import { CONFIG, backendIsConfigured } from "./config.js";
import { SPECIES, SPECIES_LIST_VERSION, validateSpeciesList } from "./species.js";
import {
  CELL_STATUSES,
  DISTANCE_BANDS,
  addSpecies,
  addUnknown,
  computeSummary,
  createTransect,
  findCell,
  markCells,
  removeSpecies,
  removeUnknown,
  setCellStatus,
  toLongCsv,
  validateTransect,
  makeId,
} from "./protocol.js";
import {
  getBlob,
  getTransect,
  listTransects,
  makeBackup,
  putBlob,
  putTransect,
  requestPersistentStorage,
  restoreBackup,
  storageEstimate,
} from "./storage.js";
import {
  enrollInClass,
  fetchOwnTransects,
  getMembership,
  syncTransect,
} from "./backend.js";

const app = document.querySelector("#app");
const headerContext = document.querySelector("#header-context");
const connectionPill = document.querySelector("#connection-pill");
const connectionText = document.querySelector("#connection-text");
const bottomNav = document.querySelector("#bottom-nav");
const cellDialog = document.querySelector("#cell-dialog");
const cellDialogContext = document.querySelector("#cell-dialog-context");
const cellDialogTitle = document.querySelector("#cell-dialog-title");
const cellDialogBody = document.querySelector("#cell-dialog-body");
const confirmDialog = document.querySelector("#confirm-dialog");
const photoInput = document.querySelector("#photo-input");
const backupInput = document.querySelector("#backup-input");

