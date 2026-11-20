// VertaCut — uygulama arayüzü
import { $, $$, clamp, uid, fmtTime, fmtDur, fmtBytes, escapeHtml, debounce, download, safeName, sleep, parseTime } from './util.js';
import { DB, loadSettings, saveSettings } from './db.js';
import { extractAudio, computeEnergy, findHypeMoments, HOP, DEFAULT_FILLERS, isFiller } from './audio.js';
import { transcribe, parseSubtitleFile, analyzeClips, regenerateMeta, suggestHooks, translateLines, designHook, youtubeChapters, listModels, testConnection, testKey, lastGeminiModel, lastOpenRouterModel, LLM_PROVIDERS, STT_PROVIDERS, CONTENT_TYPES } from './ai.js';
const AUTO_MODEL = { gemini: 'auto', openrouter: 'free' };
/** Ayarlar → Özellikler'den açılıp kapatılabilen özellikler (varsayılan: açık) */
const feat = k => S.settings.features?.[k] !== false;
import { PLATFORMS, variantValues, applyVariant, isCustom, makeZip } from './variants.js';
import { findIn, replaceAt, replaceInText, suggestions, norm as gNorm } from './glossary.js';
import { Compositor, LAYOUTS, DEFAULT_REGIONS, clipWords, ownWords, setLogoImage, hasLogoImage, ratioH } from './render.js';
import { CAPTION_PRESETS, CAPTION_FONTS, defaultCaptionStyle, buildPages, drawCaptions } from './captions.js';
import { playSfx, sfxEvents, crossed, duckFactor } from './sfx.js';
import { HOOK_PRESETS, HOOK_ANIMS, hookDesign, autoHookStyle, drawHookCard } from './hooks.js';
import { exportClip, pickMime, extFor, rangesFor, progressAt, progressAtSeq, segIndexFor, outDuration, clipSrt } from './exporter.js';

// ------------------------------------------------------------------ durum
const S = {
  settings: loadSettings(),
  project: null,
  file: null,
  videoUrl: null,
  samples: null,
  sr: 0,
  job: null,          // { kind, ctrl }
  markIn: null,
  markOut: null,
  sort: 'score',
  ed: null,           // { clip, ranges, win }
  queue: [],
  installEvt: null
};
const ACCENTS = ['#FF7A45', '#FFC15A', '#FF2D6F', '#D9FF3F', '#46E3FF', '#FFFFFF'];

// Tema renklerini canvas çizimleri için CSS değişkenlerinden oku
let _cv = {};
function cssVar(name) {
  if (!(name in _cv)) _cv[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  return _cv[name];
}
function withAlpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const mainVideo = $('#mainVideo');
const edVideo = $('#edVideo');

// ------------------------------------------------------------------ küçük yardımcılar
let snackT;
function snack(msg, { err = false, action, onAction, ms = 4200 } = {}) {
  const el = $('#snack');
  el.className = 'snack show' + (err ? ' err' : '');
  el.innerHTML = `<span>${escapeHtml(msg)}</span>${action ? `<button>${escapeHtml(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); onAction?.(); };
  clearTimeout(snackT);
  snackT = setTimeout(() => el.classList.remove('show'), err ? Math.max(ms, 7000) : ms);
}

function fillRange(el) {
  const p = ((+el.value - +el.min) / ((+el.max - +el.min) || 1)) * 100;
  el.style.setProperty('--p', p + '%');
}
document.addEventListener('input', e => { if (e.target.type === 'range') fillRange(e.target); });

function show(view) {
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== view && !(view === 'editor' && v.dataset.view === 'workspace'); });
  document.body.dataset.view = view;
}

const saveProject = debounce(() => { if (S.project) DB.saveProject(S.project).catch(e => console.warn('Kaydedilemedi', e)); }, 600);

function hypeColor(v) {
  const stops = [[92, 40, 64], [196, 48, 112], [255, 64, 110], [255, 138, 61], [255, 196, 92]];
  const x = clamp(v, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const c = stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function hasKey(provider) {
  const def = LLM_PROVIDERS[provider];
  return def?.noKey || !!(S.settings.keys[provider] || '').trim();
}
function hasSttKey() {
  const def = STT_PROVIDERS[S.settings.sttProvider];
  return !!(S.settings.keys[def?.keyFrom] || '').trim();
}

// ------------------------------------------------------------------ ANA EKRAN
function initHome() {
  const drop = $('#drop'), input = $('#fileInput');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('video/') || /\.(mkv|mov|mp4|webm|m4v)$/i.test(f.name));
    if (f) openFile(f); else snack('Bu bir video dosyası değil. MP4, MOV, WebM veya MKV dene.', { err: true });
  });
  // Dosya seçici: mümkünse File System Access (proje yeniden açılınca tekrar seçmeye gerek kalmaz)
  drop.addEventListener('click', async e => {
    if (!window.showOpenFilePicker) return; // varsayılan <input> davranışı
    e.preventDefault();
    try {
      const [h] = await showOpenFilePicker({ types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.m4v'] } }] });
      openFile(await h.getFile(), h);
    } catch (err) { if (err.name !== 'AbortError') input.click(); }
  });
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop.click(); } });
  input.addEventListener('change', () => { if (input.files[0]) openFile(input.files[0]); input.value = ''; });
  animateDropMap();
  renderRecent();
}

// Bırakma alanındaki canlı "yayın" haritası: tek orkestre edilmiş hareket
function animateDropMap() {
  const c = $('#dropMap'), ctx = c.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const N = 120;
  const seed = Array.from({ length: N }, (_, i) => {
    const base = 0.18 + 0.22 * Math.abs(Math.sin(i * 0.37)) + 0.12 * Math.sin(i * 1.7);
    const spike = [17, 46, 79, 103].some(p => Math.abs(i - p) < 3) ? 0.55 * (1 - Math.abs(i - [17, 46, 79, 103].reduce((a, p) => Math.abs(i - p) < Math.abs(i - a) ? p : a)) / 3) : 0;
    return clamp(base + spike, 0.05, 1);
  });
  let t0 = performance.now();
  const frame = now => {
    if (document.body.dataset.view !== 'home') { requestAnimationFrame(frame); return; }
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w) { requestAnimationFrame(frame); return; }
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = reduce ? 2.4 : (now - t0) / 1000;
    const reveal = clamp(t / 1.6, 0, 1);
    const bw = w / N, base = h - 24, maxH = h * 0.26;
    for (let i = 0; i < N; i++) {
      if (i / N > reveal) break;
      const v = seed[i] * (0.9 + 0.1 * Math.sin(t * 1.3 + i * 0.5));
      ctx.fillStyle = hypeColor(v);
      ctx.globalAlpha = 0.85;
      const bh = Math.max(2, v * maxH);
      ctx.fillRect(i * bw + 1, base - bh, Math.max(1, bw - 2), bh);
    }
    ctx.globalAlpha = 1;
    // kesim işaretleri
    [[14, 22], [76, 84]].forEach(([a, b], k) => {
      if (reveal < 1) return;
      const appear = clamp((t - 1.7 - k * 0.35) / 0.4, 0, 1);
      if (!appear) return;
      ctx.globalAlpha = appear;
      const top = base - maxH - 14;
      ctx.fillStyle = withAlpha(cssVar('--cut'), .12);
      ctx.fillRect(a * bw, top, (b - a) * bw, base - top);
      ctx.fillStyle = cssVar('--cut');
      ctx.fillRect(a * bw, top, 2, base - top);
      ctx.fillRect(b * bw - 2, top, 2, base - top);
      ctx.fillRect(a * bw, top, (b - a) * bw, 2);
      ctx.globalAlpha = 1;
    });
    // oynatma kafası
    const ph = ((t * 0.06) % 1) * w;
    ctx.fillStyle = withAlpha(cssVar('--text'), .5);
    ctx.fillRect(ph, base - maxH - 14, 1.5, maxH + 14);
    if (!reduce) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (reduce) setTimeout(() => requestAnimationFrame(frame), 50);
}

async function renderRecent() {
  let list = [];
  try { list = await DB.listProjects(); } catch (e) { console.warn(e); }
  $('#recentWrap').hidden = !list.length;
  $('#recentList').innerHTML = list.slice(0, 12).map(p => `
    <li class="recent-item" data-id="${p.id}" tabindex="0">
      <span class="r-thumb" style="${p.thumb ? `background-image:url(${p.thumb})` : ''}"></span>
      <span class="r-info">
        <span class="r-name">${escapeHtml(p.name)}</span>
        <span class="r-meta">${fmtDur(p.video?.duration || 0)}, ${p.clipCount ?? p.clips?.length ?? 0} klip, ${new Date(p.updatedAt || p.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</span>
      </span>
      <button class="btn icon sm danger" data-del="${p.id}" aria-label="Projeyi sil" title="Projeyi sil"><svg class="ic"><use href="#i-trash"/></svg></button>
    </li>`).join('');
}

$('#recentList').addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    const p = (await DB.listProjects()).find(m => m.id === del.dataset.del);
    if (p && confirm(`"${p.name}" projesi silinsin mi? Video dosyan silinmez.`)) {
      const gone = await DB.deleteProject(p.id);
      for (const k of gone || []) { const [kind, mid] = k.split(':'); if (kind === 'music') musicCache.delete(mid); }
      renderRecent(); snack('Proje silindi');
    }
    return;
  }
  const li = e.target.closest('.recent-item');
  if (li) openProject(li.dataset.id);
});
$('#recentList').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('.recent-item')?.click(); });

// ------------------------------------------------------------------ PROJE AÇMA
async function openFile(file, handle = null) {
  // Aynı dosya için mevcut proje varsa onu aç
  const list = await DB.listProjects().catch(() => []);
  const same = list.filter(p => p.video?.name === file.name && p.video?.size === file.size);
  let existing = same.find(p => p.video?.lastModified && p.video.lastModified === file.lastModified);
  if (!existing && handle) {
    for (const p of same) { const h = await DB.getHandle(p.id); if (h?.isSameEntry && await h.isSameEntry(handle).catch(() => false)) { existing = p; break; } }
  }
  // ad ve boyut aynı ama değişiklik tarihi farklı: kullanıcıya sor
  if (!existing && same.length && confirm(`"${file.name}" adında ve aynı boyutta kayıtlı bir proje var. Bu video o projeye mi ait?\n\nTamam: kayıtlı projeyi aç. İptal: yeni proje başlat.`)) existing = same[0];
  if (existing) {
    existing = await DB.getProject(existing.id);
    if (existing.video) existing.video.lastModified = file.lastModified;
    await loadProject(existing, file);
    if (handle) DB.saveHandle(existing.id, handle);
    snack('Bu video için kayıtlı proje açıldı');
    return;
  }
  const project = {
    id: uid(), name: file.name.replace(/\.[^.]+$/, ''), createdAt: Date.now(),
    video: { name: file.name, size: file.size, type: file.type, lastModified: file.lastModified },
    regions: { ...structuredClone(DEFAULT_REGIONS), hasCam: true },
    energy: null, transcript: null, clips: [], framed: false
  };
  if (handle) DB.saveHandle(project.id, handle);
  await loadProject(project, file);
}

async function openProject(id) {
  const p = await DB.getProject(id);
  if (!p) return snack('Proje bulunamadı', { err: true });
  let file = null;
  const h = await DB.getHandle(id);
  if (h?.getFile) {
    try {
      if ((await h.queryPermission?.({ mode: 'read' })) !== 'granted') await h.requestPermission?.({ mode: 'read' });
      file = await h.getFile();
    } catch { file = null; }
  }
  await loadProject(p, file);
}

async function loadProject(p, file) {
  stopJob();
  S.project = p;
  if (p.energy && !(p.energy instanceof Float32Array)) p.energy = Float32Array.from(p.energy);
  if (p.chat && !(p.chat instanceof Float32Array)) p.chat = Float32Array.from(p.chat);
  S.samples = null; S.markIn = S.markOut = null;
  p.clips ||= [];
  $('#projName').value = p.name;
  p.clips.forEach(c => c.logo && ensureLogo(c.logo.id));
  show('workspace');
  if (document.body.classList.contains('m')) setMTab(p.clips.length ? 'clips' : 'video');
  setFile(file);
  renderAll();
}

function setFile(file) {
  // dışa aktarma sırasında bekleyen işler eski videoyu kullanıyorsa adresi onlar bitince bırak
  if (S.videoUrl && !S.queue.some(q => q.videoUrl === S.videoUrl && (q.state === 'waiting' || q.state === 'running'))) URL.revokeObjectURL(S.videoUrl);
  S.file = file;
  S.videoUrl = file ? URL.createObjectURL(file) : null;
  $('#relink').hidden = !!file;
  $('#relinkName').textContent = S.project.video.name + ', ' + fmtBytes(S.project.video.size || 0);
  if (!file) { mainVideo.removeAttribute('src'); mainVideo.load(); return; }
  mainVideo.src = S.videoUrl;
  edVideo.src = S.videoUrl;
  thumbVideo.src = S.videoUrl;
  mainVideo.onloadedmetadata = () => {
    const v = S.project.video;
    v.duration = mainVideo.duration; v.width = mainVideo.videoWidth; v.height = mainVideo.videoHeight;
    $('#projMeta').textContent = `${fmtDur(v.duration)}, ${v.width}×${v.height}`;
    updateTc(); drawHype();
    if (!S.project.thumb) captureProjectThumb();
    saveProject();
    if (!S.project.energy?.length) runAudio().catch(() => {});
    else if (!S.project.framed && S.project.clips.length === 0) setTimeout(() => openFraming(true), 400);
    queueThumbs();
  };
  mainVideo.onerror = () => snack('Bu video tarayıcıda açılamadı. MP4 (H.264) en geniş desteğe sahip; MKV için Chrome veya Edge dene.', { err: true });
}

$('#relinkBtn').addEventListener('click', async () => {
  let file, handle;
  try {
    if (window.showOpenFilePicker) { [handle] = await showOpenFilePicker({ types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.m4v'] } }] }); file = await handle.getFile(); }
    else file = await pickFile('video/*');
  } catch { return; }
  if (!file) return;
  if (file.size !== S.project.video.size && !confirm('Seçilen dosya projedeki videodan farklı görünüyor. Yine de kullanılsın mı?')) return;
  if (handle) DB.saveHandle(S.project.id, handle);
  setFile(file);
});

function pickFile(accept) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = () => res(i.files[0] || null); i.click();
  });
}

function captureProjectThumb() {
  const go = () => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    try { c.getContext('2d').drawImage(mainVideo, 0, 0, 160, 90); S.project.thumb = c.toDataURL('image/jpeg', 0.7); saveProject(); } catch {}
  };
  if (mainVideo.readyState >= 2) go(); else mainVideo.addEventListener('loadeddata', go, { once: true });
}

$('#wsBack').addEventListener('click', () => {
  stopJob(); mainVideo.pause();
  if (S.project) DB.saveProject(S.project);
  show('home'); renderRecent();
});
$('#projName').addEventListener('change', e => { S.project.name = e.target.value.trim() || 'Adsız proje'; saveProject(); });

function renderAll() {
  renderPipeline(); renderTranscript(); renderClips(); drawHype(); updateMarks();
}

// ------------------------------------------------------------------ OYNATICI
$('#playBtn').addEventListener('click', togglePlay);
function togglePlay() { if (!S.file) return; mainVideo.paused ? mainVideo.play() : mainVideo.pause(); }
mainVideo.addEventListener('play', () => { setPlayIcon('#playBtn', true); loopMain(); });
mainVideo.addEventListener('pause', () => setPlayIcon('#playBtn', false));
mainVideo.addEventListener('timeupdate', () => { updateTc(); if (mainVideo.paused) { drawHype(); highlightWord(); } });
mainVideo.addEventListener('seeked', () => { drawHype(); highlightWord(true); });
mainVideo.addEventListener('click', togglePlay);

function setPlayIcon(sel, playing) { const u = $(sel + ' use'); if (u) u.setAttribute('href', playing ? '#i-pause' : '#i-play'); }
function loopMain() {
  if (mainVideo.paused) return;
  updateTc(); drawHype(); highlightWord();
  if (S.previewEnd && mainVideo.currentTime >= S.previewEnd) { mainVideo.pause(); S.previewEnd = null; }
  requestAnimationFrame(loopMain);
}
function updateTc() { $('#tc').textContent = `${fmtTime(mainVideo.currentTime)} / ${fmtTime(mainVideo.duration || S.project?.video.duration || 0)}`; }

$('#markIn').addEventListener('click', () => setMark('in'));
$('#markOut').addEventListener('click', () => setMark('out'));
$('#addMarked').addEventListener('click', addMarkedClip);
function setMark(which) {
  const t = mainVideo.currentTime;
  if (which === 'in') { S.markIn = t; if (S.markOut != null && S.markOut <= t) S.markOut = null; }
  else { S.markOut = t; if (S.markIn != null && S.markIn >= t) S.markIn = Math.max(0, t - 30); if (S.markIn == null) S.markIn = Math.max(0, t - 30); }
  updateMarks(); drawHype();
}
function updateMarks() {
  const ok = S.markIn != null && S.markOut != null && S.markOut - S.markIn >= 1;
  $('#addMarked').disabled = !ok;
  $('#addMarked').lastChild.textContent = ok ? `Klip yap (${Math.round(S.markOut - S.markIn)} sn)` : 'Klip yap';
}
function addMarkedClip() {
  if (S.markIn == null || S.markOut == null) return;
  const c = addClip({ start: S.markIn, end: S.markOut, title: titleFromWords(S.markIn, S.markOut), source: 'manual', score: null });
  S.markIn = S.markOut = null; updateMarks(); drawHype();
  snack('Klip eklendi', { action: 'Düzenle', onAction: () => openEditor(c.id) });
}

function titleFromWords(s, e) {
  const ws = (S.project.transcript?.words || []).filter(w => w.s >= s && w.e <= e).slice(0, 8).map(w => w.w);
  return ws.length ? ws.join(' ').replace(/[,.;:]+$/, '') + '…' : `Klip, ${fmtTime(s)}`;
}

// ------------------------------------------------------------------ HYPE HARİTASI
const hypeCanvas = $('#hypeMap'), hypeWrap = $('#hypeWrap');
function drawHype() {
  if (document.body.dataset.view !== 'workspace' || !S.project) return;
  const c = hypeCanvas, ctx = c.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const D = S.project.video.duration || mainVideo.duration || 0;
  if (!D) return;
  const X = t => (t / D) * w;
  const e = S.project.energy;
  const top = 6, base = h - 2, mh = base - top;
  if (e?.length) {
    const cols = Math.floor(w / 2);
    for (let i = 0; i < cols; i++) {
      const a = Math.floor((i / cols) * e.length), b = Math.max(a + 1, Math.floor(((i + 1) / cols) * e.length));
      let m = 0, sum = 0;
      for (let j = a; j < b; j++) { m = Math.max(m, e[j]); sum += e[j]; }
      const v = m * 0.65 + (sum / (b - a)) * 0.35;
      ctx.fillStyle = hypeColor(v);
      const bh = Math.max(1, v * v * mh);
      ctx.fillRect(i * 2, base - bh, 1.5, bh);
    }
  } else {
    ctx.fillStyle = cssVar('--ink-3');
    ctx.fillRect(0, base - 1, w, 1);
  }
  // klipler
  // sohbet yoğunluğu çizgisi
  const ch = S.project.chat;
  if (ch?.length) {
    ctx.beginPath();
    const cols = Math.floor(w / 2);
    for (let i = 0; i < cols; i++) {
      const a = Math.floor((i / cols) * ch.length), b = Math.max(a + 1, Math.floor(((i + 1) / cols) * ch.length));
      let m = 0; for (let j = a; j < b; j++) m = Math.max(m, ch[j]);
      const y = base - m * mh;
      i ? ctx.lineTo(i * 2, y) : ctx.moveTo(0, y);
    }
    ctx.strokeStyle = withAlpha(cssVar('--tape'), .9); ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (const cl of S.project.clips) {
    const active = S.ed?.clip.id === cl.id;
    for (const [s0, e0] of (cl.segments || [[cl.start, cl.end]])) {
      const x0 = X(s0), x1 = X(e0);
      ctx.fillStyle = withAlpha(cssVar('--cut'), active ? .28 : .14);
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), base);
      ctx.fillStyle = cssVar('--cut');
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), 3);
    }
  }
  // işaretler
  if (S.markIn != null) {
    const x0 = X(S.markIn), x1 = S.markOut != null ? X(S.markOut) : x0 + 1.5;
    ctx.fillStyle = withAlpha(cssVar('--tape'), .22); ctx.fillRect(x0, 0, x1 - x0, base);
    ctx.fillStyle = cssVar('--tape'); ctx.fillRect(x0, 0, 2, base); if (S.markOut != null) ctx.fillRect(x1 - 2, 0, 2, base);
  }
  // oynatma kafası
  ctx.fillStyle = cssVar('--text');
  ctx.fillRect(X(mainVideo.currentTime) - 1, 0, 2, base);
}
new ResizeObserver(() => drawHype()).observe(hypeWrap);

(() => {
  let down = null;
  const tAt = ev => {
    const r = hypeCanvas.getBoundingClientRect();
    return clamp((ev.clientX - r.left) / r.width, 0, 1) * (S.project?.video.duration || 0);
  };
  hypeWrap.addEventListener('pointerdown', ev => {
    if (!S.project || !S.file) return;
    hypeWrap.setPointerCapture(ev.pointerId);
    down = { x: ev.clientX, t: tAt(ev), drag: false };
  });
  hypeWrap.addEventListener('pointermove', ev => {
    if (!S.project) return;
    const t = tAt(ev), tip = $('#hypeTip');
    tip.hidden = false;
    tip.style.left = (ev.clientX - hypeWrap.getBoundingClientRect().left) + 'px';
    tip.textContent = fmtTime(t);
    if (!down) return;
    if (Math.abs(ev.clientX - down.x) > 5) down.drag = true;
    if (down.drag) {
      S.markIn = Math.min(down.t, t); S.markOut = Math.max(down.t, t);
      tip.textContent = `${fmtTime(S.markIn)} – ${fmtTime(S.markOut)} (${Math.round(S.markOut - S.markIn)} sn)`;
      updateMarks(); drawHype();
    }
  });
  hypeWrap.addEventListener('pointerup', ev => {
    if (!down) return;
    if (!down.drag) { mainVideo.currentTime = tAt(ev); }
    else mainVideo.currentTime = S.markIn;
    down = null;
  });
  hypeWrap.addEventListener('pointerleave', () => { $('#hypeTip').hidden = true; });
})();

// ------------------------------------------------------------------ İŞ HATTI (pipeline)
function renderPipeline() {
  const p = S.project;
  const st = (step, state, sub) => {
    const el = $(`.pl-step[data-step="${step}"]`);
    el.classList.remove('done', 'running', 'err');
    if (state) el.classList.add(state);
    if (sub != null) el.querySelector('.pl-sub').textContent = sub;
  };
  const running = S.job?.kind;
  st('audio', running === 'audio' ? 'running' : p.energy?.length ? 'done' : null,
    p.energy?.length ? 'Hype haritası hazır' : running === 'audio' ? 'Ses çözülüyor' : 'Video açılınca otomatik başlar');
  const tr = p.transcript;
  st('transcript', running === 'transcript' ? 'running' : tr ? 'done' : null,
    tr ? `${tr.words.length.toLocaleString('tr-TR')} kelime${tr.source === 'import' ? ', dosyadan' : ''}` : 'Kelime zamanlı yazıya dökme');
  st('ai', running === 'ai' ? 'running' : p.clips.length ? 'done' : null,
    p.clips.length ? `${p.clips.length} klip` : (hasKey(S.settings.llmProvider) ? `${LLM_PROVIDERS[S.settings.llmProvider].label} ile` : 'AI ile ya da ses tepkilerinden'));
  $('#txBtn').lastChild.textContent = tr ? 'Yeniden' : 'Yazıya dök';
  $('#aiBtn').lastChild.textContent = p.clips.some(c => c.source === 'ai') ? 'Yeniden bul' : 'AI ile bul';
  const busy = !!S.job;
  ['#txBtn', '#aiBtn', '#hypeBtn'].forEach(s => { $(s).disabled = busy || !S.file; });
  $('#subInput').disabled = busy;
  $('#exportAllBtn').disabled = !p.clips.length || !S.file;
}

