// Storage layer. Everything lives on this device in IndexedDB:
//   - "state": one JSON document with settings and every log (small, fast to load)
//   - "photos": progress-photo blobs keyed by id (kept apart so the state stays small)
(function () {
  const DB_NAME = 'gritty-fit';
  const DB_VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  window.DB = {
    getState: () => tx('kv', 'readonly', (s) => s.get('state')),
    setState: (state) => tx('kv', 'readwrite', (s) => s.put(state, 'state')),
    putPhoto: (photo) => tx('photos', 'readwrite', (s) => s.put(photo)),
    getPhoto: (id) => tx('photos', 'readonly', (s) => s.get(id)),
    deletePhoto: (id) => tx('photos', 'readwrite', (s) => s.delete(id)),
    allPhotos: () => tx('photos', 'readonly', (s) => s.getAll()),
    clearPhotos: () => tx('photos', 'readwrite', (s) => s.clear()),
  };
})();
