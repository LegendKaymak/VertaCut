// VertaCut — küçük yardımcılar
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function fmtTime(sec, withMs = false) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const base = h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  return withMs ? `${base}.${ms}` : base;
}

export function fmtDur(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} sn`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m} dk ${s} sn` : `${m} dk`;
  const h = Math.floor(m / 60);
  return `${h} sa ${m % 60} dk`;
}

export function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i];
}

export function parseTime(str) {
  // "1:02:03.5" | "2:03" | "45.2"
  if (typeof str === 'number') return str;
  const parts = String(str).trim().replace(',', '.').split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeName(s) {
  return String(s || 'klip').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'klip';
}

// Basit olay yayıcı
export class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] ||= new Set()).add(f); return () => this.h[e].delete(f); }
  emit(e, d) { this.h[e]?.forEach(f => { try { f(d); } catch (err) { console.error(err); } }); }
}

// Türkçe büyük harf (i → İ)
export const upperTR = s => s.toLocaleUpperCase('tr-TR');

export function srtTime(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000);
  const p = (n, l = 2) => String(Math.min(n, l === 3 ? 999 : 99)).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}