function startJob(kind) {
  stopJob();
  const ctrl = new AbortController();
  S.job = { kind, ctrl };
  $('#plProgress').hidden = false;
  setProgress(0, 'Hazırlanıyor');
  renderPipeline();
  return ctrl.signal;
}
function stopJob() { if (S.job) { S.job.ctrl.abort(); S.job = null; } $('#plProgress').hidden = true; }
function endJob() { S.job = null; $('#plProgress').hidden = true; renderPipeline(); }
function setProgress(p, label, indet = false) {
  $('#plBar').style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
  $('#plBar').parentElement.classList.toggle('indet', indet);
  if (label) $('#plLabel').textContent = label;
}
$('#plCancel').addEventListener('click', () => { stopJob(); renderPipeline(); snack('İşlem iptal edildi'); });

async function runAudio() {
  if (!S.file) return;
  const signal = startJob('audio');
  try {
    const { samples, sampleRate, method } = await extractAudio(S.file, S.videoUrl, (p, l) => setProgress(p, l, l === 'Ses çözülüyor'), signal, { fast: feat('fastAudio') });
    if (signal.aborted) return;
    S.samples = samples; S.sr = sampleRate; S.audioMethod = method;
    S.project.energy = computeEnergy(samples, sampleRate);
    saveProject();
    endJob(); drawHype();
    if (!S.project.framed && !S.project.clips.length) openFraming(true);
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error(e);
    endJob();
    $('.pl-step[data-step="audio"]').classList.add('err');
    $('.pl-step[data-step="audio"] .pl-sub').textContent = 'Ses çözülemedi';
    snack('Videonun sesi okunamadı. Altyazı dosyası içe aktarıp yine klip oluşturabilirsin. (' + e.message + ')', { err: true });
  }
}

async function ensureSamples() {
  if (S.samples) return true;
  await runAudio();
  return !!S.samples;
}

$('#txBtn').addEventListener('click', () => runTranscribe());
async function runTranscribe() {
  if (!hasSttKey()) {
    snack(`Yazıya dökmek için ${STT_PROVIDERS[S.settings.sttProvider].label} anahtarı gerekli.`, { action: 'Kurulum rehberi', onAction: () => openGuide(3) });
    return false;
  }
  if (!(await askLanguage())) return false;
  if (!(await ensureSamples())) return false;
  const signal = startJob('transcript');
  try {
    const tr = await transcribe(S.samples, S.sr, S.settings, (p, l) => setProgress(p, 'Yazıya dökülüyor: ' + l), signal);
    if (signal.aborted) return false;
    if (!tr.words.length) throw new Error('Konuşma bulunamadı. Doğru dil seçili mi?');
    tr._v = Date.now();
    S.project.transcript = tr;
    S.project.clips.forEach(c => { if (!c.words) { c._rev = (c._rev || 0) + 1; c.thumbRev = null; } });
    saveProject(); endJob(); renderTranscript();
    snack(`Transkript hazır: ${tr.words.length.toLocaleString('tr-TR')} kelime`);
    return true;
  } catch (e) {
    if (e.name === 'AbortError') return false;
    console.error(e); endJob();
    $('.pl-step[data-step="transcript"]').classList.add('err');
    snack('Yazıya dökme başarısız: ' + e.message, { err: true });
    return false;
  }
}

$('#subInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const tr = parseSubtitleFile(await f.text(), f.name);
    tr._v = Date.now();
    S.project.transcript = tr;
    S.project.clips.forEach(c => { if (!c.words) { c._rev = (c._rev || 0) + 1; c.thumbRev = null; } });
    saveProject(); renderPipeline(); renderTranscript();
    snack(`${tr.segments.length} altyazı satırı içe aktarıldı`);
  } catch (err) { snack('Dosya okunamadı: ' + err.message, { err: true }); }
});

$('#aiBtn').addEventListener('click', runAI);
async function runAI() {
  const prov = S.settings.llmProvider;
  if (!hasKey(prov)) {
    snack(`AI analizi için ${LLM_PROVIDERS[prov].label} anahtarı ekle ya da anahtarsız "Sesten" seçeneğini kullan.`, { action: 'Kurulum rehberi', onAction: () => openGuide(1) });
    return;
  }
  if (!S.project.transcript) {
    if (!hasSttKey()) {
      snack('Önce transkript gerekli. Yazıya dökme anahtarı ekle veya SRT dosyası içe aktar.', { action: 'Kurulum rehberi', onAction: () => openGuide(3) });
      return;
    }
    if (!(await runTranscribe())) return;
  }
  const signal = startJob('ai');
  setProgress(0.15, 'AI en iyi anları arıyor', true);
  try {
    const q = $('#aiQuery').value.trim();
    const st = q ? { ...S.settings, customPrompt: [S.settings.customPrompt, `Kullanıcı özellikle şunu arıyor: "${q}". Yalnızca buna gerçekten uyan anları seç; uyan an azsa daha az klip döndür.`].filter(Boolean).join('\n') } : S.settings;
    const found = await analyzeClips(S.project, st, (p, l) => setProgress(0.15 + p * 0.8, l, true), signal);
    if (signal.aborted) return;
    if (!found.length) throw new Error('AI uygun klip bulamadı. Klip süresi aralığını genişletmeyi dene.');
    const added = replaceAuto(q ? 'ai-q' : 'ai', found);
    endJob();
    if (document.body.classList.contains('m')) setMTab('clips');
    snack(`${added} klip bulundu`);
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error(e); endJob();
    $('.pl-step[data-step="ai"]').classList.add('err');
    snack('AI analizi başarısız: ' + e.message, { err: true });
  }
}

$('#hypeBtn').addEventListener('click', async () => {
  if (!S.project.energy?.length) { await runAudio(); if (!S.project.energy?.length) return; }
  const { clipMin, clipMax, clipCount } = S.settings;
  let found = findHypeMoments(hypeSignal(), S.project.video.duration, { min: clipMin, max: clipMax, count: clipCount });
  const words = S.project.transcript?.words;
  if (words?.length) found = found.map(c => {
    // cümle sınırlarına yasla ve başlığı metinden üret
    const ws = words.find(w => w.s >= c.start - 1.5);
    const we = [...words].reverse().find(w => w.e <= c.end + 1.5);
    const start = ws && Math.abs(ws.s - c.start) < 3 ? ws.s - 0.08 : c.start;
    const end = we && Math.abs(we.e - c.end) < 3 ? we.e + 0.2 : c.end;
    return { ...c, start, end, title: titleFromWords(start, end) };
  });
  if (!found.length) return snack('Belirgin bir ses tepkisi bulunamadı.');
  const added = replaceAuto('hype', found);
  if (added && document.body.classList.contains('m')) setMTab('clips');
  snack(added ? `Ses tepkilerinden ${added} yeni hype anı eklendi` : 'Ses tepkisi olan anlar zaten mevcut kliplerinde var.');
});

/** Aynı kaynaktan gelen ama hiç dokunulmamış eski klipleri yenileriyle değiştir */
function replaceAuto(source, found) {
  S.project.clips = S.project.clips.filter(c => c.source !== source || c.touched || c.exported);
  let added = 0;
  for (const f of found) {
    const near = S.project.clips.filter(c => !c.segments && overlapRatio(c, f) > 0.6);
    // karşılaştırma açıksa aynı ana ait farklı kesimler aday olarak saklanır (an başına en fazla 3)
    if (near.length && (!feat('compare') || near.length >= 3 || near.some(c => Math.abs(c.start - f.start) < 1.5 && Math.abs(c.end - f.end) < 1.5))) continue;
    const design = S.settings.hookAuto === false ? { hookStyle: undefined, hookEmoji: '' } : (f.hookStyle ? { hookStyle: f.hookStyle, hookEmoji: f.hookEmoji || '' } : autoHookStyle(f.category));
    addClip({ ...f, ...design, source }, false); added++;
  }
  saveProject(); renderPipeline(); renderClips(); drawHype(); queueThumbs(); markClipSegments();
  return added;
}
const overlapRatio = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) / Math.min(a.end - a.start, b.end - b.start);

// ------------------------------------------------------------------ KLİPLER
function addClip(partial, render = true) {
  const p = S.project;
  const lastStyle = p.lastCaption ? structuredClone(p.lastCaption) : defaultCaptionStyle('punch');
  const clip = {
    id: uid(), start: 0, end: 30, title: 'Klip', hook: '', score: null, reason: '', category: '', description: '', hashtags: [], emphasis: [],
    layout: p.regions?.hasCam === false ? 'fill' : (p.lastLayout || 'split'),
    splitRatio: 0.4, swap: false, zoom: 1, focusX: 0.5, focusY: 0.5, pipPos: 'tr', pipSize: 0.42,
    caption: lastStyle, captionsOn: true,
    hookOn: true, hookStyle: 'card', hookDur: 3.2, hookY: 0.14,
    progressOn: false, watermark: S.settings.brandHandle || '', accent: '#FF7A45', jumpcut: false, autoZoom: true, autoZoomAmt: 0.12, sfx: false, sfxVol: 0.5, music: null,
    words: null, source: 'manual', createdAt: Date.now(), logo: p.lastLogo ? { ...p.lastLogo } : null, ratio: p.lastRatio || '9:16',
    ...partial
  };
  if (!clip.hook && clip.title && clip.source !== 'manual') clip.hook = clip.title;
  clip.start = clamp(clip.start, 0, p.video.duration || clip.end);
  clip.end = clamp(clip.end, clip.start + 1, p.video.duration || clip.end);
  p.clips.push(clip);
  if (render) { saveProject(); renderPipeline(); renderClips(); drawHype(); queueThumbs(); }
  return clip;
}

function sortedClips() {
  const cs = [...S.project.clips];
  return S.sort === 'time' ? cs.sort((a, b) => a.start - b.start) : cs.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.start - b.start);
}

$$('.clips-head .seg button').forEach(b => b.addEventListener('click', () => {
  $$('.clips-head .seg button').forEach(x => x.classList.toggle('on', x === b));
  S.sort = b.dataset.sort; renderClips();
}));

/** Aynı ana ait (yarıdan fazlası örtüşen) klipleri gruplar; ilk öğe grubun öne çıkanıdır */
function clipGroups(list) {
  const groups = [], seen = new Set();
  for (const c of list) {
    if (seen.has(c.id)) continue;
    const g = [c]; seen.add(c.id);
    if (!c.segments) for (const o of list) if (!seen.has(o.id) && !o.segments && g.some(x => overlapRatio(x, o) > 0.5)) { g.push(o); seen.add(o.id); }
    g.sort((a, b) => (b.touched || b.exported ? 1 : 0) - (a.touched || a.exported ? 1 : 0) || (b.score ?? -1) - (a.score ?? -1));
    groups.push(g);
  }
  return groups;
}
function renderClips() {
  const list = sortedClips();
  $('#clipCount').textContent = list.length;
  $('#mClipBadge').hidden = !list.length; $('#mClipBadge').textContent = list.length;
  $('#montageBtn').hidden = list.filter(c => !c.segments).length < 2;
  $('#clipsEmpty').hidden = list.length > 0;
  const cmp = feat('compare');
  const groups = cmp ? clipGroups(list) : list.map(c => [c]);
  $('#clipList').innerHTML = groups.map(g => {
    const c = g[0], alts = g.length - 1, open = cmp && S.cmpOpen === c.id;
    const d = c.segments?.length ? c.segments.reduce((a, [x, y]) => a + (y - x), 0) : c.end - c.start;
    const sc = c.score == null ? '' : `<span class="score ${c.score >= 80 ? 'hi' : c.score >= 60 ? 'mid' : ''}" title="Viral potansiyel puanı">${c.score}</span>`;
    return `<li class="clip ${S.ed?.clip.id === c.id ? 'active' : ''}" data-id="${c.id}" tabindex="0">
      <div class="clip-thumb" style="${c.thumb ? `background-image:url(${c.thumb})` : ''}"><span class="dur">${fmtTime(d)}</span></div>
      <div class="clip-body">
        <div class="clip-top">${sc}${c.segments ? `<span class="clip-montage">Montaj, ${c.segments.length} parça</span>` : ''}<span class="clip-cat">${escapeHtml(c.category || (c.source === 'hype' ? 'ses tepkisi' : c.source === 'manual' ? 'elle seçildi' : ''))}</span></div>
        <div class="clip-title">${escapeHtml(c.title)}</div>
        ${c.reason ? `<div class="clip-reason">${escapeHtml(c.reason)}</div>` : ''}
        <div class="clip-foot">
          <span class="tc">${fmtTime(c.start)}–${fmtTime(c.end)}</span>
          ${c.exported ? `<span class="clip-status"><svg class="ic"><use href="#i-check"/></svg>Aktarıldı</span>` : ''}
          ${cmp && !c.segments ? `<button class="btn ${alts ? 'tonal' : 'text'} sm cmp-btn ${open ? 'on' : ''}" data-act="cmp" aria-expanded="${open}" aria-label="Sürümleri karşılaştır" title="Sürümleri karşılaştır"><svg class="ic"><use href="#i-layers"/></svg>${alts ? `<span>${alts + 1} aday</span>` : ''}</button>` : ''}
          <button class="btn icon sm" data-act="play" aria-label="Kaynakta oynat" title="Kaynakta oynat"><svg class="ic"><use href="#i-play"/></svg></button>
          <button class="btn icon sm" data-act="export" aria-label="Dışa aktar" title="Dışa aktar"><svg class="ic"><use href="#i-download"/></svg></button>
          <button class="btn icon sm" data-act="del" aria-label="Klibi sil" title="Sil"><svg class="ic"><use href="#i-trash"/></svg></button>
        </div>
      </div>
      ${open ? comparePanel(c, g) : ''}
    </li>`;
  }).join('');
  if (cmp && S.cmpOpen) drawCmpTimeline();
  renderPipeline();
}

$('#clipList').addEventListener('click', e => {
  const li = e.target.closest('.clip'); if (!li) return;
  const clip = S.project.clips.find(c => c.id === li.dataset.id); if (!clip) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'play') {
    if (document.body.classList.contains('m')) setMTab('video');
    mainVideo.currentTime = clip.start; S.previewEnd = clip.end; mainVideo.play(); return;
  }
  if (act === 'export') { enqueue([clip]); return; }
  if (act === 'cmp') { S.cmpOpen = S.cmpOpen === clip.id ? null : clip.id; renderClips(); return; }
  if (e.target.closest('.cmp')) { compareAction(e, clip); return; }
  if (act === 'del') {
    const idx = S.project.clips.indexOf(clip);
    S.project.clips.splice(idx, 1);
    saveProject(); renderClips(); drawHype();
    snack('Klip silindi', { action: 'Geri al', onAction: () => { S.project.clips.splice(idx, 0, clip); saveProject(); renderClips(); drawHype(); } });
    return;
  }
  openEditor(clip.id);
});
$('#clipList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('clip')) openEditor(e.target.dataset.id); });

// --- aday karşılaştırma ---
/** Klip içindeki işaretler: konuşmanın başladığı yer, ses zirvesi, sohbet zirvesi */
function clipMarks(c) {
  const p = S.project, out = [];
  const segs = p.transcript?.segments || [];
  const sp = segs.find(s => s.end > c.start - 0.2 && s.start < c.end);
  if (sp) out.push({ kind: 'speech', t: Math.max(c.start - 15, sp.start), label: 'Konuşma başlıyor' });
  const peakIn = (arr, lag = 0) => {
    if (!arr?.length) return null;
    let best = -1, bi = -1;
    for (let i = Math.max(0, Math.floor(c.start / HOP)); i < Math.min(arr.length, Math.ceil(c.end / HOP)); i++) if (arr[i] > best) { best = arr[i]; bi = i; }
    return bi < 0 || best < 0.2 ? null : bi * HOP - lag;
  };
  const e = peakIn(p.energy); if (e != null) out.push({ kind: 'peak', t: e, label: 'Ses zirvesi' });
  const ch = peakIn(p.chat); if (ch != null) out.push({ kind: 'chat', t: ch, label: 'Sohbet zirvesi' });
  return out.sort((a, b) => a.t - b.t);
}
const snapStart = t => { const w = S.project.transcript?.words; if (!w?.length) return t; const x = w.find(v => v.e > t); return x && Math.abs(x.s - t) < 2 ? Math.max(0, x.s - 0.08) : t; };
const snapEnd = t => { const w = S.project.transcript?.words; if (!w?.length) return t; let x = null; for (const v of w) { if (v.s < t) x = v; else break; } return x && Math.abs(x.e - t) < 2 ? x.e + 0.2 : t; };
/** Aynı an için üç kesim önerisi: sıkı, mevcut, bağlamlı */
function clipVersions(c) {
  const D = S.project.video.duration, { clipMin, clipMax } = S.settings;
  const base = c.orig || { start: c.start, end: c.end };
  const peak = clipMarks(c).find(m => m.kind === 'peak')?.t ?? (base.start + base.end) / 2;
  const dur = base.end - base.start;
  const tightLen = clamp(dur * 0.6, Math.min(clipMin, dur), dur);
  let ts = clamp(peak - tightLen * 0.55, base.start, base.end - tightLen);
  const tight = { start: snapStart(ts), end: Math.min(base.end, snapEnd(ts + tightLen)) };
  // bağlam: önceki cümlenin başına kadar geri git (en fazla 10 sn), azami süreyi aşma
  const segs = S.project.transcript?.segments || [];
  let cs = Math.max(0, base.start - 6);
  const prev = [...segs].reverse().find(s => s.start < base.start - 2 && s.start >= base.start - 10);
  if (prev) cs = prev.start - 0.08;
  const ctx = { start: Math.max(0, cs), end: Math.min(D, Math.max(base.end, Math.max(0, cs) + Math.min(clipMax, dur + 6))) };
  if (ctx.end - ctx.start > clipMax) ctx.end = ctx.start + clipMax;
  return [
    { id: 'tight', label: 'Sıkı', hint: 'Zirveye odaklı', ...tight },
    { id: 'orig', label: 'Asıl', hint: 'Bulunan kesim', ...base },
    { id: 'ctx', label: 'Bağlamlı', hint: 'Öncesiyle birlikte', ...ctx }
  ].filter((v, i, a) => v.end - v.start >= 3 && a.findIndex(x => Math.abs(x.start - v.start) < 0.5 && Math.abs(x.end - v.end) < 0.5) === i);
}
function comparePanel(c, g) {
  const vs = clipVersions(c), marks = clipMarks(c);
  const cur = v => Math.abs(v.start - c.start) < 0.3 && Math.abs(v.end - c.end) < 0.3;
  const markBtn = m => `<button class="cmp-mark ${m.kind}" data-cmp="seek" data-t="${m.t.toFixed(2)}" title="${m.label}, ${fmtTime(m.t)}"><i></i>${m.label} <b>${fmtTime(m.t)}</b></button>`;
  return `<div class="cmp" role="group" aria-label="Sürümleri karşılaştır">
    <canvas class="cmp-tl" height="44" aria-hidden="true"></canvas>
    ${marks.length ? `<div class="cmp-marks">${marks.map(markBtn).join('')}</div>` : '<p class="hint">İşaret için transkript, ses analizi veya sohbet dökümü gerekli.</p>'}
    <div class="cmp-vers">${vs.map(v => `<div class="cmp-ver ${cur(v) ? 'on' : ''}">
      <span class="cv-l"><b>${v.label}</b><small>${v.hint}, ${fmtTime(v.end - v.start)}</small></span>
      <button class="btn icon sm" data-cmp="play" data-s="${v.start.toFixed(2)}" data-e="${v.end.toFixed(2)}" aria-label="${v.label} sürümünü dinle" title="Dinle"><svg class="ic"><use href="#i-play"/></svg></button>
      <button class="btn ${cur(v) ? 'filled' : 'tonal'} sm" data-cmp="pick" data-s="${v.start.toFixed(2)}" data-e="${v.end.toFixed(2)}" ${cur(v) ? 'disabled' : ''}>${cur(v) ? 'Seçili' : 'Seç'}</button>
    </div>`).join('')}</div>
    <div class="cmp-nudge"><span class="muted sm">Başlangıç</span>
      <button class="btn text sm" data-cmp="nudge" data-d="-2">−2 sn</button><button class="btn text sm" data-cmp="nudge" data-d="-0.5">−0,5</button>
      <button class="btn text sm" data-cmp="nudge" data-d="0.5">+0,5</button><button class="btn text sm" data-cmp="nudge" data-d="2">+2 sn</button>
      ${c.orig ? '<button class="btn text sm" data-cmp="reset">Asla dön</button>' : ''}</div>
    ${g.length > 1 ? `<div class="cmp-alts"><span class="muted sm">Bu anın diğer adayları</span>${g.slice(1).map(o => `<div class="cmp-alt">
      <span class="cv-l"><b>${escapeHtml(o.title)}</b><small>${fmtTime(o.start)}–${fmtTime(o.end)}${o.score != null ? `, puan ${o.score}` : ''}</small></span>
      <button class="btn icon sm" data-cmp="play" data-s="${o.start.toFixed(2)}" data-e="${o.end.toFixed(2)}" aria-label="Dinle" title="Dinle"><svg class="ic"><use href="#i-play"/></svg></button>
      <button class="btn tonal sm" data-cmp="keep" data-id="${o.id}">Bunu seç</button></div>`).join('')}</div>` : ''}
  </div>`;
}
function drawCmpTimeline() {
  const cv = $('#clipList .cmp-tl'); if (!cv) return;
  const c = S.project.clips.find(x => x.id === S.cmpOpen); if (!c) return;
  const w = cv.clientWidth || 260, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = w * dpr; cv.height = 44 * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const vs = clipVersions(c);
  const a = Math.max(0, Math.min(c.start, ...vs.map(v => v.start)) - 4), b = Math.min(S.project.video.duration, Math.max(c.end, ...vs.map(v => v.end)) + 4);
  const X = t => (t - a) / (b - a) * w;
  const sig = hypeSignal();
  g.fillStyle = withAlpha(cssVar('--text'), .18);
  if (sig?.length) for (let x = 0; x < w; x += 2) { const v = sig[Math.floor((a + (x / w) * (b - a)) / HOP)] || 0; g.fillRect(x, 30 - v * 22, 1.5, v * 22 + 1); }
  g.fillStyle = withAlpha(cssVar('--primary'), .22); g.fillRect(X(c.start), 2, X(c.end) - X(c.start), 30);
  g.fillStyle = cssVar('--primary'); g.fillRect(X(c.start), 2, 2, 30); g.fillRect(X(c.end) - 2, 2, 2, 30);
  const col = { speech: cssVar('--text-2'), peak: cssVar('--primary'), chat: '#F5C542' };
  for (const m of clipMarks(c)) { g.fillStyle = col[m.kind]; g.beginPath(); g.moveTo(X(m.t) - 5, 42); g.lineTo(X(m.t) + 5, 42); g.lineTo(X(m.t), 34); g.fill(); }
}
function playRange(s, e) {
  if (document.body.classList.contains('m')) setMTab('video');
  mainVideo.currentTime = s; S.previewEnd = e; mainVideo.play();
}
function compareAction(e, clip) {
  const b = e.target.closest('[data-cmp]'); if (!b) return;
  const k = b.dataset.cmp;
  if (k === 'seek') { const t = +b.dataset.t; playRange(Math.max(0, t - 1), Math.min(S.project.video.duration, t + 6)); return; }
  if (k === 'play') { playRange(+b.dataset.s, +b.dataset.e); return; }
  const apply = (s, en) => {
    clip.orig ||= { start: clip.start, end: clip.end };
    clip.start = clamp(s, 0, clip.end - 1); clip.end = clamp(en, clip.start + 1, S.project.video.duration);
    clip.touched = true; clip._rev = (clip._rev || 0) + 1; clip.thumbRev = null;
    saveProject(); renderClips(); drawHype(); queueThumbs();
  };
  if (k === 'pick') { apply(+b.dataset.s, +b.dataset.e); playRange(clip.start, clip.end); }
  else if (k === 'nudge') { apply(clip.start + +b.dataset.d, clip.end); playRange(clip.start, Math.min(clip.end, clip.start + 5)); }
  else if (k === 'reset') { const o = clip.orig; delete clip.orig; apply(o.start, o.end); delete clip.orig; saveProject(); }
  else if (k === 'keep') {
    const keep = S.project.clips.find(c => c.id === b.dataset.id); if (!keep) return;
    const group = clipGroups(sortedClips()).find(g => g.includes(keep)) || [];
    const removed = group.filter(c => c !== keep);
    const before = [...S.project.clips];
    S.project.clips = S.project.clips.filter(c => !removed.includes(c));
    keep.touched = true; S.cmpOpen = null;
    saveProject(); renderClips(); drawHype();
    snack(`Seçildi, ${removed.length} aday kaldırıldı`, { action: 'Geri al', onAction: () => { S.project.clips = before; saveProject(); renderClips(); drawHype(); } });
  }
}

// --- küçük resimler (9:16 kompozit) ---
const thumbVideo = document.createElement('video');
thumbVideo.muted = true; thumbVideo.preload = 'auto'; thumbVideo.playsInline = true;
const thumbCanvas = document.createElement('canvas'); thumbCanvas.width = 180; thumbCanvas.height = 320;
const thumbComp = new Compositor(thumbCanvas);
let thumbBusy = false;
async function queueThumbs() {
  if (thumbBusy || !S.file || !S.project) return;
  thumbBusy = true;
  try {
    if (thumbVideo.readyState < 1) await new Promise(r => thumbVideo.addEventListener('loadedmetadata', r, { once: true }));
    for (;;) {
      const c = S.project?.clips.find(c => !c.thumb || c.thumbRev !== thumbKey(c));
      if (!c) break;
      const t = c.start + Math.min(2.5, (c.end - c.start) / 3);
      await new Promise(r => { thumbVideo.addEventListener('seeked', r, { once: true }); thumbVideo.currentTime = t; });
      await sleep(30);
      thumbCanvas.height = Math.round(180 * ratioH(c.ratio));
      thumbComp.draw(thumbVideo, { ...c, hookOn: false, progressOn: false, watermark: '' }, S.project, t, 0);
      c.thumb = thumbCanvas.toDataURL('image/jpeg', 0.72);
      c.thumbRev = thumbKey(c);
      const el = $(`.clip[data-id="${c.id}"] .clip-thumb`);
      if (el) el.style.backgroundImage = `url(${c.thumb})`;
    }
    saveProject();
  } catch (e) { console.warn('Küçük resim', e); }
  thumbBusy = false;
}
const thumbKey = c => [c.start.toFixed(1), c.ratio, c.track, c.layout, c.splitRatio, c.swap, c.zoom, c.focusX, c.focusY, c.pipPos, c.caption?.preset, c.captionsOn, JSON.stringify(S.project.regions)].join('|');

// ------------------------------------------------------------------ TRANSKRİPT
function renderTranscript() {
  const tr = S.project.transcript;
  const body = $('#txBody');
  $('#txEmpty').hidden = !!tr;
  body.querySelectorAll('.tx-seg').forEach(n => n.remove());
  if (!tr) return;
  const words = tr.words;
  const segs = tr.segments?.length ? tr.segments : [];
  const groups = [];
  let wi = 0;
  if (segs.length) {
    for (let si = 0; si < segs.length; si++) {
      const end = si < segs.length - 1 ? segs[si + 1].start : Infinity;
      const g = [];
      while (wi < words.length && words[wi].s < end - 0.01) g.push(wi++);
      if (g.length) groups.push(g);
    }
    if (wi < words.length) groups.push(words.slice(wi).map((_, k) => wi + k));
  } else {
    for (let i = 0; i < words.length; i += 24) groups.push(Array.from({ length: Math.min(24, words.length - i) }, (_, k) => i + k));
  }
  const html = groups.map(g => `<div class="tx-seg" data-s="${+words[g[0]].s || 0}" data-e="${+words[g[g.length - 1]].e || 0}"><span class="ts" data-t="${+words[g[0]].s || 0}">${fmtTime(words[g[0]].s)}</span><p>${g.map(i => `<span class="w" data-i="${i}">${escapeHtml(words[i].w)}</span>`).join(' ')}</p></div>`).join('');
  body.insertAdjacentHTML('beforeend', html);
  S.curWordEl = null;
  markClipSegments();
  runSearch();
}

function markClipSegments() {
  const clips = S.project.clips;
  $$('#txBody .tx-seg').forEach(el => {
    const s = +el.dataset.s, e = +el.dataset.e;
    el.classList.toggle('in-clip', clips.some(c => (c.segments || [[c.start, c.end]]).some(([a, b]) => s < b && e > a)));
  });
}

function wordIndexAt(t) {
  const ws = S.project?.transcript?.words; if (!ws?.length) return -1;
  let lo = 0, hi = ws.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ws[m].s <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}

function highlightWord(force) {
  if (!S.project?.transcript) return;
  const i = wordIndexAt(mainVideo.currentTime);
  if (i === S.curWordIdx && !force) return;
  S.curWordIdx = i;
  S.curWordEl?.classList.remove('cur');
  S.curSegEl?.classList.remove('on');
  const el = i >= 0 ? $(`#txBody .w[data-i="${i}"]`) : null;
  S.curWordEl = el;
  if (!el) return;
  el.classList.add('cur');
  S.curSegEl = el.closest('.tx-seg'); S.curSegEl?.classList.add('on');
  if ($('#txFollow').checked && (!mainVideo.paused || force)) {
    const body = $('#txBody'), r = el.getBoundingClientRect(), br = body.getBoundingClientRect();
    if (r.top < br.top + 20 || r.bottom > br.bottom - 40) body.scrollTo({ top: body.scrollTop + (r.top - br.top) - br.height / 3, behavior: mainVideo.paused ? 'auto' : 'smooth' });
  }
}

$('#txBody').addEventListener('click', e => {
  const w = e.target.closest('.w'), ts = e.target.closest('.ts');
  if (window.getSelection()?.toString().trim()) return;
  if (w) mainVideo.currentTime = S.project.transcript.words[+w.dataset.i].s;
  else if (ts) mainVideo.currentTime = +ts.dataset.t;
});

// seçimden klip
document.addEventListener('selectionchange', debounce(() => {
  const btn = $('#selClip');
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !S.project?.transcript || !$('#txBody').contains(sel.anchorNode)) { btn.hidden = true; return; }
  const elOf = n => (n.nodeType === 3 ? n.parentElement : n)?.closest?.('.w');
  let a = elOf(sel.anchorNode), b = elOf(sel.focusNode);
  const range = sel.getRangeAt(0);
  if (!a || !b) {
    const spans = $$('#txBody .w').filter(s => range.intersectsNode(s));
    a = spans[0]; b = spans[spans.length - 1];
  }
  if (!a || !b) { btn.hidden = true; return; }
  const i0 = Math.min(+a.dataset.i, +b.dataset.i), i1 = Math.max(+a.dataset.i, +b.dataset.i);
  const ws = S.project.transcript.words;
  const s = Math.max(0, ws[i0].s - 0.1), en = ws[i1].e + 0.25;
  if (en - s < 1) { btn.hidden = true; return; }
  const rect = range.getBoundingClientRect(), host = $('.tx').getBoundingClientRect();
  btn.style.left = clamp(rect.left - host.left + rect.width / 2 - 90, 8, host.width - 200) + 'px';
  btn.style.top = (rect.bottom - host.top + 8) + 'px';
  btn.lastChild.textContent = `Seçimden klip yap (${Math.round(en - s)} sn)`;
  btn.dataset.s = s; btn.dataset.e = en;
  btn.hidden = false;
}, 120));
$('#selClip').addEventListener('mousedown', e => e.preventDefault());
$('#selClip').addEventListener('click', e => {
  const b = e.currentTarget;
  const c = addClip({ start: +b.dataset.s, end: +b.dataset.e, title: titleFromWords(+b.dataset.s, +b.dataset.e), source: 'manual' });
  window.getSelection().removeAllRanges(); b.hidden = true;
  markClipSegments();
  snack('Seçimden klip oluşturuldu', { action: 'Düzenle', onAction: () => openEditor(c.id) });
});

