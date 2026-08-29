"use client";

import type { ChatImage } from "./types";

// Guest chat images live in IndexedDB: localStorage (~5 MB) cannot hold
// phone photos, IndexedDB can. localStorage messages keep only the key.

const DB_NAME = "inschat_guest_images";
const STORE = "images";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function putGuestImage(key: string, image: ChatImage): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ mimeType: image.mimeType, data: image.data }, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getGuestImage(key: string): Promise<ChatImage | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as ChatImage | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export function removeGuestImages(keys: string[]): void {
  openDb().then((db) => {
    if (!db || keys.length === 0) return;
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const key of keys) store.delete(key);
    } catch {}
  });
}
