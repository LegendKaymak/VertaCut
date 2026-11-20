// VertaCut — 9:16 kompozit çizici (düzenler + katmanlar)
import { clamp, upperTR } from './util.js';
import { buildPages, drawCaptions, roundRect, normWord } from './captions.js';
import { drawHookCard } from './hooks.js';
import { isFiller } from './audio.js';

// Logo görselleri (ImageBitmap) uygulama tarafından kaydedilir
const LOGOS = new Map();
export const setLogoImage = (id, bmp) => LOGOS.set(id, bmp);
export const hasLogoImage = id => LOGOS.has(id);

/** Hareket takibi anahtar karelerinden odak noktası */
export function trackAt(keys, t) {
  if (!keys?.length) return 0.5;
  if (t <= keys[0].t) return keys[0].x;
  for (let i = 1; i < keys.length; i++) if (t < keys[i].t) { const a = keys[i - 1], b = keys[i], f = (t - a.t) / (b.t - a.t); return a.x + (b.x - a.x) * f; }
  return keys[keys.length - 1].x;
}

export const LAYOUTS = [
  { id: 'split', label: 'Facecam + oyun', hint: 'Üstte kamera, altta içerik' },
  { id: 'fill', label: 'Tam ekran', hint: 'İçeriği 9:16 kırp, kaydır' },
  { id: 'fit', label: 'Bulanık arka plan', hint: 'Tüm kare görünür' },
  { id: 'pip', label: 'Resim içinde resim', hint: 'Köşede facecam' },
  { id: 'cam', label: 'Sadece kamera', hint: 'Konuşan kişi tam ekran' },
  { id: 'split3', label: 'Dengeli bölme', hint: 'Yarım yarım, ortada başlık' }
];

export const ratioH = r => r === '1:1' ? 1 : r === '4:5' ? 1.25 : 16 / 9;

export const DEFAULT_REGIONS = {
  cam: { x: 0.70, y: 0.62, w: 0.28, h: 0.34 },
  content: { x: 0, y: 0, w: 1, h: 1 }
};

/** Klip için altyazı kelimeleri: klipte düzenlenmiş liste varsa o, yoksa transkriptten */
export function clipWords(clip, transcript) {
  if (clip.words) return clip.words;
  if (!transcript?.words) return [];
  const segs = clip.segments?.length ? clip.segments : [[clip.start, clip.end]];
  return transcript.words.filter(w => segs.some(([a, b]) => w.e > a && w.s < b)).map(w => ({ ...w }));
}