const state = {
  view: "home",
  transects: [],
  active: null,
  segmentIndex: 0,
  editingCell: null,
  photoContext: null,
  syncing: false,
  membership: null,
  storage: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "Date not entered";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatTimestamp(value) {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

function slug(value) {
  return String(value || "transect").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "transect";
}

function humanStatus(status) {
  return ({
    draft: "Draft",
    saved_on_this_phone: "Saved on this phone",
    pending_upload: "Pending upload",
    upload_partially_complete: "Upload partially complete",
    submitted: "Submitted",
    submission_failed: "Submission failed",
    edited_after_submission: "Edited after submission",
  })[status] || String(status || "Draft").replaceAll("_", " ");
}

function statusClass(status) {
  return String(status || "draft").replaceAll("_", "-");
}

function toast(message, type = "info", duration = 4200) {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  document.querySelector("#toast-region").append(element);
  setTimeout(() => element.remove(), duration);
}

function updateConnection() {
  const online = navigator.onLine;
  connectionPill.classList.toggle("online", online);
  connectionPill.classList.toggle("offline", !online);
  connectionText.textContent = online ? "Online" : "Offline - local only";
}

async function saveActive({ changed = true } = {}) {
  if (!state.active) return;
  if (changed) {
    state.active.modifiedAt = new Date().toISOString();
    if (state.active.originalSubmittedAt) {
      if (state.active.syncStatus !== "edited_after_submission") state.active.revisionNumber += 1;
      state.active.syncStatus = "edited_after_submission";
    } else if (state.active.syncStatus !== "pending_upload") {
      state.active.syncStatus = "saved_on_this_phone";
    }
  }
  await putTransect(state.active);
  const index = state.transects.findIndex((item) => item.id === state.active.id);
  if (index >= 0) state.transects[index] = structuredClone(state.active);
  else state.transects.unshift(structuredClone(state.active));
}

function setView(view) {
  state.view = view;
  render();
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function updateChrome() {
  const hasActive = Boolean(state.active);
  const contextByView = {
    home: "Field records",
    details: "Transect details",
    entry: state.active ? `Segment ${state.segmentIndex}-${state.segmentIndex + 1} m` : "Field entry",
    summary: "Review & submit",
    settings: "Class & backup",
  };
  headerContext.textContent = contextByView[state.view] || "Field records";
  bottomNav.querySelectorAll("button").forEach((button) => {
    const target = button.dataset.nav;
    button.classList.toggle("active", target === state.view || (target === "home" && state.view === "details"));
    button.disabled = target === "summary" && !hasActive;
  });
}

function render() {
  updateChrome();
  if (state.view === "details" && state.active) return renderDetails();
  if (state.view === "entry" && state.active) return renderEntry();
  if (state.view === "summary" && state.active) return renderSummary();
  if (state.view === "settings") return renderSettings();
  state.view = "home";
  return renderHome();
}

function renderHome() {
  const records = state.transects.map((transect) => {
    const summary = computeSummary(transect);
    const title = [transect.metadata.site, transect.metadata.transectNumber && `Transect ${transect.metadata.transectNumber}`].filter(Boolean).join(" - ") || "Untitled transect";
    const percent = Math.round((summary.completed / summary.totalCells) * 100);
    return `
      <article class="card transect-card">
        <button class="open-record" type="button" data-action="open-record" data-id="${escapeHtml(transect.id)}" aria-label="Open ${escapeHtml(title)}"></button>
        <div class="card-content">
          <div class="card-header">
            <div>
              <p class="transect-name">${escapeHtml(title)}</p>
              <p class="transect-meta">${escapeHtml(formatDate(transect.metadata.surveyDate))} · ${summary.completed} of 300 cells</p>
            </div>
            <span class="status-badge ${statusClass(transect.syncStatus)}">${escapeHtml(humanStatus(transect.syncStatus))}</span>
          </div>
          <div class="mini-progress" aria-label="${percent}% complete"><span style="width:${percent}%"></span></div>
        </div>
      </article>`;
  }).join("");

  app.innerHTML = `
    <section class="hero-card card">
      <p class="eyebrow">30-meter protocol</p>
      <h1>Start where the trail begins.</h1>
      <p>Thirty true 1-meter segments, from <strong>0-1 m</strong> through <strong>29-30 m</strong>. Every segment contains five bands on each side of the trail.</p>
      <div class="hero-actions">
        <button class="button light" type="button" data-action="new-transect" data-method="digital_field">New field transect</button>
        <button class="button secondary" type="button" data-action="new-transect" data-method="paper_transcription">Transcribe paper sheet</button>
      </div>
    </section>
    <section class="page-heading" style="margin-top:1.35rem">
      <p class="eyebrow">On this phone</p>
      <h2>Saved transects</h2>
    </section>
    <div class="transect-list">${records || `<div class="empty-state"><strong>No transects yet.</strong><br>Create one above. It will remain on this phone if service disappears.</div>`}</div>`;
}

async function startNew(entryMethod) {
  const transect = createTransect({ entryMethod, speciesListVersion: SPECIES_LIST_VERSION });
  transect.appVersion = CONFIG.appVersion;
  transect.metadata.surveyDate = localDate();
  await putTransect(transect);
  state.transects.unshift(structuredClone(transect));
  state.active = transect;
  state.segmentIndex = 0;
  setView("details");
}

function gpsFields(prefix, gps) {
  return `
    <div class="gps-row">
      <div class="gps-row-header">
        <strong>${prefix === "start" ? "Start GPS" : "End GPS"}</strong>
        <button class="button small-button soft" type="button" data-action="capture-gps" data-kind="${prefix}">Capture ${prefix === "start" ? "Start" : "End"} GPS</button>
      </div>
      <p class="gps-readout" id="${prefix}-gps-readout">${gps
        ? `${Number(gps.latitude).toFixed(6)}, ${Number(gps.longitude).toFixed(6)} · ±${Math.round(Number(gps.accuracy || 0))} m · ${escapeHtml(formatTimestamp(gps.timestamp))}`
        : "Optional - not captured"}</p>
      <details>
        <summary class="small">Enter or correct coordinates manually</summary>
        <div class="manual-coordinates">
          <label class="field"><span>Latitude</span><input inputmode="decimal" name="${prefix}Latitude" value="${escapeHtml(gps?.latitude ?? "")}" placeholder="39.123456"></label>
          <label class="field"><span>Longitude</span><input inputmode="decimal" name="${prefix}Longitude" value="${escapeHtml(gps?.longitude ?? "")}" placeholder="-119.123456"></label>
        </div>
      </details>
    </div>`;
}

function renderDetails() {
  const t = state.active;
  const m = t.metadata;
  app.innerHTML = `
    <section class="page-heading">
      <p class="eyebrow">${t.entryMethod === "paper_transcription" ? "Paper transcription" : "Digital field entry"}</p>
      <h1>Transect details</h1>
      <p>These fields travel with every exported survey cell. GPS is optional and records endpoints only.</p>
    </section>
    <form id="details-form" class="card form-grid two">
      <label class="field span-two"><span>Observer name(s) *</span><input name="observers" required autocomplete="name" value="${escapeHtml(m.observers)}" placeholder="Gavin Sutter, Alex Chen"></label>
      <label class="field"><span>Survey date *</span><input name="surveyDate" type="date" required value="${escapeHtml(m.surveyDate)}"></label>
      <label class="field"><span>Transect # *</span><input name="transectNumber" required value="${escapeHtml(m.transectNumber)}" placeholder="3"></label>
      <label class="field"><span>Site *</span><input name="site" required value="${escapeHtml(m.site)}" placeholder="North Campus Trail"></label>
      <label class="field"><span>Trail</span><input name="trail" value="${escapeHtml(m.trail)}" placeholder="Creek Loop"></label>
      <label class="field"><span>Start time</span><input name="startTime" type="time" value="${escapeHtml(m.startTime)}"></label>
      <label class="field"><span>End time</span><input name="endTime" type="time" value="${escapeHtml(m.endTime)}"></label>
      <section class="span-two gps-panel" aria-label="GPS endpoints">
        ${gpsFields("start", m.startGps)}
        ${gpsFields("end", m.endGps)}
      </section>
      <label class="field span-two"><span>General notes</span><textarea name="generalNotes" placeholder="Weather, access, protocol deviations, or other transect-wide notes">${escapeHtml(m.generalNotes)}</textarea></label>
      <div class="span-two button-row">
        <button class="button" type="submit">Save and enter observations</button>
        <button class="button secondary" type="button" data-action="go-home">Save and return later</button>
      </div>
    </form>`;
}

function readGpsFromForm(form, prefix, existing) {
  const latitudeText = form.elements[`${prefix}Latitude`].value.trim();
  const longitudeText = form.elements[`${prefix}Longitude`].value.trim();
  if (!latitudeText && !longitudeText) return existing;
  if (!latitudeText || !longitudeText) throw new Error(`Enter both ${prefix} latitude and longitude, or leave both blank.`);
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error(`${prefix} latitude must be between -90 and 90.`);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error(`${prefix} longitude must be between -180 and 180.`);
  return {
    latitude,
    longitude,
    accuracy: existing?.accuracy ?? null,
    timestamp: existing?.timestamp || new Date().toISOString(),
    source: existing?.source || "manual",
  };
}

async function saveDetails(form, continueToEntry = true) {
  const data = new FormData(form);
  const m = state.active.metadata;
  m.observers = String(data.get("observers") || "").trim();
  m.surveyDate = String(data.get("surveyDate") || "");
  m.site = String(data.get("site") || "").trim();
  m.trail = String(data.get("trail") || "").trim();
  m.transectNumber = String(data.get("transectNumber") || "").trim();
  m.startTime = String(data.get("startTime") || "");
  m.endTime = String(data.get("endTime") || "");
  m.generalNotes = String(data.get("generalNotes") || "").trim();
  m.startGps = readGpsFromForm(form, "start", m.startGps);
  m.endGps = readGpsFromForm(form, "end", m.endGps);
  await saveActive();
  toast("Transect details saved.");
  if (continueToEntry) setView("entry");
}

function captureGps(kind) {
  if (!navigator.geolocation) {
    toast("This browser does not provide GPS. You can enter coordinates manually.", "warning");
    return;
  }
  toast(`Requesting ${kind} location…`);
  navigator.geolocation.getCurrentPosition(async (position) => {
    state.active.metadata[`${kind}Gps`] = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: new Date(position.timestamp).toISOString(),
      source: "device_gps",
    };
    await saveActive();
    renderDetails();
    toast(`${kind === "start" ? "Start" : "End"} GPS saved with ±${Math.round(position.coords.accuracy)} m reported accuracy.`);
  }, (error) => {
    const messages = {
      1: "Location permission was denied. Continue without GPS or enter coordinates manually.",
      2: "GPS is unavailable. Continue without it or enter coordinates manually.",
      3: "GPS timed out. Move to open sky and retry, or continue without it.",
    };
    toast(messages[error.code] || "GPS could not be captured. The survey is still saved.", "warning", 6500);
  }, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
}

function cellStateText(cell) {
  if (cell.status === CELL_STATUSES.NO_TARGET) return "0 · no target";
  if (cell.status === CELL_STATUSES.NOT_SURVEYED) return "NS";
  if (cell.status === CELL_STATUSES.DETECTED) {
    const codes = [...cell.species, ...cell.unknowns.map(() => "?")];
    return codes.join(", ");
  }
  return "Incomplete";
}

function cellHasPhoto(segmentIndex, cell) {
  return state.active.photos.some((photo) => photo.segmentIndex === segmentIndex
    && photo.side === cell.side && Number(photo.bandStart) === Number(cell.bandStart));
}

function cellButton(segmentIndex, cell) {
  return `
    <button class="cell-button ${cell.status} ${cellHasPhoto(segmentIndex, cell) ? "has-photo" : ""}" type="button"
      data-action="edit-cell" data-side="${cell.side}" data-band="${cell.bandStart}"
      aria-label="${cell.side}, ${cell.bandStart} to ${cell.bandEnd} meters: ${escapeHtml(cellStateText(cell))}">
      <span class="band">${cell.bandStart}-${cell.bandEnd} m</span>
      <span class="cell-state">${escapeHtml(cellStateText(cell))}</span>
    </button>`;
}

function renderSidePanel(segment, side) {
  const cells = segment.cells
    .filter((cell) => cell.side === side)
    .sort((a, b) => side === "left" ? b.bandStart - a.bandStart : a.bandStart - b.bandStart);
  const complete = cells.filter((cell) => cell.status !== CELL_STATUSES.INCOMPLETE).length;
  return `
    <section class="side-panel ${side}">
      <header class="side-heading"><strong>${side.toUpperCase()}</strong><span>${complete} of 5 complete</span></header>
      <div class="cells">${cells.map((cell) => cellButton(segment.index, cell)).join("")}</div>
      <div class="quick-actions">
        <button type="button" data-action="mark-side-zero" data-side="${side}">Incomplete ${side} cells = 0</button>
        <button type="button" data-action="mark-side-ns" data-side="${side}">Incomplete ${side} cells = NS</button>
      </div>
    </section>`;
}

function renderEntry() {
  updateChrome();
  const t = state.active;
  const segment = t.segments[state.segmentIndex];
  const summary = computeSummary(t);
  const percent = (summary.completed / summary.totalCells) * 100;
  app.innerHTML = `
    <section class="entry-toolbar">
      <div class="segment-title-row">
        <div>
          <p class="eyebrow">True 1-meter trail segment</p>
          <h1>${segment.startM}-${segment.endM} m</h1>
        </div>
        <span class="segment-count">Segment ${segment.index + 1} of 30</span>
      </div>
      <div class="progress-block">
        <div class="progress-track" role="progressbar" aria-label="Survey cells completed" aria-valuemin="0" aria-valuemax="300" aria-valuenow="${summary.completed}"><div class="progress-fill" style="width:${percent}%"></div></div>
        <strong>${summary.completed}/300</strong>
        <p class="progress-label">Completed cells · viewing a cell never marks it complete</p>
      </div>
    </section>
    <aside class="orientation-alert">
      <span class="orientation-arrow" aria-hidden="true">↑</span>
      <div><strong>Always face from transect start toward transect end.</strong><br>LEFT and RIGHT stay fixed even if you turn around. Record each plant in the cell containing its rooted location.</div>
    </aside>
    <div class="cross-section" aria-label="Cross-section orientation">
      <span class="cross-left">LEFT · 5 m ←</span><span class="trail-line">TRAIL CENTERLINE · ↑ FORWARD</span><span class="cross-right">→ 5 m · RIGHT</span>
    </div>
    <div class="side-grid">
      ${renderSidePanel(segment, "left")}
      ${renderSidePanel(segment, "right")}
    </div>
    <section class="card meter-note">
      <label class="field"><span>Segment ${segment.startM}-${segment.endM} m note</span><textarea data-action="segment-note" placeholder="Optional note for this 1-meter trail segment">${escapeHtml(segment.note)}</textarea></label>
      <div class="meter-actions">
        <button class="button small-button secondary" type="button" data-action="add-photo" data-scope="meter">Add segment photo</button>
        <button class="button small-button soft" type="button" data-action="mark-all-zero">All 10 incomplete cells = 0</button>
        <button class="button small-button secondary" type="button" data-action="edit-details">Transect details &amp; GPS</button>
      </div>
    </section>
    <nav class="segment-navigation" aria-label="Segment navigation">
      <button class="button secondary" type="button" data-action="previous-segment" ${state.segmentIndex === 0 ? "disabled" : ""}>← Previous</button>
      <select class="meter-jump" data-action="jump-segment" aria-label="Jump to segment">
        ${t.segments.map((item) => `<option value="${item.index}" ${item.index === state.segmentIndex ? "selected" : ""}>${item.startM}-${item.endM} m</option>`).join("")}
      </select>
      <button class="button" type="button" data-action="next-segment">${state.segmentIndex === 29 ? "Summary →" : "Next →"}</button>
    </nav>`;
}

function openCell(side, bandStart) {
  state.editingCell = { segmentIndex: state.segmentIndex, side, bandStart: Number(bandStart) };
  renderCellDialog();
  cellDialog.showModal();
}

function currentCell() {
  if (!state.editingCell || !state.active) return null;
  return findCell(state.active, state.editingCell.segmentIndex, state.editingCell.side, state.editingCell.bandStart);
}

function renderSelectedObservations(cell) {
  const speciesItems = cell.species.map((code) => {
    const species = SPECIES.find((item) => item.code === code);
    return `
      <div class="selected-item">
        <span><strong>${escapeHtml(code)}</strong>${species ? ` · ${escapeHtml(species.commonName)}` : ""}</span>
        <span class="item-actions">
          <button class="tiny-icon" type="button" data-action="add-photo" data-scope="observation" data-species="${escapeHtml(code)}" aria-label="Add photo for ${escapeHtml(code)}">◉</button>
          <button class="tiny-icon" type="button" data-action="remove-species" data-code="${escapeHtml(code)}" aria-label="Remove ${escapeHtml(code)}">×</button>
        </span>
      </div>`;
  });
  const unknownItems = cell.unknowns.map((unknown, index) => `
    <div class="selected-item">
      <span><strong>Unknown ${index + 1}</strong>${unknown.note ? ` · ${escapeHtml(unknown.note)}` : ""}</span>
      <span class="item-actions">
        <button class="tiny-icon" type="button" data-action="add-photo" data-scope="observation" data-unknown="${escapeHtml(unknown.id)}" aria-label="Add photo for unknown ${index + 1}">◉</button>
        <button class="tiny-icon" type="button" data-action="remove-unknown" data-id="${escapeHtml(unknown.id)}" aria-label="Remove unknown ${index + 1}">×</button>
      </span>
    </div>`);
  return [...speciesItems, ...unknownItems].join("") || `<p class="muted small">No detections in this cell yet.</p>`;
}

function renderCellDialog() {
  const cell = currentCell();
  if (!cell) return;
  const segment = state.active.segments[state.editingCell.segmentIndex];
  cellDialogContext.textContent = `Segment ${segment.startM}-${segment.endM} m · ${cell.side.toUpperCase()}`;
  cellDialogTitle.textContent = `${cell.bandStart}-${cell.bandEnd} m from trail centerline`;
  cellDialogBody.innerHTML = `
    <section class="dialog-section">
      <div class="dialog-section-title"><h3>Cell status</h3></div>
      <div class="status-options">
        <button type="button" class="status-option zero ${cell.status === CELL_STATUSES.NO_TARGET ? "active" : ""}" data-action="set-cell-status" data-status="${CELL_STATUSES.NO_TARGET}">0 · surveyed, none</button>
        <button type="button" class="status-option ns ${cell.status === CELL_STATUSES.NOT_SURVEYED ? "active" : ""}" data-action="set-cell-status" data-status="${CELL_STATUSES.NOT_SURVEYED}">NS · not surveyed</button>
        <button type="button" class="status-option clear ${cell.status === CELL_STATUSES.INCOMPLETE ? "active" : ""}" data-action="set-cell-status" data-status="${CELL_STATUSES.INCOMPLETE}">Leave incomplete</button>
        <button type="button" class="status-option" data-action="add-photo" data-scope="cell">Add cell photo</button>
      </div>
    </section>
    <section class="dialog-section">
      <div class="dialog-section-title"><h3>Detected species</h3><span class="small muted">Tap to add/remove</span></div>
      <label class="field"><span class="visually-hidden">Filter species</span><input id="species-filter" type="search" placeholder="Search code, common, or scientific name"></label>
      <div class="species-grid" id="species-grid">
        ${SPECIES.map((species) => `
          <button type="button" class="species-choice ${cell.species.includes(species.code) ? "selected" : ""}" data-action="toggle-species" data-code="${escapeHtml(species.code)}" data-search="${escapeHtml(`${species.code} ${species.commonName} ${species.scientificName}`.toLowerCase())}">
            <strong>${escapeHtml(species.code)}</strong><span>${escapeHtml(species.commonName)}<br><i>${escapeHtml(species.scientificName)}</i></span>
          </button>`).join("")}
      </div>
    </section>
    <section class="dialog-section">
      <div class="dialog-section-title"><h3>Current observations</h3></div>
      <div class="selected-list">${renderSelectedObservations(cell)}</div>
      <div class="unknown-row">
        <input id="unknown-note" maxlength="240" placeholder="Questionable plant note (identity not required)">
        <button class="button secondary" type="button" data-action="add-unknown">Add unknown</button>
      </div>
    </section>
    <section class="dialog-section">
      <label class="field"><span>Cell note</span><textarea data-action="cell-note" placeholder="Optional note for this cell">${escapeHtml(cell.note)}</textarea></label>
    </section>`;
}

async function persistCellAndRefresh() {
  await saveActive();
  renderCellDialog();
}

async function setStatusWithConfirmation(status) {
  const cell = currentCell();
  const hasObservations = cell.species.length || cell.unknowns.length;
  if (hasObservations && status !== CELL_STATUSES.DETECTED) {
    const accepted = await askConfirm("Replace detected observations?", "This will remove the species and unknown observations currently recorded in this cell.", { dangerLabel: "Replace cell" });
    if (!accepted) return;
  }
  setCellStatus(cell, status);
  await persistCellAndRefresh();
}

function askConfirm(title, message, { dangerLabel = "Continue", checkLabel = "" } = {}) {
  confirmDialog.returnValue = "";
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  document.querySelector("#confirm-accept").textContent = dangerLabel;
  const row = document.querySelector("#confirm-check-row");
  const checkbox = document.querySelector("#confirm-check");
  const label = document.querySelector("#confirm-check-label");
  checkbox.checked = false;
  row.classList.toggle("hidden", !checkLabel);
  label.textContent = checkLabel;
  document.querySelector("#confirm-accept").disabled = Boolean(checkLabel);
  const changeHandler = () => { document.querySelector("#confirm-accept").disabled = checkLabel ? !checkbox.checked : false; };
  checkbox.addEventListener("change", changeHandler);
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener("close", () => {
      checkbox.removeEventListener("change", changeHandler);
      resolve(confirmDialog.returnValue === "default");
    }, { once: true });
  });
}

async function markBatch(side, status) {
  const label = status === CELL_STATUSES.NO_TARGET ? "0 (surveyed, no target)" : "NS (not surveyed)";
  const scope = side ? `${side.toUpperCase()} side` : "all 10 cells";
  const accepted = await askConfirm(`Mark ${scope}?`, `Only incomplete cells in this ${state.active.segments[state.segmentIndex].label} segment will be marked ${label}. Existing detections and completed cells will not change.`, { dangerLabel: `Mark ${label}` });
  if (!accepted) return;
  const changed = markCells(state.active, state.segmentIndex, side, status, { incompleteOnly: true });
  await saveActive();
  renderEntry();
  toast(`${changed} cell${changed === 1 ? "" : "s"} marked ${label}.`);
}

function choosePhoto(context) {
  state.photoContext = context;
  photoInput.value = "";
  photoInput.click();
}

async function compressPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, CONFIG.maxPhotoDimensionPx / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Photo compression failed.")), "image/jpeg", CONFIG.jpegQuality));
    return blob;
  } catch {
    return file;
  }
}

