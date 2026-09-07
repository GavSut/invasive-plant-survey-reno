const DB_NAME = "invasive-plant-transect-v1";
const DB_VERSION = 1;
const TRANSECTS = "transects";
const BLOBS = "blobs";
const SETTINGS = "settings";

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRANSECTS)) {
        const store = db.createObjectStore(TRANSECTS, { keyPath: "id" });
        store.createIndex("modifiedAt", "modifiedAt");
      }
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local field-data storage."));
  });
  return databasePromise;
}

export async function listTransects() {
  const db = await openDatabase();
  const tx = db.transaction(TRANSECTS, "readonly");
  const done = transactionDone(tx);
  const values = await requestResult(tx.objectStore(TRANSECTS).getAll());
  await done;
  return values.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
}

export async function getTransect(id) {
  const db = await openDatabase();
  const tx = db.transaction(TRANSECTS, "readonly");
  const done = transactionDone(tx);
  const value = await requestResult(tx.objectStore(TRANSECTS).get(id));
  await done;
  return value || null;
}

export async function putTransect(transect) {
  const db = await openDatabase();
  const tx = db.transaction(TRANSECTS, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(TRANSECTS).put(structuredClone(transect));
  await done;
  return transect;
}

export async function putBlob(id, blob, metadata = {}) {
  const db = await openDatabase();
  const tx = db.transaction(BLOBS, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(BLOBS).put({ id, blob, metadata, savedAt: new Date().toISOString() });
  await done;
}

export async function getBlob(id) {
  const db = await openDatabase();
  const tx = db.transaction(BLOBS, "readonly");
  const done = transactionDone(tx);
  const value = await requestResult(tx.objectStore(BLOBS).get(id));
  await done;
  return value || null;
}

export async function setSetting(key, value) {
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(SETTINGS).put({ key, value });
  await done;
}

export async function getSetting(key) {
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS, "readonly");
  const done = transactionDone(tx);
  const item = await requestResult(tx.objectStore(SETTINGS).get(key));
  await done;
  return item?.value ?? null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read a photo for backup."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(",", 2);
  const type = /data:([^;]+)/.exec(header)?.[1] || "application/octet-stream";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
}

export async function makeBackup(transect) {
  const photos = [];
  for (const photo of transect.photos || []) {
    const stored = await getBlob(photo.blobId);
    photos.push({
      metadata: photo,
      dataUrl: stored?.blob ? await blobToDataUrl(stored.blob) : null,
    });
  }
  return {
    format: "invasive-plant-transect-backup",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    transect,
    photos,
  };
}

export async function restoreBackup(backup, { replaceExisting = false } = {}) {
  if (backup?.format !== "invasive-plant-transect-backup" || backup?.formatVersion !== 1) {
    throw new Error("This is not a supported transect backup file.");
  }
  if (!backup.transect?.id || !Array.isArray(backup.transect?.segments)) {
    throw new Error("The backup is missing its transect data.");
  }
  const existing = await getTransect(backup.transect.id);
  if (existing && !replaceExisting) throw new Error("A transect with this record ID already exists on this phone.");
  for (const item of backup.photos || []) {
    if (item.dataUrl && item.metadata?.blobId) {
      await putBlob(item.metadata.blobId, dataUrlToBlob(item.dataUrl), { restored: true });
    }
  }
  await putTransect(backup.transect);
  return backup.transect;
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
