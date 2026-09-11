import { CONFIG } from "./config.js";
import { SPECIES } from "./species.js";
import { CELL_STATUSES, computeSummary } from "./protocol.js";
import {
  InstructorApiError,
  INSTRUCTOR_ACTIONS,
  changeTrashState,
  clearCuration,
  clearInstructorSession,
  createInstructorRequestId,
  fetchExportRecords,
  fetchInstructorBootstrap,
  fetchPhotoUrls,
  fetchRecordDetail,
  listInstructorRecords,
  loadInstructorSession,
  loginInstructor,
  permanentlyPurge,
  previewPurge,
  revertCuration,
  saveCuration,
  saveRecordState,
} from "./instructor-api.js";
import {
  CELL_STATUS_LABELS,
  activeFilterLabels,
  buildChartSeries,
  cellFor,
  completedCells,
  computeSummary as computeDashboardSummary,
  curationVersion,
  effectiveReviewBadge,
  escapeHtml,
  filtersForApi,
  formatBytes,
  formatDate,
  freshFilters,
  humanize,
  metadataForRecord,
  normalizedStatusCounts,
  payloadDifferences,
  recordHasCuration,
  recordHasGps,
  recordId,
  recordIsExcluded,
  recordIsTest,
  recordIsTrashed,
  recordReviewStatus,
  recordState,
  recordTitle,
  reconcileUnknownNotes,
  safeJson,
  sourcePayload,
  stateVersion,
  summaryForRecord,
  validateCuratedPayload,
  validGps,
} from "./instructor-data.js";
import {
  PHOTO_ZIP_LIMITS,
  downloadExport,
  downloadPhotoZip,
  filterExportBundle,
  mergeExportBundles,
  reconcilePhotoInventory,
} from "./instructor-downloads.js";
const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const filterForm = document.querySelector("#filter-form");
const recordsBody = document.querySelector("#records-body");
const recordDialog = document.querySelector("#record-dialog");
const curationDialog = document.querySelector("#curation-dialog");
const downloadDialog = document.querySelector("#download-dialog");
const actionDialog = document.querySelector("#action-dialog");
const purgeDialog = document.querySelector("#purge-dialog");
const photoDialog = document.querySelector("#photo-dialog");
const filterRail = document.querySelector("#filter-rail");
const compactDashboard = window.matchMedia("(max-width: 62rem)");

const MAX_RESOLVED_RECORDS = 5000;
const MAX_BULK_ACTION_RECORDS = 100;
const MAX_PURGE_RECORDS = 20;
const EXPORT_BATCH_SIZE = 200;
const LONG_EXPORT_BASE_ROW_LIMIT = 90_000;
const RAW_JSON_RECORD_LIMIT = 200;
const PHOTO_MANIFEST_RECORD_LIMIT = 1_000;
const TRANSFORM_EXPORT_RECORD_LIMIT = 500;

const state = {
  session: null,
  classes: [],
  records: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
  filters: freshFilters(),
  sort: { field: "serverUpdatedAt", direction: "desc" },
  summary: null,
  facets: null,
  chartMetric: "submissions",
  chartLimit: "10",
  loadedAt: null,
  selected: new Map(),
  selectedPhotos: new Set(),
  detail: null,
  detailSource: "effective",
  detailCellFilter: "all",
  photoUrls: new Map(),
  photoPreviewRequests: new Map(),
  curationDraft: null,
  curationCell: null,
  pendingAction: null,
  purgePreview: null,
  downloadPreview: null,
  exportRequestIds: new Map(),
  downloadPreviewRequest: 0,
  loadRequest: 0,
  detailRequest: 0,
  bootstrapRequest: 0,
  photoRequest: 0,
  sessionEpoch: 0,
  loading: false,
};

const dialogReturnFocus = new WeakMap();
const operationRequests = new WeakMap();

function boundRequestId(holder, payload) {
  if (!holder || typeof holder !== "object") throw new Error("An instructor operation context is required.");
  const fingerprint = JSON.stringify(payload);
  const existing = operationRequests.get(holder);
  if (existing?.fingerprint === fingerprint) return existing.requestId;
  const requestId = createInstructorRequestId();
  operationRequests.set(holder, { fingerprint, requestId });
  return requestId;
}

function invalidateBoundRequest(holder) {
  if (holder && typeof holder === "object") operationRequests.delete(holder);
}

function invalidateAfterCertainFailure(holder, error) {
  if (error instanceof InstructorApiError && error.status < 500) invalidateBoundRequest(holder);
}

function currentSessionEpoch() {
  return state.sessionEpoch;
}

function sessionIsCurrent(epoch) {
  return Boolean(state.session) && epoch === state.sessionEpoch;
}

function toast(message, type = "info", duration = 4800) {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  document.querySelector("#toast-region").append(item);
  setTimeout(() => item.remove(), duration);
}

function setMessage(message = "", type = "") {
  const element = document.querySelector("#dashboard-status");
  element.textContent = message;
  element.className = `status-message dashboard-message ${type}`.trim();
}

function setLoginStatus(message = "", type = "") {
  const element = document.querySelector("#login-status");
  element.textContent = message;
  element.className = `status-message ${type}`.trim();
}

function showLogin(message = "") {
  state.sessionEpoch += 1;
  closeAllDialogs({ restoreFocus: false });
  clearInstructorSession();
  state.session = null;
  state.classes = [];
  state.records = [];
  state.page = 1;
  state.total = 0;
  state.totalPages = 1;
  state.filters = freshFilters();
  state.summary = null;
  state.facets = null;
  state.chartMetric = "submissions";
  state.chartLimit = "10";
  state.loadedAt = null;
  state.selected.clear();
  state.selectedPhotos.clear();
  state.photoUrls.clear();
  state.photoPreviewRequests.clear();
  state.detail = null;
  state.detailSource = "effective";
  state.detailCellFilter = "all";
  state.curationDraft = null;
  state.curationCell = null;
  state.pendingAction = null;
  state.purgePreview = null;
  state.downloadPreview = null;
  state.exportRequestIds.clear();
  state.downloadPreviewRequest += 1;
  recordsBody.replaceChildren();
  document.querySelector("#summary-cards").replaceChildren();
  document.querySelector("#record-detail").replaceChildren();
  document.querySelector("#summary-chart").replaceChildren();
  document.querySelector("#summary-chart-values").replaceChildren();
  document.querySelector("#summary-plot").value = state.chartMetric;
  document.querySelector("#summary-limit").value = state.chartLimit;
  for (const selector of ["#photo-body", "#curation-body", "#action-record-list", "#purge-record-list"]) {
    document.querySelector(selector)?.replaceChildren();
  }
  filterForm.reset();
  loginForm.reset();
  for (const selector of ["#curation-form", "#action-form", "#purge-form", "#download-form"]) {
    const form = document.querySelector(selector);
    invalidateBoundRequest(form);
    form?.reset();
  }
  document.querySelector("#class-filter").replaceChildren(new Option("All classes", ""));
  document.querySelector("#term-filter").replaceChildren(new Option("All terms", ""));
  document.querySelector("#active-filter-chips").replaceChildren();
  document.querySelector("#dashboard-status").textContent = "";
  document.querySelector("#toast-region").replaceChildren();
  document.querySelector("#record-dialog-title").textContent = "Record";
  document.querySelector("#record-dialog-subtitle").textContent = "";
  document.querySelector("#photo-title").textContent = "Photograph";
  document.querySelector("#photo-context").textContent = "";
  document.querySelector("#action-message").textContent = "";
  document.querySelector("#purge-summary").textContent = "";
  document.querySelector("#purge-confirmation-copy").textContent = "";
  document.querySelector("#download-progress").textContent = "";
  document.querySelector("#download-warning").textContent = "";
  document.querySelector("#reviewer-display").textContent = "";
  document.querySelector("#session-expiry").textContent = "";
  document.querySelector("#refresh-copy").textContent = "";
  document.querySelector("#result-count").textContent = "No records loaded";
  document.querySelector("#selection-count").textContent = "0 selected";
  document.querySelector("#selected-action-count").textContent = "";
  document.querySelector("#selected-action-bar").classList.add("hidden");
  document.querySelector("#page-copy").textContent = "Page 1 of 1";
  document.querySelector("#chart-scope").textContent = "";
  document.querySelector("#purge-result").replaceChildren();
  document.querySelector("#purge-result").classList.add("hidden");
  filterRail.classList.remove("open");
  filterRail.inert = true;
  filterRail.setAttribute("aria-hidden", "true");
  dashboardView.hidden = true;
  dashboardView.classList.add("hidden");
  dashboardView.setAttribute("aria-hidden", "true");
  loginView.hidden = false;
  loginView.classList.remove("hidden");
  setLoginStatus(message, message ? "error" : "");
  requestAnimationFrame(() => loginForm.elements.reviewerName.focus());
}

function showDashboard() {
  loginView.hidden = true;
  loginView.classList.add("hidden");
  dashboardView.hidden = false;
  dashboardView.classList.remove("hidden");
  dashboardView.setAttribute("aria-hidden", "false");
  document.querySelector("#reviewer-display").textContent = state.session.reviewerName;
  updateSessionCopy();
  syncFilterRailAccessibility(false);
}

function syncFilterRailAccessibility(open = filterRail.classList.contains("open")) {
  const mobile = compactDashboard.matches;
  const wasOpen = filterRail.classList.contains("open");
  const exposed = !mobile || open;
  filterRail.classList.toggle("open", mobile && open);
  filterRail.inert = !exposed;
  filterRail.setAttribute("aria-hidden", String(!exposed));
  const toggle = document.querySelector('[data-action="toggle-filters"]');
  toggle.setAttribute("aria-expanded", String(mobile && open));
  if (mobile && open) requestAnimationFrame(() => filterRail.querySelector("input, select, button")?.focus());
  else if (mobile && wasOpen) requestAnimationFrame(() => toggle.focus());
}

function updateSessionCopy() {
  const target = document.querySelector("#session-expiry");
  if (!state.session) { target.textContent = ""; return; }
  const remaining = state.session.expiresAt - Date.now();
  if (remaining <= 0) {
    showLogin("Your instructor session expired. Sign in again.");
    return;
  }
  target.textContent = `Session ends in ${Math.max(1, Math.ceil(remaining / 60000))} min`;
}

function handleError(error, fallback = "The request could not be completed.") {
  const message = String(error?.message || fallback);
  if (error instanceof InstructorApiError && error.status === 401) {
    showLogin(message);
    return;
  }
  setMessage(message, "error");
  toast(message, "error", 7000);
}

function handleExpiredSession(error) {
  if (!(error instanceof InstructorApiError) || error.status !== 401) return false;
  handleError(error);
  return true;
}

function setBusy(form, busy, label = "Working…") {
  const submit = form?.querySelector('[type="submit"]');
  if (!submit) return;
  if (busy) {
    submit.dataset.previousText = submit.textContent;
    submit.textContent = label;
    submit.disabled = true;
  } else {
    submit.textContent = submit.dataset.previousText || submit.textContent;
    submit.disabled = form.dataset.locked === "true";
  }
}

function openDialog(dialog) {
  if (!dialog?.open) {
    const active = document.activeElement;
    if (active instanceof HTMLElement) dialogReturnFocus.set(dialog, active);
    dialog.showModal();
  }
  document.body.classList.add("dialog-open");
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
  if (![recordDialog, curationDialog, downloadDialog, actionDialog, purgeDialog, photoDialog].some((item) => item.open)) {
    document.body.classList.remove("dialog-open");
  }
}

function closeAllDialogs({ restoreFocus = true } = {}) {
  for (const dialog of [recordDialog, curationDialog, downloadDialog, actionDialog, purgeDialog, photoDialog]) {
    if (!restoreFocus) dialogReturnFocus.delete(dialog);
    closeDialog(dialog);
  }
}

function populateSpeciesDatalist() {
  const list = document.querySelector("#species-options");
  list.replaceChildren(...SPECIES.map((species) => {
    const option = document.createElement("option");
    option.value = species.code;
    option.label = `${species.commonName} · ${species.scientificName}`;
    return option;
  }));
}

function populateClassSelect() {
  const select = document.querySelector("#class-filter");
  const includeInactive = Boolean(filterForm.elements.includeInactiveClasses.checked || state.filters.includeInactiveClasses);
  const selected = state.filters.classId;
  const options = [new Option("All classes", "")];
  for (const item of state.classes) {
    if (!includeInactive && !item.active && item.id !== selected) continue;
    const count = item.recordCount ?? item.record_count;
    options.push(new Option(`${item.name} · ${item.term || "No term"}${Number.isFinite(Number(count)) ? ` · ${Number(count).toLocaleString()} records` : ""}${item.active ? "" : " · inactive"}`, item.id));
  }
  select.replaceChildren(...options);
  select.value = selected;
  populateTermSelect();
}