async function storeSelectedPhoto(file) {
  if (!state.active || !state.photoContext) return;
  const blob = await compressPhoto(file);
  const note = window.prompt("Optional short photo note:", "") ?? "";
  const id = makeId("photo");
  const blobId = makeId("blob");
  const context = state.photoContext;
  const photo = {
    id,
    blobId,
    scope: context.scope,
    segmentIndex: context.segmentIndex,
    side: context.side || null,
    bandStart: context.bandStart ?? null,
    speciesCode: context.speciesCode || null,
    unknownId: context.unknownId || null,
    note: note.trim(),
    capturedAt: new Date().toISOString(),
    originalName: file.name || "camera-photo",
    mimeType: blob.type || file.type || "image/jpeg",
    sizeBytes: blob.size,
    syncStatus: "pending_upload",
  };
  await putBlob(blobId, blob, { photoId: id, transectId: state.active.id });
  state.active.photos.push(photo);
  await saveActive();
  state.photoContext = null;
  if (cellDialog.open) renderCellDialog();
  else render();
  toast("Photo saved on this phone and queued with the transect.");
}

function renderSummary() {
  const t = state.active;
  const summary = computeSummary(t);
  const m = t.metadata;
  const photoStates = (t.photos || []).reduce((counts, photo) => {
    counts[photo.syncStatus || "pending_upload"] = (counts[photo.syncStatus || "pending_upload"] || 0) + 1;
    return counts;
  }, {});
  const pendingPhotos = (photoStates.pending_upload || 0) + (photoStates.submission_failed || 0);
  const incompleteLinks = t.segments.flatMap((segment) => segment.cells
    .filter((cell) => cell.status === CELL_STATUSES.INCOMPLETE)
    .map((cell) => `<button class="incomplete-link" type="button" data-action="jump-cell" data-segment="${segment.index}" data-side="${cell.side}" data-band="${cell.bandStart}">${segment.label} · ${cell.side[0].toUpperCase()} ${cell.bandStart}-${cell.bandEnd}</button>`)).join("");
  app.innerHTML = `
    <section class="page-heading">
      <p class="eyebrow">Review before submission</p>
      <h1>${escapeHtml(m.site || "Untitled site")} · Transect ${escapeHtml(m.transectNumber || "not entered")}</h1>
      <p>${escapeHtml(m.observers || "Observers not entered")} · ${escapeHtml(formatDate(m.surveyDate))}</p>
    </section>
    <section class="summary-grid">
      <div class="metric"><strong>${summary.completed}</strong><span>of 300 cells complete</span></div>
      <div class="metric"><strong>${summary.detectedCells}</strong><span>cells with detections</span></div>
      <div class="metric"><strong>${summary.noTargetCells}</strong><span>0 cells</span></div>
      <div class="metric"><strong>${summary.notSurveyedCells}</strong><span>NS cells</span></div>
      <div class="metric ${summary.incompleteCells ? "attention" : ""}"><strong>${summary.incompleteCells}</strong><span>incomplete cells</span></div>
      <div class="metric"><strong>${summary.species.length}</strong><span>confirmed species</span></div>
      <div class="metric"><strong>${summary.unknownCount}</strong><span>unknown plants</span></div>
      <div class="metric"><strong>${summary.photoCount}</strong><span>photos attached</span></div>
    </section>
    <section class="card" style="margin-top:.8rem">
      <div class="card-header"><div><h2>Transect information</h2><p class="muted small">GPS: start ${m.startGps ? "captured" : "not captured"}; end ${m.endGps ? "captured" : "not captured"}</p></div><button class="button small-button secondary" type="button" data-action="edit-details">Edit details</button></div>
      <p class="small"><strong>Trail:</strong> ${escapeHtml(m.trail || "Not entered")} · <strong>Time:</strong> ${escapeHtml(m.startTime || "-")} to ${escapeHtml(m.endTime || "-")}</p>
      <p class="small"><strong>Photos:</strong> ${summary.photoCount} attached · ${pendingPhotos} pending/failed · ${photoStates.submitted || 0} confirmed</p>
      <p class="small"><strong>Notes:</strong> ${escapeHtml(m.generalNotes || "None")}</p>
      <p><span class="status-badge ${statusClass(t.syncStatus)}">${escapeHtml(humanStatus(t.syncStatus))}</span></p>
    </section>
    <section class="card">
      <h2>Species detected</h2>
      <div class="species-summary">${summary.species.map((code) => `<span class="code-chip">${escapeHtml(code)}</span>`).join("") || `<span class="muted">No confirmed target species recorded.</span>`}</div>
    </section>
    ${summary.incompleteCells ? `<section class="card"><h2>Incomplete cells</h2><p class="muted small">Tap any location to finish it. Do not convert blanks to zero unless that cell was actually surveyed.</p><div class="incomplete-list">${incompleteLinks}</div></section>` : ""}
    <section class="card">
      <h2>Submit or preserve a copy</h2>
      <div class="button-stack">
        <button class="button" type="button" data-action="submit-transect" ${state.syncing ? "disabled" : ""}>${state.syncing ? "Uploading…" : t.originalSubmittedAt ? "Sync changes" : "Submit transect"}</button>
        <button class="button secondary" type="button" data-action="export-csv">Export long-format CSV</button>
        <button class="button secondary" type="button" data-action="export-backup">Export restorable backup with photos</button>
      </div>
      <p class="muted small" style="margin:.65rem 0 0">A server confirmation is required before this record is labeled Submitted. Local exports work without internet.</p>
    </section>`;
}

