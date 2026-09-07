// EDIT THIS FILE to replace the example species list.
// Codes must be unique, short, and contain only letters, numbers, hyphens, or underscores.
export const SPECIES_LIST_VERSION = "example-1";

export const SPECIES = Object.freeze([
  Object.freeze({ code: "BRTE", scientificName: "Bromus tectorum", commonName: "Cheatgrass" }),
  Object.freeze({ code: "CEMA", scientificName: "Centaurea maculosa", commonName: "Spotted knapweed" }),
  Object.freeze({ code: "LASE", scientificName: "Lepidium latifolium", commonName: "Perennial pepperweed" }),
  Object.freeze({ code: "TAOF", scientificName: "Tamarix ramosissima", commonName: "Saltcedar" }),
  Object.freeze({ code: "CHJU", scientificName: "Chondrilla juncea", commonName: "Rush skeletonweed" }),
]);

export function validateSpeciesList(species = SPECIES) {
  const errors = [];
  const seen = new Set();
  for (const [index, item] of species.entries()) {
    const code = String(item.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,10}$/.test(code)) errors.push(`Species ${index + 1} has an invalid code.`);
    if (seen.has(code)) errors.push(`Duplicate species code: ${code}.`);
    seen.add(code);
    if (!String(item.scientificName || "").trim()) errors.push(`${code || `Species ${index + 1}`} needs a scientific name.`);
    if (!String(item.commonName || "").trim()) errors.push(`${code || `Species ${index + 1}`} needs a common name.`);
  }
  return errors;
}