// arama
let hits = [], hitIdx = -1;
function runSearch() {
  const q = $('#txSearch').value.trim().toLocaleLowerCase('tr-TR');
  $$('#txBody .w.hit').forEach(x => x.classList.remove('hit'));
  hits = []; hitIdx = -1;
  if (!q || !S.project?.transcript) { $('#txCount').textContent = ''; return; }
  const toks = q.split(/\s+/);
  const ws = S.project.transcript.words;
  for (let i = 0; i < ws.length; i++) {
    let ok = true;
    for (let k = 0; k < toks.length; k++) {
      const w = ws[i + k]; if (!w || !w.w.toLocaleLowerCase('tr-TR').includes(toks[k])) { ok = false; break; }
    }
    if (ok) { hits.push(i); for (let k = 0; k < toks.length; k++) $(`#txBody .w[data-i="${i + k}"]`)?.classList.add('hit'); }
  }
  $('#txCount').textContent = hits.length ? `${hits.length} sonuç` : 'Sonuç yok';
}
$('#txSearch').addEventListener('input', debounce(runSearch, 200));
$('#txSearch').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !hits.length) return;
  hitIdx = (hitIdx + (e.shiftKey ? -1 : 1) + hits.length) % hits.length;
  const el = $(`#txBody .w[data-i="${hits[hitIdx]}"]`);
  el?.scrollIntoView({ block: 'center' });
  mainVideo.currentTime = S.project.transcript.words[hits[hitIdx]].s;
  $('#txCount').textContent = `${hitIdx + 1} / ${hits.length}`;
});

// ------------------------------------------------------------------ KADRAJ
const framing = { regions: null, hasCam: true };
function openFraming(first = false) {
  if (!S.file || !mainVideo.videoWidth) { if (!first) snack('Önce video yüklenmeli.'); return; }
  const dlg = $('#framingDlg');
  const r = S.project.regions || {};
  framing.regions = { cam: { ...(r.cam || DEFAULT_REGIONS.cam) }, content: { ...(r.content || DEFAULT_REGIONS.content) } };
  framing.hasCam = r.hasCam !== false;
  $('#hasCam').checked = framing.hasCam;
  $('#frameApplyAll').closest('label').hidden = !S.project.clips.length;
  const sc = $('#frameScrub');
  sc.value = (mainVideo.currentTime || mainVideo.duration * 0.1) / mainVideo.duration; fillRange(sc);
  if (!mainVideo.currentTime) mainVideo.currentTime = mainVideo.duration * 0.1;
  dlg.showModal();
  requestAnimationFrame(() => { drawFrame(); layoutBoxes(); });
}
$('#framingBtn').addEventListener('click', () => openFraming());
$('#framingFromEd').addEventListener('click', () => openFraming());
$('#framingDlg [data-close]').addEventListener('click', () => $('#framingDlg').close());

function drawFrame() {
  const c = $('#frameCanvas');
  const vw = mainVideo.videoWidth, vh = mainVideo.videoHeight;
  const scale = Math.min(1, 1280 / vw);
  c.width = Math.round(vw * scale); c.height = Math.round(vh * scale);
  c.getContext('2d').drawImage(mainVideo, 0, 0, c.width, c.height);
  drawFramePreview();
}
function drawFramePreview() {
  const cv = $('#framePrev');
  const comp = (drawFramePreview.comp ||= new Compositor(cv));
  const fake = { id: 'fp', layout: framing.hasCam ? 'split' : 'fill', splitRatio: 0.4, captionsOn: false, hookOn: false, accent: '#FFC15A', start: 0, end: 1 };
  comp.draw(mainVideo, fake, { regions: { ...framing.regions, hasCam: framing.hasCam } }, 0, 0);
}
function layoutBoxes() {
  for (const k of ['cam', 'content']) {
    const el = k === 'cam' ? $('#boxCam') : $('#boxContent');
    const r = framing.regions[k];
    Object.assign(el.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
  }
  $('#boxCam').classList.toggle('off', !framing.hasCam);
}
$('#hasCam').addEventListener('change', e => { framing.hasCam = e.target.checked; layoutBoxes(); drawFramePreview(); });
$('#frameScrub').addEventListener('input', e => { mainVideo.currentTime = +e.target.value * mainVideo.duration; });
mainVideo.addEventListener('seeked', () => { if ($('#framingDlg').open) drawFrame(); });
$('#frameReset').addEventListener('click', () => { framing.regions = structuredClone(DEFAULT_REGIONS); layoutBoxes(); drawFramePreview(); });

(() => {
  const stage = $('#frameStage');
  let drag = null;
  stage.addEventListener('pointerdown', e => {
    const box = e.target.closest('.fbox'); if (!box) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const h = e.target.classList.contains('fh') ? [...e.target.classList].find(c => c !== 'fh') : null;
    drag = { key: box.dataset.box, handle: h, x: e.clientX, y: e.clientY, r0: { ...framing.regions[box.dataset.box] } };
    // facecam, içerik kutusunun üstünde kalsın
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const rect = stage.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / rect.width, dy = (e.clientY - drag.y) / rect.height;
    const r = { ...drag.r0 }, min = 0.05;
    if (!drag.handle) { r.x = clamp(r.x + dx, 0, 1 - r.w); r.y = clamp(r.y + dy, 0, 1 - r.h); }
    else {
      if (drag.handle.includes('l')) { const nx = clamp(r.x + dx, 0, r.x + r.w - min); r.w += r.x - nx; r.x = nx; }
      if (drag.handle.includes('r')) r.w = clamp(r.w + dx, min, 1 - r.x);
      if (drag.handle.includes('t')) { const ny = clamp(r.y + dy, 0, r.y + r.h - min); r.h += r.y - ny; r.y = ny; }
      if (drag.handle.includes('b')) r.h = clamp(r.h + dy, min, 1 - r.y);
    }
    framing.regions[drag.key] = r;
    layoutBoxes(); drawFramePreview();
  });
  const end = () => { drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
})();

$('#frameSave').addEventListener('click', () => {
  const p = S.project;
  const wasCam = p.regions?.hasCam !== false;
  p.regions = { ...framing.regions, hasCam: framing.hasCam };
  p.framed = true;
  if ($('#frameApplyAll').checked || !p.clips.length) {
    for (const c of p.clips) {
      delete c.regions;
      if (!framing.hasCam && ['split', 'split3', 'pip', 'cam'].includes(c.layout)) c.layout = 'fill';
      if (framing.hasCam && !wasCam && c.layout === 'fill') c.layout = 'split';
    }
  }
  p.lastLayout = framing.hasCam ? 'split' : 'fill';
  saveProject();
  $('#framingDlg').close();
  queueThumbs();
  if (S.ed) syncInspector();
  snack('Kadraj kaydedildi');
});

// ------------------------------------------------------------------ EDİTÖR
const edCanvas = $('#edCanvas');
const edComp = new Compositor(edCanvas);

function openEditor(id) {
  const clip = S.project.clips.find(c => c.id === id);
  if (!clip) return;
  if (!S.file) return snack('Önce videoyu yeniden seç.', { err: true });
  mainVideo.pause();
  S.ed = { clip, variant: 'base', ranges: rangesFor(clip, S.project), hist: { undo: [], redo: [], last: snapshot(clip), timer: null } };
  updateUndoBtns();
  S.ed.words = clipWords(clip, S.project.transcript);
  S.ed.events = sfxEvents(clip, S.ed.words, S.ed.ranges);
  S.ed.lastT = -1;
  setupPreviewMusic();
  if (clip.logo) ensureLogo(clip.logo.id).then(() => S.ed && syncInspector());
  if (clip.cleanAudio || previewSrc) routePreviewAudio(!!clip.cleanAudio);
  show('editor');
  $('#editor').hidden = false;
  setupTrimWindow();
  syncInspector();
  // teaser varsa ilk çıktı parçasından başla
  S.ed.seg = 0;
  edVideo.currentTime = S.ed.ranges[0]?.[0] ?? clip.start;
  edVideo.muted = !!S.settings.edMuted;
  setMuteIcon();
  renderClips(); drawHype();
  loadFonts().then(renderPresets);
  cancelAnimationFrame(edRaf);
  edRaf = requestAnimationFrame(edLoop);
}

function closeEditor() {
  if (!S.ed) return;
  cancelAnimationFrame(edRaf); edRaf = 0;
  edVideo.pause();
  disposePreviewMusic();
  S.project.lastCaption = structuredClone(S.ed.clip.caption);
  S.project.lastLayout = S.ed.clip.layout;
  S.ed = null;
  $('#editor').hidden = true;
  show('workspace');
  saveProject(); renderClips(); drawHype(); markClipSegments(); queueThumbs();
}
$('#edBack').addEventListener('click', closeEditor);

function edNav(dir) {
  const list = sortedClips();
  const i = list.findIndex(c => c.id === S.ed.clip.id);
  const next = list[(i + dir + list.length) % list.length];
  if (next && next !== S.ed.clip) { edVideo.pause(); disposePreviewMusic(); S.project.lastCaption = structuredClone(S.ed.clip.caption); openEditor(next.id); }
}
$('#edPrev').addEventListener('click', () => edNav(-1));
$('#edNext').addEventListener('click', () => edNav(1));
$('#edExport').addEventListener('click', () => enqueue([S.ed.clip]));

function touch(rethumb = true) {
  const c = S.ed.clip;
  scheduleCommit();
  c.touched = true;
  c._rev = (c._rev || 0) + 1;
  S.ed.ranges = rangesFor(c, S.project);
  S.ed.seg = null;
  S.ed.words = clipWords(c, S.project.transcript);
  S.ed.events = sfxEvents(c, S.ed.words, S.ed.ranges);
  if (rethumb) c.thumbRev = null;
  saveProject();
}

let edRaf = 0;
function edLoop() {
  edRaf = 0;
  if (!S.ed) return;
  const c = S.ed.clip;
  const box = edCanvas.parentElement;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.min(1080, Math.round(box.clientWidth * dpr));
  if (w > 0) edComp.setSize(w, Math.round(w * ratioH(c.ratio)));
  let t = edVideo.currentTime;
  const rs = S.ed.ranges;
  if (S.ed.seg == null || !rs[S.ed.seg]) S.ed.seg = segIndexFor(rs, t);
  if (!edVideo.paused && !edVideo.seeking) {
    // parçaları sırayla oynat (jump-cut, dolgu, teaser), sonda dur
    const cur = rs[S.ed.seg];
    if (t < cur[0] - 0.4) S.ed.seg = segIndexFor(rs, t);
    else if (t >= cur[1] - 0.02) {
      if (S.ed.seg + 1 < rs.length) { S.ed.seg++; edVideo.currentTime = rs[S.ed.seg][0]; t = rs[S.ed.seg][0]; }
      else { edVideo.pause(); S.ed.seg = 0; edVideo.currentTime = rs[0][0]; t = rs[0][0]; }
    }
  }
  const prog = progressAtSeq(rs, t, S.ed.seg);
  edComp.draw(edVideo, S.ed.variant && S.ed.variant !== 'base' ? applyVariant(c, S.ed.variant) : c, S.project, t, prog, null, rs);
  if (S.safe && (c.ratio || '9:16') === '9:16') drawSafeZone(edComp.ctx, edCanvas.width, edCanvas.height, S.safe);
  $('#edTc').textContent = `${fmtTime(Math.max(0, prog * outDuration(rs)))} / ${fmtTime(outDuration(rs))}`;
  const win = S.ed.win;
  if (win) $('#trimPlayhead').style.left = ((t - win[0]) / (win[1] - win[0]) * 100) + '%';
  if (!edVideo.paused) {
    highlightChip(t);
    if (c.sfx && !edVideo.muted && S.ed.events?.length) for (const ev of crossed(S.ed.events, S.ed.lastT, t)) playSfx(prevCtx(), prevCtx().destination, ev.type, c.sfxVol ?? 0.5);
    S.ed.lastT = t;
    const m = S.ed.musicEl;
    if (m) { m.muted = edVideo.muted; m.volume = clamp((c.music?.vol ?? 0.18) * (c.music?.duck !== false ? duckFactor(t, S.ed.words, S.project.energy) : 1), 0, 1); }
  }
  edRaf = requestAnimationFrame(edLoop);
}

function edToggle() {
  if (!S.ed) return;
  const c = S.ed.clip;
  if (edVideo.paused) {
    if (edVideo.currentTime < c.start - 0.1 || edVideo.currentTime >= c.end - 0.05) { edVideo.currentTime = S.ed.ranges[0][0]; S.ed.seg = 0; }
    edVideo.play().catch(e => snack('Oynatılamadı: ' + e.message, { err: true }));
  } else edVideo.pause();
}
$('#edPlay').addEventListener('click', edToggle);
$('#edPlayBig').addEventListener('click', edToggle);
edCanvas.addEventListener('click', edToggle);
edVideo.addEventListener('seeked', () => { if (S.ed && !S.ed._internalSeek) { const rs = S.ed.ranges; const cur = rs[S.ed.seg]; if (!cur || edVideo.currentTime < cur[0] - 0.05 || edVideo.currentTime > cur[1] + 0.05) S.ed.seg = segIndexFor(rs, edVideo.currentTime); } });
edVideo.addEventListener('play', () => {
  setPlayIcon('#edPlay', true); $('#edPlayBig').classList.add('hide');
  if (!S.ed) return;
  S.ed.lastT = edVideo.currentTime - 0.001;
  const m = S.ed.musicEl;
  if (m) { const el = progressAtSeq(S.ed.ranges, edVideo.currentTime, S.ed.seg) * outDuration(S.ed.ranges); m.currentTime = isFinite(m.duration) && m.duration ? el % m.duration : el; m.play().catch(() => {}); }
});
edVideo.addEventListener('pause', () => { setPlayIcon('#edPlay', false); $('#edPlayBig').classList.remove('hide'); S.ed?.musicEl?.pause(); });
$('#edMute').addEventListener('click', () => { edVideo.muted = !edVideo.muted; S.settings.edMuted = edVideo.muted; saveSettings(S.settings); setMuteIcon(); });
function setMuteIcon() { $('#edMute use').setAttribute('href', edVideo.muted ? '#i-mute' : '#i-volume'); }

// sekmeler
$$('.inspector .tabs button').forEach(b => b.addEventListener('click', () => {
  $$('.inspector .tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.inspector .tab-panel').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  if (b.dataset.tab === 'words') renderWords();
  if (b.dataset.tab === 'captions') renderPresets();
}));

// --- düzen paneli ---
const P = 'fill:var(--primary-c)', A = 'fill:var(--cut)', B = 'fill:var(--ink-3)';
const LAYOUT_ICONS = {
  split: `<rect x="1" y="1" width="32" height="22" rx="3" style="${A}"/><rect x="1" y="25" width="32" height="34" rx="3" style="${P}"/>`,
  fill: `<rect x="1" y="1" width="32" height="58" rx="3" style="${P}"/>`,
  fit: `<rect x="1" y="1" width="32" height="58" rx="3" style="${B}"/><rect x="1" y="21" width="32" height="18" rx="2" style="${P}"/>`,
  pip: `<rect x="1" y="1" width="32" height="58" rx="3" style="${P}"/><rect x="18" y="6" width="12" height="14" rx="2" style="${A}"/>`,
  cam: `<rect x="1" y="1" width="32" height="58" rx="3" style="${A}"/>`,
  split3: `<rect x="1" y="1" width="32" height="28" rx="3" style="${A}"/><rect x="1" y="31" width="32" height="28" rx="3" style="${P}"/>`
};
function renderLayouts() {
  const c = S.ed.clip, hasCam = S.project.regions?.hasCam !== false;
  $('#layoutGrid').innerHTML = LAYOUTS.filter(l => hasCam || !['split', 'pip', 'cam', 'split3'].includes(l.id)).map(l => `
    <button class="lay ${c.layout === l.id ? 'on' : ''}" data-layout="${l.id}" title="${escapeHtml(l.hint)}">
      <svg viewBox="0 0 34 60" aria-hidden="true">${LAYOUT_ICONS[l.id]}</svg>${escapeHtml(l.label)}
    </button>`).join('');
  $$('[data-panel="layout"] [data-show]').forEach(el => { el.hidden = !el.dataset.show.split(' ').includes(c.layout); });
}
$('#layoutGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-layout]'); if (!b) return;
  S.ed.clip.layout = b.dataset.layout; touch(); renderLayouts();
});

