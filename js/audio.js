// VertaCut — ses çözme, hype haritası, WAV parçalama, sessizlik analizi
import { clamp, sleep } from './util.js';
import { extractMp4Audio, fastAudioSupported } from './mp4audio.js';

export const TARGET_SR = 16000;
export const HOP = 0.25; // enerji çözünürlüğü (sn)

/**
 * Videonun sesini 16 kHz mono Float32Array olarak çözer.
 * Küçük/orta dosyalarda decodeAudioData, büyüklerde (veya hata olursa) hızlı oynatmalı tarama.
 */
export async function extractAudio(file, videoUrl, onProgress = () => {}, signal, { fast = true } = {}) {
  // Hızlı mod: MP4/MOV'da yalnızca ses izini okuyup WebCodecs ile çöz (her boyutta, dakikalar içinde)
  if (fast && file && fastAudioSupported(file)) {
    try {
      onProgress(0.01, 'Ses izi okunuyor');
      return await extractMp4Audio(file, onProgress, signal);
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      console.warn('Hızlı ses çıkarma kullanılamadı, normal yönteme geçiliyor:', e?.message || e);
    }
  }
  const BIG = 1.4 * 1024 ** 3;
  if (file && file.size < BIG) {
    try {
      onProgress(0.02, 'Dosya okunuyor');
      const buf = await file.arrayBuffer();
      if (signal?.aborted) throw new DOMException('İptal', 'AbortError');
      onProgress(0.15, 'Ses çözülüyor');
      const ctx = new OfflineAudioContext(1, 1, TARGET_SR);
      const ab = await ctx.decodeAudioData(buf);
      onProgress(0.9, 'Mono kanala indiriliyor');
      const samples = toMono(ab);
      onProgress(1, 'Hazır');
      return { samples, sampleRate: ab.sampleRate, method: 'decode' };
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      console.warn('decodeAudioData başarısız, tarama moduna geçiliyor:', e);
    }
  }
  return scanAudio(videoUrl, onProgress, signal);
}

function toMono(ab) {
  const n = ab.length, ch = ab.numberOfChannels;
  if (ch === 1) return ab.getChannelData(0).slice();
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i];
  }
  const k = 1 / ch;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/**
 * Büyük dosya modu: videoyu görünmez biçimde 4x hızla (perde korumasız) oynatır,
 * sesi Web Audio ile yakalar ve orijinal zamana geri ölçekler. Her boyutta çalışır.
 */
async function scanAudio(videoUrl, onProgress, signal) {
  const RATE = 4;
  const v = document.createElement('video');
  v.src = videoUrl;
  v.preload = 'auto';
  v.playsInline = true;
  v.crossOrigin = 'anonymous';
  let ctx = null, src = null, proc = null, sink = null, tick = 0;
  try {
    await new Promise((res, rej) => {
      v.onloadedmetadata = res;
      v.onerror = () => rej(new Error('Video okunamadı'));
    });
    const duration = v.duration;
    ctx = new AudioContext();
    await ctx.resume();
    src = ctx.createMediaElementSource(v);
    proc = ctx.createScriptProcessor(4096, 2, 1);
    sink = ctx.createGain();
    sink.gain.value = 0; // hoparlöre ses vermeden işle
    // Bloklar geldikçe doğrudan 16 kHz çıktıya yeniden örneklenir; ham kayıt tutulmaz.
    const out = new Float32Array(Math.round(duration * TARGET_SR));
    const ratio = (ctx.sampleRate / RATE) / TARGET_SR; // çıktı örneği başına giriş örneği
    let seen = 0, prev = 0, j = 0;
    proc.onaudioprocess = e => {
      if (v.paused) return;
      const ib = e.inputBuffer;
      const a = ib.getChannelData(0), b = ib.numberOfChannels > 1 ? ib.getChannelData(1) : a;
      const n = a.length, end = seen + n;
      const at = k => k < seen ? prev : (a[k - seen] + b[k - seen]) * 0.5;
      while (j < out.length) {
        const x = j * ratio, i0 = Math.floor(x);
        if (i0 + 1 >= end) break;
        const f = x - i0, s0 = at(i0), s1 = at(i0 + 1);
        out[j++] = s0 + (s1 - s0) * f;
      }
      prev = (a[n - 1] + b[n - 1]) * 0.5;
      seen = end;
    };
    src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
    v.preservesPitch = false; v.mozPreservesPitch = false; v.webkitPreservesPitch = false;
    v.playbackRate = RATE;
    await v.play();
    await new Promise((res, rej) => {
      const stop = () => { v.pause(); rej(new DOMException('İptal', 'AbortError')); };
      if (signal?.aborted) return stop();
      signal?.addEventListener('abort', stop, { once: true });
      tick = setInterval(() => onProgress(clamp(v.currentTime / duration, 0, 0.99), `Ses taranıyor (${RATE}× hız)`), 300);
      v.onended = res;
      v.onerror = () => rej(new Error('Oynatma hatası'));
    });
    await sleep(150);
    onProgress(1, 'Hazır');
    return { samples: out, sampleRate: TARGET_SR, method: 'scan' };
  } finally {
    clearInterval(tick);
    v.onended = v.onerror = null;
    try { v.pause(); } catch {}
    if (proc) proc.onaudioprocess = null;
    try { proc?.disconnect(); src?.disconnect(); sink?.disconnect(); } catch {}
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    v.removeAttribute('src'); v.load();
  }
}

