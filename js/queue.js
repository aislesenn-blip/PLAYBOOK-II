// js/queue.js
// Local DB for Bulletproof Resume Feature
const DB_NAME = 'PlaybookQueueDB';
const DB_VERSION = 1;

function getDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('chunks')) {
                const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
                chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
                chunkStore.createIndex('session_status', ['sessionId', 'status'], { unique: false });
            }
            if (!db.objectStoreNames.contains('meta')) {
                db.createObjectStore('meta', { keyPath: 'sessionId' });
            }
        };

        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

window.PlaybookQueue = {
    async saveMeta(meta) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('meta', 'readwrite');
            tx.objectStore('meta').put(meta);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async getMeta(sessionId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('meta', 'readonly');
            const req = tx.objectStore('meta').get(sessionId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(tx.error);
        });
    },

    async deleteMeta(sessionId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('meta', 'readwrite');
            tx.objectStore('meta').delete(sessionId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async saveChunk(chunk) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chunks', 'readwrite');
            tx.objectStore('chunks').put(chunk);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async getNextPendingChunk(sessionId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chunks', 'readonly');
            const store = tx.objectStore('chunks');
            const index = store.index('session_status');
            const req = index.openCursor([sessionId, 'pending']);
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    resolve(cursor.value);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => reject(tx.error);
        });
    },

    async markChunkCompleted(id) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chunks', 'readwrite');
            const store = tx.objectStore('chunks');
            const req = store.get(id);
            req.onsuccess = () => {
                const chunk = req.result;
                if (chunk) {
                    chunk.status = 'completed';
                    // We delete the heavy image data arrays to instantly free up memory
                    delete chunk.images;
                    store.put(chunk);
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async getPendingCount(sessionId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chunks', 'readonly');
            const store = tx.objectStore('chunks');
            const index = store.index('session_status');
            const req = index.count([sessionId, 'pending']);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(tx.error);
        });
    },

    async getCompletedCount(sessionId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chunks', 'readonly');
            const store = tx.objectStore('chunks');
            const index = store.index('session_status');
            const req = index.count([sessionId, 'completed']);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(tx.error);
        });
    },

    async getFirstPendingSession() {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['meta', 'chunks'], 'readonly');
            const metaStore = tx.objectStore('meta');
            const req = metaStore.getAll();
            req.onsuccess = async () => {
                const metas = req.result;
                for (const meta of metas) {
                    const count = await this.getPendingCount(meta.sessionId);
                    if (count > 0) {
                        resolve({ meta, pendingCount: count });
                        return;
                    }
                }
                resolve(null);
            };
            req.onerror = () => reject(tx.error);
        });
    },

    async deleteAllChunksForSession(sessionId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chunks', 'readwrite');
            const store = tx.objectStore('chunks');
            const index = store.index('sessionId');
            const req = index.openCursor(sessionId);
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};