function bindRange(id, key, fmt, rethumb = true) {
  const el = $('#' + id);
  el.addEventListener('input', () => {
    S.ed.clip[key] = +el.value;
    const out = $('#' + id + 'Out'); if (out && fmt) out.textContent = fmt(+el.value);
    touch(rethumb);
  });
}
bindRange('splitRatio', 'splitRatio', v => Math.round(v * 100) + '%');
bindRange('zoom', 'zoom', v => v.toFixed(2) + '×');
bindRange('focusX', 'focusX');
bindRange('focusY', 'focusY');
bindRange('pipSize', 'pipSize');
$('#swap').addEventListener('change', e => { S.ed.clip.swap = e.target.checked; touch(); });
$('#jumpcut').addEventListener('change', e => {
  S.ed.clip.jumpcut = e.target.checked; touch(false); updateTrimInfo();
  if (e.target.checked) {
    const saved = (S.ed.clip.end - S.ed.clip.start) - outDuration(S.ed.ranges);
    snack(saved > 0.3 ? `Sessiz boşluklar kesildi: ${saved.toFixed(1)} sn kısaldı` : 'Kesilecek belirgin bir boşluk yok');
  }
});
$('#pipPos').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.ed.clip.pipPos = b.dataset.v; segOn('#pipPos', b.dataset.v); touch(); });
function segOn(sel, v) { $$(sel + ' button').forEach(x => x.classList.toggle('on', x.dataset.v === String(v))); }
$('#accentSw').innerHTML = ACCENTS.map(c => `<button class="sw" data-c="${c}" style="background:${c}" aria-label="Renk ${c}"></button>`).join('');
$('#accentSw').addEventListener('click', e => {
  const b = e.target.closest('.sw'); if (!b) return;
  S.ed.clip.accent = b.dataset.c; $$('#accentSw .sw').forEach(x => x.classList.toggle('on', x === b)); touch();
});

// --- altyazı paneli ---
$('#capFont').innerHTML = CAPTION_FONTS.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
function cap() { return S.ed.clip.caption; }
$('#capOn').addEventListener('change', e => { S.ed.clip.captionsOn = e.target.checked; touch(); });
$('#capFont').addEventListener('change', e => { cap().font = e.target.value; document.fonts.load(`900 40px "${e.target.value}"`).catch(() => {}); touch(); });
const capRange = (id, key, fmt) => $('#' + id).addEventListener('input', e => {
  cap()[key] = +e.target.value; const o = $('#' + id + 'Out'); if (o) o.textContent = fmt ? fmt(+e.target.value) : e.target.value; touch(key !== 'y');
});
capRange('capSize', 'size');
capRange('capWords', 'maxWords');
capRange('capY', 'y');
capRange('capStrokeW', 'strokeW');
const capColor = (id, key) => $('#' + id).addEventListener('input', e => { cap()[key] = e.target.value; touch(false); });
capColor('capColor', 'color'); capColor('capHi', 'hi'); capColor('capHi2', 'hi2'); capColor('capStroke', 'stroke'); capColor('capBox', 'boxColor');
$('#capAnim').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cap().anim = b.dataset.v; segOn('#capAnim', b.dataset.v); touch(false); });
$('#capUpper').addEventListener('change', e => { cap().upper = e.target.checked; touch(); });
$('#capBig').addEventListener('change', e => { cap().emphBig = e.target.checked; touch(false); if (e.target.checked && !S.ed.clip.emphasis?.length && !clipWords(S.ed.clip, S.project.transcript).some(w => w.emph)) snack('Kinetik vurgu için Metin sekmesinden kelimeleri yıldızla.'); });
$('#capEmoji').addEventListener('change', e => { cap().emoji = e.target.checked; touch(false); });
$('#capApplyAll').addEventListener('click', () => {
  const src = S.ed.clip;
  for (const c of S.project.clips) if (c !== src) {
    c.caption = structuredClone(src.caption); c.captionsOn = src.captionsOn;
    c.layout = src.layout; c.splitRatio = src.splitRatio; c.swap = src.swap; c.accent = src.accent;
    c.hookStyle = src.hookStyle; c.progressOn = src.progressOn; c.watermark = src.watermark; c.jumpcut = src.jumpcut; c.autoZoom = src.autoZoom; c.autoZoomAmt = src.autoZoomAmt;
    c._rev = (c._rev || 0) + 1; c.thumbRev = null;
  }
  S.project.lastCaption = structuredClone(src.caption);
  saveProject();
  snack(`Stil ${S.project.clips.length - 1} klibe uygulandı`);
});

function renderPresets() {
  if (!S.ed) return;
  const grid = $('#presetGrid');
  if (!grid.children.length) {
    grid.innerHTML = Object.entries(CAPTION_PRESETS).map(([k, p]) => `<button class="preset" data-preset="${k}"><canvas width="300" height="128"></canvas><span>${p.label}</span></button>`).join('');
  }
  $$('#presetGrid .preset').forEach(b => {
    b.classList.toggle('on', b.dataset.preset === cap().preset);
    const cv = b.querySelector('canvas'), ctx = cv.getContext('2d');
    ctx.fillStyle = '#1a1a1f'; ctx.fillRect(0, 0, cv.width, cv.height);
    const st = { ...CAPTION_PRESETS[b.dataset.preset], y: 0.55, size: CAPTION_PRESETS[b.dataset.preset].size * (b.dataset.preset === 'single' ? 0.62 : 1), maxWords: 3 };
    const words = [{ w: 'Bunu', s: 0, e: 0.4 }, { w: 'hiç', s: 0.4, e: 0.8 }, { w: 'beklemedim', s: 0.8, e: 1.4 }];
    const pages = buildPages(st.mode === 'single' ? [words[2]] : words, st.mode === 'single' ? 1 : 3);
    drawCaptions(ctx, 1080 * 0.28, cv.height * 1, pages, st.mode === 'single' ? 1.2 : 0.6, { ...st, anim: 'none' }, null);
  });
}
$('#presetGrid').addEventListener('click', e => {
  const b = e.target.closest('.preset'); if (!b) return;
  const y = cap().y;
  S.ed.clip.caption = { ...defaultCaptionStyle(b.dataset.preset), y };
  touch(); syncCaptionPanel(); renderPresets();
});

let fontsLoaded = null;
function loadFonts() {
  fontsLoaded ||= Promise.all([
    ...CAPTION_FONTS.map(f => document.fonts.load(`${f.weight} 40px "${f.id}"`).catch(() => {})),
    document.fonts.load('800 40px "Allo"').catch(() => {}),
    document.fonts.load('700 40px "Figtree"').catch(() => {})
  ]);
  return fontsLoaded;
}

// --- metin (kelime) paneli ---
function ensureOwnWords() {
  const c = S.ed.clip;
  ownWords(c, S.project.transcript);
  // arayüzdeki sıra ile aynı (yalnızca görünür aralık); öğeler klibin kendi kelimeleridir
  return clipWords(c, S.project.transcript);
}
function renderWords() {
  if (!S.ed) return;
  const c = S.ed.clip;
  const words = clipWords(c, S.project.transcript);
  const box = $('#wordsEd');
  if (!words.length) { box.innerHTML = '<p class="hint">Bu klipte altyazı için kelime yok. Önce transkript oluştur.</p>'; return; }
  const emph = new Set((c.emphasis || []).map(e => e.word.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '')));
  const pages = buildPages(words.filter(w => !w.hidden), c.caption.maxWords);
  const pageStarts = new Set(pages.map(p => p.words[0]));
  box.innerHTML = words.map((w, i) => {
    const isE = w.emph || emph.has(w.w.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, ''));
    return `${pageStarts.has(w) && i ? '<span class="page-break"></span>' : ''}<span class="wchip ${isE ? 'emph' : ''} ${w.hidden ? 'hidden-w' : ''}" data-i="${i}">
      <span contenteditable="plaintext-only" spellcheck="false">${escapeHtml(w.w)}</span>${w.emoji ? `<span class="emo">${escapeHtml(w.emoji)}</span>` : ''}
      <button class="star" title="Vurgula" aria-label="Vurgula"><svg class="ic"><use href="#i-star"/></svg></button>
      <button class="hide" title="${w.hidden ? 'Göster' : 'Gizle'}" aria-label="Gizle"><svg class="ic"><use href="${w.hidden ? '#i-eye' : '#i-close'}"/></svg></button>
    </span>`;
  }).join('');
}
$('#wordsEd').addEventListener('click', e => {
  const chip = e.target.closest('.wchip'); if (!chip) return;
  const i = +chip.dataset.i;
  if (e.target.closest('.star')) {
    const ws = ensureOwnWords(); const w = ws[i];
    const n = w.w.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '');
    const inList = (S.ed.clip.emphasis || []).some(x => x.word.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '') === n);
    if (w.emph || inList) { w.emph = false; S.ed.clip.emphasis = (S.ed.clip.emphasis || []).filter(x => x.word.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '') !== n); }
    else w.emph = true;
    touch(false); renderWords();
  } else if (e.target.closest('.hide')) {
    const ws = ensureOwnWords(); ws[i].hidden = !ws[i].hidden; touch(false); renderWords();
  } else if (!e.target.closest('[contenteditable]')) {
    edVideo.currentTime = clipWords(S.ed.clip, S.project.transcript)[i].s;
  }
});
$('#wordsEd').addEventListener('focusout', e => {
  const ed = e.target.closest('[contenteditable]'); if (!ed) return;
  const i = +ed.closest('.wchip').dataset.i;
  const val = ed.textContent.trim();
  const cur = clipWords(S.ed.clip, S.project.transcript)[i];
  if (!cur || val === cur.w) return;
  const ws = ensureOwnWords();
  if (!val) ws[i].hidden = true; else ws[i].w = val;
  touch(false); renderWords();
});
$('#wordsEd').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[contenteditable]')) { e.preventDefault(); e.target.blur(); } });
$('#wordsReset').addEventListener('click', () => { S.ed.clip.words = null; touch(false); renderWords(); snack('Altyazı transkripte geri döndü'); });
let lastChip = -1;
function highlightChip(t) {
  if ($('[data-panel="words"]').hidden) return;
  const ws = clipWords(S.ed.clip, S.project.transcript);
  let i = -1; for (let k = 0; k < ws.length; k++) { if (ws[k].s <= t) i = k; else break; }
  if (i === lastChip) return;
  $('#wordsEd .wchip.cur')?.classList.remove('cur');
  $(`#wordsEd .wchip[data-i="${i}"]`)?.classList.add('cur');
  lastChip = i;
}

// --- kanca paneli ---
$('#hookOn').addEventListener('change', e => { S.ed.clip.hookOn = e.target.checked; touch(false); });
$('#hookText').addEventListener('input', e => { S.ed.clip.hook = e.target.value; touch(false); showHookFrame(); renderHookPresets(); });
$('#progOn').addEventListener('change', e => { S.ed.clip.progressOn = e.target.checked; touch(false); });
$('#wmText').addEventListener('input', e => { S.ed.clip.watermark = e.target.value; touch(false); });

// --- paylaşım paneli ---
// paylaşım alanları da düzenleme sayılır: yeniden aramada klip korunur
const metaEdit = fn => e => { fn(S.ed.clip, e.target.value); S.ed.clip.touched = true; saveProject(); };
$('#shTitle').addEventListener('input', metaEdit((c, v) => { c.title = v; $('#edTitle').value = v; }));
$('#edTitle').addEventListener('input', metaEdit((c, v) => { c.title = v; $('#shTitle').value = v; }));
$('#shDesc').addEventListener('input', metaEdit((c, v) => { c.description = v; }));
$('#shTags').addEventListener('input', metaEdit((c, v) => { c.hashtags = v.split(/[\s,]+/).filter(Boolean).map(h => h.startsWith('#') ? h : '#' + h); }));
$$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
  const v = $('#' + b.dataset.copy).value;
  try { await navigator.clipboard.writeText(v); snack('Kopyalandı'); } catch { snack('Kopyalanamadı', { err: true }); }
}));
$('#regenMeta').addEventListener('click', async e => {
  if (!hasKey(S.settings.llmProvider)) return snack('AI anahtarı gerekli.', { action: 'Ayarlar', onAction: () => openSettings('ai') });
  if (!S.project.transcript) return snack('Önce transkript gerekli.');
  const b = e.currentTarget; b.classList.add('busy');
  try {
    const ed = S.ed, c = ed.clip; // yanıt gelene kadar başka klibe geçilebilir
    const j = await regenerateMeta(c, S.project, S.settings);
    if (j.title) c.title = String(j.title);
    if (j.hook) c.hook = String(j.hook);
    if (j.description) c.description = String(j.description);
    if (Array.isArray(j.hashtags)) c.hashtags = j.hashtags.map(String);
    if (Array.isArray(j.emphasis)) c.emphasis = j.emphasis.filter(x => x?.word).map(x => ({ word: String(x.word), emoji: String(x.emoji || '') }));
    if (S.ed === ed) { touch(false); syncInspector(); } else { c.touched = true; c._rev = (c._rev || 0) + 1; saveProject(); }
    snack('Yeni başlık ve metinler yazıldı');
  } catch (err) { snack(err.message, { err: true }); }
  b.classList.remove('busy');
});
$('#srtBtn').addEventListener('click', () => {
  const srt = clipSrt(S.ed.clip, S.project);
  if (!srt.trim()) return snack('Bu klipte altyazı yok.');
  download(new Blob([srt], { type: 'application/x-subrip' }), safeName(S.ed.clip.title) + '.srt');
});

function syncCaptionPanel() {
  const c = S.ed.clip, st = c.caption;
  $('#capOn').checked = c.captionsOn !== false;
  $('#capFont').value = st.font;
  const set = (id, v, out) => { const el = $('#' + id); el.value = v; fillRange(el); if (out !== undefined) $('#' + id + 'Out').textContent = out; };
  set('capSize', st.size, st.size); set('capWords', st.maxWords, st.maxWords); set('capY', st.y); set('capStrokeW', st.strokeW, st.strokeW);
  $('#capColor').value = st.color; $('#capHi').value = st.hi; $('#capHi2').value = st.hi2; $('#capStroke').value = st.stroke; $('#capBox').value = st.boxColor;
  segOn('#capAnim', st.anim);
  $('#capUpper').checked = !!st.upper; $('#capEmoji').checked = !!st.emoji; $('#capBig').checked = !!st.emphBig;
}

function syncInspector() {
  const c = S.ed.clip;
  $('#edTitle').value = c.title;
  $('#edScore').textContent = c.score != null ? `Viral puan ${c.score}` : '';
  renderLayouts();
  const set = (id, v, out) => { const el = $('#' + id); el.value = v; fillRange(el); if (out !== undefined) $('#' + id + 'Out').textContent = out; };
  set('splitRatio', c.splitRatio ?? 0.4, Math.round((c.splitRatio ?? 0.4) * 100) + '%');
  set('zoom', c.zoom ?? 1, (c.zoom ?? 1).toFixed(2) + '×');
  set('focusX', c.focusX ?? 0.5); set('focusY', c.focusY ?? 0.5); set('pipSize', c.pipSize ?? 0.42);
  $('#swap').checked = !!c.swap; $('#jumpcut').checked = !!c.jumpcut;
  $('#autoZoom').checked = !!c.autoZoom; $('#autoZoomRow').hidden = !c.autoZoom;
  set('autoZoomAmt', c.autoZoomAmt ?? 0.12, '+' + Math.round((c.autoZoomAmt ?? 0.12) * 100) + '%');
  $('#hookIdeas').innerHTML = '';
  $('#sfxOn').checked = !!c.sfx; $('#sfxVolRow').hidden = !c.sfx;
  set('sfxVol', c.sfxVol ?? 0.5, Math.round((c.sfxVol ?? 0.5) * 100) + '%');
  renderMusic(); renderSegList();
  segOn('#pipPos', c.pipPos || 'tr');
  $$('#accentSw .sw').forEach(x => x.classList.toggle('on', x.dataset.c === c.accent));
  syncCaptionPanel();
  $('#hookOn').checked = c.hookOn !== false; $('#hookText').value = c.hook || '';
  syncHookPanel(); renderLogo();
  segOn('#ratioSeg', c.ratio || '9:16'); applyPhoneRatio();
  $('#trackOn').checked = !!c.track; $('#fillersOn').checked = !!c.fillers; $('#cleanOn').checked = !!c.cleanAudio; $('#teaserOn').checked = !!c.teaser;
  $('#progOn').checked = !!c.progressOn; $('#wmText').value = c.watermark || '';
  $('#shTitle').value = c.title; $('#shDesc').value = c.description || ''; $('#shTags').value = (c.hashtags || []).join(' ');
  syncVariants();
  $('#edReason').innerHTML = c.reason ? `${c.score != null ? `<b>${c.score}/100</b> ` : ''}${escapeHtml(c.reason)}` : 'Bu klip elle oluşturuldu. AI ile başlık ve etiket yazdırabilirsin.';
  if (!$('[data-panel="words"]').hidden) renderWords();
  updateTrimInfo();
  drawTrim();
}

// --- kırpma zaman çizelgesi ---
function setupTrimWindow() {
  const c = S.ed.clip, D = S.project.video.duration;
  const d = c.end - c.start, pad = Math.max(8, d * 0.4);
  S.ed.win = [Math.max(0, c.start - pad), Math.min(D, c.end + pad)];
}
function updateTrimInfo() {
  const c = S.ed.clip, out = outDuration(S.ed.ranges);
  if (c.segments) { $('#trimInfo').textContent = `Montaj: ${c.segments.length} parça, ${out.toFixed(1)} sn${c.jumpcut ? ' (kesimlerle)' : ''}. Parçaya tıkla: önizle.`; return; }
  $('#trimInfo').textContent = `${fmtTime(c.start, true)} – ${fmtTime(c.end, true)}, ${(c.end - c.start).toFixed(1)} sn${c.jumpcut ? `, kesimlerle ${out.toFixed(1)} sn` : ''}`;
}
function drawTrim() {
  if (!S.ed) return;
  const cv = $('#trimCanvas'), ctx = cv.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const [a, b] = S.ed.win, span = b - a;
  const X = t => (t - a) / span * w;
  const e = S.project.energy;
  if (e?.length) {
    for (let x = 0; x < w; x += 3) {
      const i = Math.floor((a + (x / w) * span) / HOP);
      const v = e[i] ?? 0;
      ctx.fillStyle = hypeColor(v);
      const bh = Math.max(1, v * (h - 22));
      ctx.fillRect(x, h - 4 - bh, 2, bh);
    }
  }
  // kelime işaretleri
  const ws = S.project.transcript?.words || [];
  ctx.fillStyle = withAlpha(cssVar('--text'), .25);
  for (const wd of ws) { if (wd.s < a || wd.s > b) continue; ctx.fillRect(X(wd.s), 16, 1, 6); }
  // jump-cut boşlukları
  if (S.ed.clip.jumpcut) {
    const rs = S.ed.ranges;
    ctx.fillStyle = withAlpha(cssVar('--cut'), .35);
    let prev = S.ed.clip.start;
    for (const [s, en] of rs) { if (s > prev) ctx.fillRect(X(prev), 0, X(s) - X(prev), h); prev = en; }
    if (prev < S.ed.clip.end) ctx.fillRect(X(prev), 0, X(S.ed.clip.end) - X(prev), h);
  }
  // zaman etiketleri
  ctx.fillStyle = cssVar('--text-3'); ctx.font = '11px "Allo", system-ui'; ctx.textBaseline = 'top';
  const step = span > 120 ? 20 : span > 60 ? 10 : 5;
  for (let t = Math.ceil(a / step) * step; t < b; t += step) { ctx.fillRect(X(t), 0, 1, 4); ctx.fillText(fmtTime(t), X(t) + 3, 2); }
  const sel = $('#trimSel');
  sel.style.left = X(S.ed.clip.start) + 'px';
  sel.style.width = Math.max(4, X(S.ed.clip.end) - X(S.ed.clip.start)) + 'px';
}
new ResizeObserver(() => drawTrim()).observe($('#trimTrack'));

function snapToWord(t, edge) {
  const ws = S.project.transcript?.words; if (!ws?.length) return t;
  let best = t, bd = 0.25;
  for (const w of ws) {
    const v = edge === 'start' ? w.s - 0.06 : w.e + 0.15;
    const d = Math.abs(v - t); if (d < bd) { bd = d; best = v; }
    if (w.s > t + 1) break;
  }
  return best;
}

(() => {
  const track = $('#trimTrack');
  let drag = null;
  const tAt = ev => { const r = track.getBoundingClientRect(); const [a, b] = S.ed.win; return a + clamp((ev.clientX - r.left) / r.width, 0, 1) * (b - a); };
  track.addEventListener('pointerdown', ev => {
    if (!S.ed) return;
    const c = S.ed.clip;
    const kind = ev.target.id === 'hL' ? 'l' : ev.target.id === 'hR' ? 'r' : ev.target.id === 'trimSel' ? 'move' : 'seek';
    track.setPointerCapture(ev.pointerId);
    drag = { kind, t0: tAt(ev), s0: c.start, e0: c.end, moved: false };
    if (kind === 'seek') { edVideo.currentTime = clamp(tAt(ev), c.start, c.end - 0.05); }
  });
  track.addEventListener('pointermove', ev => {
    if (!drag || !S.ed) return;
    const c = S.ed.clip, t = tAt(ev), D = S.project.video.duration;
    const dt = t - drag.t0;
    if (Math.abs(dt) > 0.05) drag.moved = true;
    if (drag.kind === 'l') { c.start = clamp(ev.altKey ? t : snapToWord(t, 'start'), 0, c.end - 1); edVideo.currentTime = c.start; }
    else if (drag.kind === 'r') { c.end = clamp(ev.altKey ? t : snapToWord(t, 'end'), c.start + 1, D); edVideo.currentTime = Math.max(c.start, c.end - 1.5); }
    else if (drag.kind === 'move') {
      const d = drag.e0 - drag.s0;
      c.start = clamp(drag.s0 + dt, 0, D - d); c.end = c.start + d;
      edVideo.currentTime = c.start;
    } else if (drag.kind === 'seek') edVideo.currentTime = clamp(t, c.start, c.end - 0.05);
    if (drag.kind !== 'seek') { S.ed.ranges = rangesFor(c, S.project); drawTrim(); updateTrimInfo(); }
  });
  const end = () => {
    if (!drag) return;
    if (drag.kind !== 'seek' && drag.moved) {
      touch(); setupTrimWindow(); drawTrim(); drawHype();
      if (!$('[data-panel="words"]').hidden) renderWords();
    }
    drag = null;
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  const keyNudge = (which, d) => {
    const c = S.ed.clip, D = S.project.video.duration;
    if (which === 'start') c.start = clamp(c.start + d, 0, c.end - 1); else c.end = clamp(c.end + d, c.start + 1, D);
    touch(); setupTrimWindow(); drawTrim(); updateTrimInfo();
    edVideo.currentTime = which === 'start' ? c.start : Math.max(c.start, c.end - 1.5);
  };
  $('#hL').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); keyNudge('start', e.key === 'ArrowLeft' ? -0.25 : 0.25); } });
  $('#hR').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); keyNudge('end', e.key === 'ArrowLeft' ? -0.25 : 0.25); } });
  $('#nudgeStartL').onclick = () => keyNudge('start', -1);
  $('#nudgeStartR').onclick = () => keyNudge('start', 1);
  $('#nudgeEndL').onclick = () => keyNudge('end', -1);
  $('#nudgeEndR').onclick = () => keyNudge('end', 1);
})();


// ------------------------------------------------------------------ EDİTÖR: yeni araçlar
// Otomatik zoom
$('#autoZoom').addEventListener('change', e => { S.ed.clip.autoZoom = e.target.checked; $('#autoZoomRow').hidden = !e.target.checked; touch(false); });
$('#autoZoomAmt').addEventListener('input', e => { S.ed.clip.autoZoomAmt = +e.target.value; $('#autoZoomAmtOut').textContent = '+' + Math.round(+e.target.value * 100) + '%'; touch(false); });