/** HOP saniyelik pencerelerde 0..1 arası yüksek sesi (loudness) haritası */
export function computeEnergy(samples, sr) {
  const hopN = Math.max(1, Math.round(sr * HOP));
  const n = Math.ceil(samples.length / hopN);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0; const s = i * hopN, e = Math.min(samples.length, s + hopN);
    for (let j = s; j < e; j++) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / Math.max(1, e - s));
    db[i] = 20 * Math.log10(rms + 1e-7);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.08)] ?? -60;
  const hi = sorted[Math.floor(sorted.length * 0.995)] ?? 0;
  const out = new Float32Array(n);
  const range = Math.max(6, hi - lo);
  for (let i = 0; i < n; i++) out[i] = clamp((db[i] - lo) / range, 0, 1);
  return out;
}

function smooth(arr, win) {
  const out = new Float32Array(arr.length);
  let acc = 0; const q = [];
  for (let i = 0; i < arr.length; i++) {
    acc += arr[i]; q.push(arr[i]);
    if (q.length > win) acc -= q.shift();
    out[i] = acc / q.length;
  }
  // gecikmeyi telafi et
  const shift = Math.floor(win / 2);
  return out.map((_, i) => out[Math.min(arr.length - 1, i + shift)]);
}

/**
 * API anahtarı olmadan: yüksek ses + ani yükseliş tepelerinden "hype" anları bulur.
 */
export function findHypeMoments(energy, duration, { min = 20, max = 60, count = 8 } = {}) {
  if (!energy || !energy.length) return [];
  const e = energy instanceof Float32Array ? energy : Float32Array.from(energy);
  const short = smooth(e, Math.round(2 / HOP));
  const long = smooth(e, Math.round(30 / HOP));
  const score = new Float32Array(e.length);
  for (let i = 0; i < e.length; i++) {
    const rise = i > 8 ? Math.max(0, short[i] - short[i - 8]) : 0;
    score[i] = short[i] * 0.55 + Math.max(0, short[i] - long[i]) * 1.1 + rise * 0.8;
  }
  const target = clamp((min + max) / 2, min, max);
  const used = [];
  const results = [];
  const idx = Array.from(score.keys()).sort((a, b) => score[b] - score[a]);
  const maxScore = score[idx[0]] || 0;
  // sessiz ya da düz kayıtta belirgin tepe yoksa uydurma klip üretme
  if (maxScore < 0.08) return [];
  for (const i of idx) {
    if (results.length >= count) break;
    if (score[i] < maxScore * 0.35) break;
    const t = i * HOP;
    let start = clamp(t - target * 0.62, 0, Math.max(0, duration - target));
    let end = Math.min(duration, start + target);
    if (end - start < Math.min(min, duration)) continue;
    if (used.some(([a, b]) => start < b - 2 && end > a + 2)) continue;
    used.push([start, end]);
    const s = Math.round(55 + 44 * (score[i] / maxScore));
    results.push({ start, end, score: s, peak: t, title: `Hype anı, ${fmtMin(t)}`, reason: 'Ses seviyesinde ani yükseliş ve yoğun tepki algılandı.' });
  }
  return results;
}

const fmtMin = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** LLM'e ipucu olarak verilen en yüksek tepe noktaları */
export function topPeaks(energy, n = 15) {
  if (!energy?.length) return [];
  const e = smooth(energy instanceof Float32Array ? energy : Float32Array.from(energy), Math.round(1.5 / HOP));
  const peaks = [];
  for (let i = 1; i < e.length - 1; i++) if (e[i] >= e[i - 1] && e[i] >= e[i + 1] && e[i] > 0.55) peaks.push(i);
  peaks.sort((a, b) => e[b] - e[a]);
  const chosen = [];
  for (const p of peaks) {
    if (chosen.length >= n) break;
    if (chosen.every(c => Math.abs(c - p) * HOP > 20)) chosen.push(p);
  }
  return chosen.sort((a, b) => a - b).map(i => ({ t: +(i * HOP).toFixed(1), level: +e[i].toFixed(2) }));
}