export class Compositor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this._pagesKey = null;
    this._pages = [];
    this._emph = null;
  }

  setSize(w, h) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /**
   * @param video HTMLVideoElement (mevcut kare)
   * @param clip klip nesnesi
   * @param project proje (regions, transcript)
   * @param t kaynak videodaki mutlak zaman
   * @param prog 0..1 klip ilerlemesi
   */
  draw(video, clip, project, t, prog = 0, words = null, ranges = null) {
    const { ctx, canvas } = this;
    if (!words) {
      // klip kelimelerini her karede yeniden süzmemek için önbellekle
      const wk = [clip.id, clip._rev || 0, clip.start, clip.end, project.transcript?.words?.length || 0, !!clip.words].join('|');
      if (wk !== this._wsKey) { this._ws = clipWords(clip, project.transcript); this._wsKey = wk; }
      words = this._ws;
    }
    const W = canvas.width, H = canvas.height;
    const k = W / 1080;
    ctx.save();
    ctx.fillStyle = clip.bg || '#0b0b0c';
    ctx.fillRect(0, 0, W, H);
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh && video.readyState >= 2) {
      const regions = { ...DEFAULT_REGIONS, ...(project.regions || {}), ...(clip.regions || {}) };
      const R = r => ({ x: r.x * vw, y: r.y * vh, w: r.w * vw, h: r.h * vh });
      const cam = R(regions.cam), content = R(regions.content);
      const dz = clip.autoZoom ? this.autoZoom(clip, project, t, words) : 1;
      const zoom = (clip.zoom || 1) * dz;
      const fx = clip.focusX ?? 0.5, fy = clip.focusY ?? 0.5;
      switch (clip.layout || 'split') {
        case 'fill':
          drawCover(ctx, video, content, { x: 0, y: 0, w: W, h: H }, clip.track && clip.trackKeys?.length ? trackAt(clip.trackKeys, t) : fx, fy, zoom);
          break;
        case 'cam':
          drawCover(ctx, video, cam, { x: 0, y: 0, w: W, h: H }, 0.5, 0.5, zoom);
          break;
        case 'fit': {
          ctx.save();
          ctx.filter = `blur(${Math.round(38 * k)}px) brightness(.55) saturate(1.3)`;
          drawCover(ctx, video, content, { x: -40 * k, y: -40 * k, w: W + 80 * k, h: H + 80 * k }, 0.5, 0.5, 1);
          ctx.restore();
          ctx.filter = 'none';
          const ar = content.w / content.h;
          const dw = W * zoom, dh = dw / ar;
          const dy = (H - dh) / 2 + (fy - 0.5) * H * 0.5;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 40 * k;
          ctx.drawImage(video, content.x, content.y, content.w, content.h, (W - dw) / 2, dy, dw, dh);
          ctx.restore();
          break;
        }
        case 'pip': {
          drawCover(ctx, video, content, { x: 0, y: 0, w: W, h: H }, fx, fy, zoom);
          const pw = W * (clip.pipSize || 0.42), ph = pw * (cam.h / cam.w);
          const m = 44 * k;
          const pos = clip.pipPos || 'tr';
          const px = pos.includes('l') ? m : W - pw - m;
          const py = pos.includes('t') ? H * 0.235 : H - ph - m - 260 * k;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 30 * k; ctx.shadowOffsetY = 10 * k;
          roundRect(ctx, px, py, pw, ph, 34 * k);
          ctx.fillStyle = '#000'; ctx.fill();
          ctx.restore();
          ctx.save();
          roundRect(ctx, px, py, pw, ph, 34 * k); ctx.clip();
          drawCover(ctx, video, cam, { x: px, y: py, w: pw, h: ph });
          ctx.restore();
          ctx.save();
          roundRect(ctx, px, py, pw, ph, 34 * k);
          ctx.lineWidth = 6 * k; ctx.strokeStyle = clip.accent || '#D9FF3F'; ctx.stroke();
          ctx.restore();
          break;
        }
        case 'split3':
        case 'split':
        default: {
          const ratio = (clip.layout === 'split3') ? 0.5 : (clip.splitRatio || 0.40);
          const camH = Math.round(H * ratio);
          const swap = !!clip.swap;
          const camBox = swap ? { x: 0, y: H - camH, w: W, h: camH } : { x: 0, y: 0, w: W, h: camH };
          const conBox = swap ? { x: 0, y: 0, w: W, h: H - camH } : { x: 0, y: camH, w: W, h: H - camH };
          drawCover(ctx, video, content, conBox, fx, fy, zoom);
          drawCover(ctx, video, cam, camBox, 0.5, 0.5, 1 + (dz - 1) * 0.6);
          // ayırıcı çizgi
          ctx.fillStyle = clip.accent || '#D9FF3F';
          const sepY = swap ? H - camH : camH;
          ctx.fillRect(0, sepY - 3 * k, W, 6 * k);
        }
      }
    }
    ctx.restore();

    // --- Katmanlar ---
    if (clip.captionsOn !== false && clip.caption) {
      const ws = clip.fillers ? words.filter(w => !isFiller(w.w, clip.fillerWords)) : words;
      const key = JSON.stringify([clip.id, clip.caption.maxWords, ws.length, clip._rev || 0, clip.start, clip.end, !!clip.fillers]);
      if (key !== this._pagesKey) {
        this._pages = buildPages(ws, clip.caption.maxWords);
        this._emph = new Map((clip.emphasis || []).map(e => [normWord(e.word), e.emoji || true]));
        this._pagesKey = key;
      }
      drawCaptions(ctx, W, H, this._pages, t, clip.caption, this._emph);
    }
    const total = ranges ? ranges.reduce((a, [x, y]) => a + (y - x), 0) : (clip._outDur || (clip.end - clip.start));
    const elapsed = prog * total;
    // teaser geçişlerinde beyaz flaş
    if (ranges?.teaser) {
      let acc = 0;
      for (let i = 0; i <= ranges.teaser && i < ranges.length; i++) {
        if (i > 0 && elapsed >= acc && elapsed < acc + 0.14) {
          ctx.save(); ctx.globalAlpha = (1 - (elapsed - acc) / 0.14) * 0.85; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
        }
        acc += ranges[i][1] - ranges[i][0];
      }
    }
    if (clip.hookOn !== false && clip.hook) drawHookCard(ctx, clip, elapsed, W, H);
    if (clip.progressOn) this.drawProgress(clip, prog, W, H);
    if (clip.logo && LOGOS.has(clip.logo.id)) this.drawLogo(clip, W, H);
    if (clip.watermark) this.drawWatermark(clip.watermark, W, H, clip);
  }

  drawLogo(clip, W, H) {
    const img = LOGOS.get(clip.logo.id), ctx = this.ctx, k = W / 1080;
    const w = W * (clip.logo.size ?? 0.2), h = w * (img.height / img.width);
    const m = 40 * k, pos = clip.logo.pos || 'tr';
    const x = pos[1] === 'l' ? m : pos[1] === 'c' ? (W - w) / 2 : W - w - m;
    const y = pos[0] === 't' ? m + 20 * k : pos[0] === 'm' ? (H - h) / 2 : H - h - m - 40 * k;
    ctx.save(); ctx.globalAlpha = clip.logo.opacity ?? 0.9;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  /** Vurgulu kelimelerde ve yüksek tepki anlarında yumuşak "punch-in" yakınlaştırma çarpanı */
  autoZoom(clip, project, t, ws) {
    const key = clip.id + '|' + (clip._rev || 0) + '|' + ws.length;
    if (key !== this._azKey) {
      const emph = new Set((clip.emphasis || []).map(e => normWord(e.word)));
      this._azWords = ws.filter(w => !w.hidden && (w.emph || emph.has(normWord(w.w))));
      this._azKey = key;
    }
    let p = 0;
    for (const w of this._azWords) {
      if (t < w.s - 0.25 || t > w.e + 1.0) continue;
      const a = t < w.s ? (t - (w.s - 0.25)) / 0.25 : t > w.e + 0.55 ? 1 - (t - w.e - 0.55) / 0.45 : 1;
      p = Math.max(p, clamp(a, 0, 1));
    }
    const e = project.energy;
    if (e?.length) {
      const i = Math.floor(t / 0.25);
      let v = 0; for (let k = i - 3; k <= i + 3; k++) v += e[k] || 0;
      p = Math.max(p, clamp((v / 7 - 0.72) / 0.18, 0, 1) * 0.85);
    }
    p = p * p * (3 - 2 * p);
    return 1 + (clip.autoZoomAmt ?? 0.12) * p;
  }

  drawProgress(clip, prog, W, H) {
    const ctx = this.ctx, k = W / 1080;
    const h = 10 * k;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(0, H - h, W, h);
    ctx.fillStyle = clip.accent || '#D9FF3F';
    ctx.fillRect(0, H - h, W * clamp(prog, 0, 1), h);
    ctx.restore();
  }

  drawWatermark(text, W, H, clip) {
    const ctx = this.ctx, k = W / 1080;
    ctx.save();
    ctx.font = `700 ${34 * k}px "Allo", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.78;
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 10 * k;
    ctx.fillStyle = '#fff';
    const y = clip.layout === 'split' && !clip.swap ? H * (clip.splitRatio || 0.4) + 50 * k : H - 70 * k;
    ctx.fillText(text, W / 2, y);
    ctx.restore();
  }
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** src dikdörtgenini dst'ye "cover" mantığıyla çizer, odak noktası fx/fy ile kaydırılır */
export function drawCover(ctx, video, src, dst, fx = 0.5, fy = 0.5, zoom = 1) {
  if (src.w <= 1 || src.h <= 1) return;
  const dAr = dst.w / dst.h;
  let sw = src.w, sh = src.h;
  if (sw / sh > dAr) sw = sh * dAr; else sh = sw / dAr;
  sw /= zoom; sh /= zoom;
  const sx = src.x + (src.w - sw) * clamp(fx, 0, 1);
  const sy = src.y + (src.h - sh) * clamp(fy, 0, 1);
  ctx.drawImage(video, sx, sy, sw, sh, dst.x, dst.y, dst.w, dst.h);
}