function requiredMetadataErrors(transect) {
  const m = transect.metadata;
  return [
    ["observer name(s)", m.observers],
    ["survey date", m.surveyDate],
    ["site", m.site],
    ["transect #", m.transectNumber],
  ].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
}

async function submitActive() {
  if (state.syncing) return;
  const errors = validateTransect(state.active);
  if (errors.length) {
    toast(`The transect structure failed validation: ${errors[0]}`, "error", 7000);
    return;
  }
  const missingMetadata = requiredMetadataErrors(state.active);
  if (missingMetadata.length) {
    toast(`Complete the required details: ${missingMetadata.join(", ")}.`, "warning", 6000);
    setView("details");
    return;
  }
  const summary = computeSummary(state.active);
  if (summary.incompleteCells) {
    const accepted = await askConfirm(
      `${summary.incompleteCells} cells are incomplete`,
      "Blank cells will remain incomplete; they will not be changed to 0. Return to complete them, mark them NS, or explicitly acknowledge submission with incomplete data.",
      { dangerLabel: "Submit with blanks", checkLabel: "I understand these blank cells represent incomplete data." },
    );
    if (!accepted) return;
  }
  if (!state.membership?.classId) {
    toast("Join the class before uploading. Your transect remains saved on this phone.", "warning", 6500);
    setView("settings");
    return;
  }
  if (!navigator.onLine) {
    state.active.syncStatus = "pending_upload";
    await saveActive({ changed: false });
    renderSummary();
    toast("No connection. Submission is queued; use Retry sync when online.", "warning", 6500);
    return;
  }
  state.syncing = true;
  if (!state.active.originalSubmittedAt) state.active.originalSubmittedAt = new Date().toISOString();
  state.active.syncStatus = "pending_upload";
  await saveActive({ changed: false });
  renderSummary();
  try {
    const result = await syncTransect(state.active, ({ completed, total }) => {
      const button = document.querySelector('[data-action="submit-transect"]');
      if (button) button.textContent = `Uploading ${completed} of ${total}…`;
    });
    state.active.lastSubmittedAt = new Date().toISOString();
    state.active.syncStatus = result.photoFailures.length ? "upload_partially_complete" : "submitted";
    await saveActive({ changed: false });
    toast(result.photoFailures.length
      ? `Survey data submitted; ${result.photoFailures.length} photo upload${result.photoFailures.length === 1 ? "" : "s"} still need retry. Support data is safe.`
      : "Transect and photos confirmed by the server.", result.photoFailures.length ? "warning" : "info", 7000);
  } catch (error) {
    state.active.syncStatus = "submission_failed";
    state.active.lastSyncError = error.message;
    await saveActive({ changed: false });
    toast(`Upload failed: ${error.message} The local record is safe.`, "error", 7500);
  } finally {
    state.syncing = false;
    renderSummary();
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCsv() {
  const csv = toLongCsv([state.active]);
  const name = `${slug(state.active.metadata.site)}-transect-${slug(state.active.metadata.transectNumber)}-long.csv`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), name);
  toast("Long-format CSV saved. It includes every surveyed, NS, and incomplete cell.");
}

