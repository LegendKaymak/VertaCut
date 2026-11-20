// VertaCut — dosyasız ses efektleri (Web Audio ile sentezlenir) + olay zamanlaması
import { normWord } from './captions.js';

/** Kısa "pop" sesi (vurgulu kelimeler için) */
export function playSfx(ctx, dest, type = 'pop', vol = 0.5) {
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.connect(dest);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(880, t);
  o.frequency.exponentialRampToValueAtTime(220, t + 0.09);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * 0.9, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g); o.start(t); o.stop(t + 0.14);
}

/** Klip için kaynak-zamanlı efekt olayları */
export function sfxEvents(clip, words, ranges) {
  if (!clip.sfx) return [];
  const ev = [];
  const emph = new Set((clip.emphasis || []).map(e => normWord(e.word)));
  let last = -9;
  for (const w of words) {
    if (w.hidden || !(w.emph || emph.has(normWord(w.w)))) continue;
    if (w.s - last < 0.8) continue; // art arda pop'ları seyrelt
    if (!ranges.some(([a, b]) => w.s >= a && w.s < b)) continue;
    ev.push({ t: w.s, type: 'pop' }); last = w.s;
  }
  return ev.sort((a, b) => a.t - b.t);
}

/** lastT → t aralığında geçilen olayları döndürür (atlamalarda geriye gidişi yok sayar) */
export function crossed(events, lastT, t) {
  if (t < lastT || t - lastT > 0.6) return [];
  return events.filter(e => e.t > lastT && e.t <= t);
}

/** Konuşma varken müziği kısmak için hedef çarpan */
export function duckFactor(t, words, energy) {
  if (words?.length) {
    for (const w of words) { if (w.s - 0.15 <= t && t <= w.e + 0.25) return 0.35; if (w.s > t + 1) break; }
    return 1;
  }
  const v = energy?.[Math.floor(t / 0.25)] ?? 0;
  return v > 0.35 ? 0.4 : 1;
}