function populateTermSelect() {
  const select = document.querySelector("#term-filter");
  const selected = state.filters.term;
  const includeInactive = Boolean(filterForm.elements.includeInactiveClasses.checked || state.filters.includeInactiveClasses);
  const terms = [...new Set(state.classes
    .filter((item) => includeInactive || item.active || item.term === selected)
    .map((item) => String(item.term || "").trim()).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  select.replaceChildren(new Option("All terms", ""), ...terms.map((term) => new Option(term, term)));
  select.value = selected;
}

function defaultClassId(classes) {
  return classes.find((item) => item.active)?.id || classes[0]?.id || "";
}

function filtersForRequest(filters) {
  const output = filtersForApi(filters);
  return Array.isArray(output.speciesCodes) && output.speciesCodes.length === 0 ? null : output;
}

async function bootstrapDashboard() {
  const requestNumber = ++state.bootstrapRequest;
  const epoch = currentSessionEpoch();
  setMessage("Loading classes…");
  try {
    const data = await fetchInstructorBootstrap();
    if (requestNumber !== state.bootstrapRequest || !sessionIsCurrent(epoch)) return;
    state.classes = Array.isArray(data.classes) ? data.classes : [];
    state.loadedAt = data.loadedAt || null;
    if (!state.filters.classId) state.filters.classId = defaultClassId(state.classes);
    populateClassSelect();
    writeFiltersToForm();
    await loadRecords({ resetPage: true });
  } catch (error) {
    if (requestNumber !== state.bootstrapRequest || !sessionIsCurrent(epoch)) return;
    handleError(error, "Dashboard setup failed.");
  }
}

function filtersFromForm() {
  const data = new FormData(filterForm);
  const filters = freshFilters();
  for (const key of Object.keys(filters)) {
    if (key === "includeInactiveClasses") filters[key] = filterForm.elements[key].checked;
    else filters[key] = String(data.get(key) || "").trim();
  }
  return filters;
}

function writeFiltersToForm() {
  for (const [key, value] of Object.entries(state.filters)) {
    const control = filterForm.elements[key];
    if (!control) continue;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value;
  }
  populateClassSelect();
}

async function loadRecords({ resetPage = false, quiet = false } = {}) {
  if (!recordDialog.open) state.detailRequest += 1;
  if (resetPage) state.page = 1;
  const requestNumber = ++state.loadRequest;
  const epoch = currentSessionEpoch();
  const request = {
    page: state.page,
    pageSize: state.pageSize,
    filters: structuredClone(state.filters),
    sort: { ...state.sort },
  };
  state.loading = true;
  if (!quiet) setMessage("Loading filtered submissions…");
  try {
    const apiFilters = filtersForRequest(request.filters);
    if (!apiFilters) {
      if (requestNumber !== state.loadRequest || !sessionIsCurrent(epoch)) return;
      state.records = [];
      state.total = 0;
      state.page = 1;
      state.totalPages = 1;
      state.loadedAt = new Date().toISOString();
      state.summary = null;
      state.facets = null;
      renderDashboard();
      setMessage("No catalog species match that species search.");
      return;
    }
    const data = await listInstructorRecords({
      page: request.page,
      pageSize: request.pageSize,
      filters: apiFilters,
      sort: request.sort,
    });
    if (requestNumber !== state.loadRequest || !sessionIsCurrent(epoch)) return;
    const returnedTotal = Number(data.total || 0);
    const returnedPageSize = Number(data.pageSize || request.pageSize);
    const returnedTotalPages = Math.max(1, Number(data.totalPages || Math.ceil(returnedTotal / returnedPageSize) || 1));
    if (request.page > returnedTotalPages) {
      state.page = returnedTotalPages;
      await loadRecords({ quiet });
      return;
    }
    state.records = Array.isArray(data.records) ? data.records : [];
    state.records.forEach((record) => {
      const id = recordId(record);
      if (state.selected.has(id)) state.selected.set(id, record);
    });
    state.total = returnedTotal;
    state.page = Math.max(1, Number(data.page || request.page));
    state.pageSize = returnedPageSize;
    state.totalPages = returnedTotalPages;
    state.loadedAt = data.loadedAt || new Date().toISOString();
    state.summary = data.summary || data.aggregates || null;
    state.facets = data.facets || data.chartSeries || data.summary || null;
    renderDashboard();
    setMessage("");
  } catch (error) {
    if (requestNumber !== state.loadRequest || !sessionIsCurrent(epoch)) return;
    handleError(error, "Submissions could not be loaded.");
  } finally {
    if (requestNumber === state.loadRequest) state.loading = false;
  }
}

function renderDashboard() {
  renderFilterChips();
  renderSummaryCards();
  renderCharts();
  renderTable();
  renderSelection();
  document.querySelector("#refresh-copy").textContent = `${state.total.toLocaleString()} matching record${state.total === 1 ? "" : "s"} · refreshed ${formatDate(state.loadedAt)}`;
}

function renderFilterChips() {
  const container = document.querySelector("#active-filter-chips");
  const labels = activeFilterLabels(state.filters, state.classes);
  container.innerHTML = labels.map((item) => `<span class="filter-chip">${escapeHtml(item.label)}<button type="button" data-action="remove-filter" data-filter-key="${escapeHtml(item.key)}" aria-label="Remove ${escapeHtml(item.label)}">×</button></span>`).join("");
}

function summaryValue(summary, key, fallback = 0) {
  const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return Number(summary?.[key] ?? summary?.[snake] ?? fallback);
}

function renderSummaryCards() {
  const summary = computeDashboardSummary(state.records, state.summary);
  const metrics = [
    ["totalTransects", "Transects", ""], ["submittedTransects", "Submitted", ""], ["editedSubmissions", "Edited", ""],
    ["partialUploads", "Partial uploads", "warning"], ["incompleteTransects", "Incomplete transects", "warning"], ["trashedRecords", "In trash", "danger"],
    ["recordsWithPhotos", "With photos", ""], ["recordsWithGps", "With GPS", ""], ["detectedSpeciesCount", "Species detected", ""],
    ["detectedCells", "Detected cells", ""], ["surveyedNoTargetCells", "0 cells", ""], ["notSurveyedCells", "NS cells", "warning"],
    ["incompleteCells", "Incomplete cells", "warning"], ["testRecords", "Test records", "warning"], ["excludedRecords", "Excluded", "warning"],
  ];
  document.querySelector("#summary-cards").innerHTML = metrics.map(([key, label, tone]) => `<article class="summary-card ${tone}"><strong>${summaryValue(summary, key).toLocaleString()}</strong><span>${escapeHtml(label)}</span></article>`).join("");
}

const CHART_DEFINITIONS = {
  submissions: { title: "Submissions over time", note: "Transects submitted by Reno calendar date", kind: "line" },
  species: { title: "Species detections", note: "Transects containing each target species", kind: "bar" },
  statuses: { title: "Cell status", note: "All cells by completion status", kind: "bar" },
  sites: { title: "Sites and trails", note: "Transects grouped by site and trail", kind: "bar" },
};

function chartValue(item) {
  const value = Number(item?.value ?? item?.count ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function exactValuesMarkup(items) {
  if (!items.length) return "";
  const rows = items.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${chartValue(item).toLocaleString()}</td></tr>`).join("");
  return `<details><summary>View exact values (${items.length.toLocaleString()})</summary><div class="chart-values-scroll"><table class="chart-values-table"><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function linePlotMarkup(items) {
  const width = 820; const height = 300;
  const left = 52; const right = 24; const top = 20; const bottom = 52;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const max = Math.max(1, ...items.map(chartValue));
  const x = (index) => items.length === 1 ? left + (plotWidth / 2) : left + ((index / (items.length - 1)) * plotWidth);
  const y = (value) => top + plotHeight - ((value / max) * plotHeight);
  const points = items.map((item, index) => `${x(index).toFixed(1)},${y(chartValue(item)).toFixed(1)}`).join(" ");
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const py = top + plotHeight - (ratio * plotHeight);
    return `<line class="plot-grid-line" x1="${left}" y1="${py}" x2="${width - right}" y2="${py}"></line><text class="plot-axis-label" x="${left - 10}" y="${py + 4}" text-anchor="end">${Math.round(max * ratio).toLocaleString()}</text>`;
  }).join("");
  const labelStep = Math.max(1, Math.ceil(items.length / 6));
  const labels = items.map((item, index) => (index % labelStep === 0 || index === items.length - 1)
    ? `<text class="plot-axis-label" x="${x(index)}" y="${height - 20}" text-anchor="middle">${escapeHtml(item.label)}</text>` : "").join("");
  const area = `${left},${top + plotHeight} ${points} ${x(items.length - 1)},${top + plotHeight}`;
  const dots = items.map((item, index) => `<circle class="plot-point" cx="${x(index)}" cy="${y(chartValue(item))}" r="5"><title>${escapeHtml(item.label)}: ${chartValue(item).toLocaleString()}</title></circle>`).join("");
  return `<svg class="summary-plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="Submissions over time line plot">${grid}<polygon class="plot-area" points="${area}"></polygon><polyline class="plot-line" points="${points}"></polyline>${dots}${labels}</svg>`;
}

function barPlotMarkup(items) {
  const width = 820; const left = 205; const right = 65; const rowHeight = 38;
  const height = Math.max(230, (items.length * rowHeight) + 24); const plotWidth = width - left - right;
  const max = Math.max(1, ...items.map(chartValue));
  const rows = items.map((item, index) => {
    const value = chartValue(item); const y = 12 + (index * rowHeight); const barWidth = Math.max(2, (value / max) * plotWidth);
    const shortLabel = String(item.label).length > 30 ? `${String(item.label).slice(0, 29)}…` : String(item.label);
    return `<text class="plot-axis-label" x="${left - 12}" y="${y + 20}" text-anchor="end">${escapeHtml(shortLabel)}<title>${escapeHtml(item.label)}</title></text><rect class="plot-bar" x="${left}" y="${y + 4}" width="${barWidth}" height="22"><title>${escapeHtml(item.label)}: ${value.toLocaleString()}</title></rect><text class="plot-value-label" x="${Math.min(left + barWidth + 8, width - right + 8)}" y="${y + 20}">${value.toLocaleString()}</text>`;
  }).join("");
  return `<svg class="summary-plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="Horizontal bar plot">${rows}</svg>`;
}

function renderCharts() {
  const series = buildChartSeries(state.records, state.facets);
  const definition = CHART_DEFINITIONS[state.chartMetric] || CHART_DEFINITIONS.submissions;
  const allItems = Array.isArray(series[state.chartMetric]) ? series[state.chartMetric] : [];
  const fixedLength = state.chartMetric === "submissions" || state.chartMetric === "statuses";
  const requestedLimit = state.chartLimit === "all" ? allItems.length : Number(state.chartLimit);
  const items = fixedLength ? allItems : allItems.slice(0, requestedLimit);
  const target = document.querySelector("#summary-chart");
  document.querySelector("#summary-limit").disabled = fixedLength;
  const plot = items.length ? (definition.kind === "line" ? linePlotMarkup(items) : barPlotMarkup(items)) : '<div class="chart-empty">No matching values for this plot.</div>';
  target.innerHTML = `<div class="summary-chart-header"><h3>${escapeHtml(definition.title)}</h3><p>${escapeHtml(definition.note)}</p></div>${plot}`;
  document.querySelector("#summary-chart-values").innerHTML = exactValuesMarkup(allItems);
  document.querySelector("#chart-scope").textContent = state.summary || state.facets
    ? "Exact values for all filtered records"
    : `Visible page only (${state.records.length} of ${state.total})`;
}

function recordRow(record) {
  const id = recordId(record);
  const metadata = metadataForRecord(record);
  const summary = summaryForRecord(record);
  const counts = normalizedStatusCounts(summary);
  const speciesCodes = summary.speciesCodes || summary.species_codes || [];
  const checked = state.selected.has(id);
  const curationStale = Boolean(record.curationStale ?? record.curation_stale);
  const review = recordReviewStatus(record);
  const reviewTone = review === "accepted" || review === "reviewed" ? "success" : review === "unreviewed" ? "neutral" : "warning";
  const badges = [
    `<span class="status-badge ${reviewTone}">${escapeHtml(humanize(review))}</span>`,
    recordHasCuration(record) ? `<span class="status-badge ${curationStale ? "danger" : "success"}">${curationStale ? "Stale curation" : "Curated"}</span>` : '<span class="status-badge">Original only</span>',
    recordIsTest(record) ? '<span class="status-badge test">Test data</span>' : '<span class="status-badge">Real data</span>',
    recordIsExcluded(record) ? '<span class="status-badge warning">Excluded</span>' : '<span class="status-badge">Included</span>',
    recordIsTrashed(record) ? '<span class="status-badge danger">Trashed</span>' : '<span class="status-badge">Active</span>',
  ].filter(Boolean).join("");
  const revisionCount = Math.max(Number(record.submissionCount ?? record.submission_count ?? 1) - 1, 0);
  const classRecord = state.classes.find((item) => item.id === (record.classId ?? record.class_id));
  const className = record.className ?? record.class_name ?? classRecord?.name ?? "Unknown class";
  const classTerm = record.classTerm ?? record.class_term ?? classRecord?.term ?? "No term";
  const rowClasses = [checked ? "selected" : "", recordIsTrashed(record) ? "trashed" : ""].filter(Boolean).join(" ");
  return `<tr class="${rowClasses}" data-record-row="${escapeHtml(id)}" tabindex="0">
    <td class="select-cell"><input type="checkbox" data-select-record="${escapeHtml(id)}" ${checked ? "checked" : ""} aria-label="Select ${escapeHtml(recordTitle(record))}"></td>
    <td><strong>${escapeHtml(formatDate(metadata.surveyDate, { dateOnly: true }))}</strong><small>${escapeHtml(`${className} · ${classTerm}`)}</small></td>
    <td><strong>${escapeHtml(metadata.site || "Not entered")}</strong><small>${escapeHtml(metadata.trail || "No trail")}</small></td>
    <td><strong>${escapeHtml(metadata.transectNumber || "—")}</strong><small title="${escapeHtml(id)}">${escapeHtml(id.slice(0, 17))}${id.length > 17 ? "…" : ""}</small></td>
    <td>${escapeHtml(metadata.observers || "—")}</td>
    <td><strong>${completedCells(record)} / 180</strong><small>${counts.incomplete ? `${counts.incomplete} incomplete` : "Complete"}</small></td>
    <td><strong>${Number(summary.detectedCells ?? summary.detected_cells ?? counts.detected)} cells</strong><small>${speciesCodes.length} species</small></td>
    <td><strong>${recordHasGps(record) ? "GPS" : "No GPS"}</strong><small>${Number(record.photoCount ?? record.photo_count ?? 0)} photo${Number(record.photoCount ?? record.photo_count ?? 0) === 1 ? "" : "s"}</small></td>
    <td><strong>${escapeHtml(humanize(record.syncState ?? record.sync_state))}</strong><small>${revisionCount} revision${revisionCount === 1 ? "" : "s"} · ${escapeHtml(formatDate(record.serverUpdatedAt ?? record.server_updated_at))}</small></td>
    <td><div class="badge-stack">${badges}</div></td>
    <td><button class="open-row" type="button" data-action="open-record" data-id="${escapeHtml(id)}">Open</button></td>
  </tr>`;
}

function renderTable() {
  recordsBody.innerHTML = state.records.map(recordRow).join("");
  document.querySelector("#table-empty").classList.toggle("hidden", state.records.length > 0);
  document.querySelector("#result-count").textContent = `${state.total.toLocaleString()} matching · showing ${state.records.length ? ((state.page - 1) * state.pageSize) + 1 : 0}–${Math.min(state.page * state.pageSize, state.total)}`;
  document.querySelector("#page-copy").textContent = `Page ${state.page} of ${state.totalPages}`;
  document.querySelector("#page-size").value = String(state.pageSize);
  document.querySelector('[data-action="previous-page"]').disabled = state.page <= 1;
  document.querySelector('[data-action="next-page"]').disabled = state.page >= state.totalPages;
  document.querySelectorAll("[data-sort]").forEach((button) => {
    const active = button.dataset.sort === state.sort.field;
    button.classList.toggle("sorted", active);
    button.dataset.direction = active ? (state.sort.direction === "asc" ? "▲" : "▼") : "";
    button.closest("th")?.setAttribute("aria-sort", active ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none");
  });
}

function renderSelection() {
  const count = state.selected.size;
  document.querySelector("#selection-count").textContent = `${count.toLocaleString()} selected`;
  document.querySelector("#selected-action-count").textContent = `${count.toLocaleString()} selected`;
  document.querySelector("#selected-action-bar").classList.toggle("hidden", count === 0);
  const selectedRecords = [...state.selected.values()];
  const allTrashed = count > 0 && selectedRecords.every(recordIsTrashed);
  const anyTrashed = selectedRecords.some(recordIsTrashed);
  const overBulkLimit = count > MAX_BULK_ACTION_RECORDS;
  const explicitTrashView = state.filters.trashState === "trashed";
  const trashButton = document.querySelector('[data-action="trash-selected"]');
  const restoreButton = document.querySelector('[data-action="restore-selected"]');
  const purgeButton = document.querySelector('[data-action="purge-selected"]');
  trashButton.classList.toggle("hidden", count === 0 || allTrashed);
  restoreButton.classList.toggle("hidden", !anyTrashed);
  purgeButton.classList.toggle("hidden", !explicitTrashView || !allTrashed);
  trashButton.disabled = overBulkLimit;
  restoreButton.disabled = overBulkLimit;
  purgeButton.disabled = count > MAX_PURGE_RECORDS;
  trashButton.title = restoreButton.title = overBulkLimit ? `Bulk changes are limited to ${MAX_BULK_ACTION_RECORDS} records at a time.` : "";
  purgeButton.title = count > MAX_PURGE_RECORDS ? `Permanent purge is limited to ${MAX_PURGE_RECORDS} records at a time.` : "";
  if (overBulkLimit) document.querySelector("#selected-action-count").textContent += ` · narrow to ${MAX_BULK_ACTION_RECORDS} for bulk changes`;
  else if (explicitTrashView && count > MAX_PURGE_RECORDS) document.querySelector("#selected-action-count").textContent += ` · narrow to ${MAX_PURGE_RECORDS} to purge`;
  document.querySelector("#download-selected-count").textContent = `(${count})`;
  document.querySelector("#download-filtered-count").textContent = `(${state.total})`;
  const classScope = document.querySelector("#download-class-scope");
  const classRecord = state.classes.find((item) => item.id === state.filters.classId);
  classScope.disabled = !classRecord;
  document.querySelector("#download-class-copy").textContent = classRecord ? `(${classRecord.name} · ${classRecord.term || "No term"})` : "(select a class filter first)";
  if (classScope.checked && classScope.disabled) document.querySelector('#download-form [name="scope"][value="filtered"]').checked = true;
}

function syncVisibleSelection() {
  document.querySelectorAll("[data-select-record]").forEach((checkbox) => {
    const selected = state.selected.has(checkbox.dataset.selectRecord);
    checkbox.checked = selected;
    checkbox.closest("tr")?.classList.toggle("selected", selected);
  });
}

async function collectRecords(filters = state.filters, onProgress = () => {}, sort = state.sort) {
  const apiFilters = filtersForRequest(filters);
  if (!apiFilters) return [];
  const sortSnapshot = { ...sort };
  const first = await listInstructorRecords({ page: 1, pageSize: 200, filters: apiFilters, sort: sortSnapshot });
  const total = Number(first.total || 0);
  if (total > MAX_RESOLVED_RECORDS) throw new Error(`This selection contains ${total.toLocaleString()} records. Narrow it below ${MAX_RESOLVED_RECORDS.toLocaleString()} before a browser download or bulk selection.`);
  const all = [...(first.records || [])];
  const totalPages = Math.max(1, Number(first.totalPages || Math.ceil(total / 200) || 1));
  if (Number(first.page || 1) !== 1 || Number(first.totalPages || totalPages) !== totalPages
    || (first.sort && (first.sort.field !== sortSnapshot.field || first.sort.direction !== sortSnapshot.direction))) {
    throw new Error("The record-list response changed while the complete selection was starting. Refresh and try again.");
  }
  onProgress(all.length, total);
  for (let page = 2; page <= totalPages; page += 1) {
    const data = await listInstructorRecords({ page, pageSize: 200, filters: apiFilters, sort: sortSnapshot });
    if (Number(data.total || 0) !== total || Number(data.page || page) !== page
      || Number(data.totalPages || totalPages) !== totalPages
      || (data.sort && (data.sort.field !== sortSnapshot.field || data.sort.direction !== sortSnapshot.direction))) {
      throw new Error("Records changed while the complete filtered selection was being resolved. Refresh and try again.");
    }
    all.push(...(data.records || []));
    onProgress(all.length, total);
  }
  const ids = all.map(recordId);
  if (all.length !== total || new Set(ids).size !== total || ids.some((id) => !id)) {
    throw new Error("The complete filtered selection changed during paging. Refresh and try again to avoid an incomplete download.");
  }
  return all;
}

async function selectAllFiltered() {
  const epoch = currentSessionEpoch();
  const filterSnapshot = structuredClone(state.filters);
  const sortSnapshot = { ...state.sort };
  setMessage("Resolving all matching record IDs…");
  try {
    const records = await collectRecords(filterSnapshot, (done, total) => {
      if (sessionIsCurrent(epoch)) setMessage(`Selecting matching records: ${done.toLocaleString()} of ${total.toLocaleString()}…`);
    }, sortSnapshot);
    if (!sessionIsCurrent(epoch) || JSON.stringify(filterSnapshot) !== JSON.stringify(state.filters)
      || JSON.stringify(sortSnapshot) !== JSON.stringify(state.sort)) return;
    records.forEach((record) => state.selected.set(recordId(record), record));
    syncVisibleSelection(); renderSelection(); setMessage("");
  } catch (error) {
    if (!sessionIsCurrent(epoch)) return;
    handleError(error);
  }
}

async function openRecord(id) {
  const requestNumber = ++state.detailRequest;
  const epoch = currentSessionEpoch();
  setMessage("Loading record detail…");
  try {
    const detail = await fetchRecordDetail(id);
    if (requestNumber !== state.detailRequest || !sessionIsCurrent(epoch)) return;
    state.detail = detail;
    state.detailSource = "effective";
    state.detailCellFilter = "all";
    state.selectedPhotos.clear();
    state.photoUrls.clear();
    state.photoPreviewRequests.clear();
    renderRecordDetail();
    openDialog(recordDialog);
    setMessage("");
  } catch (error) {
    if (requestNumber !== state.detailRequest || !sessionIsCurrent(epoch)) return;
    handleError(error, "Record detail could not be loaded.");
  }
}

function curationIsStale(detail = state.detail) {
  return Boolean(detail?.curation?.active)
    && Number(detail.curation.source_submission_count) !== Number(detail?.transect?.submission_count);
}

function displayPayload() {
  if (state.detailSource === "diff") return sourcePayload(state.detail, "effective");
  return sourcePayload(state.detail, state.detailSource);
}

function metadataMarkup(payload) {
  const metadata = payload?.metadata || {};
  const gps = (value) => {
    if (!validGps(value)) return "Not captured";
    const accuracy = Number(value.accuracy);
    const accuracyCopy = Number.isFinite(accuracy) && accuracy >= 0
      ? `±${Math.round(accuracy)} m`
      : "accuracy not reported";
    return `${Number(value.latitude).toFixed(6)}, ${Number(value.longitude).toFixed(6)} · ${accuracyCopy}`;
  };
  const items = [
    ["Site", metadata.site], ["Trail", metadata.trail], ["Transect #", metadata.transectNumber], ["Observers", metadata.observers],
    ["Survey date", metadata.surveyDate], ["Start / end", `${metadata.startTime || "—"} / ${metadata.endTime || "—"}`],
    ["Start GPS", gps(metadata.startGps)], ["End GPS", gps(metadata.endGps)], ["General notes", metadata.generalNotes, "wide"],
  ];
  return `<dl class="metadata-grid">${items.map(([label, value, width]) => `<div class="metadata-item ${width || ""}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "—")}</dd></div>`).join("")}</dl>`;
}

function cellShort(cell) {
  if (!cell) return "Missing";
  if (cell.status === CELL_STATUSES.DETECTED) return [...(cell.species || []), ...(cell.unknowns || []).map(() => "Unknown")].join(", ") || "Detected";
  if (cell.status === CELL_STATUSES.NO_TARGET) return "0";
  if (cell.status === CELL_STATUSES.NOT_SURVEYED) return "NS";
  return "Blank";
}

function cellsGridMarkup(payload, { editable = false, statusFilter = "all" } = {}) {
  const original = sourcePayload(state.detail, "original");
  const columns = [["left", 0, "L 0–1"], ["left", 1, "L 1–2"], ["left", 2, "L 2–3"], ["right", 0, "R 0–1"], ["right", 1, "R 1–2"], ["right", 2, "R 2–3"]];
  const segments = (payload?.segments || []).map((segment, index) => ({ segment, index })).filter(({ index }) => statusFilter === "all"
    || columns.some(([side, band]) => cellFor(payload, index, side, band)?.status === statusFilter));
  const rows = segments.map(({ segment, index }) => `<tr><td>${index}–${index + 1} m</td>${columns.map(([side, band]) => {
    const cell = cellFor(payload, index, side, band);
    const originalCell = cellFor(original, index, side, band);
    const changed = JSON.stringify(cell) !== JSON.stringify(originalCell);
    const editing = editable && state.curationCell?.segmentIndex === index
      && state.curationCell?.side === side && state.curationCell?.bandStart === band;
    const content = `<span>${escapeHtml(cellShort(cell))}</span>${cell?.note ? `<small title="${escapeHtml(cell.note)}"> · note</small>` : ""}`;
    const visible = statusFilter === "all" || cell?.status === statusFilter;
    if (!visible) return `<td><span class="cell-pill filtered-out" aria-label="Hidden by cell-status filter">—</span></td>`;
    return `<td>${editable ? `<button type="button" class="cell-pill ${escapeHtml(cell?.status || "incomplete")} ${changed ? "changed" : ""} ${editing ? "editing" : ""}" data-action="edit-curation-cell" data-segment="${index}" data-side="${side}" data-band="${band}" ${editing ? 'aria-current="true"' : ""}>${content}</button>` : `<span class="cell-pill ${escapeHtml(cell?.status || "incomplete")} ${changed ? "changed" : ""}">${content}</span>`}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="cell-grid-wrap"><table class="cell-grid"><thead><tr><th>Segment</th>${columns.map(([, , label]) => `<th>${label} m</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="7">No cells match this status.</td></tr>`}</tbody></table></div>`;
}

function cellStatusFilterMarkup() {
  const options = [["all", "All 180"], [CELL_STATUSES.DETECTED, "Detected"], [CELL_STATUSES.NO_TARGET, "0"], [CELL_STATUSES.NOT_SURVEYED, "NS"], [CELL_STATUSES.INCOMPLETE, "Incomplete"]];
  return `<div class="cell-status-filter" role="group" aria-label="Filter cells by survey status">${options.map(([value, label]) => `<button type="button" class="${state.detailCellFilter === value ? "active" : ""}" data-action="detail-cell-filter" data-status="${escapeHtml(value)}" aria-pressed="${state.detailCellFilter === value}">${escapeHtml(label)}</button>`).join("")}</div>`;
}

function observationsMarkup(payload) {
  const populated = [];
  const segmentNotes = [];
  for (const segment of payload?.segments || []) {
    if (String(segment.note || "").trim()) segmentNotes.push(segment);
    for (const cell of segment.cells || []) {
      if (cell.status === "detected" || cell.note) populated.push({ segment, cell });
    }
  }
  const total = populated.length + segmentNotes.length;
  if (!total) return `<p class="muted">No detections, cell notes, or segment notes.</p>`;
  return `<details><summary>Detection and note details (${total})</summary><ul class="audit-list">${segmentNotes.map((segment) => `<li class="audit-item"><strong>${escapeHtml(segment.label)} · segment note</strong><p>${escapeHtml(segment.note)}</p></li>`).join("")}${populated.map(({ segment, cell }) => `<li class="audit-item"><strong>${escapeHtml(segment.label)} · ${escapeHtml(cell.side)} · ${cell.bandStart}–${cell.bandEnd} m</strong><p>${escapeHtml((cell.species || []).join(", ") || ((cell.unknowns || []).length ? `${cell.unknowns.length} unknown` : CELL_STATUS_LABELS[cell.status]))}</p>${cell.note ? `<p>${escapeHtml(cell.note)}</p>` : ""}${(cell.unknowns || []).map((unknown) => `<p>Unknown: ${escapeHtml(unknown.note || "No note")}</p>`).join("")}</li>`).join("")}</ul></details>`;
}

function diffMarkup() {
  const changes = payloadDifferences(state.detail);
  return changes.length ? `<section class="detail-section"><h3>Original versus curated (${changes.length} changes)</h3><ul class="diff-list">${changes.map((change) => `<li class="diff-item"><code>${escapeHtml(change.path)}</code><div class="diff-values"><div><strong>Original</strong><pre>${safeJson(change.original)}</pre></div><div><strong>Curated</strong><pre>${safeJson(change.curated)}</pre></div></div></li>`).join("")}</ul></section>` : `<div class="notice"><strong>No active differences.</strong><p>This record does not have an active curation, or its values match the original.</p></div>`;
}

function safeSignedPhotoUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return url.protocol === "https:" && url.hostname.endsWith(".supabase.co") ? url.href : "";
  } catch { return ""; }
}

function photoAssociation(photo) {
  const values = [humanize(photo.scope)];
  const segmentIndex = photo.segment_index ?? photo.segmentIndex;
  const bandStart = photo.band_start_m ?? photo.distance_band_start_m ?? photo.bandStart;
  const speciesCode = photo.species_code ?? photo.speciesCode;
  const unknownId = photo.unknown_id ?? photo.unknownId;
  if (segmentIndex !== null && segmentIndex !== undefined && segmentIndex !== "" && Number.isInteger(Number(segmentIndex))) {
    values.push(`segment ${Number(segmentIndex) + 1} (${Number(segmentIndex)}–${Number(segmentIndex) + 1} m)`);
  }
  if (photo.side) values.push(String(photo.side).toUpperCase());
  if (bandStart !== null && bandStart !== undefined && bandStart !== "") values.push(`band ${Number(bandStart)}–${Number(bandStart) + 1} m`);
  if (speciesCode) values.push(`species ${speciesCode}`);
  if (unknownId) values.push(`unknown ${unknownId}`);
  return values.join(" · ");
}

function photoMarkup(detail) {
  const inventory = reconcilePhotoInventory(detail);
  const serverPhotos = new Map((detail.photos || []).map((photo) => [photo.id, photo]));
  const uploaded = inventory.filter((photo) => photo.server_photo_metadata_present);
  const first = inventory[0] || {};
  const expectedCount = Number(first.record_effective_expected_photo_count || 0);
  const missingCount = Number(first.record_effective_missing_photo_count || 0);
  const selectedCount = [...state.selectedPhotos].filter((id) => serverPhotos.has(id)).length;
  const uploadSummary = inventory.length
    ? `${expectedCount.toLocaleString()} expected · ${uploaded.length.toLocaleString()} server photo record${uploaded.length === 1 ? "" : "s"} · ${missingCount.toLocaleString()} expected attachment${missingCount === 1 ? "" : "s"} missing`
    : "No photo attachments are expected or uploaded.";
  const warning = missingCount
    ? `<div class="notice warning"><strong>Incomplete photo inventory.</strong><p>${missingCount.toLocaleString()} attachment${missingCount === 1 ? " is" : "s are"} present in the submitted payload but missing from server photo metadata or private Storage. These entries cannot be previewed or downloaded.</p></div>`
    : "";
  return `<section id="detail-photos" class="detail-section"><div class="section-heading"><div><h3>Photographs</h3><p class="muted">${escapeHtml(uploadSummary)} Secure previews are loaded only on request, are short-lived, and stay only in this tab's memory.</p></div>${uploaded.length ? `<button class="button secondary compact" type="button" data-action="download-detail-photos" ${selectedCount ? "" : "disabled"}>Download selected photos (${selectedCount})</button>` : ""}</div>${warning}${inventory.length ? `<ul class="photo-list">${inventory.map((photo) => {
    const uploadedPhoto = serverPhotos.get(photo.photo_id);
    const authorized = state.photoUrls.get(photo.photo_id);
    const url = safeSignedPhotoUrl(authorized?.url);
    const preview = !uploadedPhoto
      ? `<div class="photo-placeholder missing"><strong>Expected attachment missing</strong><span>No server photo metadata or private file is available.</span></div>`
      : url
        ? `<button class="photo-preview" type="button" data-action="open-photo" data-photo-id="${escapeHtml(photo.photo_id)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(photo.note || `Survey photograph ${photo.photo_id}`)}" loading="lazy" data-photo-thumbnail="${escapeHtml(photo.photo_id)}"><span>Open larger preview</span></button>`
        : authorized?.loading
          ? `<div class="photo-placeholder"><strong>Authorizing preview…</strong><span>Private photo</span></div>`
          : `<div class="photo-placeholder ${authorized?.error ? "missing" : ""}"><strong>${authorized?.error ? "Preview unavailable" : "Private photo"}</strong><span>${escapeHtml(authorized?.error || "Preview authorization has not been requested.")}</span><button class="text-button" type="button" data-action="load-photo-preview" data-photo-id="${escapeHtml(photo.photo_id)}">${authorized?.error ? "Request fresh preview" : "Load preview"}</button></div>`;
    const selector = uploadedPhoto
      ? `<label class="check-field photo-select"><input type="checkbox" data-select-photo="${escapeHtml(photo.photo_id)}" ${state.selectedPhotos.has(photo.photo_id) ? "checked" : ""}><span>Select for ZIP</span></label>`
      : `<span class="status-badge warning">Not downloadable</span>`;
    const uploadState = photo.upload_state === "uploaded" ? "Uploaded"
      : photo.upload_state === "server_metadata_without_payload_descriptor" ? "Server photo without payload descriptor"
        : "Missing from server/Storage";
    return `<li class="photo-item">${preview}${selector}<dl><div><dt>Photo ID</dt><dd>${escapeHtml(photo.photo_id || "—")}</dd></div><div><dt>Upload state</dt><dd>${escapeHtml(uploadState)}${photo.payload_sync_status ? ` · client: ${escapeHtml(humanize(photo.payload_sync_status))}` : ""}</dd></div><div><dt>Association</dt><dd>${escapeHtml(photoAssociation(photo))}</dd></div><div><dt>Captured</dt><dd>${escapeHtml(formatDate(photo.captured_at))}</dd></div><div><dt>Uploaded</dt><dd>${escapeHtml(formatDate(photo.uploaded_at))}</dd></div><div><dt>File</dt><dd>${escapeHtml(photo.original_filename || photo.mime_type || "Unknown file")} · ${escapeHtml(photo.mime_type || "Unknown type")} · ${escapeHtml(formatBytes(photo.size_bytes))}</dd></div><div><dt>Expected in payload</dt><dd>${photo.expected_in_effective_payload ? "Yes" : "No"}${photo.expected_in_original_payload !== photo.expected_in_effective_payload ? ` · original: ${photo.expected_in_original_payload ? "yes" : "no"}` : ""}</dd></div>${photo.note ? `<div><dt>Note</dt><dd>${escapeHtml(photo.note)}</dd></div>` : ""}</dl></li>`;
  }).join("")}</ul>` : `<p class="muted">No photo attachments are associated with this record.</p>`}</section>`;
}

function wirePhotoThumbnailErrors() {
  document.querySelectorAll("[data-photo-thumbnail]").forEach((image) => image.addEventListener("error", () => {
    const id = image.dataset.photoThumbnail;
    state.photoUrls.set(id, { error: "The private file is missing or the preview URL expired." });
    renderPhotoSection();
  }, { once: true }));
}

function renderPhotoSection() {
  const current = document.querySelector("#detail-photos");
  if (!current || !state.detail) return;
  current.outerHTML = photoMarkup(state.detail);
  wirePhotoThumbnailErrors();
}

async function loadPhotoPreview(photoId) {
  const recordIdToLoad = state.detail?.transect?.id;
  if (!recordIdToLoad || !state.detail.photos?.some((photo) => photo.id === photoId)) return;
  const epoch = currentSessionEpoch();
  const detailRequest = state.detailRequest;
  const requestNumber = Number(state.photoPreviewRequests.get(photoId) || 0) + 1;
  state.photoPreviewRequests.set(photoId, requestNumber);
  state.photoUrls.set(photoId, { loading: true });
  renderPhotoSection();
  try {
    const data = await fetchPhotoUrls([photoId]);
    if (!sessionIsCurrent(epoch) || detailRequest !== state.detailRequest
      || state.detail?.transect?.id !== recordIdToLoad || state.photoPreviewRequests.get(photoId) !== requestNumber) return;
    const item = (data.items || []).find((candidate) => candidate.id === photoId);
    const url = safeSignedPhotoUrl(item?.signedUrl);
    state.photoUrls.set(photoId, url ? { url } : { error: item?.signedError || "No signed preview was returned." });
  } catch (error) {
    if (!sessionIsCurrent(epoch) || detailRequest !== state.detailRequest
      || state.detail?.transect?.id !== recordIdToLoad || state.photoPreviewRequests.get(photoId) !== requestNumber) return;
    if (handleExpiredSession(error)) return;
    state.photoUrls.set(photoId, { error: String(error?.message || "Preview authorization failed.") });
  }
  renderPhotoSection();
}

function updatePhotoSelectionControls() {
  const button = document.querySelector('[data-action="download-detail-photos"]');
  if (!button) return;
  const available = new Set((state.detail?.photos || []).map((photo) => photo.id));
  const count = [...state.selectedPhotos].filter((id) => available.has(id)).length;
  button.textContent = `Download selected photos (${count})`;
  button.disabled = count === 0;
}

async function downloadSelectedDetailPhotos() {
  const detailId = state.detail?.transect?.id;
  const selectedIds = [...state.selectedPhotos];
  if (!detailId || !selectedIds.length) return;
  setMessage(`Preparing ${selectedIds.length} selected photograph${selectedIds.length === 1 ? "" : "s"}…`);
  try {
    const bundle = await fetchAuditedExport([detailId], "photo-zip");
    const selected = new Set(selectedIds);
    bundle.photos = (bundle.photos || []).filter((photo) => selected.has(photo.id));
    if (bundle.photos.length !== selected.size) {
      throw new Error("One or more selected photographs changed or were removed. Reopen the record and select the current files.");
    }
    const result = await downloadPhotoZip(bundle, {
      fetchPhotoUrls: (ids) => fetchPhotoUrls(ids),
      onProgress: ({ completed, total, failures, zipPercent }) => setMessage(zipPercent
        ? `Building selected-photo ZIP: ${Math.round(zipPercent)}% · ${failures} failed`
        : `Downloading selected photos: ${completed} of ${total} · ${failures} failed`),
    });
    setMessage("");
    toast(`Photo ZIP saved: ${result.included} included, ${result.failures} failed. See its manifest for exact results.`, result.failures ? "warning" : "info", 8000);
  } catch (error) {
    handleError(error, "Selected photographs could not be downloaded.");
  }
}

function stateFormMarkup(detail) {
  const value = detail.state || {};
  const review = value.review_status || "unreviewed";
  const test = value.test_data_status || "auto";
  return `<section class="detail-section"><h3>Instructor review</h3><form id="state-form" class="state-form">
    <label class="field"><span>Review state</span><select name="reviewStatus">${["unreviewed", "reviewed", "needs_follow_up", "questionable", "accepted"].map((item) => `<option value="${item}" ${item === review ? "selected" : ""}>${escapeHtml(humanize(item))}</option>`).join("")}</select></label>
    <label class="field"><span>Test-data status</span><select name="testDataStatus"><option value="auto" ${test === "auto" ? "selected" : ""}>Automatic suggestion</option><option value="test" ${test === "test" ? "selected" : ""}>Test data</option><option value="real" ${test === "real" ? "selected" : ""}>Real data</option></select></label>
    <label class="check-field"><input type="checkbox" name="excludedFromAnalysis" ${value.excluded_from_analysis ? "checked" : ""}><span>Exclude from default analysis exports</span></label>
    <label class="field"><span>Structured flags (comma-separated)</span><input name="flags" value="${escapeHtml((value.flags || []).join(", "))}" placeholder="location_question, needs_photo_review"></label>
    <label class="field span-all"><span>Instructor note</span><textarea name="instructorNote" maxlength="10000">${escapeHtml(value.instructor_note || "")}</textarea></label>
    <label class="field span-all"><span>Reason or action note</span><input name="reason" maxlength="1000" placeholder="Optional explanation for this review update"></label>
    <div class="span-all"><button class="button primary compact" type="submit">Save review state</button></div>
  </form></section>`;
}

function historyMarkup(detail) {
  const actions = detail.actions || [];
  const revisions = detail.revisions || [];
  const curationRevisions = detail.curationRevisions || detail.curation_revisions || [];
  return `<section class="detail-section"><h3>History</h3>
    <details><summary>Student revisions (${revisions.length})</summary><ul class="revision-list">${revisions.map((item) => `<li class="revision-item"><strong>Revision ${escapeHtml(item.revision_number)}</strong><p>${escapeHtml(formatDate(item.archived_at))}</p></li>`).join("") || "<li>No archived student revisions.</li>"}</ul></details>
    <details><summary>Curation revisions (${curationRevisions.length})</summary><ul class="revision-list">${curationRevisions.map((item) => `<li class="revision-item"><strong>Version ${escapeHtml(item.version)}</strong><p>${escapeHtml(item.reviewer_name || "Unknown reviewer")} · ${escapeHtml(formatDate(item.archived_at || item.created_at))}</p><button class="text-button" type="button" data-action="revert-curation" data-revision-id="${escapeHtml(item.revision_id)}">Restore this curation version</button></li>`).join("") || "<li>No archived curation revisions.</li>"}</ul></details>
    <details><summary>Instructor actions (${actions.length})</summary><ul class="audit-list">${actions.map((item) => `<li class="audit-item"><strong>${escapeHtml(humanize(item.action))}</strong><p>${escapeHtml(item.reviewer_name || "Unknown reviewer")} · ${escapeHtml(formatDate(item.created_at))}</p>${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ""}${item.detail && Object.keys(item.detail).length ? `<details><summary>Recorded before/after summary</summary><pre>${safeJson(item.detail)}</pre></details>` : ""}</li>`).join("") || "<li>No instructor actions recorded.</li>"}</ul></details>
  </section>`;
}

function renderRecordDetail() {
  const detail = state.detail;
  if (!detail?.transect) return;
  const payload = displayPayload();
  const summary = computeSummary(payload);
  const metadata = payload.metadata || {};
  const stale = curationIsStale(detail);
  const id = detail.transect.id;
  document.querySelector("#record-dialog-title").textContent = [metadata.site, metadata.transectNumber && `Transect ${metadata.transectNumber}`].filter(Boolean).join(" · ") || id;
  document.querySelector("#record-dialog-subtitle").textContent = `${id} · submitted ${formatDate(detail.transect.original_submitted_at)}`;
  const hasCuration = Boolean(detail.curation?.active && detail.curation?.curated_payload);
  const activeSource = state.detailSource;
  const submissionCount = Math.max(1, Number(detail.transect.submission_count || 1));
  const revisionCount = submissionCount - 1;
  const curationStatus = hasCuration ? (stale ? "Stale archive—re-review required" : `Current · version ${Number(detail.curation.version || 0)}`) : "No active curation";
  const sourceTab = (source, label) => `<button type="button" aria-pressed="${activeSource === source}" data-action="detail-source" data-source="${source}" class="${activeSource === source ? "active" : ""}">${label}</button>`;
  document.querySelector("#record-detail").innerHTML = `
    <div class="detail-toolbar"><div class="source-tabs" role="group" aria-label="Record data source">${sourceTab("effective", "Effective")}${sourceTab("original", "Original")}${hasCuration ? `${sourceTab("curated", `Curated${stale ? " archive" : ""}`)}${sourceTab("diff", "Differences")}` : ""}</div><button class="button secondary compact" type="button" data-action="open-curation">Curate</button>${hasCuration ? `<button class="button secondary compact" type="button" data-action="clear-curation">Clear curation</button>` : ""}<button class="button ${recordIsTrashed({ state: detail.state }) ? "secondary" : "warning"} compact" type="button" data-action="${recordIsTrashed({ state: detail.state }) ? "restore-current" : "trash-current"}">${recordIsTrashed({ state: detail.state }) ? "Restore" : "Move to trash"}</button></div>
    <dl class="record-provenance"><div><dt>Original submission</dt><dd>${escapeHtml(formatDate(detail.transect.original_submitted_at))}</dd></div><div><dt>Latest submission update</dt><dd>${escapeHtml(formatDate(detail.transect.server_updated_at || detail.transect.client_modified_at))}</dd></div><div><dt>Revisions</dt><dd>${revisionCount} student revision${revisionCount === 1 ? "" : "s"}</dd></div><div><dt>Sync state</dt><dd>${escapeHtml(humanize(detail.transect.sync_state))}</dd></div><div><dt>Curation</dt><dd>${escapeHtml(curationStatus)}</dd></div><div><dt>Trash state</dt><dd>${recordIsTrashed({ state: detail.state }) ? "Trashed" : "Active"}</dd></div></dl>
    ${stale ? `<div class="notice danger"><strong>Stale curation—not applied.</strong><p>The student submitted a newer revision after this curation. Effective display and default export use the new original submission until an instructor re-reviews and saves a current curation.</p></div>` : ""}
    ${detail.transect.sync_state === "upload_partially_complete" ? `<div class="notice warning"><strong>Photo upload incomplete.</strong><p>The survey payload is present, but one or more photos may be missing.</p></div>` : ""}
    ${activeSource === "diff" ? diffMarkup() : `<section><div class="detail-metrics"><div class="detail-metric"><strong>${summary.completed}</strong><span>of 180 complete</span></div><div class="detail-metric"><strong>${summary.detectedCells}</strong><span>detected cells</span></div><div class="detail-metric"><strong>${summary.species.length}</strong><span>target species</span></div><div class="detail-metric"><strong>${detail.photos?.length || 0}</strong><span>photo records</span></div></div></section><section class="detail-section"><h3>Metadata</h3>${metadataMarkup(payload)}</section><section class="detail-section"><div class="section-heading"><div><h3>All 180 cells</h3><p class="muted">Rows are 1-meter trail segments; columns are distance bands on each side while facing start → end.</p></div>${cellStatusFilterMarkup()}</div>${cellsGridMarkup(payload, { statusFilter: state.detailCellFilter })}${observationsMarkup(payload)}</section>`}
    ${photoMarkup(detail)}${stateFormMarkup(detail)}${historyMarkup(detail)}`;
  wirePhotoThumbnailErrors();
}

function metadataInput(name, label, value, type = "text") {
  return `<label class="field"><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" ${type === "number" ? 'step="any"' : ""} value="${escapeHtml(value ?? "")}"></label>`;
}

function focusCurationLocation(location, target = "grid") {
  if (!location) return;
  requestAnimationFrame(() => {
    const element = target === "editor"
      ? document.querySelector("#curation-cell-status")
      : document.querySelector(`[data-action="edit-curation-cell"][data-segment="${location.segmentIndex}"][data-side="${location.side}"][data-band="${location.bandStart}"]`);
    element?.focus();
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function renderCuration({ focus = "none" } = {}) {
  const payload = state.curationDraft;
  const metadata = payload.metadata || {};
  const gps = (key, label) => {
    const value = metadata[key] || {};
    return `<fieldset><legend>${label}</legend>${metadataInput(`${key}Latitude`, "Latitude", value.latitude, "number")}${metadataInput(`${key}Longitude`, "Longitude", value.longitude, "number")}${metadataInput(`${key}Accuracy`, "Accuracy (m)", value.accuracy, "number")}${metadataInput(`${key}Timestamp`, "Timestamp", value.timestamp, "text")}</fieldset>`;
  };
  document.querySelector("#curation-body").innerHTML = `<div class="curation-layout"><section class="curation-metadata"><h3>Metadata</h3>${metadataInput("site", "Site", metadata.site)}${metadataInput("trail", "Trail", metadata.trail)}${metadataInput("transectNumber", "Transect #", metadata.transectNumber)}${metadataInput("observers", "Observers", metadata.observers)}${metadataInput("surveyDate", "Survey date", metadata.surveyDate, "date")}${metadataInput("startTime", "Start time", metadata.startTime, "time")}${metadataInput("endTime", "End time", metadata.endTime, "time")}<label class="field"><span>General notes</span><textarea name="generalNotes">${escapeHtml(metadata.generalNotes || "")}</textarea></label>${gps("startGps", "Start GPS")}${gps("endGps", "End GPS")}</section><section class="curation-grid-panel"><h3>Cell corrections</h3><p class="muted">Select a cell, stage its values below, then save the complete curation with a reason.</p>${cellsGridMarkup(payload, { editable: true })}<div id="curation-cell-editor" class="curation-cell-editor"><p class="muted">Choose a cell in the grid to inspect or edit it.</p></div><div id="curation-validation"></div></section></div>`;
  if (state.curationCell) renderCurationCellEditor();
  if (focus !== "none") focusCurationLocation(state.curationCell, focus);
}

function renderCurationCellEditor() {
  const location = state.curationCell;
  const cell = cellFor(state.curationDraft, location.segmentIndex, location.side, location.bandStart);
  const segment = state.curationDraft.segments[location.segmentIndex];
  const editor = document.querySelector("#curation-cell-editor");
  editor.innerHTML = `<h3>${segment.label} · ${escapeHtml(location.side.toUpperCase())} · ${cell.bandStart}–${cell.bandEnd} m</h3><label class="field"><span>Status</span><select name="curationCellStatus" id="curation-cell-status">${Object.entries(CELL_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${cell.status === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label><fieldset><legend>Target species</legend><div class="species-checks">${SPECIES.map((species) => `<label><input type="checkbox" name="curationSpecies" value="${escapeHtml(species.code)}" ${cell.species.includes(species.code) ? "checked" : ""}><span><strong>${escapeHtml(species.code)}</strong> ${escapeHtml(species.commonName)}</span></label>`).join("")}</div></fieldset><label class="field"><span>Unknown plants (one note per line)</span><textarea name="curationUnknowns">${escapeHtml((cell.unknowns || []).map((item) => item.note || "Unknown plant").join("\n"))}</textarea></label><label class="field"><span>Cell note</span><textarea name="curationCellNote">${escapeHtml(cell.note || "")}</textarea></label><label class="field"><span>Segment note</span><textarea name="curationSegmentNote">${escapeHtml(segment.note || "")}</textarea></label><div id="curation-cell-error" class="status-message error"></div><div class="editor-actions"><button class="button primary compact" type="button" data-action="apply-curation-cell">Apply cell to draft</button></div>`;
}

function readGps(form, prefix, existing) {
  const latitude = String(form.elements[`${prefix}Latitude`]?.value || "").trim();
  const longitude = String(form.elements[`${prefix}Longitude`]?.value || "").trim();
  if (!latitude && !longitude) return null;
  return {
    latitude: latitude === "" ? null : Number(latitude), longitude: longitude === "" ? null : Number(longitude),
    accuracy: form.elements[`${prefix}Accuracy`]?.value === "" ? null : Number(form.elements[`${prefix}Accuracy`].value),
    timestamp: String(form.elements[`${prefix}Timestamp`]?.value || existing?.timestamp || ""),
    source: existing?.source || "instructor_correction",
  };
}

function copyMetadataFromCurationForm() {
  const form = document.querySelector("#curation-form");
  const metadata = state.curationDraft.metadata;
  for (const key of ["site", "trail", "transectNumber", "observers", "surveyDate", "startTime", "endTime", "generalNotes"]) metadata[key] = String(form.elements[key]?.value || "").trim();
  metadata.startGps = readGps(form, "startGps", metadata.startGps);
  metadata.endGps = readGps(form, "endGps", metadata.endGps);
}

function applyCurationCell({ rerender = true, announce = true } = {}) {
  const location = state.curationCell;
  if (!location) return true;
  const editor = document.querySelector("#curation-cell-editor");
  const cell = cellFor(state.curationDraft, location.segmentIndex, location.side, location.bandStart);
  const status = editor.querySelector('[name="curationCellStatus"]').value;
  const species = [...editor.querySelectorAll('[name="curationSpecies"]:checked')].map((input) => input.value);
  const notes = editor.querySelector('[name="curationUnknowns"]').value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (status === CELL_STATUSES.DETECTED && !species.length && !notes.length) {
    editor.querySelector("#curation-cell-error").textContent = "A detected cell must contain a target species or unknown plant.";
    editor.querySelector("#curation-cell-status")?.focus();
    return false;
  }
  cell.status = status;
  cell.species = status === CELL_STATUSES.DETECTED ? [...new Set(species)] : [];
  cell.unknowns = status === CELL_STATUSES.DETECTED ? reconcileUnknownNotes(cell.unknowns, notes) : [];
  cell.note = editor.querySelector('[name="curationCellNote"]').value.trim();
  state.curationDraft.segments[location.segmentIndex].note = editor.querySelector('[name="curationSegmentNote"]').value.trim();
  copyMetadataFromCurationForm();
  if (rerender) renderCuration({ focus: "grid" });
  if (announce) toast("Cell change staged. Save the curation to apply it to dashboard data.");
  return true;
}

async function refreshDetailAndList(id) {
  const requestNumber = ++state.detailRequest;
  const epoch = currentSessionEpoch();
  const detail = await fetchRecordDetail(id);
  if (requestNumber !== state.detailRequest || !sessionIsCurrent(epoch)) return;
  state.detail = detail;
  const photoIds = new Set((state.detail.photos || []).map((photo) => photo.id));
  state.selectedPhotos = new Set([...state.selectedPhotos].filter((photoId) => photoIds.has(photoId)));
  for (const photoId of state.photoUrls.keys()) if (!photoIds.has(photoId)) state.photoUrls.delete(photoId);
  for (const photoId of state.photoPreviewRequests.keys()) if (!photoIds.has(photoId)) state.photoPreviewRequests.delete(photoId);
  renderRecordDetail();
  await loadRecords({ quiet: true });
}

function openAction(kind, records, extra = {}) {
  const ids = records.map(recordId);
  if (!ids.length) { toast("No eligible records are selected for that action.", "warning"); return; }
  if ((kind === "trash" || kind === "restore") && ids.length > MAX_BULK_ACTION_RECORDS) {
    toast(`Bulk changes are limited to ${MAX_BULK_ACTION_RECORDS} records. Narrow the selection and try again.`, "warning", 7000);
    return;
  }
  const labels = records.map((record) => `${recordTitle(record)} · ${recordId(record)}`);
  const config = {
    trash: ["Move records to trash", `Move ${ids.length} selected record${ids.length === 1 ? "" : "s"} to reversible trash?`, "Move to trash", "warning"],
    restore: ["Restore records", `Restore ${ids.length} selected record${ids.length === 1 ? "" : "s"} to active views?`, "Restore", "primary"],
    clearCuration: ["Clear active curation", "Return effective display and export to the original student submission? Curation history will be retained.", "Clear curation", "warning"],
    revertCuration: ["Restore curation version", "Restore this archived curation as the current curated representation?", "Restore version", "primary"],
  }[kind];
  if (!config) return;
  state.pendingAction = { kind, records, ids, ...extra };
  document.querySelector("#action-title").textContent = config[0];
  document.querySelector("#action-message").textContent = config[1];
  document.querySelector("#action-record-list").innerHTML = labels.map((label) => `<code>${escapeHtml(label)}</code>`).join("");
  const form = document.querySelector("#action-form");
  form.reset();
  delete form.dataset.locked;
  const button = document.querySelector("#action-confirm");
  button.textContent = config[2];
  button.className = `button ${config[3]}`;
  openDialog(actionDialog);
}

async function performPendingAction(form) {
  const pending = state.pendingAction;
  if (!pending) return;
  const reason = new FormData(form).get("reason")?.trim();
  setBusy(form, true);
  try {
    let keepDialogOpen = false;
    if (pending.kind === "trash" || pending.kind === "restore") {
      const action = pending.kind === "trash" ? INSTRUCTOR_ACTIONS.TRASH : INSTRUCTOR_ACTIONS.RESTORE;
      const versions = Object.fromEntries(pending.records.map((record) => [recordId(record), stateVersion(record)]));
      const requestId = boundRequestId(pending, { action, recordIds: pending.ids, reason, expectedStateVersions: versions });
      const result = await changeTrashState(action, pending.ids, reason, versions, { requestId });
      const failed = (result.results || []).filter((item) => !item.ok);
      if (failed.length) {
        keepDialogOpen = true;
        document.querySelector("#action-message").textContent = `${result.results.length - failed.length} record${result.results.length - failed.length === 1 ? "" : "s"} changed; ${failed.length} failed. Refresh before retrying only the failed records.`;
        document.querySelector("#action-record-list").innerHTML = failed.map((item) => `<div><code>${escapeHtml(item.recordId || "Unknown ID")}</code><span>${escapeHtml(item.error || item.code || "Unknown failure")}</span></div>`).join("");
        form.elements.reason.value = "";
        form.dataset.locked = "true";
        toast("Bulk action was only partially completed. Exact failures remain open in the dialog.", "warning", 8000);
      } else {
        toast(`${pending.ids.length} record${pending.ids.length === 1 ? "" : "s"} updated.`);
      }
    } else if (pending.kind === "clearCuration") {
      const expectedSubmissionCount = state.detail.transect.submission_count;
      const expectedCurationVersion = curationVersion(state.detail);
      const requestId = boundRequestId(pending, {
        action: INSTRUCTOR_ACTIONS.CLEAR_CURATION, recordId: pending.ids[0], reason,
        expectedSubmissionCount, expectedCurationVersion,
      });
      await clearCuration(pending.ids[0], reason, expectedSubmissionCount, expectedCurationVersion, { requestId });
    } else if (pending.kind === "revertCuration") {
      const expectedSubmissionCount = state.detail.transect.submission_count;
      const expectedCurationVersion = curationVersion(state.detail);
      const requestId = boundRequestId(pending, {
        action: INSTRUCTOR_ACTIONS.REVERT_CURATION, recordId: pending.ids[0], revisionId: pending.revisionId,
        reason, expectedSubmissionCount, expectedCurationVersion,
      });
      await revertCuration(pending.ids[0], pending.revisionId, reason, expectedSubmissionCount, expectedCurationVersion, { requestId });
    }
    if (!keepDialogOpen) closeDialog(actionDialog);
    state.pendingAction = null;
    state.selected.clear();
    if (state.detail?.transect?.id && pending.ids.includes(state.detail.transect.id)) await refreshDetailAndList(state.detail.transect.id);
    else await loadRecords({ quiet: true });
  } catch (error) {
    invalidateAfterCertainFailure(pending, error);
    handleError(error);
  }
  finally { setBusy(form, false); }
}

async function startPurge(records) {
  const ids = records.map(recordId);
  if (state.filters.trashState !== "trashed") {
    toast("Permanent purge is available only in the explicit Trash only view.", "warning", 7000);
    return;
  }
  if (!ids.length || records.some((record) => !recordIsTrashed(record))) {
    toast("Select only records confirmed as trashed before starting a purge.", "warning", 7000);
    return;
  }
  if (ids.length > MAX_PURGE_RECORDS) {
    toast(`Permanent purge is limited to ${MAX_PURGE_RECORDS} records at a time. Narrow the selection and try again.`, "warning", 7000);
    return;
  }
  setMessage("Verifying exact trash contents…");
  try {
    const preview = await previewPurge(ids);
    const eligible = preview.records || preview.recordIds || preview.eligibleRecords || preview.eligibleIds || [];
    const eligibleIds = eligible.map((item) => typeof item === "string" ? item : (item.recordId || item.record_id));
    const sortedEligible = [...eligibleIds].sort();
    const sortedRequested = [...ids].sort();
    if (sortedEligible.length !== sortedRequested.length || sortedEligible.some((id, index) => id !== sortedRequested[index])) {
      throw new Error("The purge preview did not return the exact selected record set. Refresh before trying again.");
    }
    state.purgePreview = { ...preview, eligibleIds };
    document.querySelector("#purge-summary").textContent = `${preview.recordCount ?? eligibleIds.length} records, ${preview.photoMetadataCount ?? preview.photoCount ?? 0} linked photo records, and ${preview.storageObjectCount ?? preview.photoCount ?? 0} private photo objects will be permanently removed.`;
    const previewRecords = preview.records || [];
    document.querySelector("#purge-record-list").innerHTML = eligibleIds.map((id) => {
      const item = previewRecords.find((candidate) => candidate.recordId === id) || {};
      const snapshot = item.display || item.snapshot || item.recordSnapshot?.display || {};
      const identity = [snapshot.site, snapshot.trail, snapshot.transectNumber && `Transect ${snapshot.transectNumber}`, snapshot.surveyDate].filter(Boolean).join(" · ") || "Metadata not entered";
      return `<div><strong>${escapeHtml(identity)}</strong><code>${escapeHtml(id)}</code><small>${Number(item.photoMetadataCount || 0)} photo metadata row${Number(item.photoMetadataCount || 0) === 1 ? "" : "s"} · ${Number(item.storageObjectCount || 0)} private object${Number(item.storageObjectCount || 0) === 1 ? "" : "s"}</small></div>`;
    }).join("");
    document.querySelector("#purge-confirmation-copy").textContent = preview.confirmation;
    document.querySelector("#purge-result").classList.add("hidden");
    document.querySelector("#purge-result").textContent = "";
    const purgeForm = document.querySelector("#purge-form");
    purgeForm.reset();
    delete purgeForm.dataset.locked;
    openDialog(purgeDialog);
    setMessage("");
  } catch (error) { handleError(error); }
}

async function executePurge(form) {
  const preview = state.purgePreview;
  if (!preview) return;
  const data = new FormData(form);
  setBusy(form, true, "Purging exact records…");
  try {
    const reason = data.get("reason");
    const confirmation = data.get("confirmation");
    const requestId = boundRequestId(preview, {
      action: INSTRUCTOR_ACTIONS.PURGE,
      recordIds: preview.eligibleIds,
      challenge: preview.challenge,
      reason,
      confirmation,
    });
    const result = await permanentlyPurge({
      recordIds: preview.eligibleIds,
      challenge: preview.challenge,
      password: data.get("password"),
      reason,
      confirmation,
    }, { requestId });
    form.elements.password.value = "";
    const failed = (result.results || []).filter((item) => !item.ok);
    if (failed.length) {
      const resultPanel = document.querySelector("#purge-result");
      resultPanel.innerHTML = `<strong>Partial purge—${failed.length} record${failed.length === 1 ? "" : "s"} failed.</strong><p>Refresh Trash, select only the remaining records, and create a new purge preview. Do not reuse this challenge.</p><div class="id-list">${failed.map((item) => `<div><code>${escapeHtml(item.recordId || "Unknown ID")}</code><span>${escapeHtml(item.error || item.code || item.stage || "Unknown failure")}</span></div>`).join("")}</div>`;
      resultPanel.classList.remove("hidden");
      state.purgePreview = null;
      form.elements.password.value = "";
      form.elements.confirmation.value = "";
      form.dataset.locked = "true";
      toast("Permanent deletion was only partially completed. Exact failures are shown in the dialog.", "warning", 9000);
    } else {
      toast(`${preview.eligibleIds.length} record${preview.eligibleIds.length === 1 ? "" : "s"} permanently purged.`, "info", 9000);
      invalidateBoundRequest(preview);
      state.purgePreview = null;
      form.reset();
      closeDialog(purgeDialog);
      if (state.detail && preview.eligibleIds.includes(state.detail.transect.id)) { closeDialog(recordDialog); state.detail = null; }
    }
    state.selected.clear();
    await loadRecords({ quiet: true });
  } catch (error) {
    form.elements.password.value = "";
    invalidateAfterCertainFailure(preview, error);
    handleError(error);
  } finally { setBusy(form, false); }
}

async function resolveDownloadRecords(form) {
  const data = new FormData(form);
  const scope = data.get("scope");
  if (scope === "selected") return [...state.selected.values()];
  if (scope === "filtered") return collectRecords(state.filters, (done, total) => { document.querySelector("#download-progress").textContent = `Resolving filtered records: ${done} of ${total}…`; });
  if (scope === "class" && !state.filters.classId) throw new Error("Select one class in the dashboard filter before choosing Current class.");
  const overrides = scope === "class" ? { classId: state.filters.classId } : { classId: "" };
  const broad = freshFilters({ ...overrides, includeInactiveClasses: true, trashState: "all" });
  return collectRecords(broad, (done, total) => { document.querySelector("#download-progress").textContent = `Resolving records: ${done} of ${total}…`; });
}

function downloadEligibilityKey(form) {
  const data = new FormData(form);
  return JSON.stringify({
    scope: data.get("scope"), includeTest: data.get("includeTest") === "on",
    includeExcluded: data.get("includeExcluded") === "on", includeTrash: data.get("includeTrash") === "on",
    format: data.get("format"), sourceMode: data.get("sourceMode"),
    selected: data.get("scope") === "selected" ? [...state.selected.keys()].sort() : [],
    filters: data.get("scope") === "filtered" ? state.filters : null,
    classId: data.get("scope") === "class" ? state.filters.classId : null,
  });
}

function assertFormatSafe(records, data) {
  const format = data.get("format");
  const sourceMode = data.get("sourceMode");
  if (format === "long-csv") {
    const estimatedBaseRows = records.length * 180 * (sourceMode === "both" ? 2 : 1);
    if (estimatedBaseRows > LONG_EXPORT_BASE_ROW_LIMIT) {
      throw new Error(`This long CSV would start with about ${estimatedBaseRows.toLocaleString()} cell rows before multi-species expansion. Narrow the scope below ${LONG_EXPORT_BASE_ROW_LIMIT.toLocaleString()} base rows and download smaller batches.`);
    }
  }
  if (format === "raw-json" && records.length > RAW_JSON_RECORD_LIMIT) {
    throw new Error(`Raw JSON is limited to ${RAW_JSON_RECORD_LIMIT} records per browser download because complete protocol payloads are large. Download smaller batches.`);
  }
  if (format === "photo-manifest" && records.length > PHOTO_MANIFEST_RECORD_LIMIT) {
    throw new Error(`Photo manifests are limited to ${PHOTO_MANIFEST_RECORD_LIMIT.toLocaleString()} records per browser download. Narrow the class or filters and download smaller batches.`);
  }
  if (["metadata-csv", "geojson"].includes(format) && records.length > TRANSFORM_EXPORT_RECORD_LIMIT) {
    throw new Error(`${format === "geojson" ? "GeoJSON" : "Metadata CSV"} is limited to ${TRANSFORM_EXPORT_RECORD_LIMIT.toLocaleString()} records per browser download because complete protocol payloads must be assembled before conversion. Download smaller batches.`);
  }
}

function applyDownloadExclusions(records, data) {
  const includeTest = data.get("includeTest") === "on";
  const includeExcluded = data.get("includeExcluded") === "on";
  const includeTrash = data.get("includeTrash") === "on";
  return records.filter((record) => (includeTest || !recordIsTest(record))
    && (includeExcluded || !recordIsExcluded(record)) && (includeTrash || !recordIsTrashed(record)));
}

async function resolveEligibleRecords(form) {
  const data = new FormData(form);
  const records = await resolveDownloadRecords(form);
  if (data.get("scope") !== "selected" || !records.length) return applyDownloadExclusions(records, data);
  const bundle = await fetchBundleFor(records, "eligibility");
  const current = filterExportBundle(bundle, {
    includeTest: data.get("includeTest") === "on",
    includeExcluded: data.get("includeExcluded") === "on",
    includeTrash: data.get("includeTrash") === "on",
  });
  const eligibleIds = new Set(current.transects.map((transect) => transect.id));
  return records.filter((record) => eligibleIds.has(recordId(record)));
}

async function updateDownloadEligibility() {
  const form = document.querySelector("#download-form");
  const progress = document.querySelector("#download-progress");
  const submit = form.querySelector('[type="submit"]');
  const key = downloadEligibilityKey(form);
  const requestNumber = ++state.downloadPreviewRequest;
  state.downloadPreview = null;
  submit.disabled = true;
  progress.textContent = "Calculating exact eligible record count…";
  try {
    const records = await resolveEligibleRecords(form);
    if (requestNumber !== state.downloadPreviewRequest || key !== downloadEligibilityKey(form)) return;
    assertFormatSafe(records, new FormData(form));
    state.downloadPreview = { key, records };
    progress.textContent = `${records.length.toLocaleString()} record${records.length === 1 ? "" : "s"} eligible after the selected safeguards.`;
    submit.disabled = records.length === 0;
  } catch (error) {
    if (requestNumber !== state.downloadPreviewRequest || key !== downloadEligibilityKey(form)) return;
    if (handleExpiredSession(error)) return;
    progress.textContent = String(error?.message || error);
    submit.disabled = true;
  }
}

async function fetchBundleFor(records, format) {
  const bundles = [];
  const ids = records.map(recordId);
  let completed = 0;
  const fetchBatch = async (batch) => {
    try {
      const bundle = await fetchAuditedExport(batch, format);
      bundles.push(bundle);
      completed += batch.length;
      document.querySelector("#download-progress").textContent = `Fetched ${completed.toLocaleString()} of ${ids.length.toLocaleString()} records…`;
    } catch (error) {
      if (error?.status === 413 && batch.length > 1) {
        discardExportRequest(batch, format);
        const midpoint = Math.ceil(batch.length / 2);
        await fetchBatch(batch.slice(0, midpoint));
        await fetchBatch(batch.slice(midpoint));
        return;
      }
      if (error?.status === 413 && batch.length === 1) {
        discardExportRequest(batch, format);
        throw new Error(`Record ${batch[0]} exceeds the dashboard's bounded export response. Download its photo manifest separately or inspect it in Supabase. (${error.message})`);
      }
      throw error;
    }
  }
  for (let index = 0; index < ids.length; index += EXPORT_BATCH_SIZE) await fetchBatch(ids.slice(index, index + EXPORT_BATCH_SIZE));
  const merged = mergeExportBundles(bundles);
  const returnedIds = merged.transects.map((transect) => transect.id);
  const returnedSet = new Set(returnedIds);
  if (returnedIds.length !== ids.length || returnedSet.size !== ids.length || ids.some((id) => !returnedSet.has(id))) {
    throw new Error("The server export did not return the exact requested record set. Refresh and try again.");
  }
  return merged;
}

function exportRequestKey(recordIds, format, reason = "") {
  return JSON.stringify({ action: INSTRUCTOR_ACTIONS.EXPORT_RECORDS, recordIds, format, reason });
}

function discardExportRequest(recordIds, format, reason = "") {
  state.exportRequestIds.delete(exportRequestKey(recordIds, format, reason));
}

async function fetchAuditedExport(recordIds, format, reason = "") {
  const requestKey = exportRequestKey(recordIds, format, reason);
  const requestId = state.exportRequestIds.get(requestKey) || createInstructorRequestId();
  state.exportRequestIds.set(requestKey, requestId);
  try {
    const bundle = await fetchExportRecords(recordIds, { format, reason }, { requestId });
    state.exportRequestIds.delete(requestKey);
    return bundle;
  } catch (error) {
    if (error instanceof InstructorApiError && error.status < 500) state.exportRequestIds.delete(requestKey);
    throw error;
  }
}

async function executeDownload(form) {
  const data = new FormData(form);
  const progress = document.querySelector("#download-progress");
  const warning = document.querySelector("#download-warning");
  warning.classList.add("hidden"); warning.textContent = "";
  setBusy(form, true, "Preparing…");
  try {
    const previewKey = downloadEligibilityKey(form);
    let records = state.downloadPreview?.key === previewKey ? state.downloadPreview.records : await resolveEligibleRecords(form);
    const inclusion = {
      includeTest: data.get("includeTest") === "on",
      includeExcluded: data.get("includeExcluded") === "on",
      includeTrash: data.get("includeTrash") === "on",
    };
    if (!records.length) throw new Error("No records remain after the default test, exclusion, and trash safeguards. Change the download options if intentional.");
    assertFormatSafe(records, data);
    let bundle = await fetchBundleFor(records, data.get("format"));
    bundle = filterExportBundle(bundle, { ...inclusion, summaries: records });
    if (bundle.transects.length !== records.length) {
      state.downloadPreview = null;
      throw new Error(`Record safeguards changed while this download was being prepared (${bundle.transects.length} now eligible instead of ${records.length}). Review the exact count and press Prepare download again.`);
    }
    if (data.get("format") === "photo-zip") {
      const photoCount = bundle.photos.length;
      const bytes = bundle.photos.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
      if (photoCount > PHOTO_ZIP_LIMITS.maxFiles || bytes > PHOTO_ZIP_LIMITS.maxBytes) throw new Error(`Choose a smaller batch: photo ZIPs are capped at ${PHOTO_ZIP_LIMITS.maxFiles} files and ${Math.round(PHOTO_ZIP_LIMITS.maxBytes / 1048576)} MB to protect browser memory.`);
      const result = await downloadPhotoZip(bundle, {
        fetchPhotoUrls: (ids) => fetchPhotoUrls(ids),
        onProgress: ({ completed, total, failures, zipPercent }) => { progress.textContent = zipPercent ? `Building ZIP: ${Math.round(zipPercent)}% · ${failures} failed` : `Downloading photos: ${completed} of ${total} · ${failures} failed`; },
      });
      toast(`Photo ZIP saved: ${result.included} included, ${result.failures} failed. The manifest records every result.`, result.failures ? "warning" : "info", 8000);
    } else {
      downloadExport(data.get("format"), bundle, { sourceMode: data.get("sourceMode"), classes: bundle.classes, prefix: "invasive-plant-transects" });
      toast(`${bundle.transects.length} record${bundle.transects.length === 1 ? "" : "s"} prepared for download.`);
    }
    progress.textContent = "Download prepared. Check your browser’s downloads.";
    state.exportRequestIds.clear();
  } catch (error) {
    if (handleExpiredSession(error)) return;
    warning.textContent = String(error?.message || error);
    warning.classList.remove("hidden");
    progress.textContent = "";
  } finally { setBusy(form, false); }
}

async function openPhoto(photoId) {
  const requestNumber = ++state.photoRequest;
  const epoch = currentSessionEpoch();
  const photo = state.detail?.photos?.find((item) => item.id === photoId);
  document.querySelector("#photo-title").textContent = photo ? `Photo ${photo.id}` : "Photograph";
  document.querySelector("#photo-context").textContent = photo ? `${photoAssociation(photo)} · captured ${formatDate(photo.captured_at)}${photo.note ? ` · ${photo.note}` : ""}` : "";
  const body = document.querySelector("#photo-body");
  body.innerHTML = `<p>Authorizing private photograph…</p>`;
  openDialog(photoDialog);
  try {
    const data = await fetchPhotoUrls([photoId]);
    if (requestNumber !== state.photoRequest || !sessionIsCurrent(epoch) || !photoDialog.open) return;
    const item = (data.items || []).find((candidate) => candidate.id === photoId);
    const signedUrl = safeSignedPhotoUrl(item?.signedUrl);
    if (!signedUrl) throw new Error(item?.signedError || "No valid signed photo URL was returned.");
    body.replaceChildren();
    const image = document.createElement("img");
    image.src = signedUrl;
    image.alt = photo?.note || `Survey photograph ${photoId}`;
    image.addEventListener("error", () => { body.innerHTML = `<p class="photo-error">The private file could not be loaded. It may be missing or the signed URL may have expired.</p><button class="button secondary compact" type="button" data-action="open-photo" data-photo-id="${escapeHtml(photoId)}">Request fresh preview</button>`; }, { once: true });
    body.append(image);
  } catch (error) {
    if (requestNumber !== state.photoRequest || !sessionIsCurrent(epoch) || !photoDialog.open) return;
    if (handleExpiredSession(error)) return;
    body.innerHTML = `<p class="photo-error">${escapeHtml(error?.message || "The photograph could not be opened.")}</p><button class="button secondary compact" type="button" data-action="open-photo" data-photo-id="${escapeHtml(photoId)}">Try again</button>`;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setLoginStatus("Signing in…"); setBusy(form, true, "Signing in…");
  try {
    state.session = await loginInstructor(data.get("reviewerName"), data.get("password"));
    form.elements.password.value = "";
    showDashboard();
    await bootstrapDashboard();
  } catch (error) {
    form.elements.password.value = "";
    setLoginStatus(error?.message || "Sign-in failed.", "error");
  } finally { setBusy(form, false); }
});

filterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.filters = filtersFromForm();
  state.selected.clear();
  syncFilterRailAccessibility(false);
  await loadRecords({ resetPage: true });
});

filterForm.elements.includeInactiveClasses.addEventListener("change", () => populateClassSelect());

document.querySelector("#page-size").addEventListener("change", async (event) => {
  state.pageSize = Number(event.target.value);
  await loadRecords({ resetPage: true });
});

document.querySelector("#download-form").addEventListener("change", (event) => {
  if (event.target.matches('[name="scope"], [name="includeTest"], [name="includeExcluded"], [name="includeTrash"], [name="format"], [name="sourceMode"]')) {
    state.exportRequestIds.clear();
    updateDownloadEligibility();
  }
});

function invalidateEditedOperation(event) {
  const form = event.target.closest?.("form");
  if (!form) return;
  if (form.id === "state-form" || form.id === "curation-form") invalidateBoundRequest(form);
  else if (form.id === "action-form") invalidateBoundRequest(state.pendingAction);
  else if (form.id === "purge-form" && event.target.name !== "password") invalidateBoundRequest(state.purgePreview);
  else if (form.id === "download-form") state.exportRequestIds.clear();
}

document.addEventListener("input", invalidateEditedOperation);
document.addEventListener("change", invalidateEditedOperation);

document.addEventListener("change", (event) => {
  const photoCheckbox = event.target.closest?.("[data-select-photo]");
  if (photoCheckbox) {
    state.exportRequestIds.clear();
    if (photoCheckbox.checked) state.selectedPhotos.add(photoCheckbox.dataset.selectPhoto);
    else state.selectedPhotos.delete(photoCheckbox.dataset.selectPhoto);
    updatePhotoSelectionControls();
    return;
  }
  const checkbox = event.target.closest?.("[data-select-record]");
  if (!checkbox) return;
  const record = state.records.find((item) => recordId(item) === checkbox.dataset.selectRecord);
  if (checkbox.checked && record) state.selected.set(recordId(record), record);
  else state.selected.delete(checkbox.dataset.selectRecord);
  checkbox.closest("tr")?.classList.toggle("selected", checkbox.checked);
  renderSelection();
});

document.addEventListener("click", async (event) => {
  const close = event.target.closest?.("[data-close-dialog]");
  if (close) { closeDialog(document.getElementById(close.dataset.closeDialog)); return; }
  const sort = event.target.closest?.("[data-sort]");
  if (sort) {
    state.sort = { field: sort.dataset.sort, direction: state.sort.field === sort.dataset.sort && state.sort.direction === "asc" ? "desc" : "asc" };
    await loadRecords({ resetPage: true }); return;
  }
  const button = event.target.closest?.("[data-action]");
  if (!button) {
    const row = event.target.closest?.("[data-record-row]");
    if (row && !event.target.closest("input, select, textarea, a")) await openRecord(row.dataset.recordRow);
    return;
  }
  const action = button.dataset.action;
  if (action === "sign-out") { showLogin(); return; }
  if (action === "refresh") { await bootstrapDashboard(); return; }
  if (action === "toggle-filters") {
    syncFilterRailAccessibility(!filterRail.classList.contains("open")); return;
  }
  if (action === "close-filters") { syncFilterRailAccessibility(false); return; }
  if (action === "clear-filters") {
    state.filters = freshFilters(); state.selected.clear(); writeFiltersToForm(); await loadRecords({ resetPage: true }); return;
  }
  if (action === "show-test-only") {
    state.filters = { ...filtersFromForm(), testState: "test" };
    state.selected.clear(); writeFiltersToForm(); syncFilterRailAccessibility(false); await loadRecords({ resetPage: true }); return;
  }
  if (action === "remove-filter") {
    const key = button.dataset.filterKey;
    if (key === "surveyDates") { state.filters.surveyDateFrom = ""; state.filters.surveyDateTo = ""; }
    else if (key === "submissionDates") { state.filters.submissionDateFrom = ""; state.filters.submissionDateTo = ""; }
    else if (key === "includeInactiveClasses") state.filters[key] = false;
    else if (key in state.filters) state.filters[key] = key === "trashState" ? "active" : "";
    state.selected.clear(); writeFiltersToForm(); await loadRecords({ resetPage: true }); return;
  }
  if (action === "open-record") { await openRecord(button.dataset.id); return; }
  if (action === "previous-page" && state.page > 1) { state.page -= 1; await loadRecords(); return; }
  if (action === "next-page" && state.page < state.totalPages) { state.page += 1; await loadRecords(); return; }
  if (action === "select-page") { state.records.forEach((record) => state.selected.set(recordId(record), record)); syncVisibleSelection(); renderSelection(); return; }
  if (action === "select-all-filtered") { await selectAllFiltered(); return; }
  if (action === "clear-selection") { state.selected.clear(); syncVisibleSelection(); renderSelection(); return; }
  if (action === "open-downloads" || action === "download-selected") {
    state.exportRequestIds.clear();
    document.querySelector("#download-form").reset();
    document.querySelector(`#download-form [name="scope"][value="${action === "download-selected" ? "selected" : "filtered"}"]`).checked = true;
    document.querySelector("#download-progress").textContent = ""; document.querySelector("#download-warning").classList.add("hidden"); renderSelection(); openDialog(downloadDialog); await updateDownloadEligibility(); return;
  }
  if (action === "trash-selected") { openAction("trash", [...state.selected.values()].filter((record) => !recordIsTrashed(record))); return; }
  if (action === "restore-selected") { openAction("restore", [...state.selected.values()].filter(recordIsTrashed)); return; }
  if (action === "purge-selected") {
    if (state.filters.trashState !== "trashed") { toast("Switch to Trash only before permanently purging records.", "warning"); return; }
    await startPurge([...state.selected.values()]); return;
  }
  if (action === "detail-source") { state.detailSource = button.dataset.source; renderRecordDetail(); return; }
  if (action === "detail-cell-filter") { state.detailCellFilter = button.dataset.status; renderRecordDetail(); return; }
  if (action === "load-photo-preview") { await loadPhotoPreview(button.dataset.photoId); return; }
  if (action === "download-detail-photos") { await downloadSelectedDetailPhotos(); return; }
  if (action === "open-curation") {
    const form = document.querySelector("#curation-form");
    invalidateBoundRequest(form);
    state.curationDraft = structuredClone(sourcePayload(state.detail, "effective")); state.curationCell = null; renderCuration(); form.elements.reason.value = ""; openDialog(curationDialog); return;
  }
  if (action === "edit-curation-cell") {
    if (state.curationCell && !applyCurationCell({ rerender: false, announce: false })) return;
    copyMetadataFromCurationForm();
    state.curationCell = { segmentIndex: Number(button.dataset.segment), side: button.dataset.side, bandStart: Number(button.dataset.band) };
    renderCuration({ focus: "editor" }); return;
  }
  if (action === "apply-curation-cell") { applyCurationCell(); return; }
  if (action === "clear-curation") { openAction("clearCuration", [{ ...state.records.find((record) => recordId(record) === state.detail.transect.id), recordId: state.detail.transect.id }]); return; }
  if (action === "revert-curation") { openAction("revertCuration", [{ recordId: state.detail.transect.id, originalMetadata: state.detail.transect.payload.metadata }], { revisionId: Number(button.dataset.revisionId) }); return; }
  if (action === "trash-current" || action === "restore-current") {
    const summary = state.records.find((record) => recordId(record) === state.detail.transect.id) || { recordId: state.detail.transect.id, originalMetadata: state.detail.transect.payload.metadata, state: state.detail.state };
    openAction(action === "trash-current" ? "trash" : "restore", [summary]); return;
  }
  if (action === "open-photo") { await openPhoto(button.dataset.photoId); }
});

document.addEventListener("keydown", async (event) => {
  if (event.key === "Escape" && filterRail.classList.contains("open")) {
    syncFilterRailAccessibility(false);
    document.querySelector('[data-action="toggle-filters"]')?.focus();
    return;
  }
  const row = event.target.closest?.("[data-record-row]");
  if (row && (event.key === "Enter" || event.key === " ") && !event.target.closest("input, button, select, textarea, a")) {
    event.preventDefault();
    await openRecord(row.dataset.recordRow);
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "state-form") {
    event.preventDefault(); const form = event.target; const data = new FormData(form); setBusy(form, true);
    try {
      const recordIdValue = state.detail.transect.id;
      const values = {
        reviewStatus: data.get("reviewStatus"), testDataStatus: data.get("testDataStatus"), excludedFromAnalysis: data.get("excludedFromAnalysis") === "on",
        flags: String(data.get("flags") || "").split(",").map((item) => item.trim()).filter(Boolean), instructorNote: data.get("instructorNote"), reason: data.get("reason"),
      };
      const expectedStateVersion = stateVersion(state.detail.state);
      const requestId = boundRequestId(form, {
        action: INSTRUCTOR_ACTIONS.SAVE_STATE, recordId: recordIdValue, values, expectedStateVersion,
      });
      await saveRecordState(recordIdValue, values, expectedStateVersion, { requestId });
      invalidateBoundRequest(form);
      toast("Instructor review state saved."); await refreshDetailAndList(state.detail.transect.id);
    } catch (error) {
      invalidateAfterCertainFailure(form, error);
      handleError(error);
    } finally { setBusy(form, false); }
  }
});

document.querySelector("#curation-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget;
  if (!applyCurationCell({ rerender: false, announce: false })) return;
  copyMetadataFromCurationForm();
  const errors = validateCuratedPayload(state.curationDraft);
  const output = document.querySelector("#curation-validation");
  if (errors.length) { output.innerHTML = `<div class="notice danger"><strong>Curation cannot be saved.</strong><ul class="validation-list">${errors.slice(0, 12).map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></div>`; output.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  setBusy(form, true, "Saving curation…");
  try {
    const recordIdValue = state.detail.transect.id;
    const reason = form.elements.reason.value;
    const expectedSubmissionCount = state.detail.transect.submission_count;
    const expectedCurationVersion = curationVersion(state.detail);
    const requestId = boundRequestId(form, {
      action: INSTRUCTOR_ACTIONS.SAVE_CURATION, recordId: recordIdValue, curatedPayload: state.curationDraft,
      reason, expectedSubmissionCount, expectedCurationVersion,
    });
    await saveCuration(recordIdValue, state.curationDraft, reason, expectedSubmissionCount, expectedCurationVersion, { requestId });
    invalidateBoundRequest(form);
    closeDialog(curationDialog); toast("Curated values saved; the original submission remains unchanged."); await refreshDetailAndList(state.detail.transect.id);
  } catch (error) {
    invalidateAfterCertainFailure(form, error);
    handleError(error);
  } finally { setBusy(form, false); }
});

document.querySelector("#action-form").addEventListener("submit", async (event) => { event.preventDefault(); await performPendingAction(event.currentTarget); });
document.querySelector("#purge-form").addEventListener("submit", async (event) => { event.preventDefault(); await executePurge(event.currentTarget); });
document.querySelector("#download-form").addEventListener("submit", async (event) => { event.preventDefault(); await executeDownload(event.currentTarget); });

document.querySelector("#summary-plot").addEventListener("change", (event) => {
  state.chartMetric = event.currentTarget.value;
  renderCharts();
});

document.querySelector("#summary-limit").addEventListener("change", (event) => {
  state.chartLimit = event.currentTarget.value;
  renderCharts();
});

for (const dialog of [recordDialog, curationDialog, downloadDialog, actionDialog, purgeDialog, photoDialog]) dialog.addEventListener("close", () => {
  if (dialog === photoDialog) state.photoRequest += 1;
  if (dialog === recordDialog) {
    state.exportRequestIds.clear();
  } else if (dialog === curationDialog) {
    invalidateBoundRequest(document.querySelector("#curation-form"));
    state.curationDraft = null;
    state.curationCell = null;
  } else if (dialog === actionDialog) {
    invalidateBoundRequest(state.pendingAction);
    state.pendingAction = null;
  } else if (dialog === purgeDialog) {
    invalidateBoundRequest(state.purgePreview);
    state.purgePreview = null;
    const form = document.querySelector("#purge-form");
    form.reset();
    delete form.dataset.locked;
  } else if (dialog === downloadDialog) {
    state.exportRequestIds.clear();
  }
  if (![recordDialog, curationDialog, downloadDialog, actionDialog, purgeDialog, photoDialog].some((item) => item.open)) document.body.classList.remove("dialog-open");
  const returnTarget = dialogReturnFocus.get(dialog);
  dialogReturnFocus.delete(dialog);
  if (returnTarget?.isConnected && !dashboardView.hidden) requestAnimationFrame(() => returnTarget.focus());
});

window.addEventListener("online", () => toast("Connection restored. Refresh to retrieve current class data."));
window.addEventListener("offline", () => setMessage("The instructor dashboard requires an internet connection. No new data can load while offline.", "error"));
compactDashboard.addEventListener("change", () => syncFilterRailAccessibility(false));
setInterval(updateSessionCopy, 30_000);

async function initialize() {
  populateSpeciesDatalist();
  state.session = loadInstructorSession();
  if (!state.session) { showLogin(); return; }
  showDashboard();
  await bootstrapDashboard();
}

initialize();