async function exportBackupFile() {
  const backup = await makeBackup(state.active);
  const json = JSON.stringify(backup, null, 2);
  const name = `${slug(state.active.metadata.site)}-transect-${slug(state.active.metadata.transectNumber)}-backup.json`;
  downloadBlob(new Blob([json], { type: "application/json" }), name);
  toast("Restorable backup saved, including locally available photos.");
}

function renderSettings() {
  const membership = state.membership;
  const backendMessage = backendIsConfigured()
    ? "Backend configuration is present. First enrollment and uploads require internet."
    : "Backend is not configured. Local entry, CSV export, and backup still work; the instructor must edit config.js before class submission can work.";
  const usage = state.storage?.usage;
  const quota = state.storage?.quota;
  app.innerHTML = `
    <section class="page-heading">
      <p class="eyebrow">Class &amp; data safety</p>
      <h1>Sync and backups</h1>
      <p>The class code grants this browser's anonymous session access to one class. Observer names are labels, not passwords.</p>
    </section>
    <section class="card class-state">
      <div class="card-header"><div><h2>Class enrollment</h2><p class="muted small">${escapeHtml(backendMessage)}</p></div>${membership ? `<span class="status-badge submitted">Joined</span>` : ""}</div>
      ${membership ? `
        <div class="sync-detail"><strong>${escapeHtml(membership.className || "Class joined")}</strong>${membership.term ? ` · ${escapeHtml(membership.term)}` : ""}<br>Enrollment is saved on this phone.</div>
      ` : ""}
      <form id="class-form" class="form-grid">
        <label class="field"><span>${membership ? "Join a different class" : "Shared class code"}</span><input name="classCode" type="password" autocomplete="off" required placeholder="Enter instructor-provided code"></label>
        <button class="button" type="submit">${membership ? "Change current class" : "Join class on this phone"}</button>
      </form>
    </section>
    <section class="card">
      <h2>Upload and restore</h2>
      <div class="button-stack">
        <button class="button" type="button" data-action="sync-active" ${!state.active || state.syncing ? "disabled" : ""}>${state.active ? "Retry/sync current transect" : "Open a transect to sync it"}</button>
        <button class="button secondary" type="button" data-action="refresh-server" ${!membership ? "disabled" : ""}>Refresh my submissions from server</button>
        <button class="button secondary" type="button" data-action="import-backup">Import a restorable JSON backup</button>
      </div>
      <p class="muted small" style="margin:.65rem 0 0">Refreshing can recover this anonymous session's records; it cannot show another group's work.</p>
    </section>
    <section class="card">
      <h2>Offline readiness</h2>
      <p class="small">Application cache: ${navigator.serviceWorker?.controller ? "active" : "preparing after first successful load"}. Local database: ready.</p>
      <p class="small">Storage used: ${usage && quota ? `${(usage / 1048576).toFixed(1)} MB of approximately ${(quota / 1048576).toFixed(0)} MB available` : "estimate unavailable"}.</p>
      <p class="muted small">Before fieldwork, open the app online once, wait for the offline-ready message, then test airplane mode. Keep a CSV or JSON backup before clearing browser data or switching phones.</p>
    </section>
    <section class="card">
      <h2>Current versions</h2>
      <p class="small"><strong>Protocol:</strong> ${escapeHtml(state.active?.protocolVersion || "1.0.0")} · <strong>Species list:</strong> ${escapeHtml(SPECIES_LIST_VERSION)} · <strong>App:</strong> ${escapeHtml(CONFIG.appVersion)}</p>
    </section>`;
}