/** 16-bit PCM WAV parçaları (STT sağlayıcısı dosya limitlerine uyar) */
export function wavChunks(samples, sr, chunkSec = 600, overlapSec = 0) {
  const per = Math.floor(chunkSec * sr);
  const out = [];
  for (let s = 0; s < samples.length; s += per) {
    const st = Math.max(0, s - Math.floor(overlapSec * sr));
    const slice = samples.subarray(st, Math.min(samples.length, s + per));
    // WAV yalnızca istendiğinde (gönderilmeden hemen önce) kodlanır
    let blob = null;
    out.push({ get blob() { return blob || (blob = encodeWav(slice, sr)); }, release() { blob = null; }, offset: st / sr, duration: slice.length / sr });
  }
  return out;
}

export function encodeWav(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = clamp(samples[i], -1, 1);
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Jump-cut için korunacak aralıklar. Kelime zaman damgaları varsa onları,
 * yoksa enerji eşiğini kullanır. Boşluklar `keepGap` saniyeye kısaltılır.
 */
export function keepRanges(start, end, words, energy, { minGap = 0.55, pad = 0.12 } = {}) {
  const ranges = [];
  if (words && words.length > 1) {
    const ws = words.filter(w => w.e > start && w.s < end);
    if (!ws.length) return [[start, end]];
    let cs = Math.max(start, ws[0].s - pad), ce = Math.min(end, ws[0].e + pad);
    // başlangıçtaki sessizliği de kes
    for (let i = 1; i < ws.length; i++) {
      const w = ws[i];
      if (w.s - ce > minGap) { ranges.push([cs, ce]); cs = Math.max(start, w.s - pad); }
      ce = Math.min(end, Math.max(ce, w.e + pad));
    }
    ranges.push([cs, ce]);
  } else if (energy?.length) {
    const th = 0.18;
    let cs = null, lastLoud = null;
    for (let t = start; t < end; t += HOP) {
      const v = energy[Math.floor(t / HOP)] ?? 0;
      if (v > th) {
        if (cs === null) cs = Math.max(start, t - pad);
        else if (t - lastLoud > minGap) { ranges.push([cs, lastLoud + pad]); cs = t - pad; }
        lastLoud = t;
      }
    }
    if (cs !== null) ranges.push([cs, Math.min(end, lastLoud + HOP + pad)]);
  }
  const clean = ranges.filter(([a, b]) => b - a > 0.15);
  return clean.length ? clean : [[start, end]];
}

// ------------------------------------------------------------------ dolgu kelimeleri
export const DEFAULT_FILLERS = ['ıı', 'ııı', 'ıııı', 'ı', 'ee', 'eee', 'eeee', 'e', 'ehm', 'eh', 'hmm', 'hım', 'hı', 'mm', 'ım', 'um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah'];
const normF = s => String(s).toLocaleLowerCase('tr-TR').replace(/[^\p{L}]/gu, '');
export function isFiller(word, list) {
  const n = normF(word);
  if (!n) return false;
  return (list?.length ? list : DEFAULT_FILLERS).some(f => normF(f) === n);
}
/** Aralıklardan dolgu kelimelerinin sürelerini çıkarır */
export function removeFillers(ranges, words, list) {
  const cuts = words.filter(w => isFiller(w.w, list)).map(w => [w.s - 0.03, w.e + 0.03]);
  if (!cuts.length) return ranges;
  const out = [];
  for (const [a, b] of ranges) {
    let pieces = [[a, b]];
    for (const [cs, ce] of cuts) {
      if (ce <= a || cs >= b) continue;
      pieces = pieces.flatMap(([x, y]) => (ce <= x || cs >= y) ? [[x, y]] : [[x, cs], [ce, y]].filter(([p, q]) => q - p > 0.12));
    }
    out.push(...pieces);
  }
  return out.length ? out : ranges;
}

/** Teaser: klibin en vurucu kısa anları (beyaz flaşla bağlanır) */
export function teaserSegments(start, end, words, energy, emphSet, n = 3) {
  const cands = [];
  for (let t = start + 2; t < end - 1.2; t += 0.25) {
    let v = 0; for (let k = 0; k < 5; k++) v += energy?.[Math.floor((t + k * 0.25) / HOP)] || 0;
    cands.push({ t, v });
  }
  for (const w of words || []) if (emphSet?.has(w.w.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '')) && w.s > start + 1 && w.s < end - 1) cands.push({ t: w.s - 0.3, v: 9 });
  cands.sort((a, b) => b.v - a.v);
  const picked = [];
  for (const c of cands) { if (picked.length >= n) break; if (picked.every(p => Math.abs(p - c.t) > 3)) picked.push(c.t); }
  return picked.sort((a, b) => a - b).map(t => [t, Math.min(end, t + 1.1)]);
}
