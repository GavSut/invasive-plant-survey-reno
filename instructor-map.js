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
    const map = L.map(container, { zoomControl: true, scrollWheelZoom: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    context = { map, layer: L.featureGroup().addTo(map) };
    instances.set(container, context);
  }

  context.layer.clearLayers();
  const bounds = [];
  for (const record of records) {
    const metadata = metadataForRecord(record);
    const points = [metadata.startGps, metadata.endGps].filter(validGps).map(coordinates);
    if (!points.length) continue;
    const color = recordColor(record);
    const isSelected = recordId(record) === selectedId;
    const style = { color, weight: isSelected ? 6 : 4, opacity: isSelected ? 1 : .82 };
    const activate = (target) => {
      target.bindPopup(popupMarkup(record));
      target.on("click", () => onSelect?.(recordId(record)));
      return target;
    };
    let layer;
    if (points.length === 2) {
      layer = L.polyline(points, style);
      points.forEach((point) => activate(L.circleMarker(point, { radius: isSelected ? 6 : 4, color, fillColor: "#fff", fillOpacity: 1, weight: 2 })).addTo(context.layer));
    } else {
      layer = L.circleMarker(points[0], { radius: isSelected ? 9 : 7, color, fillColor: color, fillOpacity: .72, weight: isSelected ? 4 : 2 });
    }
    activate(layer);
    layer.addTo(context.layer);
    bounds.push(...points);
  }

  if (!bounds.length) {
    context.map.setView([39.5296, -119.8138], 9);
  } else if (bounds.length === 1) {
    context.map.setView(bounds[0], 15);
  } else {
    context.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
  }
  requestAnimationFrame(() => context.map.invalidateSize());
}

export function destroyInstructorMap(container) {
  const context = instances.get(container);
  if (context) context.map.remove();
  instances.delete(container);
}
