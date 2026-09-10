import { SPECIES, SPECIES_LIST_VERSION } from "./species.js";

const list = document.querySelector("#guide-list");
const search = document.querySelector("#guide-search");
const resultCount = document.querySelector("#result-count");
const connectionNotice = document.querySelector("#connection-notice");
const imageDialog = document.querySelector("#image-dialog");
const guideBack = document.querySelector("#guide-back");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function searchText(species) {
  return [species.code, species.commonName, species.scientificName, species.family, ...species.aliases].join(" ").toLowerCase();
}

function imageMarkup(species) {
  if (!species.guide.images.length) {
    return `<div class="image-gap"><strong>No vetted local image yet.</strong><span>Use the cited profile and record an unknown if identification remains uncertain.</span></div>`;
  }
  return species.guide.images.map((photo, index) => `
    <figure>
      <button class="image-button" type="button" data-image-code="${escapeHtml(species.code)}" data-image-index="${index}" aria-label="Enlarge image ${index + 1} for ${escapeHtml(species.commonName)}">
        <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.alt)}" loading="lazy" decoding="async">
      </button>
      <figcaption>${escapeHtml(photo.creator || "Creator not listed")} · ${escapeHtml(photo.provider || "Provider not listed")} · <a href="${escapeHtml(photo.sourceRecord)}" target="_blank" rel="noopener noreferrer">source and reuse record</a></figcaption>
    </figure>`).join("");
}

function card(species) {
  const classification = species.instructorClassification;
  const sources = species.guide.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)}</a>`).join(" · ");
  return `
    <article class="species-card" id="${escapeHtml(species.code)}" data-search="${escapeHtml(searchText(species))}">
      <header class="species-title">
        <span class="code">${escapeHtml(species.code)}</span>
        <div><h2>${escapeHtml(species.commonName)}</h2><p><i>${escapeHtml(species.scientificName)}</i> · ${escapeHtml(species.family)}</p></div>
      </header>
      <p class="catalog-meta"><strong>${escapeHtml(species.duration)}</strong> · ${escapeHtml(species.growthHabit)} · Instructor catalog “Nevada Noxious”: <strong>${escapeHtml(classification.nevadaNoxious)}</strong>${classification.notes ? ` · ${escapeHtml(classification.notes)}` : ""}</p>
      <div class="image-grid">${imageMarkup(species)}</div>
      <section><h3>Field cues</h3><ul>${species.guide.traits.map((trait) => `<li>${escapeHtml(trait)}</li>`).join("")}</ul></section>
      <section><h3>Lookalikes</h3><p>${escapeHtml(species.guide.lookalikes)}</p></section>
      <section><h3>Season / growth</h3><p>${escapeHtml(species.guide.seasonal)}</p></section>
      <section class="safety"><h3>Safety</h3><p>${escapeHtml(species.guide.safety)}</p></section>
      <p class="uncertainty">${escapeHtml(species.guide.uncertainty)}</p>
      <footer><span>Aliases: ${escapeHtml(species.aliases.join(", ") || "None listed")}</span><span>Sources: ${sources}</span><span>Code: USDA NRCS PLANTS · verified ${escapeHtml(species.codeVerified)}</span></footer>
    </article>`;
}

function render(term = "") {
  const normalized = term.trim().toLowerCase();
  const shown = SPECIES.filter((species) => !normalized || searchText(species).includes(normalized));
  list.innerHTML = shown.map(card).join("") || `<div class="empty">No target matches “${escapeHtml(term)}”.</div>`;
  resultCount.textContent = `${shown.length} of ${SPECIES.length} targets · catalog ${SPECIES_LIST_VERSION}`;
}

function updateConnection() {
  connectionNotice.classList.toggle("offline", !navigator.onLine);
  connectionNotice.textContent = navigator.onLine
    ? "This guide is online-only. Survey entry and saved field records continue offline in the main app."
    : "You are offline. Previously loaded browser content may appear, but guide availability is not guaranteed. Return to the survey app for offline entry.";
}

function openHashTarget() {
  const code = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  if (!code) return;
  const target = document.getElementById(code);
  if (target) {
    target.scrollIntoView({ block: "start" });
    target.classList.add("highlight");
    target.querySelector("h2")?.setAttribute("tabindex", "-1");
    target.querySelector("h2")?.focus({ preventScroll: true });
    setTimeout(() => target.classList.remove("highlight"), 2400);
  }
}

search.addEventListener("input", () => render(search.value));
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);
window.addEventListener("hashchange", openHashTarget);

list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-image-code]");
  if (!button) return;
  const species = SPECIES.find((item) => item.code === button.dataset.imageCode);
  const photo = species?.guide.images[Number(button.dataset.imageIndex)];
  if (!photo) return;
  document.querySelector("#image-dialog-title").textContent = `${species.code} · ${species.commonName}`;
  const img = document.querySelector("#image-dialog-img");
  img.src = photo.src;
  img.alt = photo.alt;
  document.querySelector("#image-dialog-credit").innerHTML = `${escapeHtml(photo.creator || "Creator not listed")} · ${escapeHtml(photo.provider || "Provider not listed")}<br>${escapeHtml(photo.rights)} <a href="${escapeHtml(photo.sourceRecord)}" target="_blank" rel="noopener noreferrer">USDA image record</a>`;
  imageDialog.showModal();
});

list.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement) event.target.closest("figure")?.classList.add("image-failed");
}, true);

if (new URLSearchParams(location.search).get("from") === "app") {
  guideBack.textContent = "← Return to survey tab";
  guideBack.addEventListener("click", (event) => {
    event.preventDefault();
    window.close();
    setTimeout(() => {
      if (!window.closed) connectionNotice.textContent = "This browser did not close the guide tab. Switch back to the existing survey tab; its unsaved cell is still there.";
    }, 250);
  });
}
render();
updateConnection();
requestAnimationFrame(openHashTarget);
