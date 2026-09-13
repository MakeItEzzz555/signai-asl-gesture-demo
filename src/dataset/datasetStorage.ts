import type { CustomTranslations } from '../i18n/translations';
import type { GestureSample } from '../contexts/AppContext';

export interface DatasetStorageSnapshot {
  schemaVersion: 1;
  revision: number;
  samples: GestureSample[];
  customTranslations: CustomTranslations;
}

const DATABASE_NAME = 'signai';
const STORE_NAME = 'datasets';
const SNAPSHOT_KEY = 'current';

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Browser dataset storage is unavailable'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser dataset storage'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadDatasetSnapshot(): Promise<unknown | null> {
  const db = await openDatabase();
  try {
    return await new Promise<unknown | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      request.onerror = () => reject(request.error ?? new Error('Could not read browser dataset storage'));
      request.onsuccess = () => resolve(request.result ?? null);
    });
  } finally {
    db.close();
  }
}

export async function saveDatasetSnapshot(snapshot: DatasetStorageSnapshot): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save browser dataset storage'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Browser dataset storage write was aborted'));
      transaction.oncomplete = () => resolve();
      transaction.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
    });
  } finally {
    db.close();
  }
}