// Platform güvenli alanı (önizlemede, dışa aktarmaya girmez)
S.safe = '';
const SAFE = {
  tiktok: { right: [0.84, 0.36, 1, 0.86], bottom: [0, 0.80, 0.82, 1], top: [0, 0, 1, 0.075] },
  shorts: { right: [0.84, 0.44, 1, 0.88], bottom: [0, 0.83, 0.84, 1], top: [0, 0, 1, 0.06] },
  reels:  { right: [0.85, 0.52, 1, 0.90], bottom: [0, 0.81, 0.85, 1], top: [0, 0, 1, 0.07] }
};
function drawSafeZone(ctx, W, H, which) {
  const z = SAFE[which]; if (!z) return;
  ctx.save();
  const k = W / 1080;
  ctx.fillStyle = 'rgba(255,45,111,.20)';
  ctx.strokeStyle = 'rgba(255,255,255,.75)';
  ctx.setLineDash([10 * k, 8 * k]); ctx.lineWidth = 2.5 * k;
  for (const [x0, y0, x1, y1] of Object.values(z)) {
    ctx.fillRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
    ctx.strokeRect(x0 * W + 1, y0 * H + 1, (x1 - x0) * W - 2, (y1 - y0) * H - 2);
  }
  ctx.setLineDash([]);
  ctx.font = `700 ${26 * k}px "Allo", system-ui, sans-serif`;
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6 * k;
  ctx.fillText('Platform düğmeleri', z.bottom[0] * W + 24 * k, (z.bottom[1] + 0.03) * H);
  ctx.restore();
}
$('#safeZone').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.safe = b.dataset.v; segOn('#safeZone', b.dataset.v);
  if (S.safe) {
    const st = S.ed?.clip.caption;
    if (st && S.ed.clip.captionsOn !== false && st.y > SAFE[S.safe].bottom[1] - 0.05) snack('Altyazı platform düğmelerinin altında kalıyor. Altyazı sekmesinden yukarı taşı.', { action: 'Düzelt', onAction: () => { st.y = 0.68; touch(false); syncCaptionPanel(); } });
  }
});

// Kapak görseli
$('#coverBtn').addEventListener('click', async () => {
  await loadFonts();
  const c = S.ed.clip;
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = Math.round(1080 * ratioH(c.ratio));
  const comp = new Compositor(cv);
  const fake = { ...c, id: c.id + '-cover', hookOn: !!c.hook, hookDur: 999, captionsOn: false, progressOn: false, autoZoom: false, _outDur: 1, hookY: Math.max(0.12, c.hookY ?? 0.14) };
  comp.draw(edVideo, fake, S.project, edVideo.currentTime, 0.6);
  cv.toBlob(b => { if (b) { download(b, safeName(c.title) + '-kapak.png'); snack('Kapak görseli indirildi. İstersen önce oynatıcıyı istediğin kareye getir.'); } }, 'image/png');
});

// AI kanca önerileri
$('#hookIdeasBtn').addEventListener('click', async e => {
  if (!hasKey(S.settings.llmProvider)) return snack('Kanca önerisi için AI anahtarı gerekli.', { action: 'Kurulum rehberi', onAction: () => openGuide(1) });
  const b = e.currentTarget; b.classList.add('busy');
  try {
    const ed = S.ed;
    const hooks = await suggestHooks(ed.clip, S.project, S.settings);
    if (S.ed !== ed) { b.classList.remove('busy'); return; }
    $('#hookIdeas').innerHTML = hooks.map(h => `<button class="chip ${h === S.ed.clip.hook ? 'on' : ''}">${escapeHtml(h)}</button>`).join('');
  } catch (err) { snack(err.message, { err: true }); }
  b.classList.remove('busy');
});
$('#hookIdeas').addEventListener('click', e => {
  const ch = e.target.closest('.chip'); if (!ch) return;
  S.ed.clip.hook = ch.textContent; S.ed.clip.hookOn = true;
  $('#hookText').value = ch.textContent; $('#hookOn').checked = true;
  $$('#hookIdeas .chip').forEach(x => x.classList.toggle('on', x === ch));
  touch(false); edVideo.currentTime = S.ed.clip.start + 0.8;
});

// Altyazı çevirisi
$('#trBtn').addEventListener('click', async e => {
  if (!hasKey(S.settings.llmProvider)) return snack('Çeviri için AI anahtarı gerekli.', { action: 'Kurulum rehberi', onAction: () => openGuide(1) });
  const c = S.ed.clip;
  const words = clipWords(c, S.project.transcript).filter(w => !w.hidden);
  if (!words.length) return snack('Bu klipte çevrilecek altyazı yok.');
  const pages = buildPages(words, Math.max(4, c.caption.maxWords));
  const b = e.currentTarget; b.classList.add('busy');
  try {
    const lines = await translateLines(pages.map(p => p.words.map(w => w.w).join(' ')), $('#trLang').value, S.settings);
    const out = [];
    pages.forEach((p, i) => {
      const toks = lines[i].split(/\s+/).filter(Boolean);
      if (!toks.length) return;
      const s0 = p.s, dur = Math.max(0.3, p.e - p.s);
      const total = toks.reduce((a, t) => a + t.length + 1, 0);
      let t = s0;
      for (const tk of toks) { const d = dur * (tk.length + 1) / total; out.push({ w: tk, s: t, e: t + d * 0.95 }); t += d; }
    });
    c.words = out; c.emphasis = [];
    if (S.ed?.clip === c) { touch(false); renderWords(); } else { c.touched = true; c._rev = (c._rev || 0) + 1; saveProject(); }
    snack(`Altyazı ${$('#trLang').value} diline çevrildi`);
  } catch (err) { snack(err.message, { err: true }); }
  b.classList.remove('busy');
});

// Geri al / yinele
function snapshot(c) { const { thumb, thumbRev, _rev, ...rest } = c; return JSON.stringify(rest); }
function scheduleCommit() {
  const h = S.ed?.hist; if (!h) return;
  clearTimeout(h.timer);
  h.timer = setTimeout(commitHist, 350);
  $('#edUndo').disabled = false;
}
function commitHist() {
  const h = S.ed?.hist; if (!h) return;
  clearTimeout(h.timer); h.timer = null;
  const cur = snapshot(S.ed.clip);
  if (cur === h.last) return;
  h.undo.push(h.last); if (h.undo.length > 100) h.undo.shift();
  h.last = cur; h.redo = [];
  updateUndoBtns();
}
function restoreSnap(json) {
  const c = S.ed.clip, o = JSON.parse(json), rev = (c._rev || 0) + 1;
  for (const k of Object.keys(c)) if (!(k in o) && !['thumb', 'thumbRev', '_rev', 'id'].includes(k)) delete c[k];
  Object.assign(c, o); c._rev = rev; c.thumbRev = null;
  S.ed.ranges = rangesFor(c, S.project);
  S.ed.events = sfxEvents(c, clipWords(c, S.project.transcript), S.ed.ranges);
  setupTrimWindow(); syncInspector(); drawHype(); saveProject(); setupPreviewMusic();
  if (!$('[data-panel="captions"]').hidden) renderPresets();
}
function histStep(dir) {
  const h = S.ed?.hist; if (!h) return;
  if (h.timer) commitHist();
  const from = dir < 0 ? h.undo : h.redo, to = dir < 0 ? h.redo : h.undo;
  if (!from.length) return;
  to.push(h.last); h.last = from.pop();
  restoreSnap(h.last); updateUndoBtns();
}
function updateUndoBtns() {
  const h = S.ed?.hist;
  $('#edUndo').disabled = !h || (!h.undo.length && !h.timer);
  $('#edRedo').disabled = !h || !h.redo.length;
}
$('#edUndo').addEventListener('click', () => histStep(-1));
$('#edRedo').addEventListener('click', () => histStep(1));
document.addEventListener('keydown', e => {
  if (document.body.dataset.view !== 'editor' || document.querySelector('dialog[open]')) return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  if (e.target.closest('input[type=text], input:not([type]), textarea, [contenteditable]')) return;
  e.preventDefault(); histStep(e.shiftKey ? 1 : -1);
});

// Kısayollar
$$('[data-open-keys]').forEach(b => b.addEventListener('click', () => $('#keysDlg').showModal()));


// ------------------------------------------------------------------ SOHBET (CHAT) İLE HYPE
function parseChat(text) {
  text = text.replace(/^﻿/, '');
  let times = [];
  const first = text.trimStart()[0];
  if (first === '{' || first === '[') {
    try {
      const d = JSON.parse(text);
      const arr = Array.isArray(d) ? d : (d.comments || d.messages || d.chat || d.items || d.data || []);
      for (const m of arr) {
        if (!m || typeof m !== 'object') continue;
        let v = m.content_offset_seconds ?? m.time_in_seconds ?? m.offset_seconds ?? m.offset ?? m.time ?? m.t ?? m.seconds;
        if (v == null && m.time_text) v = m.time_text;
        if (typeof v === 'string') v = parseTime(v.replace(/^-/, ''));
        if (typeof v === 'number' && isFinite(v) && v >= 0) times.push(v);
      }
    } catch { times = []; }
  }
  if (!times.length) {
    const re = /^\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d+)?\]?/;
    for (const line of text.split(/\r?\n/)) { const m = line.match(re); if (m) { const v = parseTime(m[1]); if (isFinite(v)) times.push(v); } }
  }
  const D = S.project.video.duration || 0;
  let max = 0; for (const t of times) if (t > max) max = t;
  if (D && max > D * 5 && max / 1000 <= D * 1.2) times = times.map(t => t / 1000); // milisaniye ise
  return times.filter(t => !D || t <= D + 5);
}
function chatDensity(times, D) {
  const n = Math.ceil(D / HOP) + 1;
  const raw = new Float32Array(n);
  for (const t of times) { const i = Math.floor(t / HOP); if (i >= 0 && i < n) raw[i]++; }
  const win = Math.round(5 / HOP), out = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += raw[i]; if (i >= win) acc -= raw[i - win]; out[Math.max(0, i - (win >> 1))] = acc; }
  const sorted = Array.from(out).sort((a, b) => a - b);
  const hi = sorted[Math.floor(n * 0.995)] || 1, lo = sorted[Math.floor(n * 0.3)] || 0;
  for (let i = 0; i < n; i++) out[i] = clamp((out[i] - lo) / Math.max(1, hi - lo), 0, 1);
  return out;
}
/** Ses + sohbet birleşik hype sinyali. Sohbet tepkisi olaydan ~6 sn sonra geldiği için geri kaydırılır. */
function hypeSignal() {
  const e = S.project.energy, c = S.project.chat;
  if (!c?.length) return e;
  const lag = Math.round(6 / HOP);
  const n = Math.max(e?.length || 0, c.length), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, (e?.[i] || 0) * 0.55 + (c[i + lag] || 0) * 0.7);
  return out;
}
$('#chatInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !S.project) return;
  if (!S.project.video.duration) return snack('Önce video yüklenmeli.');
  try {
    const times = parseChat(await f.text());
    if (times.length < 10) throw new Error('Zaman damgalı mesaj bulunamadı. TwitchDownloader JSON, chat-downloader JSON veya "[0:12:34] kullanıcı: mesaj" biçimli metin desteklenir.');
    S.project.chat = chatDensity(times, S.project.video.duration);
    saveProject(); drawHype();
    $('.pl-step[data-step="audio"] .pl-sub').textContent = `${times.length.toLocaleString('tr-TR')} sohbet mesajı eklendi`;
    snack(`${times.length.toLocaleString('tr-TR')} sohbet mesajı eklendi. Sarı çizgi sohbet yoğunluğu; AI ve "Sesten" artık bunu da kullanıyor.`);
  } catch (err) { snack(err.message, { err: true }); }
});

// ------------------------------------------------------------------ KANAL SÖZLÜĞÜ
let glossHits = [];
$('#glossBtn').addEventListener('click', openGlossary);
function openGlossary() {
  renderGlossTerms(); renderGlossSuggest();
  $('#glossHits').innerHTML = S.project?.transcript ? '' : '<p class="hint">Toplu düzeltme için önce transkript oluştur. Sözlüğü şimdiden doldurabilirsin; yazıya dökmede kullanılır.</p>';
  glossHits = []; updateGlossApply();
  $('#glossDlg').showModal();
}
const glossary = () => (S.settings.glossary ||= []);
function renderGlossTerms() {
  const g = glossary();
  $('#glossTerms').innerHTML = g.length ? g.map((t, i) => `<span class="chip gloss-term">${escapeHtml(t.term)}<button data-gdel="${i}" aria-label="${escapeHtml(t.term)} terimini sil" title="Sil"><svg class="ic sm"><use href="#i-close"/></svg></button></span>`).join('')
    : '<span class="muted sm">Henüz terim yok. Sık yanlış yazılan adları ekle.</span>';
  $('#glossList').innerHTML = g.map(t => `<option value="${escapeHtml(t.term)}">`).join('');
}
function addTerm(term, wrong) {
  term = String(term || '').trim(); if (!term) return;
  const g = glossary();
  let t = g.find(x => gNorm(x.term) === gNorm(term));
  if (!t) { t = { term, wrong: [] }; g.push(t); }
  if (wrong && gNorm(wrong) !== gNorm(term) && !t.wrong.some(w => gNorm(w) === gNorm(wrong))) t.wrong.push(String(wrong).trim());
  saveSettings(S.settings);
}
function renderGlossSuggest() {
  const sug = S.project?.transcript ? suggestions(S.project.transcript.words, glossary()) : [];
  $('#glossSuggestWrap').hidden = !sug.length;
  $('#glossSuggest').innerHTML = sug.map(x => `<button class="chip" data-gsug data-from="${escapeHtml(x.from)}" data-to="${escapeHtml(x.to)}"><s>${escapeHtml(x.from)}</s> → <b>${escapeHtml(x.to)}</b> <small>${x.count} yer</small></button>`).join('');
}
$('#glossAdd').addEventListener('click', () => { addTerm($('#glossNew').value); $('#glossNew').value = ''; renderGlossTerms(); renderGlossSuggest(); });
$('#glossNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#glossAdd').click(); } });
$('#glossTerms').addEventListener('click', e => {
  const b = e.target.closest('[data-gdel]'); if (!b) return;
  glossary().splice(+b.dataset.gdel, 1); saveSettings(S.settings); renderGlossTerms(); renderGlossSuggest();
});
$('#glossSuggest').addEventListener('click', e => {
  const b = e.target.closest('[data-gsug]'); if (!b) return;
  $('#glossFrom').value = b.dataset.from; $('#glossTo').value = b.dataset.to; findGloss();
});
$('#glossFind').addEventListener('click', findGloss);
['glossFrom', 'glossTo'].forEach(id => $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findGloss(); } }));
/** Transkriptte ve klip altyazılarında (düzenlenmiş kelimeler) eşleşmeleri listeler */
function findGloss() {
  const from = $('#glossFrom').value.trim(), to = $('#glossTo').value.trim();
  const tr = S.project?.transcript;
  if (!tr) return;
  if (!from) { $('#glossHits').innerHTML = '<p class="hint">Yanlış yazılan kelimeyi gir.</p>'; return; }
  glossHits = [];
  const ctx = (ws, i, n) => {
    const a = ws.slice(Math.max(0, i - 4), i).map(w => escapeHtml(w.w)).join(' ');
    const m = ws.slice(i, i + n).map(w => escapeHtml(w.w)).join(' ');
    const z = ws.slice(i + n, i + n + 4).map(w => escapeHtml(w.w)).join(' ');
    return `${a} <mark>${m}</mark> ${z}`;
  };
  for (const h of findIn(tr.words, from)) glossHits.push({ where: 'tx', i: h.i, n: h.n, t: tr.words[h.i].s, html: ctx(tr.words, h.i, h.n) });
  for (const c of S.project.clips) if (c.words) for (const h of findIn(c.words, from)) glossHits.push({ where: c.id, i: h.i, n: h.n, t: c.words[h.i].s, html: ctx(c.words, h.i, h.n), clip: c.title });
  $('#glossHits').innerHTML = glossHits.length
    ? `<p class="muted sm">${glossHits.length} yer bulundu${to ? `; seçilenler <b>${escapeHtml(to)}</b> olarak düzeltilecek` : '. Doğru yazımı da gir'}.</p>` +
      glossHits.map((h, k) => `<label class="gloss-hit"><input type="checkbox" data-gk="${k}" checked><button type="button" class="ts" data-gt="${h.t}">${fmtTime(h.t)}</button><span>${h.html}${h.clip ? ` <small class="muted">(klip: ${escapeHtml(h.clip)})</small>` : ''}</span></label>`).join('')
    : '<p class="hint">Eşleşme bulunamadı.</p>';
  $('#glossAll').checked = true;
  updateGlossApply();
}
function updateGlossApply() {
  const n = $$('#glossHits [data-gk]:checked').length;
  $('#glossApply').disabled = !n || !$('#glossTo').value.trim();
  $('#glossApply').lastChild.textContent = n ? `Seçilenleri düzelt (${n})` : 'Seçilenleri düzelt';
}
$('#glossTo').addEventListener('input', updateGlossApply);
$('#glossHits').addEventListener('change', updateGlossApply);
$('#glossHits').addEventListener('click', e => { const b = e.target.closest('[data-gt]'); if (b) { e.preventDefault(); mainVideo.currentTime = +b.dataset.gt; } });
$('#glossAll').addEventListener('change', e => { $$('#glossHits [data-gk]').forEach(x => { x.checked = e.target.checked; }); updateGlossApply(); });
$('#glossApply').addEventListener('click', () => {
  const from = $('#glossFrom').value.trim(), to = $('#glossTo').value.trim();
  const picked = $$('#glossHits [data-gk]:checked').map(x => glossHits[+x.dataset.gk]);
  if (!picked.length || !to) return;
  const p = S.project, tr = p.transcript;
  // tek adımda geri alınabilsin diye önceki hâli sakla
  const before = { words: structuredClone(tr.words), segments: structuredClone(tr.segments || []), clips: p.clips.filter(c => c.words).map(c => [c, structuredClone(c.words)]) };
  const byList = new Map();
  for (const h of picked) { const k = h.where; if (!byList.has(k)) byList.set(k, []); byList.get(k).push(h); }
  let n = 0;
  for (const [k, hs] of byList) {
    const ws = k === 'tx' ? tr.words : p.clips.find(c => c.id === k)?.words;
    if (!ws) continue;
    hs.sort((a, b) => b.i - a.i); // sondan başa: birleşen kelimeler indeksleri kaydırmasın
    for (const h of hs) { replaceAt(ws, h.i, h.n, to); n++; }
  }
  // seçilen transkript yerlerinin geçtiği segment metinlerini de güncelle
  const times = picked.filter(h => h.where === 'tx').map(h => h.t);
  for (const sg of tr.segments || []) if (times.some(t => t >= sg.start - 0.05 && t < sg.end + 0.05)) sg.text = replaceInText(sg.text, from, to);
  addTerm(to, from);
  const bump = () => { tr._v = Date.now(); p.clips.forEach(c => { c._rev = (c._rev || 0) + 1; c.thumbRev = null; }); saveProject(); renderTranscript(); renderClips(); queueThumbs(); };
  bump();
  $('#glossDlg').close();
  snack(`${n} yer düzeltildi: ${to}`, { action: 'Geri al', onAction: () => {
    tr.words = before.words; tr.segments = before.segments;
    for (const [c, w] of before.clips) c.words = w;
    bump(); snack('Toplu düzeltme geri alındı');
  } });
});

// ------------------------------------------------------------------ MONTAJ
$('#montageBtn').addEventListener('click', createMontage);
function createMontage() {
  const src = [...S.project.clips].filter(c => !c.segments).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
  if (src.length < 2) return snack('Montaj için en az 2 klip gerekli.');
  const per = clamp(Math.round(52 / src.length), 6, 15);
  const sig = hypeSignal();
  const words = S.project.transcript?.words || [];
  let segs = src.map(c => {
    const d = Math.min(per, c.end - c.start);
    let best = c.start, bv = -1;
    for (let s0 = c.start; s0 <= c.end - d + 0.01; s0 += 0.5) {
      let v = 0; for (let t = s0; t < s0 + d; t += HOP) v += sig?.[Math.floor(t / HOP)] || 0;
      if (v > bv) { bv = v; best = s0; }
    }
    let a = best, b = best + d;
    if (words.length) {
      const ws = words.find(w => w.s >= a - 1.5); if (ws && ws.s < a + 1.5) a = Math.max(c.start, ws.s - 0.06);
      const we = [...words].reverse().find(w => w.e <= b + 1.5); if (we && we.e > b - 1.5) b = Math.min(c.end, we.e + 0.15);
    }
    return [a, Math.max(a + 2, b)];
  }).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const sg of segs) { const l = merged[merged.length - 1]; if (l && sg[0] <= l[1] + 0.3) l[1] = Math.max(l[1], sg[1]); else merged.push([...sg]); }
  const tags = [...new Set(src.flatMap(c => c.hashtags || []))].slice(0, 8);
  const emph = src.flatMap(c => c.emphasis || []).slice(0, 10);
  const c = addClip({
    start: merged[0][0], end: merged[merged.length - 1][1], segments: merged, source: 'montage', score: null,
    title: 'Yayının en iyi anları', hook: 'Yayının en iyi anları', reason: `${merged.length} güçlü anın birleşimi.`,
    description: src.map(x => x.title).slice(0, 3).join(' · '), hashtags: tags, emphasis: emph, sfx: true
  });
  snack(`Montaj hazır: ${merged.length} parça, ${Math.round(merged.reduce((a, [x, y]) => a + y - x, 0))} sn`, { action: 'Düzenle', onAction: () => openEditor(c.id) });
}
function renderSegList() {
  const c = S.ed.clip, box = $('#segList');
  $('.trim').classList.toggle('montage', !!c.segments);
  $('#trimTrack').hidden = !!c.segments;
  box.hidden = !c.segments;
  if (!c.segments) return;
  box.innerHTML = c.segments.map(([a, b], i) => `<span class="seg-chip" data-i="${i}"><b>${i + 1}</b>${fmtTime(a)}–${fmtTime(b)}${c.segments.length > 2 ? `<button data-rm="${i}" aria-label="Parçayı çıkar" title="Parçayı çıkar"><svg class="ic"><use href="#i-close"/></svg></button>` : ''}</span>`).join('');
}
$('#segList').addEventListener('click', e => {
  const c = S.ed.clip;
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    c.segments.splice(+rm.dataset.rm, 1);
    c.start = c.segments[0][0]; c.end = c.segments[c.segments.length - 1][1];
    touch(); renderSegList(); updateTrimInfo(); drawHype(); return;
  }
  const ch = e.target.closest('.seg-chip');
  if (ch) edVideo.currentTime = c.segments[+ch.dataset.i][0];
});

