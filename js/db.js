// VertaCut — IndexedDB tabanlı proje deposu + ayarlar
const DB_NAME = 'vertacut';
const DB_VER = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const DB = {
  async saveProject(p) {
    const copy = { ...p, updatedAt: Date.now() };
    if (copy.energy instanceof Float32Array) copy.energy = Array.from(copy.energy);
    if (copy.chat instanceof Float32Array) copy.chat = Array.from(copy.chat);
    return tx('projects', 'readwrite', s => req(s.put(copy)));
  },
  async getProject(id) {
    return tx('projects', 'readonly', s => req(s.get(id)));
  },
  async listProjects() {
    const all = await tx('projects', 'readonly', s => req(s.getAll()));
    return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async deleteProject(id) {
    await tx('handles', 'readwrite', s => req(s.delete(id))).catch(() => {});
    return tx('projects', 'readwrite', s => req(s.delete(id)));
  },
  async saveHandle(id, handle) {
    try { return await tx('handles', 'readwrite', s => req(s.put(handle, id))); } catch { /* bazı tarayıcılar desteklemez */ }
  },
  async getHandle(id) {
    try { return await tx('handles', 'readonly', s => req(s.get(id))); } catch { return null; }
  }
};

// ---- Ayarlar (localStorage) ----
const SKEY = 'vertacut.settings.v1';
export const DEFAULT_SETTINGS = {
  sttProvider: 'groq',          // groq | openai | gemini | custom
  sttModel: '',
  sttKey: '',                   // boşsa sağlayıcı anahtarı kullanılır
  sttBaseUrl: '',
  language: 'tr',
  llmProvider: 'gemini',        // openai | gemini | anthropic | groq | openrouter | xai | ollama | custom
  llmModel: '',
  llmBaseUrl: '',
  keys: {},                     // { openai: '...', gemini: '...' }
  clipMin: 20,
  clipMax: 60,
  clipCount: 8,
  contentType: 'auto',
  titleLang: 'tr',
  customPrompt: '',
  exportRes: 1080,
  exportFps: 30,
  exportFormat: 'auto',
  brandHandle: '',
  theme: 'sunset',             // sunset | light | oled | indigo | system
  guideDismissed: false,
  layoutMode: 'auto'            // auto | mobile | desktop
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...s, keys: { ...(s.keys || {}) } };
  } catch { return { ...DEFAULT_SETTINGS, keys: {} }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { console.warn('Ayarlar kaydedilemedi', e); }
}
