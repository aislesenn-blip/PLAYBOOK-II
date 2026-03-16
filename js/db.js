const DB_NAME = 'PlaybookDB';
const DB_VERSION = 1;

const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sessions')) {
            db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('students')) {
            const studentStore = db.createObjectStore('students', { keyPath: 'id' });
            studentStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
});

async function saveSession(session) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        store.put(session);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getSessions() {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getSession(id) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveStudent(student) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('students', 'readwrite');
        const store = tx.objectStore('students');
        store.put(student);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getStudentsBySession(sessionId) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('students', 'readonly');
        const store = tx.objectStore('students');
        const index = store.index('sessionId');
        const request = index.getAll(sessionId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getStudent(id) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('students', 'readonly');
        const store = tx.objectStore('students');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

window.PlaybookDB = {
    saveSession,
    getSessions,
    getSession,
    saveStudent,
    getStudentsBySession,
    getStudent
};