async function joinClass(form) {
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Joining…";
  try {
    const code = new FormData(form).get("classCode");
    state.membership = await enrollInClass(code);
    toast(`Joined ${state.membership.className || "class"}.`);
    renderSettings();
  } catch (error) {
    toast(`Could not join class: ${error.message}`, "error", 7000);
    button.disabled = false;
    button.textContent = "Join class on this phone";
  }
}

async function refreshFromServer() {
  if (!navigator.onLine) return toast("Reconnect before refreshing from the server.", "warning");
  try {
    const remote = await fetchOwnTransects();
    let added = 0;
    let updated = 0;
    for (const record of remote) {
      const local = await getTransect(record.id);
      if (!local) {
        await putTransect(record);
        added += 1;
      } else if (String(record.modifiedAt) > String(local.modifiedAt) && local.syncStatus !== "edited_after_submission") {
        await putTransect(record);
        updated += 1;
      }
    }
    state.transects = await listTransects();
    if (state.active) state.active = await getTransect(state.active.id);
    toast(`Server refresh complete: ${added} restored, ${updated} updated, ${remote.length - added - updated} unchanged.`);
    renderSettings();
  } catch (error) {
    toast(`Server refresh failed: ${error.message}`, "error", 7000);
  }
}

async function importBackupFile(file) {
  try {
    const backup = JSON.parse(await file.text());
    const structureErrors = validateTransect(backup?.transect);
    if (structureErrors.length) throw new Error(`Backup structure is invalid: ${structureErrors[0]}`);
    let replaceExisting = false;
    if (await getTransect(backup?.transect?.id)) {
      replaceExisting = await askConfirm("Replace local copy?", "This backup has the same stable record ID as a transect already on this phone. Replacing it is appropriate only when the backup is the intended copy.", { dangerLabel: "Replace local copy" });
      if (!replaceExisting) return;
    }
    const transect = await restoreBackup(backup, { replaceExisting });
    state.transects = await listTransects();
    state.active = transect;
    state.segmentIndex = 0;
    toast("Backup restored. Review the transect before syncing.");
    setView("summary");
  } catch (error) {
    toast(`Backup import failed: ${error.message}`, "error", 7000);
  }
}

