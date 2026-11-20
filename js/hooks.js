// VertaCut — kanca (başlık) kartı: hazır stiller, özelleştirme ve çizim
import { clamp, upperTR } from './util.js';
import { roundRect } from './captions.js';

export const HOOK_PRESETS = {
  card:    { label: 'Kart',      bg: '#FFFFFF', fg: '#111111', font: 'Allo', weight: 800, size: 54, radius: 30, tilt: -1.6, anim: 'drop', shadow: true },
  accent:  { label: 'Renkli',    bg: 'accent',  fg: '#111111', font: 'Allo', weight: 800, size: 54, radius: 30, tilt: 0, anim: 'pop', shadow: true },
  bold:    { label: 'Kalın',     bg: 'none',    fg: '#FFFFFF', font: 'Montserrat', weight: 900, size: 66, radius: 0, tilt: 0, anim: 'pop', stroke: '#000000', strokeW: 12, upper: true },
  sticker: { label: 'Çıkartma',  bg: '#FFE14D', fg: '#111111', font: 'Archivo Black', weight: 400, size: 52, radius: 18, tilt: -4, anim: 'pop', border: '#111111', borderW: 7, shadow: true },
  glass:   { label: 'Cam',       bg: 'rgba(18,14,18,.62)', fg: '#FFFFFF', font: 'Allo', weight: 700, size: 50, radius: 26, tilt: 0, anim: 'drop', border: 'rgba(255,255,255,.28)', borderW: 2 },
  neon:    { label: 'Neon',      bg: '#14091F', fg: '#FF4FD8', font: 'Allo', weight: 800, size: 54, radius: 22, tilt: 0, anim: 'glitch', border: '#FF4FD8', borderW: 3, glow: 28 },
  pill:    { label: 'Çerçeve',   bg: 'none',    fg: '#FFFFFF', font: 'Allo', weight: 800, size: 50, radius: 999, tilt: 0, anim: 'type', border: '#FFFFFF', borderW: 5, textShadow: true },
  news:    { label: 'Son dakika', bg: '#E3242B', fg: '#FFFFFF', font: 'Anton', weight: 400, size: 60, radius: 6, tilt: 0, anim: 'type', upper: true, shadow: true, tag: 'SON DAKİKA' }
};
// eski sürümlerdeki stil adları
const ALIAS = { card: 'card', accent: 'accent', bold: 'bold' };

export const HOOK_ANIMS = [['drop', 'Kayarak'], ['pop', 'Pop'], ['type', 'Daktilo'], ['glitch', 'Glitch'], ['none', 'Yok']];

/** Klibin kanca ayarlarını hazır stille birleştirir */
export function hookDesign(clip) {
  const id = ALIAS[clip.hookStyle] || (HOOK_PRESETS[clip.hookStyle] ? clip.hookStyle : 'card');
  const P = HOOK_PRESETS[id];
  const pick = (k, d) => clip['hook' + k[0].toUpperCase() + k.slice(1)] ?? P[k] ?? d;
  let bg = pick('bg', '#FFFFFF');
  if (bg === 'accent') bg = clip.accent || '#FF7A45';
  return {
    id, bg, fg: pick('fg', '#111111'), font: pick('font', 'Allo'), weight: P.weight, size: pick('size', 54),
    radius: pick('radius', 30), tilt: pick('tilt', 0), anim: pick('anim', 'drop'), upper: pick('upper', false),
    emoji: clip.hookEmoji || '', stroke: P.stroke, strokeW: P.strokeW, border: P.border, borderW: P.borderW,
    shadow: P.shadow, glow: P.glow, textShadow: P.textShadow, tag: P.tag,
    y: clip.hookY ?? 0.14, dur: clip.hookDur ?? 3.2
  };
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}
/** Başlığı en fazla 3 satıra sığdırmak için yazıyı küçültür; yine sığmazsa son satırı "…" ile bitirir */
export function fitHook(ctx, text, maxW, size, fontFor) {
  let fs = size, lines;
  for (;;) {
    ctx.font = fontFor(fs);
    lines = wrap(ctx, text, maxW);
    if (lines.length <= 3 || fs <= size * 0.55) break;
    fs = Math.max(size * 0.55, fs * 0.92);
  }
  if (lines.length > 3) {
    let last = lines.slice(2).join(' ');
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines = [...lines.slice(0, 2), last.trimEnd() + '…'];
  }
  return { fs, lines, cut: lines[2]?.endsWith('…') && !text.endsWith('…') };
}
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

