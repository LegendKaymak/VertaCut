// VertaCut — kelime kelime animasyonlu altyazı motoru (canvas)
import { clamp, upperTR } from './util.js';

export const CAPTION_FONTS = [
  { id: 'Montserrat', label: 'Montserrat', weight: 900 },
  { id: 'Allo', label: 'Allo', weight: 900 },
  { id: 'Anton', label: 'Anton', weight: 400 },
  { id: 'Archivo Black', label: 'Archivo Black', weight: 400 },
  { id: 'Bricolage Grotesque', label: 'Bricolage', weight: 800 },
  { id: 'Poppins', label: 'Poppins', weight: 800 },
  { id: 'Figtree', label: 'Figtree', weight: 700 },
  { id: 'Bangers', label: 'Bangers', weight: 400 },
  { id: 'Rubik Mono One', label: 'Rubik Mono', weight: 400 }
];

export const CAPTION_PRESETS = {
  punch: {
    label: 'Punch', font: 'Montserrat', size: 78, color: '#FFFFFF', hi: '#D9FF3F', hi2: '#FF5C39',
    stroke: '#000000', strokeW: 11, shadow: 0.55, upper: true, maxWords: 3, mode: 'highlight', anim: 'pop', boxColor: '#D9FF3F', emoji: true
  },
  box: {
    label: 'Kutu', font: 'Poppins', size: 70, color: '#FFFFFF', hi: '#111111', hi2: '#FF5C39',
    stroke: '#000000', strokeW: 6, shadow: 0.4, upper: false, maxWords: 4, mode: 'box', anim: 'pop', boxColor: '#D9FF3F', emoji: true
  },
  karaoke: {
    label: 'Karaoke', font: 'Archivo Black', size: 66, color: '#FFFFFF', hi: '#46E3FF', hi2: '#FFD43B',
    stroke: '#0A0A0A', strokeW: 9, shadow: 0.5, upper: true, maxWords: 5, mode: 'karaoke', anim: 'none', boxColor: '#46E3FF', emoji: false
  },
  single: {
    label: 'Tek kelime', font: 'Anton', size: 132, color: '#FFFFFF', hi: '#FFFFFF', hi2: '#FFD43B',
    stroke: '#000000', strokeW: 14, shadow: 0.6, upper: true, maxWords: 1, mode: 'single', anim: 'bounce', boxColor: '#FFFFFF', emoji: true
  },
  neon: {
    label: 'Neon', font: 'Bricolage Grotesque', size: 74, color: '#F4F1FF', hi: '#FF4FD8', hi2: '#4FFFE1',
    stroke: '#1A0630', strokeW: 6, shadow: 0, glow: 26, upper: false, maxWords: 3, mode: 'highlight', anim: 'pop', boxColor: '#FF4FD8', emoji: true
  },
  clean: {
    label: 'Sade', font: 'Figtree', size: 58, color: '#FFFFFF', hi: '#FFFFFF', hi2: '#FFD43B',
    stroke: '#000000', strokeW: 0, shadow: 0.85, upper: false, maxWords: 6, mode: 'dim', anim: 'none', boxColor: '#000000', emoji: false
  },
  comic: {
    label: 'Çizgi roman', font: 'Bangers', size: 96, color: '#FFF6D6', hi: '#FFCC00', hi2: '#FF3B3B',
    stroke: '#1B1B1B', strokeW: 12, shadow: 0.3, upper: true, maxWords: 3, mode: 'highlight', anim: 'bounce', boxColor: '#FFCC00', emoji: true
  }
};

export function defaultCaptionStyle(preset = 'punch') {
  return { preset, y: 0.70, ...structuredClone(CAPTION_PRESETS[preset]) };
}

/** Kelimeleri ekranda birlikte görünen "sayfalara" böler */
export function buildPages(words, maxWords = 3, maxChars = 22) {
  const pages = [];
  let cur = [];
  const flush = () => { if (cur.length) { pages.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; } };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.hidden) continue;
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length;
    if (cur.length && (cur.length >= maxWords || chars > maxChars * Math.max(1, maxWords / 3) || (prev && w.s - prev.e > 0.7))) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w) && cur.length >= Math.min(2, maxWords)) flush();
  }
  flush();
  // sayfalar arası kısa boşluklarda bir önceki sayfayı ekranda tut
  for (let i = 0; i < pages.length - 1; i++) {
    const gap = pages[i + 1].s - pages[i].e;
    pages[i].hold = gap < 0.6 ? pages[i + 1].s : pages[i].e + 0.25;
  }
  if (pages.length) pages[pages.length - 1].hold = pages[pages.length - 1].e + 0.4;
  return pages;
}

const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOut = t => 1 - Math.pow(1 - t, 3);

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export { rr as roundRect };

/**
 * t: kaynak videodaki mutlak zaman. emphasis: Map(lowercase kelime -> emoji|true)
 */
