import {
  effectiveReviewBadge,
  escapeHtml,
  metadataForRecord,
  recordId,
  recordIsExcluded,
  recordIsTest,
  recordIsTrashed,
  recordTitle,
  normalizedStatusCounts,
  summaryForRecord,
  validGps,
} from "./instructor-data.js";

const instances = new WeakMap();

function recordKey(record) {
  const metadata = metadataForRecord(record);
  const gpsKey = (gps) => validGps(gps)
    ? `${Number(gps.latitude).toFixed(7)},${Number(gps.longitude).toFixed(7)}`
    : "";
  return [
    recordId(record), gpsKey(metadata.startGps), gpsKey(metadata.endGps), recordColor(record),
    recordTitle(record), metadata.trail || "", effectiveReviewBadge(record).text,
  ].join("|");
}

function geometryKey(record) {
  const metadata = metadataForRecord(record);
  const gpsKey = (gps) => validGps(gps)
    ? `${Number(gps.latitude).toFixed(7)},${Number(gps.longitude).toFixed(7)}`
    : "";
  return [recordId(record), gpsKey(metadata.startGps), gpsKey(metadata.endGps)].join("|");
}

function coordinates(gps) {
  return [Number(gps.latitude), Number(gps.longitude)];
}

function recordColor(record) {
  if (recordIsTrashed(record)) return "#8e3030";
  if (recordIsTest(record)) return "#7148a6";
  if (recordIsExcluded(record)) return "#9a6a0b";
  if (normalizedStatusCounts(summaryForRecord(record)).incomplete > 0) return "#c16b20";
  const badge = effectiveReviewBadge(record);
  if (badge.text === "Needs Follow Up" || badge.text === "Questionable") return "#b46719";
  return "#176554";
}

function popupMarkup(record) {
  const metadata = metadataForRecord(record);
  return `<div class="map-popup"><strong>${escapeHtml(recordTitle(record))}</strong><br>`
    + `<span>${escapeHtml(metadata.trail || "Trail not entered")}</span><br>`
    + `<span>${escapeHtml(effectiveReviewBadge(record).text)}</span></div>`;
}

function fallbackMap(container, records, onSelect) {
  const located = records.filter((record) => {
    const metadata = metadataForRecord(record);
    return validGps(metadata.startGps) || validGps(metadata.endGps);
  });
  container.innerHTML = located.length
    ? `<div class="map-fallback"><p><strong>Interactive map unavailable.</strong> Located records remain accessible below.</p>${located.map((record) => {
      const metadata = metadataForRecord(record);
      const endpoints = [
        validGps(metadata.startGps) ? `Start ${Number(metadata.startGps.latitude).toFixed(5)}, ${Number(metadata.startGps.longitude).toFixed(5)}` : "",
        validGps(metadata.endGps) ? `End ${Number(metadata.endGps.latitude).toFixed(5)}, ${Number(metadata.endGps.longitude).toFixed(5)}` : "",
      ].filter(Boolean).join(" · ");
      return `<button type="button" data-map-record="${escapeHtml(recordId(record))}"><strong>${escapeHtml(recordTitle(record))}</strong><span>${escapeHtml(endpoints)}</span></button>`;
    }).join("")}</div>`
    : `<div class="map-empty">No filtered records have usable GPS coordinates.</div>`;
  container.querySelectorAll("[data-map-record]").forEach((button) => {
    button.addEventListener("click", () => onSelect?.(button.dataset.mapRecord));
  });
}

function setLayerSelected(entry, selected) {
  if (!entry) return;
  const { color } = entry;
  entry.primary.setStyle?.({
    color,
    weight: selected ? 7 : 4,
    opacity: selected ? 1 : .82,
    ...(entry.endpoints.length ? {} : { fillColor: color, fillOpacity: selected ? .92 : .72 }),
  });
  if (!entry.endpoints.length) entry.primary.setRadius?.(selected ? 10 : 8);
  entry.endpoints.forEach((endpoint) => {
    endpoint.setStyle?.({
      color,
      fillColor: selected ? color : "#fff",
      fillOpacity: selected ? .92 : 1,
      weight: selected ? 3 : 2,
    });
    endpoint.setRadius?.(selected ? 7 : 5);
  });
  if (selected) {
    entry.primary.bringToFront?.();
    entry.endpoints.forEach((endpoint) => endpoint.bringToFront?.());
  }
}