function photoContextFromButton(button) {
  const cell = currentCell();
  const scope = button.dataset.scope;
  if (scope === "meter") return { scope, segmentIndex: state.segmentIndex };
  return {
    scope,
    segmentIndex: state.editingCell.segmentIndex,
    side: cell.side,
    bandStart: cell.bandStart,
    speciesCode: button.dataset.species || null,
    unknownId: button.dataset.unknown || null,
  };
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "new-transect") return startNew(button.dataset.method);
    if (action === "open-record") {
      state.active = await getTransect(button.dataset.id);
      state.segmentIndex = 0;
      return setView("entry");
    }
    if (action === "go-home") {
      const form = document.querySelector("#details-form");
      if (form) await saveDetails(form, false);
      return setView("home");
    }
    if (action === "edit-details") return setView("details");
    if (action === "edit-cell") return openCell(button.dataset.side, button.dataset.band);
    if (action === "previous-segment") {
      state.segmentIndex = Math.max(0, state.segmentIndex - 1);
      return renderEntry();
    }
    if (action === "next-segment") {
      if (state.segmentIndex === 29) return setView("summary");
      state.segmentIndex += 1;
      return renderEntry();
    }
    if (action === "mark-side-zero") return markBatch(button.dataset.side, CELL_STATUSES.NO_TARGET);
    if (action === "mark-side-ns") return markBatch(button.dataset.side, CELL_STATUSES.NOT_SURVEYED);
    if (action === "mark-all-zero") return markBatch(null, CELL_STATUSES.NO_TARGET);
    if (action === "toggle-species") {
      const cell = currentCell();
      if (cell.species.includes(button.dataset.code)) removeSpecies(cell, button.dataset.code);
      else addSpecies(cell, button.dataset.code);
      return persistCellAndRefresh();
    }
    if (action === "remove-species") {
      removeSpecies(currentCell(), button.dataset.code);
      return persistCellAndRefresh();
    }
    if (action === "add-unknown") {
      const input = document.querySelector("#unknown-note");
      addUnknown(currentCell(), input.value);
      return persistCellAndRefresh();
    }
    if (action === "remove-unknown") {
      removeUnknown(currentCell(), button.dataset.id);
      return persistCellAndRefresh();
    }
    if (action === "set-cell-status") return setStatusWithConfirmation(button.dataset.status);
    if (action === "add-photo") return choosePhoto(photoContextFromButton(button));
    if (action === "capture-gps") {
      const form = document.querySelector("#details-form");
      if (form) await saveDetails(form, false);
      return captureGps(button.dataset.kind);
    }
    if (action === "jump-cell") {
      state.segmentIndex = Number(button.dataset.segment);
      setView("entry");
      return setTimeout(() => openCell(button.dataset.side, button.dataset.band), 0);
    }
    if (action === "submit-transect") return submitActive();
    if (action === "sync-active") {
      setView("summary");
      return submitActive();
    }
    if (action === "export-csv") return exportCsv();
    if (action === "export-backup") return exportBackupFile();
    if (action === "import-backup") { backupInput.value = ""; return backupInput.click(); }
    if (action === "refresh-server") return refreshFromServer();
  } catch (error) {
    toast(error.message || "The action could not be completed.", "error", 7000);
  }
});

