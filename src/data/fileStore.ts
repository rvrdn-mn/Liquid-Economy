/**
 * Keeps imported files in the browser (IndexedDB) so they survive a
 * refresh. The original text is stored and re-read on start, so importer
 * improvements apply to files already imported. Nothing leaves the browser.
 */
import type { FileZone } from './fileZone';

export interface StoredFile {
  /** `${instrument}|${barSeconds}` for price files, `driver|risk` for a driver file, `journal` for trade history. */
  id: string;
  /** Absent for price files. */
  kind?: 'driver' | 'journal';
  fileName: string;
  text: string;
  /** The clock the file was written in, as chosen at import. */
  zone: FileZone;
  importedAt: number;
}

const DB_NAME = 'liquid-markets-desk';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Browser storage is unavailable'));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('Browser storage failed'));
        };
      }),
  );
}

export const fileStore = {
  all: () => run<StoredFile[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFile[]>),
  put: (file: StoredFile) => run('readwrite', (s) => s.put(file)).then(() => undefined),
  remove: (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined),
};