function fitContext(context, selectedOnly = false) {
  if (!context) return false;
  const selected = selectedOnly ? context.records.get(context.selectedId) : null;
  const points = selected?.points?.length ? selected.points : context.bounds;
  if (!points.length) {
    context.map.setView([39.5296, -119.8138], 9, { animate: false });
    return false;
  }
  if (points.length === 1) context.map.setView(points[0], 15, { animate: false });
  else context.map.fitBounds(points, { padding: [32, 32], maxZoom: 16, animate: false });
  return true;
}

export function fitInstructorMap(container, { selectedOnly = false } = {}) {
  const context = instances.get(container);
  if (!context) return false;
  context.map.invalidateSize({ pan: false });
  return fitContext(context, selectedOnly);
}

export function invalidateInstructorMap(container) {
  const context = instances.get(container);
  if (!context) return;
  requestAnimationFrame(() => context.map.invalidateSize({ pan: false }));
}

export function renderInstructorMap(container, records, { selectedId = "", onSelect } = {}) {
  if (!container) return;
  const L = globalThis.L;
  if (!L?.map || !L?.tileLayer) {
    fallbackMap(container, records, onSelect);
    return;
  }

  let context = instances.get(container);
  if (!context) {
    container.replaceChildren();
    const map = L.map(container, {
      zoomControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: true,
      touchZoom: true,
      keyboard: true,
    });
    const zoomControl = L.control?.zoom?.({ position: "bottomright" });
    zoomControl?.addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    context = {
      map,
      layer: L.featureGroup().addTo(map),
      records: new Map(),
      bounds: [],
      dataKey: null,
      geometryKey: null,
      selectedId: "",
    };
    if (globalThis.ResizeObserver) {
      context.resizeObserver = new globalThis.ResizeObserver(() => {
        globalThis.cancelAnimationFrame?.(context.resizeFrame);
        context.resizeFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
      });
      context.resizeObserver.observe(container);
    }
    instances.set(container, context);
  }

  const dataKey = records.map(recordKey).sort().join(";");
  const nextGeometryKey = records.map(geometryKey).sort().join(";");
  const dataChanged = dataKey !== context.dataKey;
  const geometryChanged = nextGeometryKey !== context.geometryKey;
  if (dataChanged) {
    context.layer.clearLayers();
    context.records.clear();
    context.bounds = [];
    for (const record of records) {
      const metadata = metadataForRecord(record);
      const points = [metadata.startGps, metadata.endGps].filter(validGps).map(coordinates);
      if (!points.length) continue;
      const id = recordId(record);
      const color = recordColor(record);
      const activate = (target) => {
        target.bindPopup(popupMarkup(record), { autoPanPadding: [24, 24] });
        target.bindTooltip?.(escapeHtml(recordTitle(record)), { direction: "top", offset: [0, -6] });
        target.on("click", () => onSelect?.(id));
        return target;
      };
      let primary;
      const endpoints = [];
      if (points.length === 2) {
        primary = L.polyline(points, { color, weight: 4, opacity: .82 });
        points.forEach((point) => {
          const endpoint = L.circleMarker(point, { radius: 5, color, fillColor: "#fff", fillOpacity: 1, weight: 2 });
          activate(endpoint).addTo(context.layer);
          endpoints.push(endpoint);
        });
      } else {
        primary = L.circleMarker(points[0], { radius: 8, color, fillColor: color, fillOpacity: .72, weight: 2 });
      }
      activate(primary).addTo(context.layer);
      context.records.set(id, { primary, endpoints, points, color });
      context.bounds.push(...points);
    }
    context.dataKey = dataKey;
    context.geometryKey = nextGeometryKey;
  }

  if (context.selectedId !== selectedId || dataChanged) {
    setLayerSelected(context.records.get(context.selectedId), false);
    context.selectedId = selectedId;
    setLayerSelected(context.records.get(selectedId), true);
  }

  requestAnimationFrame(() => {
    context.map.invalidateSize({ pan: false });
    if (geometryChanged) fitContext(context);
  });
}

export function destroyInstructorMap(container) {
  const context = instances.get(container);
  if (context) {
    context.resizeObserver?.disconnect();
    globalThis.cancelAnimationFrame?.(context.resizeFrame);
    context.map.remove();
  }
  instances.delete(container);
}