document.addEventListener("submit", async (event) => {
  // Let method="dialog" forms run their native Close / Cancel / Continue action.
  if (event.target.id !== "details-form" && event.target.id !== "class-form") return;
  event.preventDefault();
  try {
    if (event.target.id === "details-form") await saveDetails(event.target, true);
    if (event.target.id === "class-form") await joinClass(event.target);
  } catch (error) {
    toast(error.message, "error", 7000);
  }
});

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.matches('[data-action="jump-segment"]')) {
    state.segmentIndex = Number(target.value);
    renderEntry();
  }
  if (target.matches('[data-action="segment-note"]')) {
    state.active.segments[state.segmentIndex].note = target.value.trim();
    await saveActive();
    toast("Segment note saved.");
  }
  if (target.matches('[data-action="cell-note"]')) {
    currentCell().note = target.value.trim();
    await saveActive();
    toast("Cell note saved.");
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "species-filter") return;
  const term = event.target.value.trim().toLowerCase();
  document.querySelectorAll("#species-grid .species-choice").forEach((choice) => {
    choice.classList.toggle("hidden", term && !choice.dataset.search.includes(term));
  });
});

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  try { await storeSelectedPhoto(file); }
  catch (error) { toast(`Photo could not be saved: ${error.message}. The survey record is unchanged and safe.`, "error", 7000); }
});

backupInput.addEventListener("change", () => {
  const file = backupInput.files?.[0];
  if (file) importBackupFile(file);
});

document.querySelector("#home-button").addEventListener("click", async () => {
  try {
    const form = state.view === "details" ? document.querySelector("#details-form") : null;
    if (form) await saveDetails(form, false);
    setView("home");
  } catch (error) {
    toast(error.message, "error", 7000);
  }
});
bottomNav.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-nav]");
  if (!button || button.disabled) return;
  try {
    const form = state.view === "details" ? document.querySelector("#details-form") : null;
    if (form) await saveDetails(form, false);
    setView(button.dataset.nav);
  } catch (error) {
    toast(error.message, "error", 7000);
  }
});

window.addEventListener("online", () => { updateConnection(); toast("Connection restored. Pending uploads still require a manual retry."); });
window.addEventListener("offline", () => { updateConnection(); toast("Offline. Changes continue saving on this phone.", "warning"); });
cellDialog.addEventListener("close", () => {
  if (state.view === "entry") renderEntry();
});

async function initialize() {
  updateConnection();
  const speciesErrors = validateSpeciesList();
  if (speciesErrors.length) toast(`Species list problem: ${speciesErrors[0]}`, "error", 9000);
  try {
    await requestPersistentStorage();
    state.transects = await listTransects();
    state.membership = await getMembership();
    state.storage = await storageEstimate();
  } catch (error) {
    toast(`Local storage could not be initialized: ${error.message}`, "error", 9000);
  }
  render();
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
      toast("Offline app files are prepared on this phone.", "info", 2800);
    } catch (error) {
      toast(`Offline app caching is unavailable: ${error.message}`, "warning", 6500);
    }
  }
}

initialize();