// ------------------------------------------------------------------ SES: efektler + müzik
let _prevCtx = null;
function prevCtx() { _prevCtx ||= new AudioContext(); if (_prevCtx.state === 'suspended') _prevCtx.resume(); return _prevCtx; }
const musicCache = new Map();
async function getMusic(id) {
  if (!id) return null;
  if (musicCache.has(id)) return musicCache.get(id);
  const b = await DB.getHandle('music:' + id);
  if (b) musicCache.set(id, b);
  return b || null;
}
function disposePreviewMusic() {
  const m = S.ed?.musicEl; if (!m) return;
  m.pause(); URL.revokeObjectURL(m.src); S.ed.musicEl = null;
}
async function setupPreviewMusic() {
  const ed = S.ed; if (!ed) return;
  disposePreviewMusic();
  const id = ed.clip.music?.id; if (!id) return;
  const b = await getMusic(id);
  if (!b || S.ed !== ed || ed.clip.music?.id !== id) return;
  const m = new Audio(URL.createObjectURL(b)); m.loop = true; m.preload = 'auto';
  ed.musicEl = m;
  if (!edVideo.paused) edVideo.dispatchEvent(new Event('play'));
}
function renderMusic() {
  const c = S.ed.clip;
  $('#musicCtrls').hidden = !c.music;
  $('#musicBox').innerHTML = c.music
    ? `<div class="music-row"><svg class="ic"><use href="#i-music"/></svg><b title="${escapeHtml(c.music.name)}">${escapeHtml(c.music.name)}</b>
        <label class="btn text sm"><input type="file" accept="audio/*" data-music hidden>Değiştir</label>
        <button class="btn icon sm" id="musicRm" aria-label="Müziği kaldır" title="Müziği kaldır"><svg class="ic"><use href="#i-trash"/></svg></button></div>`
    : `<label class="btn tonal sm"><input type="file" accept="audio/*" data-music hidden><svg class="ic"><use href="#i-music"/></svg>Müzik dosyası seç</label>`;
  if (c.music) {
    const set = (id, v, out) => { const el = $('#' + id); el.value = v; fillRange(el); $('#' + id + 'Out').textContent = out; };
    set('musicVol', c.music.vol ?? 0.18, Math.round((c.music.vol ?? 0.18) * 100) + '%');
    $('#musicDuck').checked = c.music.duck !== false;
  }
}
$('#musicBox').addEventListener('change', async e => {
  if (!e.target.matches('[data-music]')) return;
  const f = e.target.files[0]; if (!f) return;
  const ed = S.ed, c = ed.clip; // dosya kaydedilirken klip değişebilir
  const id = uid();
  musicCache.set(id, f);
  await DB.saveHandle('music:' + id, f);
  c.music = { id, name: f.name, vol: c.music?.vol ?? 0.18, duck: c.music?.duck ?? true };
  c.touched = true; c._rev = (c._rev || 0) + 1;
  if (S.ed === ed) { touch(false); renderMusic(); setupPreviewMusic(); } else saveProject();
  snack('Müzik eklendi. Önizlemede ve dışa aktarmada çalınacak.');
});
$('#musicBox').addEventListener('click', e => {
  if (!e.target.closest('#musicRm')) return;
  S.ed.clip.music = null; touch(false); disposePreviewMusic(); renderMusic();
});
$('#musicVol').addEventListener('input', e => { S.ed.clip.music.vol = +e.target.value; $('#musicVolOut').textContent = Math.round(+e.target.value * 100) + '%'; touch(false); });
$('#musicDuck').addEventListener('change', e => { S.ed.clip.music.duck = e.target.checked; touch(false); });
$('#sfxOn').addEventListener('change', e => {
  S.ed.clip.sfx = e.target.checked; $('#sfxVolRow').hidden = !e.target.checked; touch(false);
  if (e.target.checked) {
    playSfx(prevCtx(), prevCtx().destination, 'pop', S.ed.clip.sfxVol ?? 0.5);
    if (!S.ed.events.some(x => x.type === 'pop')) snack('Pop efekti için Metin sekmesinden kelimeleri yıldızla vurgula.');
  }
});
$('#sfxVol').addEventListener('input', e => { S.ed.clip.sfxVol = +e.target.value; $('#sfxVolOut').textContent = Math.round(+e.target.value * 100) + '%'; touch(false); });
$('#sfxVol').addEventListener('change', () => playSfx(prevCtx(), prevCtx().destination, 'pop', S.ed.clip.sfxVol));
$('#audioApplyAll').addEventListener('click', () => {
  const src = S.ed.clip;
  for (const c of S.project.clips) if (c !== src) { c.sfx = src.sfx; c.sfxVol = src.sfxVol; c.music = src.music ? { ...src.music } : null; }
  saveProject(); snack(`Ses ayarları ${S.project.clips.length - 1} klibe uygulandı`);
});

// ------------------------------------------------------------------ PAYLAŞ (mobil)
function canShareJob(j) {
  try { return !!(j.blob && navigator.canShare && navigator.canShare({ files: [new File([j.blob], j.fileName, { type: j.blob.type })] })); } catch { return false; }
}
async function shareJob(j) {
  const clip = S.project?.clips.find(c => c.id === j.clipId);
  try {
    await navigator.share({
      files: [new File([j.blob], j.fileName, { type: j.blob.type })],
      title: clip?.title || j.name,
      text: clip ? [clip.description, (clip.hashtags || []).join(' ')].filter(Boolean).join('\n\n') : ''
    });
  } catch (e) { if (e.name !== 'AbortError') snack('Paylaşılamadı: ' + e.message, { err: true }); }
}


// ------------------------------------------------------------------ KANCA TASARIMCISI
$('#hookFont').innerHTML = CAPTION_FONTS.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
$('#hookAnim').innerHTML = HOOK_ANIMS.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('');
function showHookFrame() {
  if (!S.ed || !edVideo.paused) return;
  const rs = S.ed.ranges; S.ed.seg = 0;
  edVideo.currentTime = rs[0][0] + Math.min(1.2, (S.ed.clip.hookDur ?? 3.2) * 0.4);
}
function toHex(c) { return /^#[0-9a-f]{6}$/i.test(c) ? c : (c === 'none' ? '#000000' : '#ffffff'); }
function syncHookPanel() {
  const c = S.ed.clip, d = hookDesign(c);
  $('#hookOn').checked = c.hookOn !== false; $('#hookText').value = c.hook || '';
  $('#hookEmoji').value = c.hookEmoji || '';
  $('#hookFont').value = d.font;
  $('#hookBg').value = toHex(d.bg); $('#hookFg').value = toHex(d.fg);
  const set = (id, v, out) => { const el = $('#' + id); el.value = v; fillRange(el); if (out !== undefined) $('#' + id + 'Out').textContent = out; };
  set('hookSize', d.size, d.size); set('hookTilt', d.tilt, d.tilt + '°'); set('hookRadius', Math.min(60, d.radius), d.radius >= 60 ? 'tam' : d.radius);
  set('hookDur', d.dur, d.dur.toFixed(1) + ' sn'); set('hookY', d.y);
  segOn('#hookAnim', d.anim);
  $('#hookUpper').checked = !!d.upper;
  $('#hookAuto').checked = S.settings.hookAuto !== false;
  renderHookPresets();
}
function renderHookPresets() {
  if (!S.ed) return;
  const grid = $('#hookPresetGrid'), c = S.ed.clip;
  if (!grid.children.length) grid.innerHTML = Object.entries(HOOK_PRESETS).map(([k, p]) => `<button class="preset" data-hook="${k}"><canvas width="300" height="152"></canvas><span>${p.label}</span></button>`).join('');
  $$('#hookPresetGrid .preset').forEach(b => {
    const k = b.dataset.hook;
    b.classList.toggle('on', hookDesign(c).id === k);
    const cv = b.querySelector('canvas'), ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 300, 152); g.addColorStop(0, '#3a3a44'); g.addColorStop(1, '#1b1b22');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 300, 152);
    drawHookCard(ctx, { hook: (c.hook || 'Bunu kimse beklemiyordu').split(/\s+/).slice(0, 5).join(' '), hookStyle: k, hookY: 0.5, hookDur: 99, accent: c.accent, hookEmoji: k === c.hookStyle ? c.hookEmoji : '' }, 1.5, 300, 152);
  });
}
$('#hookPresetGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-hook]'); if (!b) return;
  const c = S.ed.clip;
  c.hookStyle = b.dataset.hook;
  for (const k of ['hookBg', 'hookFg', 'hookFont', 'hookSize', 'hookRadius', 'hookTilt', 'hookAnim', 'hookUpper']) delete c[k];
  c.hookOn = true;
  touch(false); syncHookPanel(); showHookFrame();
});
const hookSet = (key, val) => { S.ed.clip[key] = val; touch(false); showHookFrame(); };
$('#hookEmoji').addEventListener('input', e => { hookSet('hookEmoji', e.target.value.trim()); renderHookPresets(); });
$('#hookFont').addEventListener('change', e => { document.fonts.load(`800 40px "${e.target.value}"`).catch(() => {}); hookSet('hookFont', e.target.value); });
$('#hookBg').addEventListener('input', e => hookSet('hookBg', e.target.value));
$('#hookFg').addEventListener('input', e => hookSet('hookFg', e.target.value));
$('#hookNoBg').addEventListener('click', () => hookSet('hookBg', 'none'));
$('#hookResetColors').addEventListener('click', () => { delete S.ed.clip.hookBg; delete S.ed.clip.hookFg; touch(false); syncHookPanel(); showHookFrame(); });
$('#hookSize').addEventListener('input', e => { $('#hookSizeOut').textContent = e.target.value; hookSet('hookSize', +e.target.value); });
$('#hookTilt').addEventListener('input', e => { $('#hookTiltOut').textContent = e.target.value + '°'; hookSet('hookTilt', +e.target.value); });
$('#hookRadius').addEventListener('input', e => { $('#hookRadiusOut').textContent = +e.target.value >= 60 ? 'tam' : e.target.value; hookSet('hookRadius', +e.target.value >= 60 ? 999 : +e.target.value); });
$('#hookDur').addEventListener('input', e => { $('#hookDurOut').textContent = (+e.target.value).toFixed(1) + ' sn'; hookSet('hookDur', +e.target.value); });
$('#hookY').addEventListener('input', e => hookSet('hookY', +e.target.value));
$('#hookAnim').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  segOn('#hookAnim', b.dataset.v); S.ed.clip.hookAnim = b.dataset.v; touch(false);
  if (edVideo.paused) { S.ed.seg = 0; edVideo.currentTime = S.ed.ranges[0][0]; edToggle(); setTimeout(() => { if (S.ed && !edVideo.paused) edToggle(); }, 1400); }
});
$('#hookUpper').addEventListener('change', e => hookSet('hookUpper', e.target.checked));
$('#hookAuto').addEventListener('change', e => { S.settings.hookAuto = e.target.checked; persist(); });
$('#hookApplyAll').addEventListener('click', () => {
  const src = S.ed.clip, keys = ['hookStyle', 'hookBg', 'hookFg', 'hookFont', 'hookSize', 'hookRadius', 'hookTilt', 'hookAnim', 'hookUpper', 'hookDur', 'hookY', 'hookEmoji'];
  for (const c of S.project.clips) if (c !== src) { for (const k of keys) { if (src[k] === undefined) delete c[k]; else c[k] = src[k]; } c._rev = (c._rev || 0) + 1; }
  saveProject(); snack(`Kanca stili ${S.project.clips.length - 1} klibe uygulandı`);
});
$('#hookDesignBtn').addEventListener('click', async e => {
  const c = S.ed.clip;
  if (!hasKey(S.settings.llmProvider)) {
    Object.assign(c, autoHookStyle(c.category)); if (!c.hook) c.hook = c.title;
    c.hookOn = true; touch(false); syncHookPanel(); showHookFrame();
    return snack('AI anahtarı olmadığı için içerik türüne göre yerel bir tasarım uygulandı.', { action: 'Kurulum rehberi', onAction: () => openGuide(1) });
  }
  const b = e.currentTarget; b.classList.add('busy');
  try {
    const d = await designHook(c, S.project, S.settings);
    for (const k of ['hookBg', 'hookFg', 'hookFont', 'hookSize', 'hookRadius', 'hookTilt', 'hookAnim', 'hookUpper']) delete c[k];
    for (const [k, v] of Object.entries(d)) if (v !== undefined) c[k] = v;
    c.hookOn = true;
    if (S.ed?.clip === c) { touch(false); syncHookPanel(); showHookFrame(); } else { c.touched = true; c._rev = (c._rev || 0) + 1; saveProject(); }
    snack('AI kancayı yeniden tasarladı');
  } catch (err) { snack(err.message, { err: true }); }
  b.classList.remove('busy');
});

// ------------------------------------------------------------------ TEASER, DOLGU, SES İYİLEŞTİRME
$('#teaserOn').addEventListener('change', e => {
  S.ed.clip.teaser = e.target.checked; touch(false); updateTrimInfo();
  if (e.target.checked) snack(S.ed.ranges.teaser ? `Teaser eklendi: ${S.ed.ranges.teaser} kısa an, flaş geçişli` : 'Bu klip teaser için çok kısa ya da belirgin an yok.');
});
$('#fillersOn').addEventListener('change', e => {
  const c = S.ed.clip; c.fillers = e.target.checked; c.fillerWords = DEFAULT_FILLERS;
  touch(false); updateTrimInfo(); drawTrim();
  if (e.target.checked) { const n = clipWords(c, S.project.transcript).filter(w => isFiller(w.w)).length; snack(n ? `${n} dolgu kelimesi kesildi` : 'Bu klipte dolgu kelimesi bulunamadı.'); }
});
let previewSrc = null, previewChain = null;
function routePreviewAudio(clean) {
  const ctx = prevCtx();
  if (!previewSrc) previewSrc = ctx.createMediaElementSource(edVideo);
  previewSrc.disconnect();
  if (clean) { previewChain ||= buildCleanChain(ctx); previewSrc.connect(previewChain.input); previewChain.output.connect(ctx.destination); }
  else previewSrc.connect(ctx.destination);
}
export function buildCleanChain(ctx) {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 3;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -26; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
  const make = ctx.createGain(); make.gain.value = 1.5;
  hp.connect(pres); pres.connect(comp); comp.connect(make);
  return { input: hp, output: make };
}
$('#cleanOn').addEventListener('change', e => { S.ed.clip.cleanAudio = e.target.checked; touch(false); routePreviewAudio(e.target.checked); });

// ------------------------------------------------------------------ FORMAT ve OTOMATİK KADRAJ
function applyPhoneRatio() {
  const r = S.ed?.clip.ratio || '9:16';
  $('.phone').style.aspectRatio = r === '1:1' ? '1 / 1' : r === '4:5' ? '4 / 5' : '9 / 16';
  $('#safeZone').hidden = r !== '9:16';
}
$('#ratioSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.ed.clip.ratio = b.dataset.v; S.project.lastRatio = b.dataset.v;
  segOn('#ratioSeg', b.dataset.v); applyPhoneRatio(); touch();
  if (S.ed.clip.track) analyzeTrack(S.ed.clip);
});
const motionVideo = document.createElement('video');
motionVideo.muted = true; motionVideo.preload = 'auto'; motionVideo.playsInline = true;
async function analyzeTrack(clip) {
  if (!S.videoUrl) return;
  if (motionVideo.src !== S.videoUrl) { motionVideo.src = S.videoUrl; await new Promise(r => motionVideo.addEventListener('loadeddata', r, { once: true })); }
  const vw = motionVideo.videoWidth, vh = motionVideo.videoHeight;
  const reg = { ...DEFAULT_REGIONS.content, ...(S.project.regions?.content || {}) };
  const rx = reg.x * vw, ry = reg.y * vh, rw = reg.w * vw, rh = reg.h * vh;
  const SW = 96, SH = Math.max(24, Math.round(96 * rh / rw));
  const cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // kırpma penceresinin bölgeye oranı (odak hesabı için)
  const dstAR = 1 / ratioH(clip.ratio);
  const cw = Math.min(1, (rh * dstAR) / rw) / (clip.zoom || 1);
  const keys = []; let prev = null, cx = 0.5;
  const step = 0.4, total = Math.max(1, Math.ceil((clip.end - clip.start) / step));
  for (let i = 0; i <= total; i++) {
    const t = Math.min(clip.end, clip.start + i * step);
    await new Promise(r => { motionVideo.addEventListener('seeked', r, { once: true }); motionVideo.currentTime = t; });
    ctx.drawImage(motionVideo, rx, ry, rw, rh, 0, 0, SW, SH);
    const d = ctx.getImageData(0, 0, SW, SH).data;
    const g = new Float32Array(SW * SH);
    for (let p = 0, q = 0; p < d.length; p += 4, q++) g[q] = d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11;
    if (prev) {
      let sw = 0, sx = 0;
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const q = y * SW + x, df = Math.abs(g[q] - prev[q]); if (df > 18) { sw += df; sx += df * x; } }
      if (sw > SW * SH * 0.6) { const m = (sx / sw + 0.5) / SW; if (Math.abs(m - cx) > 0.04) cx += (m - cx) * 0.35; }
    }
    prev = g;
    keys.push({ t, x: clamp((cx - cw / 2) / Math.max(0.0001, 1 - cw), 0, 1) });
    if (i % 10 === 0) $('#trackOn').closest('label').querySelector('small').textContent = `Hareket analiz ediliyor %${Math.round(i / total * 100)}`;
  }
  // yumuşat
  for (let k = 0; k < 2; k++) for (let i = 1; i < keys.length - 1; i++) keys[i].x = (keys[i - 1].x + keys[i].x * 2 + keys[i + 1].x) / 4;
  clip.trackKeys = keys; clip.trackRange = [clip.start, clip.end];
  $('#trackOn').closest('label').querySelector('small').textContent = 'Görüntüdeki hareketi takip edip konuşan kişiyi ortalar';
  if (S.ed?.clip === clip) touch();
}
$('#trackOn').addEventListener('change', async e => {
  const c = S.ed.clip; c.track = e.target.checked;
  if (c.track && (!c.trackKeys || c.trackRange?.[0] !== c.start || c.trackRange?.[1] !== c.end)) await analyzeTrack(c);
  touch();
});

// ------------------------------------------------------------------ PLATFORM SÜRÜMLERİ
function syncVariants() {
  if (!S.ed) return;
  const on = feat('variants'); $('#variantsBox').hidden = !on;
  if (!on) { S.ed.variant = 'base'; return; }
  const c = S.ed.clip, v = S.ed.variant || 'base';
  $$('#varSeg button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-checked', b.dataset.v === v);
    b.classList.toggle('custom', b.dataset.v !== 'base' && isCustom(c, b.dataset.v));
  });
  $('#varFields').hidden = v === 'base';
  if (v === 'base') return;
  const val = variantValues(c, v);
  $('#vTitle').value = val.title; $('#vDesc').value = val.description; $('#vTags').value = val.hashtags.join(' ');
  $('#vHook').value = val.hook;
  const r = (id, x) => { const el = $('#' + id); el.value = x; fillRange(el); };
  r('vHookY', val.hookY); r('vCapY', val.capY);
  $('#vReset').disabled = !isCustom(c, v);
}
$('#varSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !S.ed) return;
  S.ed.variant = b.dataset.v; syncVariants();
  // sürüm seçilince o platformun güvenli alanını da göster
  if ((S.ed.clip.ratio || '9:16') === '9:16') { S.safe = b.dataset.v === 'base' ? S.safe : b.dataset.v; segOn('#safeZone', S.safe || ''); }
  if (b.dataset.v !== 'base') edVideo.currentTime = Math.min(S.ed.clip.end - 0.1, (S.ed.ranges[0]?.[0] ?? S.ed.clip.start) + 0.8);
});
const setVar = (key, val) => {
  const c = S.ed.clip, v = S.ed.variant; if (!v || v === 'base') return;
  c.variants ||= {}; c.variants[v] = { ...(c.variants[v] || {}), [key]: val };
  touch(false);
  $$('#varSeg button').forEach(b => b.classList.toggle('custom', b.dataset.v !== 'base' && isCustom(c, b.dataset.v)));
  $('#vReset').disabled = false;
};
$('#vTitle').addEventListener('input', e => setVar('title', e.target.value));
$('#vDesc').addEventListener('input', e => setVar('description', e.target.value));
$('#vTags').addEventListener('input', e => setVar('hashtags', e.target.value.split(/[\s,]+/).filter(Boolean).map(h => h.startsWith('#') ? h : '#' + h)));
$('#vHook').addEventListener('input', e => { setVar('hook', e.target.value); edVideo.currentTime = (S.ed.ranges[0]?.[0] ?? S.ed.clip.start) + 0.8; });
$('#vHookY').addEventListener('input', e => { setVar('hookY', +e.target.value); fillRange(e.target); edVideo.currentTime = (S.ed.ranges[0]?.[0] ?? S.ed.clip.start) + 0.8; });
$('#vCapY').addEventListener('input', e => { setVar('capY', +e.target.value); fillRange(e.target); });
$('#vReset').addEventListener('click', () => {
  const c = S.ed.clip, v = S.ed.variant; if (!c.variants?.[v]) return;
  delete c.variants[v]; touch(false); syncVariants();
  snack(`${PLATFORMS[v].short} sürümü ortak ayarlara döndü`);
});
$('#pkgBtn').addEventListener('click', () => enqueuePackage(S.ed.clip));
/** Üç platform sürümünü sıraya alır; hepsi bitince video, kapak ve metinler tek ZIP olarak iner */
function enqueuePackage(clip) {
  if (!S.file) return snack('Önce videoyu yeniden seç.', { err: true });
  if (pickMime(S.settings.exportFormat) === null) return snack('Bu tarayıcı video kaydını desteklemiyor. Chrome veya Edge kullan.', { err: true });
  const pkg = uid();
  for (const id of Object.keys(PLATFORMS)) S.queue.push({ id: uid(), clipId: clip.id, variant: id, pkg, name: `${clip.title} (${PLATFORMS[id].short})`, state: 'waiting', progress: 0, project: S.project, videoUrl: S.videoUrl, settings: { ...S.settings } });
  $('#queue').hidden = false; renderQueue();
  snack('3 platform sürümü sıraya alındı. Bitince tek ZIP dosyası inecek; bu sekmeyi açık tut.');
  processQueue();
}
/** Klibin kapak görseli: kanca metniyle, klibin ilk saniyesinden bir kare */
async function renderCover(clipV, project, videoUrl, t) {
  await loadFonts();
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = videoUrl;
  try {
    await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('Video okunamadı')); });
    await new Promise(r => { v.onseeked = r; v.currentTime = t; });
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = Math.round(1080 * ratioH(clipV.ratio));
    const fake = { ...clipV, id: clipV.id + '-cover', hookOn: !!clipV.hook, hookDur: 999, captionsOn: false, progressOn: false, autoZoom: false, _outDur: 1, hookY: Math.max(0.12, clipV.hookY ?? 0.14) };
    new Compositor(cv).draw(v, fake, project, t, 0.6);
    return await new Promise(r => cv.toBlob(r, 'image/png'));
  } finally { v.removeAttribute('src'); v.load(); }
}
async function finishPackage(pkg) {
  const jobs = S.queue.filter(q => q.pkg === pkg);
  if (jobs.some(j => j.state === 'waiting' || j.state === 'running')) return;
  const done = jobs.filter(j => j.state === 'done' && j.blob);
  if (!done.length) return;
  const files = [];
  const base = safeName(jobs[0].baseTitle || jobs[0].name.replace(/ \([^)]*\)$/, ''));
  for (const j of done) {
    const P = PLATFORMS[j.variant], folder = `${P.short}/`;
    files.push({ name: folder + `${base}-${j.variant}.${j.ext}`, blob: j.blob });
    if (j.cover) files.push({ name: folder + `${base}-${j.variant}-kapak.png`, blob: j.cover });
    const v = j.meta;
    files.push({ name: folder + `${base}-${j.variant}-metin.txt`, blob: new Blob([`${P.label}\n\nBaşlık:\n${v.title}\n\nAçıklama:\n${v.description}\n\nEtiketler:\n${v.hashtags.join(' ')}\n`], { type: 'text/plain;charset=utf-8' }) });
  }
  const zip = await makeZip(files);
  download(zip, `${base}-platform-paketi.zip`);
  snack(done.length === jobs.length ? 'Platform paketi indirildi' : `Paket indirildi (${jobs.length - done.length} sürüm başarısız oldu)`);
}

// ------------------------------------------------------------------ LOGO
async function ensureLogo(id) {
  if (!id || hasLogoImage(id)) return;
  const b = await DB.getHandle('logo:' + id);
  if (b) { try { setLogoImage(id, await createImageBitmap(b)); } catch {} }
}
const POS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
$('#logoPos').innerHTML = POS.map(p => `<button data-v="${p}" aria-label="Konum ${p}"></button>`).join('');
function renderLogo() {
  const c = S.ed.clip;
  $('#logoCtrls').hidden = !c.logo;
  $('#logoBox').innerHTML = c.logo
    ? `<div class="music-row"><svg class="ic"><use href="#i-image"/></svg><b title="${escapeHtml(c.logo.name)}">${escapeHtml(c.logo.name)}</b>
        <label class="btn text sm"><input type="file" accept="image/*" data-logo hidden>Değiştir</label>
        <button class="btn icon sm" id="logoRm" aria-label="Logoyu kaldır" title="Logoyu kaldır"><svg class="ic"><use href="#i-trash"/></svg></button></div>`
    : `<label class="btn tonal sm"><input type="file" accept="image/*" data-logo hidden><svg class="ic"><use href="#i-image"/></svg>Logo ekle (PNG önerilir)</label>`;
  if (c.logo) {
    segOn('#logoPos', c.logo.pos || 'tr');
    const set = (id, v, out) => { const el = $('#' + id); el.value = v; fillRange(el); $('#' + id + 'Out').textContent = out; };
    set('logoSize', c.logo.size ?? 0.2, Math.round((c.logo.size ?? 0.2) * 100) + '%');
    set('logoOp', c.logo.opacity ?? 0.9, Math.round((c.logo.opacity ?? 0.9) * 100) + '%');
  }
}
$('#logoBox').addEventListener('change', async e => {
  if (!e.target.matches('[data-logo]')) return;
  const f = e.target.files[0]; if (!f) return;
  const ed = S.ed, c = ed.clip, proj = S.project; // dosya işlenirken klip değişebilir
  const id = uid();
  try { setLogoImage(id, await createImageBitmap(f)); } catch { return snack('Bu görsel açılamadı. PNG veya JPG dene.', { err: true }); }
  await DB.saveHandle('logo:' + id, f);
  c.logo = { id, name: f.name, pos: c.logo?.pos || 'tr', size: c.logo?.size ?? 0.2, opacity: c.logo?.opacity ?? 0.9 };
  proj.lastLogo = { ...c.logo };
  c.touched = true; c._rev = (c._rev || 0) + 1;
  if (S.ed === ed) { touch(); renderLogo(); } else if (S.project === proj) saveProject();
});
$('#logoBox').addEventListener('click', e => { if (e.target.closest('#logoRm')) { S.ed.clip.logo = null; S.project.lastLogo = null; touch(); renderLogo(); } });
$('#logoPos').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !S.ed.clip.logo) return; S.ed.clip.logo.pos = b.dataset.v; S.project.lastLogo = { ...S.ed.clip.logo }; segOn('#logoPos', b.dataset.v); touch(); });
$('#logoSize').addEventListener('input', e => { S.ed.clip.logo.size = +e.target.value; $('#logoSizeOut').textContent = Math.round(+e.target.value * 100) + '%'; S.project.lastLogo = { ...S.ed.clip.logo }; touch(); });
$('#logoOp').addEventListener('input', e => { S.ed.clip.logo.opacity = +e.target.value; $('#logoOpOut').textContent = Math.round(+e.target.value * 100) + '%'; S.project.lastLogo = { ...S.ed.clip.logo }; touch(false); });
$('#brandApplyAll').addEventListener('click', () => {
  const src = S.ed.clip;
  for (const c of S.project.clips) if (c !== src) { c.logo = src.logo ? { ...src.logo } : null; c.watermark = src.watermark; c.progressOn = src.progressOn; c.thumbRev = null; }
  saveProject(); snack(`Logo ve kanal adı ${S.project.clips.length - 1} klibe uygulandı`);
});