export function drawCaptions(ctx, W, H, pages, t, st, emphasis) {
  if (!pages?.length) return;
  // ikili arama
  let lo = 0, hi = pages.length - 1, idx = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (pages[m].s <= t) { idx = m; lo = m + 1; } else hi = m - 1;
  }
  if (idx < 0) return;
  const page = pages[idx];
  if (t > page.hold) return;

  const k = W / 1080;
  const size = st.size * k;
  const fontDef = CAPTION_FONTS.find(f => f.id === st.font) || CAPTION_FONTS[0];
  const font = `${fontDef.weight} ${size}px "${st.font}", "Montserrat", system-ui, sans-serif`;
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const maxW = W * 0.84;
  const space = size * 0.28;
  // kinetik: vurgulu kelimeler daha büyük ve ikinci yazı tipiyle
  const big = st.emphBig ? `900 ${size * 1.32}px "${st.font2 || 'Anton'}", "Montserrat", system-ui, sans-serif` : null;
  const toks = page.words.map(w => {
    const text = st.upper ? upperTR(w.w) : w.w;
    const isBig = !!(big && (w.emph || emphasis?.has(normWord(w.w))));
    if (isBig) ctx.font = big;
    const width = ctx.measureText(text).width;
    if (isBig) ctx.font = font;
    return { w, text, width, big: isBig };
  });
  // satırlara sar
  const lines = [[]]; let lw = 0;
  for (const tk of toks) {
    const add = (lines[lines.length - 1].length ? space : 0) + tk.width;
    if (lw + add > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push(tk); lw += (lines[lines.length - 1].length > 1 ? space : 0) + tk.width;
  }
  const lineH = size * (toks.some(t => t.big) ? 1.38 : 1.18);
  const totalH = lineH * lines.length;
  let y0 = clamp(st.y, 0.08, 0.94) * H - totalH / 2 + lineH / 2;

  // sayfa girişi animasyonu
  const pIn = clamp((t - page.s) / 0.12, 0, 1);
  const pageScale = st.anim === 'none' ? 1 : 0.86 + 0.14 * easeOut(pIn);
  const cx = W / 2, cy = clamp(st.y, 0.08, 0.94) * H;
  ctx.translate(cx, cy); ctx.scale(pageScale, pageScale); ctx.translate(-cx, -cy);
  ctx.globalAlpha = st.anim === 'none' ? 1 : clamp(pIn * 1.6, 0, 1);

  let emojiToDraw = null;
  for (const line of lines) {
    const width = line.reduce((a, tk, i) => a + tk.width + (i ? space : 0), 0);
    let x = W / 2 - width / 2;
    for (const tk of line) {
      const w = tk.w;
      const active = t >= w.s && t < Math.max(w.e, w.s + 0.08) || (t >= w.e && isLastSpoken(page.words, w, t));
      const spoken = t >= w.s;
      const emph = w.emph || emphasis?.has(normWord(w.w));
      const emo = (typeof w.emoji === 'string' && w.emoji) || (emphasis && typeof emphasis.get(normWord(w.w)) === 'string' ? emphasis.get(normWord(w.w)) : null);
      let scale = 1;
      if (active && st.anim !== 'none') {
        const a = clamp((t - w.s) / (st.anim === 'bounce' ? 0.22 : 0.15), 0, 1);
        scale = st.anim === 'bounce' ? 0.7 + 0.42 * easeOutBack(a) - 0.12 * a : 1 + 0.12 * Math.sin(a * Math.PI) + 0.04 * a;
      }
      const wx = x + tk.width / 2, wy = y0;
      ctx.save();
      ctx.translate(wx, wy); ctx.scale(scale, scale); ctx.translate(-wx, -wy);
      if (tk.big) ctx.font = big;

      let fill = st.color;
      if (st.mode === 'highlight' || st.mode === 'single') fill = active ? (emph ? st.hi2 : st.hi) : (emph && spoken ? st.hi2 : st.color);
      else if (st.mode === 'karaoke') fill = spoken ? (emph ? st.hi2 : st.hi) : st.color;
      else if (st.mode === 'dim') { fill = st.color; ctx.globalAlpha *= spoken ? 1 : 0.55; }
      else if (st.mode === 'box') fill = active ? st.hi : (emph ? st.hi2 : st.color);

      if (st.mode === 'box' && active) {
        const padX = size * 0.2, padY = size * 0.1;
        ctx.save();
        ctx.fillStyle = emph ? st.hi2 : st.boxColor;
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18 * k; ctx.shadowOffsetY = 6 * k;
        rr(ctx, x - padX, wy - size * 0.58 - padY / 2, tk.width + padX * 2, size * 1.16 + padY, size * 0.22);
        ctx.fill();
        ctx.restore();
      }
      if (st.glow) { ctx.shadowColor = active || (emph && spoken) ? fill : st.hi; ctx.shadowBlur = st.glow * k * (active ? 1.4 : 0.6); }
      else if (st.shadow) { ctx.shadowColor = `rgba(0,0,0,${st.shadow})`; ctx.shadowBlur = 14 * k; ctx.shadowOffsetY = 5 * k; }
      const boxed = st.mode === 'box' && active;
      if (st.strokeW > 0 && !boxed) {
        ctx.strokeStyle = st.stroke; ctx.lineWidth = st.strokeW * k;
        ctx.strokeText(tk.text, x, wy);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = fill;
      ctx.fillText(tk.text, x, wy);
      ctx.restore();
      if (active && emo && st.emoji) emojiToDraw = { emo, x: wx, y: y0 - lineH * 0.5 - size * 0.55, s: w.s };
      x += tk.width + space;
    }
    y0 += lineH;
  }
  ctx.restore();

  if (emojiToDraw) {
    const a = clamp((t - emojiToDraw.s) / 0.25, 0, 1);
    const s = size * 1.25 * (0.4 + 0.6 * easeOutBack(a));
    ctx.save();
    ctx.globalAlpha = clamp(a * 2, 0, 1);
    ctx.font = `${s}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const topY = clamp(st.y, 0.08, 0.94) * H - totalH / 2 - size * 0.75;
    ctx.translate(emojiToDraw.x, topY); ctx.rotate((1 - a) * -0.35);
    ctx.fillText(emojiToDraw.emo, 0, 0);
    ctx.restore();
  }
}

// Kelimeler arasındaki kısa boşluklarda son konuşulan kelimeyi aktif tut
function isLastSpoken(words, w, t) {
  const i = words.indexOf(w);
  const next = words[i + 1];
  return t >= w.e && (!next ? t < w.e + 0.35 : t < next.s);
}

export const normWord = s => String(s).toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '');
