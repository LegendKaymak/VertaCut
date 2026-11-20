// VertaCut — IndexedDB tabanlı proje deposu + ayarlar
const DB_NAME = 'vertacut';
const DB_VER = 2;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      // proje listesi ve dosya eşleştirme için küçük özet kayıtlar
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
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

/** Projenin kullandığı müzik ve logo kayıt anahtarları */
export function mediaKeys(p) {
  const k = new Set();
  for (const c of p.clips || []) {
    if (c.music?.id) k.add('music:' + c.music.id);
    if (c.logo?.id) k.add('logo:' + c.logo.id);
  }
  if (p.lastLogo?.id) k.add('logo:' + p.lastLogo.id);
  return [...k];
}
const summary = p => ({
  id: p.id, name: p.name, thumb: p.thumb || null, video: p.video ? { ...p.video } : null,
  clipCount: p.clips?.length || 0, createdAt: p.createdAt, updatedAt: p.updatedAt, media: mediaKeys(p)
});

export const DB = {
  async saveProject(p) {
    const copy = { ...p, updatedAt: Date.now() };
    if (copy.energy instanceof Float32Array) copy.energy = Array.from(copy.energy);
    if (copy.chat instanceof Float32Array) copy.chat = Array.from(copy.chat);
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(['projects', 'meta'], 'readwrite');
      t.objectStore('projects').put(copy);
      t.objectStore('meta').put(summary(copy));
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  async getProject(id) {
    return tx('projects', 'readonly', s => req(s.get(id)));
  },
  /** Yalnızca özetleri döndürür (transkript ve enerji okunmaz). */
  async listProjects() {
    let metas = await tx('meta', 'readonly', s => req(s.getAll()));
    const n = await tx('projects', 'readonly', s => req(s.count()));
    if ((metas?.length || 0) !== n) {
      // eski sürümden kalan projeler için özetleri bir kez oluştur
      const all = await tx('projects', 'readonly', s => req(s.getAll()));
      metas = (all || []).map(summary);
      await tx('meta', 'readwrite', s => { s.clear(); metas.forEach(m => s.put(m)); });
    }
    return (metas || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  /** Projeyi ve başka projede kullanılmayan müzik/logo dosyalarını siler. */
  async deleteProject(id) {
    const metas = await this.listProjects();
    const mine = metas.find(m => m.id === id);
    const used = new Set(metas.filter(m => m.id !== id).flatMap(m => m.media || []));
    const orphans = (mine?.media || []).filter(k => !used.has(k));
    await tx('handles', 'readwrite', s => { s.delete(id); orphans.forEach(k => s.delete(k)); }).catch(() => {});
    await tx('meta', 'readwrite', s => req(s.delete(id)));
    await tx('projects', 'readwrite', s => req(s.delete(id)));
    return orphans;
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
  sttBaseUrl: '',
  language: 'tr',
  llmProvider: 'gemini',        // openai | gemini | anthropic | groq | openrouter | xai | ollama | custom
  llmModel: '',
  llmBaseByProvider: {},        // { custom: 'https://…/v1', ollama: 'http://localhost:11434/v1' }
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
  layoutMode: 'auto',           // auto | mobile | desktop
  features: { fastAudio: true, compare: true, glossary: true, variants: true },
  glossary: []                  // kanal sözlüğü: doğru yazımlar [{ term, wrong: [] }]
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || '{}');
    const out = { ...DEFAULT_SETTINGS, ...s, keys: { ...(s.keys || {}) }, llmBaseByProvider: { ...(s.llmBaseByProvider || {}) }, features: { ...DEFAULT_SETTINGS.features, ...(s.features || {}) }, glossary: Array.isArray(s.glossary) ? s.glossary : [] };
    // eski sürüm: ayrı yazıya dökme anahtarı → sağlayıcının kendi anahtarı
    if (s.sttKey) {
      const from = { groq: 'groq', openai: 'openai', gemini: 'gemini', custom: 'custom' }[out.sttProvider] || out.sttProvider;
      if (!out.keys[from]) out.keys[from] = s.sttKey;
    }
    delete out.sttKey;
    // eski sürüm: tek ortak temel adres → sağlayıcıya göre
    if (s.llmBaseUrl) {
      const prov = ['custom', 'ollama'].includes(out.llmProvider) ? out.llmProvider : 'custom';
      out.llmBaseByProvider[prov] ||= s.llmBaseUrl;
    }
    delete out.llmBaseUrl;
    return out;
  } catch { return { ...DEFAULT_SETTINGS, keys: {} }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { console.warn('Ayarlar kaydedilemedi', e); }
}
