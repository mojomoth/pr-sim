"use client";
// IndexedDB "pr-sim": stores `sessions` (keyPath "id") and `blobs` (key -> Blob, out-of-line keys).
// Layout fixed by docs/wiki/api-contract.md. Record typing lives in features/session/db.ts.

const DB_NAME = "pr-sim";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const BLOBS = "blobs";

class StorageError extends Error {
  constructor(
    public kind: "unavailable" | "quota" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

const TEXT = {
  unavailable: "이 브라우저에서는 기록을 저장할 수 없어요. 사생활 보호(시크릿) 창이라면 일반 창에서 다시 열어 주세요.",
  quota: "기기 저장 공간이 부족해요. 지난 기록을 지운 뒤 다시 시도해 주세요.",
  failed: "기록을 저장하거나 불러오지 못했어요. 다시 시도해 주세요.",
};

function wrap(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  const name = (e as { name?: string })?.name;
  if (name === "QuotaExceededError") return new StorageError("quota", TEXT.quota);
  if (name === "InvalidStateError" || name === "SecurityError") return new StorageError("unavailable", TEXT.unavailable);
  return new StorageError("failed", TEXT.failed);
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new StorageError("unavailable", TEXT.unavailable));
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      return reject(wrap(e));
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: let it proceed, reopen lazily next time.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(new StorageError("unavailable", TEXT.unavailable));
    req.onblocked = () => reject(new StorageError("failed", "다른 탭이 기록을 쓰고 있어요. 다른 DANSANG 탭을 닫고 다시 시도해 주세요."));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Run `fn` in one transaction; resolves with fn's result once the transaction commits. */
async function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      dbPromise = null; // connection closed (versionchange / browser cleared data)
      return reject(wrap(e));
    }
    let result = undefined as T;
    let r: IDBRequest<T> | void;
    try {
      r = fn(tx);
    } catch (e) {
      tx.abort();
      return reject(wrap(e));
    }
    if (r) r.onsuccess = () => (result = (r as IDBRequest<T>).result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(wrap(tx.error));
    tx.onabort = () => reject(wrap(tx.error));
  });
}

export const storage = {
  getSession<T>(id: string): Promise<T | undefined> {
    return run<T | undefined>([SESSIONS], "readonly", (tx) => tx.objectStore(SESSIONS).get(id));
  },
  putSession<T extends { id: string }>(record: T): Promise<void> {
    return run<IDBValidKey>([SESSIONS], "readwrite", (tx) => tx.objectStore(SESSIONS).put(record)).then(() => undefined);
  },
  /** Read-modify-write in ONE transaction (no lost updates between concurrent writers in this tab). */
  updateSession<T extends { id: string }>(id: string, fn: (current: T | undefined) => T): Promise<T> {
    let next: T;
    let fnError: unknown = null;
    return run<undefined>([SESSIONS], "readwrite", (tx) => {
      const store = tx.objectStore(SESSIONS);
      const get = store.get(id);
      get.onsuccess = () => {
        try {
          next = fn(get.result as T | undefined);
          store.put(next);
        } catch (e) {
          fnError = e;
          tx.abort();
        }
      };
    }).then(
      () => next,
      (e) => {
        throw fnError ?? e;
      },
    );
  },
  listSessions<T>(): Promise<T[]> {
    return run<T[]>([SESSIONS], "readonly", (tx) => tx.objectStore(SESSIONS).getAll());
  },
  /** Delete a session and the given blob keys atomically. */
  deleteSession(id: string, blobKeys: string[] = []): Promise<void> {
    return run<undefined>([SESSIONS, BLOBS], "readwrite", (tx) => {
      tx.objectStore(SESSIONS).delete(id);
      for (const k of blobKeys) tx.objectStore(BLOBS).delete(k);
    });
  },
  getBlob(key: string): Promise<Blob | undefined> {
    return run<Blob | undefined>([BLOBS], "readonly", (tx) => tx.objectStore(BLOBS).get(key));
  },
  putBlob(key: string, blob: Blob): Promise<void> {
    return run<IDBValidKey>([BLOBS], "readwrite", (tx) => tx.objectStore(BLOBS).put(blob, key)).then(() => undefined);
  },
  /** Remove one blob (e.g. a replaced PDF or judge photo). Missing keys are a no-op. */
  deleteBlob(key: string): Promise<void> {
    return run<undefined>([BLOBS], "readwrite", (tx) => tx.objectStore(BLOBS).delete(key)).then(() => undefined);
  },
  deleteBlobs(keys: string[]): Promise<void> {
    return run<undefined>([BLOBS], "readwrite", (tx) => {
      for (const k of keys) tx.objectStore(BLOBS).delete(k);
    });
  },
};