/** elapsed: klibin çıktısındaki geçen süre (sn) */
export function drawHookCard(ctx, clip, elapsed, W, H) {
  if (!clip.hook) return;
  const d = hookDesign(clip);
  if (elapsed > d.dur + 0.3 || elapsed < 0) return;
  const k = W / 1080;
  const inT = clamp(elapsed / 0.35, 0, 1), outT = clamp((d.dur + 0.3 - elapsed) / 0.3, 0, 1);
  const vis = Math.min(inT, outT);
  if (vis <= 0) return;
  let text = (d.upper ? upperTR(clip.hook) : clip.hook).trim();
  if (d.emoji) text = d.emoji + ' ' + text;
  ctx.save();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const { fs, lines } = fitHook(ctx, text, W * 0.74, d.size * k, f => `${d.weight} ${f}px "${d.font}", "Allo", system-ui, sans-serif`);
  // daktilo: karakterleri sırayla aç
  let shown = lines;
  if (d.anim === 'type' && outT >= 1) {
    const total = lines.join('').length;
    let n = Math.floor(clamp(elapsed / 0.7, 0, 1) * total);
    shown = lines.map(l => { const s = l.slice(0, Math.max(0, n)); n -= l.length; return s; });
  }
  const lh = fs * 1.2, padX = 44 * k, padY = (d.tag ? 46 : 32) * k;
  const bw = Math.min(W * 0.88, Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2);
  const bh = lines.length * lh + padY * 2 + (d.tag ? 10 * k : 0);
  const cy = d.y * H;
  const e = 1 - Math.pow(1 - vis, 3);
  let sc = 1, dy = 0, dx = 0;
  if (d.anim === 'drop') dy = (1 - e) * -34 * k;
  if (d.anim === 'pop') sc = inT < 1 ? 0.55 + 0.45 * easeOutBack(inT) : 1;
  if (d.anim === 'glitch' && elapsed < 0.35) dx = (Math.random() - 0.5) * 26 * k;
  ctx.globalAlpha = d.anim === 'pop' ? Math.min(1, inT * 2) * outT : e;
  ctx.translate(W / 2 + dx, cy + dy);
  ctx.rotate(d.tilt * Math.PI / 180);
  ctx.scale(sc, sc);
  const hasBox = d.bg && d.bg !== 'none';
  if (hasBox || d.border) {
    ctx.save();
    if (d.shadow) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 30 * k; ctx.shadowOffsetY = 12 * k; }
    if (d.glow) { ctx.shadowColor = d.border || d.fg; ctx.shadowBlur = d.glow * k; }
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, d.radius * k);
    if (hasBox) { ctx.fillStyle = d.bg; ctx.fill(); }
    if (d.border) { ctx.shadowColor = d.glow ? ctx.shadowColor : 'transparent'; ctx.lineWidth = d.borderW * k; ctx.strokeStyle = d.border; ctx.stroke(); }
    ctx.restore();
  }
  if (d.tag) {
    ctx.save();
    ctx.font = `800 ${22 * k}px "Allo", system-ui, sans-serif`;
    ctx.fillStyle = d.fg; ctx.globalAlpha *= 0.85;
    ctx.fillText(d.tag, 0, -bh / 2 + 26 * k);
    ctx.restore();
  }
  const top = -bh / 2 + padY + lh / 2 + (d.tag ? 10 * k : 0);
  shown.forEach((l, i) => {
    const y = top + i * lh;
    if (d.anim === 'glitch' && elapsed < 0.45) {
      ctx.save(); ctx.globalAlpha *= 0.7;
      ctx.fillStyle = '#00E5FF'; ctx.fillText(l, -4 * k, y);
      ctx.fillStyle = '#FF2D6F'; ctx.fillText(l, 4 * k, y);
      ctx.restore();
    }
    if (d.strokeW) { ctx.lineWidth = d.strokeW * k; ctx.strokeStyle = d.stroke; ctx.lineJoin = 'round'; ctx.strokeText(l, 0, y); }
    if (d.textShadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12 * k; }
    if (d.glow) { ctx.shadowColor = d.fg; ctx.shadowBlur = d.glow * 0.6 * k; }
    ctx.fillStyle = d.fg;
    ctx.fillText(l, 0, y);
  });
  ctx.restore();
}

/** AI anahtarı yokken içerik türüne göre yerel kanca tasarımı */
export function autoHookStyle(category = '') {
  const c = category.toLocaleLowerCase('tr-TR');
  if (/komik|eğlen|funny/.test(c)) return { hookStyle: 'sticker', hookEmoji: '😂', hookAnim: 'pop' };
  if (/şaşırt|şok|shock/.test(c)) return { hookStyle: 'bold', hookEmoji: '😱', hookAnim: 'pop' };
  if (/epik|clutch|oyun/.test(c)) return { hookStyle: 'neon', hookEmoji: '🔥', hookAnim: 'glitch' };
  if (/öğret|bilgi|eğitim/.test(c)) return { hookStyle: 'card', hookEmoji: '💡', hookAnim: 'type' };
  if (/duygu/.test(c)) return { hookStyle: 'glass', hookEmoji: '🥹', hookAnim: 'drop' };
  if (/tartış|drama/.test(c)) return { hookStyle: 'news', hookEmoji: '', hookAnim: 'type' };
  if (/hikâye|hikaye/.test(c)) return { hookStyle: 'pill', hookEmoji: '👀', hookAnim: 'type' };
  return { hookStyle: 'card', hookEmoji: '', hookAnim: 'drop' };
}