// ------------------------------------------------------------------ YOUTUBE BÖLÜMLERİ
let chaptersData = null;
async function runChapters(force = false) {
  const dlg = $('#chaptersDlg');
  // kayıtlı bölümler anahtarsız ve çevrimdışı da açılır
  if (S.project?.chapters && !force) { chaptersData = S.project.chapters; renderChapters(); return dlg.open || dlg.showModal(); }
  if (!S.project?.transcript) return snack('Önce transkript gerekli.', { action: 'Yazıya dök', onAction: () => runTranscribe() });
  if (!hasKey(S.settings.llmProvider)) return snack('Bölümler için AI anahtarı gerekli.', { action: 'Kurulum rehberi', onAction: () => openGuide(1) });
  $('#chaptersBody').innerHTML = '<p class="muted">AI yayını okuyup bölümlere ayırıyor…</p><div class="bar indet"><i></i></div>';
  if (!dlg.open) dlg.showModal();
  try {
    chaptersData = await youtubeChapters(S.project, S.settings);
    S.project.chapters = chaptersData; saveProject();
    renderChapters();
  } catch (err) { $('#chaptersBody').innerHTML = `<p class="g-status err">${escapeHtml(err.message)}</p>`; }
}
function chaptersText() {
  const d = chaptersData; if (!d) return '';
  return [d.description, '', ...d.chapters.map(c => `${fmtTime(c.t)} ${c.title}`)].join('\n').trim();
}
function renderChapters() {
  const d = chaptersData;
  $('#chaptersBody').innerHTML = `
    ${d.titles.length ? `<div class="field"><label>Başlık önerileri (tıkla, kopyala)</label><div class="chips ch-titles">${d.titles.map(t => `<button class="chip" data-copy-text="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div></div>` : ''}
    <div class="field"><label for="chaptersText">Açıklama ve bölümler</label><textarea id="chaptersText" spellcheck="false">${escapeHtml(chaptersText())}</textarea></div>`;
}
$('#chaptersBtn').addEventListener('click', () => runChapters());
$('#chaptersRegen').addEventListener('click', () => runChapters(true));
$('#chaptersCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#chaptersText')?.value || ''); snack('Açıklama kopyalandı'); } catch { snack('Kopyalanamadı', { err: true }); } });
$('#chaptersBody').addEventListener('click', async e => { const b = e.target.closest('[data-copy-text]'); if (b) { try { await navigator.clipboard.writeText(b.dataset.copyText); snack('Başlık kopyalandı'); } catch {} } });

// ------------------------------------------------------------------ DIŞA AKTARMA KUYRUĞU
$('#exportAllBtn').addEventListener('click', () => enqueue(sortedClips()));
function enqueue(clips) {
  if (!S.file) return snack('Önce videoyu yeniden seç.', { err: true });
  if (pickMime(S.settings.exportFormat) === null) return snack('Bu tarayıcı video kaydını desteklemiyor. Chrome veya Edge kullan.', { err: true });
  let added = 0;
  for (const c of clips) {
    if (S.queue.some(q => q.clipId === c.id && !q.variant && (q.state === 'waiting' || q.state === 'running'))) continue;
    S.queue.push({ id: uid(), clipId: c.id, name: c.title, state: 'waiting', progress: 0, project: S.project, videoUrl: S.videoUrl, settings: { ...S.settings } });
    added++;
  }
  $('#queue').hidden = false;
  renderQueue();
  if (added) snack(added > 1 ? `${added} klip sıraya alındı. Bu sekmeyi açık tut.` : 'Dışa aktarılıyor. Bu sekmeyi açık tut.');
  processQueue();
}

async function processQueue() {
  if (S.queue.some(q => q.state === 'running')) return;
  const job = S.queue.find(q => q.state === 'waiting');
  if (!job) return;
  // iş, sıraya alındığı projeye ve videoya bağlıdır (proje değişse bile)
  const proj = job.project;
  const clip = proj.clips.find(c => c.id === job.clipId);
  if (!clip) { job.state = 'error'; job.error = 'Klip silinmiş'; releaseJobVideo(job); renderQueue(); return processQueue(); }
  job.state = 'running'; job.ctrl = new AbortController();
  renderQueue();
  await loadFonts();
  try {
    const musicBlob = clip.music ? await getMusic(clip.music.id) : null;
    const clipV = job.variant ? applyVariant(clip, job.variant) : clip;
    const { blob, mime } = await exportClip({
      videoUrl: job.videoUrl, clip: clipV, project: proj, settings: job.settings, signal: job.ctrl.signal, musicBlob,
      onProgress: p => { job.progress = p; updateQueueItem(job); }
    });
    job.ext = extFor(mime);
    job.url = URL.createObjectURL(blob);
    job.size = blob.size;
    job.blob = blob;
    job.fileName = `${safeName(clipV.title)}${job.variant ? '-' + job.variant : ''}.${job.ext}`;
    if (job.pkg) {
      job.baseTitle = clip.title; job.meta = variantValues(clip, job.variant);
      job.cover = await renderCover(clipV, proj, job.videoUrl, (rangesFor(clip, proj)[0]?.[0] ?? clip.start) + 1).catch(() => null);
    }
    job.state = 'done';
    clip.exported = true;
    if (proj === S.project) { saveProject(); renderClips(); } else DB.saveProject(proj).catch(() => {});
    if (!job.pkg) { const a = document.createElement('a'); a.href = job.url; a.download = job.fileName; document.body.appendChild(a); a.click(); a.remove(); }
  } catch (e) {
    if (e.name === 'AbortError') job.state = 'canceled';
    else { console.error(e); job.state = 'error'; job.error = e.message; }
  }
  const pkg = job.pkg;
  if (pkg && !S.queue.some(q => q.pkg === pkg && (q.state === 'waiting' || q.state === 'running'))) {
    // paketin videosu son işten sonra bırakılır (kapak için gerekiyor)
    await finishPackage(pkg).catch(e => snack('Paket hazırlanamadı: ' + e.message, { err: true }));
  }
  releaseJobVideo(job);
  renderQueue();
  processQueue();
}
/** Proje değiştiyse ve eski videoyu bekleyen başka iş kalmadıysa video adresini bırak */
function releaseJobVideo(job) {
  const url = job.videoUrl;
  job.project = null; job.settings = null;
  if (!url || url === S.videoUrl) return;
  if (!S.queue.some(q => q !== job && q.videoUrl === url && (q.state === 'waiting' || q.state === 'running'))) URL.revokeObjectURL(url);
}

let queueCollapseT;
function renderQueue() {
  const q = S.queue;
  const busy = q.some(x => x.state === 'running' || x.state === 'waiting');
  clearTimeout(queueCollapseT);
  $('#queueBtn').hidden = !q.length;
  $('#queueBadge').textContent = q.filter(x => x.state === 'done').length;
  if (busy) { $('#queue').hidden = false; $('#queue').classList.remove('collapsed'); }
  else if (q.length) queueCollapseT = setTimeout(() => { $('#queue').hidden = true; }, 3000);
  const done = q.filter(x => x.state === 'done').length;
  $('#queueSum').textContent = `${done}/${q.length} tamamlandı`;
  $('#queueList').innerHTML = q.map(j => `<li class="q-item ${j.state}" data-id="${j.id}">
    <span class="q-name">${escapeHtml(j.name)}</span>
    <span class="q-state">${qState(j)}</span>
    <span class="q-actions">
      ${j.state === 'done' && canShareJob(j) ? `<button class="btn icon sm" data-share="${j.id}" aria-label="Paylaş" title="Paylaş (TikTok, Instagram, WhatsApp…)"><svg class="ic"><use href="#i-share"/></svg></button>` : ''}
      ${j.state === 'done' ? `<a class="btn icon sm" href="${j.url}" download="${escapeHtml(j.fileName)}" aria-label="İndir" title="Tekrar indir"><svg class="ic"><use href="#i-download"/></svg></a>` : ''}
      ${j.state === 'running' || j.state === 'waiting' ? `<button class="btn icon sm" data-cancel="${j.id}" aria-label="İptal" title="İptal"><svg class="ic"><use href="#i-close"/></svg></button>` : ''}
      ${j.state === 'error' || j.state === 'canceled' ? `<button class="btn icon sm" data-retry="${j.id}" aria-label="Tekrar dene" title="Tekrar dene"><svg class="ic"><use href="#i-refresh"/></svg></button>` : ''}
    </span>
    ${j.state === 'running' ? `<div class="bar"><i style="width:${Math.round(j.progress * 100)}%"></i></div>` : ''}
  </li>`).join('');
}
function qState(j) {
  return j.state === 'running' ? `Kaydediliyor %${Math.round(j.progress * 100)}`
    : j.state === 'waiting' ? 'Sırada'
    : j.state === 'done' ? `İndirildi, ${j.ext.toUpperCase()}, ${fmtBytes(j.size)}`
    : j.state === 'canceled' ? 'İptal edildi' : 'Hata: ' + escapeHtml(j.error || '');
}
function updateQueueItem(j) {
  const li = $(`.q-item[data-id="${j.id}"]`); if (!li) return renderQueue();
  li.querySelector('.q-state').textContent = qState(j);
  const i = li.querySelector('.bar i'); if (i) i.style.width = Math.round(j.progress * 100) + '%';
}
$('#queueList').addEventListener('click', e => {
  const c = e.target.closest('[data-cancel]'), r = e.target.closest('[data-retry]');
  if (c) { const j = S.queue.find(x => x.id === c.dataset.cancel); if (j.state === 'waiting') { j.state = 'canceled'; releaseJobVideo(j); } else j.ctrl?.abort(); renderQueue(); }
  const sh = e.target.closest('[data-share]');
  if (sh) { const j = S.queue.find(x => x.id === sh.dataset.share); shareJob(j); return; }
  if (r) { const j = S.queue.find(x => x.id === r.dataset.retry); j.state = 'waiting'; j.progress = 0; renderQueue(); processQueue(); }
});
$('#queueBtn').addEventListener('click', () => { clearTimeout(queueCollapseT); const q = $('#queue'); q.hidden = !q.hidden; q.classList.remove('collapsed'); });
$('#queueHead').addEventListener('click', e => { if (!e.target.closest('#queueMin')) $('#queue').classList.toggle('collapsed'); });
$('#queueMin').addEventListener('click', () => {
  if (S.queue.some(q => q.state === 'running' || q.state === 'waiting')) { $('#queue').hidden = true; snack('Dışa aktarma arka planda sürüyor'); }
  else { S.queue.forEach(q => q.url && URL.revokeObjectURL(q.url)); S.queue = []; $('#queue').hidden = true; $('#queueBtn').hidden = true; }
});
window.addEventListener('beforeunload', e => {
  if (S.queue.some(q => q.state === 'running' || q.state === 'waiting') || S.job) { e.preventDefault(); e.returnValue = ''; }
});

// ------------------------------------------------------------------ AYARLAR
function openSettings(sec = 'ai') {
  fillSettings();
  setSection(sec);
  $('#settingsDlg').showModal();
}
$$('[data-open-settings]').forEach(b => b.addEventListener('click', () => openSettings()));
function setSection(sec) {
  $$('#setNav button').forEach(b => b.classList.toggle('on', b.dataset.sec === sec));
  $$('.set-body section').forEach(s => { s.hidden = s.dataset.sec !== sec; });
}
$('#setNav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setSection(b.dataset.sec); });

$('#llmProvider').innerHTML = Object.entries(LLM_PROVIDERS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('#sttProvider').innerHTML = Object.entries(STT_PROVIDERS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('#contentType').innerHTML = Object.entries(CONTENT_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

function fillSettings() {
  const s = S.settings;
  $$('#featList [data-feat]').forEach(i => { i.checked = feat(i.dataset.feat); });
  $('#llmProvider').value = s.llmProvider;
  syncLlmFields();
  $('#sttProvider').value = s.sttProvider;
  syncSttFields();
  $('#sttLang').value = s.language;
  $('#clipMin').value = s.clipMin; $('#clipMax').value = s.clipMax; $('#clipCount').value = s.clipCount;
  $('#titleLang').value = s.titleLang; $('#contentType').value = s.contentType; $('#customPrompt').value = s.customPrompt;
  segOn('#exportRes', s.exportRes); segOn('#exportFps', s.exportFps); segOn('#exportFormat', s.exportFormat);
  $('#brandHandle').value = s.brandHandle;
  renderThemes();
  segOn('#layoutMode', s.layoutMode || 'auto');
  const mime = pickMime(s.exportFormat);
  $('#fmtHint').textContent = mime === null ? 'Bu tarayıcı video kaydını desteklemiyor.' : `Bu tarayıcıda kullanılacak: ${extFor(mime).toUpperCase()}${extFor(mime) === 'webm' && s.exportFormat === 'auto' ? ' (MP4 desteği yok; Chrome 126+ veya Safari önerilir)' : ''}`;
}
function syncLlmFields() {
  const s = S.settings, p = s.llmProvider, def = LLM_PROVIDERS[p];
  $('#llmKey').value = s.keys[p] || '';
  $('#llmKey').placeholder = def.noKey ? 'Gerekmez' : 'Anahtarını yapıştır';
  $('#llmKey').disabled = !!def.noKey && p === 'ollama';
  $('#llmKeyLink').hidden = !def.keyUrl; if (def.keyUrl) $('#llmKeyLink').href = def.keyUrl;
  $('#llmBaseRow').hidden = !(p === 'custom' || p === 'ollama');
  $('#llmBase').value = s.llmBaseByProvider?.[p] || def.base || '';
  const chosen = s.llmModelByProvider?.[p] ?? '';
  const autoVal = AUTO_MODEL[p];
  const auto = !!autoVal && (!chosen || chosen === autoVal);
  $('#geminiAutoRow').hidden = !autoVal;
  if (autoVal) $('#autoModelText').innerHTML = p === 'openrouter'
    ? 'Ücretsiz modeller (önerilen) <small class="muted">Yalnızca ücretsiz OpenRouter modellerini kullanır; biri meşgulse sıradakini dener</small>'
    : 'Otomatik model (önerilen) <small class="muted">Çalışan Gemini modelini kendisi bulur; ücretsiz kota dolunca sıradakini dener</small>';
  $('#geminiAuto').checked = auto;
  $('#llmModelRow').hidden = auto;
  $('#llmModel').value = chosen === autoVal ? '' : chosen;
  $('#llmModel').placeholder = p === 'gemini' ? 'Örn. gemini-3.8-flash' : p === 'openrouter' ? 'Örn. deepseek/deepseek-chat-v3.1:free' : def.model ? `Varsayılan: ${def.model}` : 'Model adı';
  $('#llmModels').innerHTML = '';
  $('#testOut').textContent = '';
  s.llmModel = $('#llmModel').value;
}
function syncSttFields() {
  const s = S.settings, def = STT_PROVIDERS[s.sttProvider];
  $('#sttKey').value = s.keys[def.keyFrom] || '';
  $('#sttKeyHint').textContent = `Bu anahtar ${LLM_PROVIDERS[def.keyFrom]?.label || def.label} için AI analiziyle ortak kullanılır.`;
  $('#sttBaseRow').hidden = s.sttProvider !== 'custom';
  $('#sttBase').value = s.sttBaseUrl || '';
  $('#sttModel').value = s.sttModel || '';
  $('#sttModel').placeholder = `Varsayılan: ${def.model}`;
}
const persist = () => saveSettings(S.settings);
$('#llmProvider').addEventListener('change', e => { S.settings.llmProvider = e.target.value; syncLlmFields(); persist(); if (S.project) renderPipeline(); });
$('#llmKey').addEventListener('input', e => { S.settings.keys[S.settings.llmProvider] = e.target.value.trim(); persist(); if (S.project) renderPipeline(); });
$('#llmBase').addEventListener('input', e => { S.settings.llmBaseByProvider = { ...(S.settings.llmBaseByProvider || {}), [S.settings.llmProvider]: e.target.value.trim() }; persist(); });
$('#geminiAuto').addEventListener('change', e => {
  const p = S.settings.llmProvider, by = { ...(S.settings.llmModelByProvider || {}) };
  by[p] = e.target.checked ? AUTO_MODEL[p] : ($('#llmModel').value.trim() || (p === 'gemini' ? 'gemini-3.8-flash' : ''));
  S.settings.llmModelByProvider = by; persist();
  $('#llmModelRow').hidden = e.target.checked;
  if (!e.target.checked) { $('#llmModel').value = by[p]; $('#llmModel').focus(); if (p === 'openrouter') $('#fetchModels').click(); }
});
$('#llmModel').addEventListener('input', e => {
  S.settings.llmModelByProvider = { ...(S.settings.llmModelByProvider || {}), [S.settings.llmProvider]: e.target.value.trim() };
  S.settings.llmModel = e.target.value.trim(); persist();
});
$('#sttProvider').addEventListener('change', e => { S.settings.sttProvider = e.target.value; S.settings.sttModel = ''; syncSttFields(); persist(); });
$('#sttKey').addEventListener('input', e => { S.settings.keys[STT_PROVIDERS[S.settings.sttProvider].keyFrom] = e.target.value.trim(); persist(); if ($('#llmProvider').value === STT_PROVIDERS[S.settings.sttProvider].keyFrom) $('#llmKey').value = e.target.value.trim(); });
$('#sttBase').addEventListener('input', e => { S.settings.sttBaseUrl = e.target.value.trim(); persist(); });
$('#sttModel').addEventListener('input', e => { S.settings.sttModel = e.target.value.trim(); persist(); });
$('#sttLang').addEventListener('change', e => { S.settings.language = e.target.value; persist(); });
const numSet = (id, key, lo, hi) => $('#' + id).addEventListener('change', e => { const v = clamp(Math.round(+e.target.value || lo), lo, hi); e.target.value = v; S.settings[key] = v; if (S.settings.clipMax < S.settings.clipMin + 5) { S.settings.clipMax = S.settings.clipMin + 5; $('#clipMax').value = S.settings.clipMax; } persist(); });
numSet('clipMin', 'clipMin', 5, 175); numSet('clipMax', 'clipMax', 10, 180); numSet('clipCount', 'clipCount', 1, 40);
$('#titleLang').addEventListener('change', e => { S.settings.titleLang = e.target.value; persist(); });
$('#contentType').addEventListener('change', e => { S.settings.contentType = e.target.value; persist(); });
$('#customPrompt').addEventListener('input', e => { S.settings.customPrompt = e.target.value; persist(); });
['exportRes', 'exportFps', 'exportFormat'].forEach(id => $('#' + id).addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.settings[id] = id === 'exportFormat' ? b.dataset.v : +b.dataset.v; segOn('#' + id, b.dataset.v); persist(); fillSettings();
}));
$('#brandHandle').addEventListener('input', e => { S.settings.brandHandle = e.target.value; persist(); });
$$('[data-reveal]').forEach(b => b.addEventListener('click', () => { const i = $('#' + b.dataset.reveal); i.type = i.type === 'password' ? 'text' : 'password'; }));
$('#fetchModels').addEventListener('click', async e => {
  const b = e.currentTarget; b.classList.add('busy');
  try {
    const ms = await listModels(S.settings);
    $('#llmModels').innerHTML = ms.map(m => `<option value="${escapeHtml(m)}">`).join('');
    snack(S.settings.llmProvider === 'openrouter' ? `${ms.length} ücretsiz model bulundu. Model kutusuna tıklayıp seç.` : `${ms.length} model bulundu. Model kutusuna tıklayıp seç.`);
    $('#llmModel').focus();
  } catch (err) { snack(err.message, { err: true }); }
  b.classList.remove('busy');
});
$('#testLlm').addEventListener('click', async e => {
  const b = e.currentTarget; b.classList.add('busy'); $('#testOut').textContent = '';
  try {
    await testConnection(S.settings);
    const lp = S.settings.llmProvider, ch = S.settings.llmModelByProvider?.[lp] || AUTO_MODEL[lp];
    const gm = AUTO_MODEL[lp] && ch === AUTO_MODEL[lp] ? (lp === 'gemini' ? lastGeminiModel() : lastOpenRouterModel()) : null;
    $('#testOut').textContent = 'Bağlantı çalışıyor' + (gm ? ` (otomatik seçilen model: ${gm})` : '');
    $('#testOut').style.color = 'var(--ok)';
  }
  catch (err) { $('#testOut').textContent = err.message; $('#testOut').style.color = 'var(--err)'; }
  b.classList.remove('busy');
});


$('#featList').addEventListener('change', e => {
  const i = e.target.closest('[data-feat]'); if (!i) return;
  S.settings.features = { ...(S.settings.features || {}), [i.dataset.feat]: i.checked };
  persist(); applyFeatures();
});
/** Kapalı özelliklerin düğmelerini gizler */
function applyFeatures() {
  $('#glossBtn').hidden = !feat('glossary');
  if (!feat('compare')) S.cmpOpen = null;
  if (S.project) renderClips();
  if (S.ed) syncVariants();
}

// ------------------------------------------------------------------ TEMA
const THEMES = [
  { id: 'sunset', label: 'Gün batımı', sw: ['#141012', '#FF7A45', '#FF2D6F'] },
  { id: 'light', label: 'Açık', sw: ['#FFF8F4', '#E8521F', '#E3245E'] },
  { id: 'oled', label: 'OLED siyah', sw: ['#000000', '#FF7A45', '#FF2D6F'] },
  { id: 'indigo', label: 'Gece moru', sw: ['#121120', '#B6AFFF', '#FF5E7E'] },
  { id: 'system', label: 'Sisteme uy', sw: ['#141012', '#FFF8F4', '#FF7A45'] }
];
const lightMQ = matchMedia('(prefers-color-scheme: light)');
function applyTheme(t = S.settings.theme) {
  const eff = t === 'system' ? (lightMQ.matches ? 'light' : 'sunset') : (THEMES.some(x => x.id === t) ? t : 'sunset');
  document.documentElement.dataset.theme = eff;
  _cv = {};
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = cssVar('--ink-0');
  drawHype(); if (S.ed) { drawTrim(); renderLayouts(); }
}
lightMQ.addEventListener?.('change', () => { if (S.settings.theme === 'system') applyTheme(); });
function renderThemes() {
  $('#themeGrid').innerHTML = THEMES.map(t => `
    <button class="theme ${S.settings.theme === t.id ? 'on' : ''}" role="radio" aria-checked="${S.settings.theme === t.id}" data-theme-id="${t.id}">
      <span class="theme-sw" style="background:${t.sw[0]}">${t.id === 'system' ? `<i style="background:${t.sw[1]};left:50%;width:50%;top:0;height:100%;border-radius:0"></i>` : ''}<i style="background:${t.sw[1]}"></i><i style="background:${t.sw[2]}"></i></span>
      <span>${t.label}</span>
    </button>`).join('');
}
$('#themeGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-theme-id]'); if (!b) return;
  S.settings.theme = b.dataset.themeId; persist(); applyTheme(); renderThemes();
});

// ------------------------------------------------------------------ API KURULUM REHBERİ
const T_FREE = ['free', 'Ücretsiz'], T_PAID = ['paid', 'Ücretli'], T_REC = ['rec', 'Önerilen'];
const PROV = {
  gemini: { name: 'Google Gemini', tags: [['free', 'Ücretsiz katman'], T_REC], desc: 'Uzun transkriptleri hızlı okur; ücretsiz kotası çoğu kullanım için yeter. Kota dolarsa otomatik olarak başka Gemini modeline geçer.',
    url: 'https://aistudio.google.com/apikey', linkText: "Google AI Studio'yu aç", prefix: 'AIza',
    steps: ["Google AI Studio'yu aç.", 'Google hesabınla giriş yap ve ilk girişte kullanım şartlarını onayla.', '<b>Create API key</b> (API anahtarı oluştur) düğmesine bas. Proje sorarsa varsayılanı seç.', 'Oluşan anahtarı kopyala.'] },
  groq: { name: 'Groq', tags: [['free', 'Ücretsiz katman']], desc: 'Çok hızlı ve ücretsiz. Klip seçme kalitesi Gemini ve Claude kadar iyi olmayabilir.',
    url: 'https://console.groq.com/keys', linkText: 'Groq konsolunu aç', prefix: 'gsk_',
    steps: ['Groq konsolunu aç.', 'Google, GitHub veya e-posta ile ücretsiz hesap aç.', '<b>Create API Key</b> düğmesine bas, isim olarak "VertaCut" yaz.', 'Anahtarı hemen kopyala; Groq onu yalnızca bir kez gösterir.'] },
  openrouter: { name: 'OpenRouter', tags: [['free', 'Ücretsiz']], desc: 'Tek anahtarla yüzlerce model. VertaCut yalnızca ücretsiz modelleri kullanır ve biri meşgulse sıradakine geçer.',
    url: 'https://openrouter.ai/keys', linkText: 'OpenRouter anahtarlarını aç', prefix: 'sk-or-',
    steps: ['OpenRouter anahtar sayfasını aç.', 'Google veya e-posta ile giriş yap.', '<b>Create Key</b> düğmesine bas, isim ver.', 'Anahtarı kopyala ve buraya yapıştır. Ücretsiz modeller otomatik seçilir; kart veya bakiye gerekmez.'] },
  openai: { name: 'OpenAI (ChatGPT)', tags: [T_PAID], desc: 'GPT modelleri. Kullandıkça ödersin; hesaba önceden bakiye yüklemek gerekir.',
    url: 'https://platform.openai.com/api-keys', linkText: 'OpenAI anahtarlarını aç', prefix: 'sk-',
    steps: ['OpenAI platformunu aç ve giriş yap.', '<b>Billing</b> bölümünden bakiye yükle (en az 5 $).', '<b>Create new secret key</b> düğmesine bas.', 'Anahtarı kopyala; yalnızca bir kez gösterilir.'] },
  anthropic: { name: 'Anthropic Claude', tags: [T_PAID], desc: 'Başlık, kanca ve açıklama yazmada çok başarılı. Hesaba kredi yüklemek gerekir.',
    url: 'https://console.anthropic.com/settings/keys', linkText: 'Anthropic konsolunu aç', prefix: 'sk-ant-',
    steps: ['Anthropic konsolunu aç ve hesap oluştur.', '<b>Plans & Billing</b> bölümünden kredi yükle.', '<b>Create Key</b> düğmesine bas, isim ver.', 'Anahtarı kopyala.'] },
  deepseek: { name: 'DeepSeek', tags: [['paid', 'Ücretli, çok ucuz']], desc: 'Fiyatı çok düşük, Türkçe metinlerde iyi. Bakiye yüklemek gerekir.',
    url: 'https://platform.deepseek.com/api_keys', linkText: 'DeepSeek platformunu aç', prefix: 'sk-',
    steps: ['DeepSeek platformunu aç ve giriş yap.', '<b>Top up</b> ile bakiye yükle.', '<b>Create new API key</b> düğmesine bas.', 'Anahtarı kopyala.'] },
  xai: { name: 'xAI Grok', tags: [T_PAID], desc: 'Grok modelleri. Kredi yüklemek gerekir.',
    url: 'https://console.x.ai', linkText: 'xAI konsolunu aç', prefix: 'xai-',
    steps: ['xAI konsolunu aç ve giriş yap.', 'Kredi yükle.', '<b>API Keys</b> bölümünde yeni anahtar oluştur.', 'Anahtarı kopyala.'] },
  ollama: { name: 'Ollama (bilgisayarında)', tags: [T_FREE, ['adv', 'Kurulum gerekir']], desc: 'Model kendi bilgisayarında çalışır; anahtar gerekmez ama güçlü bir bilgisayar ve kurulum ister.',
    url: 'https://ollama.com/download', linkText: "Ollama'yı indir", prefix: '', noKey: true,
    steps: ["Ollama'yı indirip kur.", 'Terminalde <code>ollama pull llama3.1</code> yaz ve modeli indir.', 'Ollama\'yı tarayıcı erişimine açarak başlat: <code>OLLAMA_ORIGINS=* ollama serve</code>', 'Aşağıdan bağlantıyı test et.'] }
};
const STT_CHOICES = {
  groq: { name: 'Groq Whisper', tags: [['free', 'Ücretsiz katman'], T_REC], desc: 'Çok hızlı, kelime kelime zamanlı. Altyazılar için en iyisi.' },
  gemini: { name: 'Google Gemini', tags: [['free', 'Ücretsiz katman']], desc: 'Gemini anahtarınla çalışır, ek anahtar gerekmez. Kelime zamanları tahminidir; altyazı senkronu biraz daha kaba olur.' },
  openai: { name: 'OpenAI Whisper', tags: [T_PAID], desc: 'Kelime zamanlı ve isabetli. Dakika başı ücretlendirilir.' }
};
const guide = { step: 0, llm: null, stt: null, status: {} };
const guideDlg = $('#guideDlg');
const keyOf = p => (S.settings.keys[p] || '').trim();
function keysReady() { return hasKey(S.settings.llmProvider) && hasSttKey(); }

function guideSteps() {
  const st = ['intro', 'llm', 'llmkey', 'stt'];
  if (guide.stt && guide.stt !== guide.llm) st.push('sttkey');
  st.push('done');
  return st;
}
function maybeShowGuide() {
  if (S.settings.guideDismissed || keysReady()) return;
  $('#gAsk').hidden = false; $('#gSteps').hidden = true;
  $('#guideNever').checked = false;
  guideDlg.showModal();
}
function openGuide(step = 0) {
  if ($('#settingsDlg').open) $('#settingsDlg').close();
  $('#gAsk').hidden = true; $('#gSteps').hidden = false;
  guide.llm ||= S.settings.llmProvider in PROV ? S.settings.llmProvider : 'gemini';
  guide.stt ||= S.settings.sttProvider in STT_CHOICES ? S.settings.sttProvider : 'groq';
  guide.step = Math.min(step, guideSteps().length - 1);
  renderGuide();
  if (!guideDlg.open) guideDlg.showModal();
}
$('#guideYes').addEventListener('click', () => { if ($('#guideNever').checked) { S.settings.guideDismissed = true; persist(); } openGuide(0); });
$('#guideLater').addEventListener('click', () => {
  if ($('#guideNever').checked) { S.settings.guideDismissed = true; persist(); }
  guideDlg.close();
  snack('Rehbere istediğin zaman Ayarlar → AI analizi bölümünden ulaşabilirsin.');
});
guideDlg.addEventListener('cancel', () => { if (!$('#gAsk').hidden && $('#guideNever').checked) { S.settings.guideDismissed = true; persist(); } });
$('#guideClose').addEventListener('click', () => guideDlg.close());
$('#openGuide').addEventListener('click', () => openGuide(0));
$('#gBack').addEventListener('click', () => { if (guide.step > 0) { guide.step--; renderGuide(); } });
$('#gSkip').addEventListener('click', () => { guide.step = Math.min(guideSteps().length - 1, guide.step + 1); renderGuide(); });
$('#gNext').addEventListener('click', () => {
  const steps = guideSteps();
  if (steps[guide.step] === 'llm') { S.settings.llmProvider = guide.llm; persist(); }
  if (steps[guide.step] === 'stt') { S.settings.sttProvider = guide.stt; S.settings.sttModel = ''; persist(); }
  if (guide.step >= steps.length - 1) {
    guideDlg.close();
    if (S.project) renderPipeline();
    if (keysReady()) snack('Hazırsın. Bir video bırak ve "AI ile bul" de.');
    return;
  }
  guide.step++; renderGuide();
});

const tagsHtml = tags => `<span class="g-tags">${tags.map(([k, l]) => `<span class="tag ${k}">${l}</span>`).join('')}</span>`;
const extLink = (href, text) => `<a class="btn tonal sm" href="${href}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-key"/></svg>${text}</a>`;

function keyStepHtml(id, title) {
  const P = PROV[id];
  const val = keyOf(id);
  const st = guide.status[id];
  const keyBox = P.noKey ? `
    <div class="field g-key">
      <label for="gBase">Ollama adresi</label>
      <div class="copy-row"><input id="gKey" data-provider="${id}" type="text" value="${escapeHtml(S.settings.llmBaseByProvider?.[id] || 'http://localhost:11434/v1')}"><button class="btn filled sm" id="gTest">Test et</button></div>
      <small class="g-status ${st ? st.kind : ''}" id="gStatus">${st ? escapeHtml(st.msg) : 'Ollama çalışıyorsa bağlantıyı test et.'}</small>
    </div>` : `
    <div class="field g-key">
      <label for="gKey">Anahtarı buraya yapıştır</label>
      <div class="copy-row">
        <input id="gKey" data-provider="${id}" type="password" autocomplete="off" spellcheck="false" placeholder="${P.prefix}..." value="${escapeHtml(val)}">
        <button class="btn icon sm" data-reveal="gKey" aria-label="Göster"><svg class="ic"><use href="#i-eye"/></svg></button>
        <button class="btn filled sm" id="gTest">Kaydet ve test et</button>
      </div>
      <small class="g-status ${st ? st.kind : ''}" id="gStatus">${st ? escapeHtml(st.msg) : (val ? 'Kayıtlı bir anahtar var. Değiştirmek istersen yenisini yapıştır.' : `Anahtar genellikle "${P.prefix}" ile başlar.`)}</small>
    </div>`;
  return `
    <h2>${title}</h2>
    <p class="muted g-lead">Yeni sekmede ${P.name} sayfası açılacak. İşin bitince bu pencereye dönüp devam et.</p>
    <ol class="g-list">
      <li><span>${P.steps[0]}</span>${extLink(P.url, P.linkText)}</li>
      ${P.steps.slice(1).map(x => `<li><span>${x}</span></li>`).join('')}
    </ol>${keyBox}`;
}

function renderGuide() {
  const steps = guideSteps();
  const step = steps[guide.step];
  $('#gDots').innerHTML = steps.map((_, i) => `<li class="${i < guide.step ? 'done' : i === guide.step ? 'on' : ''}"><span>${i + 1}</span></li>`).join('');
  const body = $('#gBody');
  if (step === 'intro') {
    body.innerHTML = `
      <h2>Neye ihtiyacın var</h2>
      <p class="muted g-lead">VertaCut iki iş için yapay zekâ kullanır. İkisi için de ücretsiz seçenekler var.</p>
      <div class="g-cards">
        <div class="g-card"><svg class="ic"><use href="#i-spark"/></svg><div><b>Klipleri bulan AI</b><span>Yazıya dökülen metni okuyup en iyi anları, başlıkları, kancaları ve etiketleri seçer.</span></div></div>
        <div class="g-card"><svg class="ic"><use href="#i-mic"/></svg><div><b>Yazıya döken AI</b><span>Videodaki konuşmayı kelime kelime yazıya döker. Altyazılar buradan gelir.</span></div></div>
      </div>
      <p class="note"><svg class="ic sm"><use href="#i-lock"/></svg>Anahtarlar yalnızca bu tarayıcıda saklanır. Videon hiçbir yere yüklenmez; yazıya döken servise sadece ses, klip bulan servise sadece metin gider.</p>`;
  } else if (step === 'llm') {
    body.innerHTML = `
      <h2>Klipleri hangi AI bulsun?</h2>
      <p class="muted g-lead">Emin değilsen önerileni seç; sonradan Ayarlar'dan değiştirebilirsin.</p>
      <div class="g-choices" role="radiogroup">${Object.entries(PROV).map(([k, P]) => `
        <button class="g-choice ${guide.llm === k ? 'on' : ''}" role="radio" aria-checked="${guide.llm === k}" data-llm="${k}">
          <b>${P.name}</b>${tagsHtml(keyOf(k) ? [...P.tags, ['adv', 'Anahtar kayıtlı']] : P.tags)}<small>${P.desc}</small>
        </button>`).join('')}</div>`;
  } else if (step === 'llmkey') {
    body.innerHTML = keyStepHtml(guide.llm, `${PROV[guide.llm].name} ${PROV[guide.llm].noKey ? 'kurulumu' : 'anahtarı'}`);
  } else if (step === 'stt') {
    body.innerHTML = `
      <h2>Konuşmayı hangi AI yazıya döksün?</h2>
      <p class="muted g-lead">Altyazıların doğruluğu ve kelime senkronu bu seçime bağlı.</p>
      <div class="g-choices" role="radiogroup">${Object.entries(STT_CHOICES).map(([k, C]) => `
        <button class="g-choice ${guide.stt === k ? 'on' : ''}" role="radio" aria-checked="${guide.stt === k}" data-stt="${k}">
          <b>${C.name}</b>${tagsHtml(keyOf(k) ? [...C.tags, ['adv', 'Anahtar kayıtlı']] : C.tags)}<small>${C.desc}${k === guide.llm ? ' Bir önceki adımdaki anahtarı kullanır.' : ''}</small>
        </button>`).join('')}</div>`;
  } else if (step === 'sttkey') {
    body.innerHTML = keyStepHtml(guide.stt, `${PROV[guide.stt].name} anahtarı (yazıya dökme)`);
  } else {
    const llmOk = hasKey(guide.llm), sttOk = !!keyOf(STT_PROVIDERS[guide.stt].keyFrom);
    body.innerHTML = `
      <h2>${llmOk && sttOk ? 'Her şey hazır' : 'Neredeyse bitti'}</h2>
      <ul class="g-summary">
        <li class="${llmOk ? 'ok' : ''}"><svg class="ic"><use href="${llmOk ? '#i-check' : '#i-close'}"/></svg>Klipleri bulan: ${PROV[guide.llm].name}, ${llmOk ? 'bağlı' : 'bağlı değil'}</li>
        <li class="${sttOk ? 'ok' : ''}"><svg class="ic"><use href="${sttOk ? '#i-check' : '#i-close'}"/></svg>Yazıya döken: ${STT_CHOICES[guide.stt].name}, ${sttOk ? 'bağlı' : 'bağlı değil'}</li>
      </ul>
      <p class="muted g-lead">${llmOk && sttOk
        ? 'Bir yayın videosu bırak, kadrajı ayarla ve <b>AI ile bul</b> düğmesine bas.'
        : 'Eksik anahtar olsa da uygulamayı kullanabilirsin: <b>Sesten</b> düğmesi yüksek ses tepkilerinden klip bulur. Anahtarları sonra Ayarlar → AI analizi bölümünden ekleyebilirsin.'}</p>`;
  }
  $('#gBack').hidden = guide.step === 0;
  $('#gSkip').hidden = !(step === 'llmkey' || step === 'sttkey');
  $('#gNext').textContent = step === 'done' ? 'Başla' : step === 'intro' ? 'Başlayalım' : 'İleri';
  body.querySelector('[data-reveal]')?.addEventListener('click', () => { const i = $('#gKey'); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('#gTest')?.addEventListener('click', guideTest);
  $('#gKey')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guideTest(); } });
  body.scrollTop = 0;
}
$('#gBody').addEventListener('click', e => {
  const l = e.target.closest('[data-llm]'), t = e.target.closest('[data-stt]');
  if (l) { guide.llm = l.dataset.llm; renderGuide(); }
  if (t) { guide.stt = t.dataset.stt; renderGuide(); }
});
$('#gBody').addEventListener('dblclick', e => { if (e.target.closest('[data-llm],[data-stt]')) $('#gNext').click(); });

async function guideTest() {
  const inp = $('#gKey'), id = inp.dataset.provider, val = inp.value.trim();
  const P = PROV[id], out = $('#gStatus'), btn = $('#gTest');
  if (!val) { out.className = 'g-status err'; out.textContent = P.noKey ? 'Adres boş olamaz.' : 'Önce anahtarı yapıştır.'; return; }
  btn.classList.add('busy'); out.className = 'g-status'; out.textContent = 'Kontrol ediliyor…';
  try {
    if (P.noKey) { await testKey(id, '', val); S.settings.llmBaseByProvider = { ...(S.settings.llmBaseByProvider || {}), [id]: val }; }
    else { await testKey(id, val); S.settings.keys[id] = val; }
    const steps = guideSteps();
    if (steps[guide.step] === 'llmkey') S.settings.llmProvider = id;
    persist();
    guide.status[id] = { kind: 'ok', msg: P.noKey ? 'Ollama bağlandı.' : 'Bağlandı ve kaydedildi.' };
    out.className = 'g-status ok'; out.textContent = guide.status[id].msg;
    if (S.project) renderPipeline();
    const here = guide.step;
    setTimeout(() => { if (guide.step === here && guideDlg.open) { guide.step++; renderGuide(); } }, 700);
  } catch (e) {
    if (/bağlantısı kurulamadı/.test(e.message) && !P.noKey) {
      S.settings.keys[id] = val; persist();
      guide.status[id] = { kind: 'warn', msg: 'Anahtar kaydedildi ama şu an doğrulanamadı (internet bağlantını kontrol et).' };
    } else guide.status[id] = { kind: 'err', msg: P.noKey ? 'Ollama\'ya ulaşılamadı. Çalıştığından ve OLLAMA_ORIGINS=* ile başlatıldığından emin ol.' : e.message.replace(/^\d+:\s*/, 'Anahtar kabul edilmedi: ') };
    out.className = 'g-status ' + guide.status[id].kind; out.textContent = guide.status[id].msg;
  }
  btn.classList.remove('busy');
}

// ------------------------------------------------------------------ MOBİL MOD
function applyLayoutMode() {
  const mode = S.settings.layoutMode || 'auto';
  const narrow = innerWidth <= 860;
  const m = mode === 'mobile' || (mode === 'auto' && narrow);
  document.body.classList.toggle('m', m);
  document.body.classList.toggle('m-forced', mode === 'mobile' && !narrow);
  if (!document.body.dataset.mtab) document.body.dataset.mtab = 'video';
  requestAnimationFrame(() => { drawHype(); if (S.ed) drawTrim(); });
}
addEventListener('resize', debounce(applyLayoutMode, 120));
function setMTab(tab) {
  document.body.dataset.mtab = tab;
  $$('#mNav button').forEach(b => b.classList.toggle('on', b.dataset.mtab === tab));
  scrollTo({ top: 0 });
  requestAnimationFrame(() => { drawHype(); if (tab === 'text') highlightWord(true); });
}
$('#mNav').addEventListener('click', e => { const b = e.target.closest('[data-mtab]'); if (b) setMTab(b.dataset.mtab); });
new ResizeObserver(() => {
  const st = $('.stage');
  if (st && document.body.classList.contains('m')) document.documentElement.style.setProperty('--stage-h', st.offsetHeight + 'px');
}).observe($('.stage'));
$('#layoutMode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.settings.layoutMode = b.dataset.v; persist(); segOn('#layoutMode', b.dataset.v); applyLayoutMode();
});

// ------------------------------------------------------------------ DİL SEÇİMİ (yazıya dökmeden önce)
const SPOKEN = [['tr', 'Türkçe'], ['en', 'İngilizce'], ['de', 'Almanca'], ['es', 'İspanyolca'], ['fr', 'Fransızca'], ['ar', 'Arapça'],
  ['ru', 'Rusça'], ['pt', 'Portekizce'], ['it', 'İtalyanca'], ['az', 'Azerice'], ['ja', 'Japonca'], ['ko', 'Korece'], ['auto', 'Bilmiyorum, otomatik algıla']];
function askLanguage() {
  return new Promise(resolve => {
    const dlg = $('#langDlg');
    let lang = S.project?.language || S.settings.language || 'tr';
    let tl = S.settings.titleLang || 'tr';
    $('#langGrid').innerHTML = SPOKEN.map(([v, l]) => `<button type="button" role="radio" data-v="${v}" class="${v === 'auto' ? 'auto' : ''} ${v === lang ? 'on' : ''}" aria-checked="${v === lang}">${l}</button>`).join('');
    segOn('#langTitleSeg', tl);
    let done = false;
    const finish = val => {
      if (done) return; done = true;
      $('#langGrid').onclick = $('#langTitleSeg').onclick = $('#langOk').onclick = $('#langCancel').onclick = null;
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(val);
    };
    const onClose = () => finish(null);
    $('#langGrid').onclick = e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      lang = b.dataset.v;
      $$('#langGrid button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    };
    $('#langGrid').ondblclick = e => { if (e.target.closest('[data-v]')) $('#langOk').click(); };
    $('#langTitleSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; tl = b.dataset.v; segOn('#langTitleSeg', tl); };
    $('#langOk').onclick = () => {
      S.settings.language = lang; S.settings.titleLang = tl; persist();
      if (S.project) { S.project.language = lang; saveProject(); }
      finish({ lang, titleLang: tl });
    };
    $('#langCancel').onclick = () => finish(null);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    $('#langGrid .on')?.focus();
  });
}

// ------------------------------------------------------------------ KLAVYE
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  // Odaktaki düğme kendi Enter/Boşluk davranışını kullansın (çift tetiklemeyi önler)
  if ((e.key === 'Enter' || e.code === 'Space') && e.target.closest('button, a, [role="tab"], .clip, .recent-item, .handle')) return;
  const view = document.body.dataset.view;
  if (e.key === '?') { e.preventDefault(); $('#keysDlg').showModal(); return; }
  if (view === 'editor') {
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey) { enqueue([S.ed.clip]); return; }
    if (e.code === 'Space') { e.preventDefault(); edToggle(); }
    else if (e.key === 'Escape') closeEditor();
    else if (e.key === 'ArrowRight' && e.altKey) edNav(1);
    else if (e.key === 'ArrowLeft' && e.altKey) edNav(-1);
    return;
  }
  if (view !== 'workspace' || !S.file) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'i' || e.key === 'I') setMark('in');
  else if (e.key === 'o' || e.key === 'O') setMark('out');
  else if (e.key === 'Enter' && !$('#addMarked').disabled) addMarkedClip();
  else if (e.key === 'ArrowRight') mainVideo.currentTime += e.shiftKey ? 30 : 5;
  else if (e.key === 'ArrowLeft') mainVideo.currentTime -= e.shiftKey ? 30 : 5;
  else if (e.key === 'Escape') { S.markIn = S.markOut = null; updateMarks(); drawHype(); }
});

// ------------------------------------------------------------------ PWA
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => {
  if (!S.installEvt) return;
  S.installEvt.prompt();
  await S.installEvt.userChoice.catch(() => {});
  S.installEvt = null; $('#installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; snack('VertaCut yüklendi'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW kaydı başarısız', e));
}
// Diğer uygulamalardan "Paylaş" ile gelen ya da dosya olarak açılan videolar (PWA file_handlers)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    const h = params.files?.[0]; if (!h) return;
    openFile(await h.getFile(), h);
  });
}

// ------------------------------------------------------------------ başlat
applyTheme();
applyLayoutMode();
applyFeatures();
show('home');
initHome();
loadFonts();
setTimeout(maybeShowGuide, 700);
if (location.protocol === 'file:') snack('Uygulamayı bir web sunucusundan (Netlify, GitHub Pages veya yerel sunucu) açman gerekiyor.', { err: true, ms: 15000 });
window.__hc = S; // hata ayıklama için
