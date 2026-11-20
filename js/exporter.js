// VertaCut — tarayıcı içinde 9:16 dışa aktarma (canvas + MediaRecorder)
import { Compositor, clipWords, ratioH } from './render.js';
import { keepRanges, removeFillers, teaserSegments, isFiller } from './audio.js';
import { normWord } from './captions.js';
import { sleep } from './util.js';
import { playSfx, sfxEvents, crossed, duckFactor } from './sfx.js';

export function pickMime(pref = 'auto') {
  // Öncelik: H.264 + AAC → H.264 + Opus → H.264 → (son çare) tarayıcının varsayılan MP4'ü
  const mp4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs="avc1.42E01E, mp4a.40.2"',
    'video/mp4;codecs=avc1.640028,opus', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const list = pref === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm];
  if (typeof MediaRecorder === 'undefined') return null;
  return list.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
}

export const extFor = mime => (mime || '').includes('mp4') ? 'mp4' : 'webm';

/** Klip için oynatılacak aralıklar (jump-cut açıksa sessizlikler atlanır) */
export function rangesFor(clip, project) {
  let out = clip.segments?.length ? clip.segments.map(([a, b]) => [a, b]) : [[clip.start, clip.end]];
  const words = (clip.jumpcut || clip.fillers || clip.teaser) ? clipWords(clip, project.transcript) : [];
  if (clip.jumpcut) out = out.flatMap(([a, b]) => keepRanges(a, b, words.length > 1 ? words : null, project.energy));
  if (clip.fillers && words.length) out = removeFillers(out, words, clip.fillerWords);
  if (clip.teaser && !clip.segments) {
    const emph = new Set((clip.emphasis || []).map(e => normWord(e.word)).concat(words.filter(w => w.emph).map(w => normWord(w.w))));
    const tz = teaserSegments(clip.start, clip.end, words, project.energy, emph, 3);
    if (tz.length >= 2) { out = [...tz, ...out]; out.teaser = tz.length; }
  }
  return out;
}

export const outDuration = ranges => ranges.reduce((a, [s, e]) => a + (e - s), 0);

/** Sıradaki parça bilindiğinde ilerleme (teaser gibi çakışan aralıklar için) */
export function progressAtSeq(ranges, t, seg) {
  const total = outDuration(ranges) || 1;
  if (seg == null || !ranges[seg]) return progressAt(ranges, t);
  let acc = 0; for (let i = 0; i < seg; i++) acc += ranges[i][1] - ranges[i][0];
  const [a, b] = ranges[seg];
  return Math.min(1, (acc + Math.min(b - a, Math.max(0, t - a))) / total);
}
/** Kaynak zamanının hangi parçaya düştüğü (çakışmada ana kısım tercih edilir) */
export function segIndexFor(ranges, t) {
  for (let i = ranges.length - 1; i >= 0; i--) if (t >= ranges[i][0] - 0.05 && t < ranges[i][1]) return i;
  const n = ranges.findIndex(([a]) => a > t);
  return n < 0 ? ranges.length - 1 : n;
}

/** Kaynak zamanı → çıktı ilerlemesi (0..1) */
export function progressAt(ranges, t) {
  const total = outDuration(ranges) || 1;
  let acc = 0;
  for (const [s, e] of ranges) {
    if (t < s) break;
    if (t <= e) return (acc + (t - s)) / total;
    acc += e - s;
  }
  return Math.min(1, acc / total);
}

let audioCtx = null;
const elementNodes = new WeakMap();

/**
 * @returns {Promise<{blob: Blob, mime: string}>}
 */
export async function exportClip({ videoUrl, clip, project, settings, musicBlob = null, onProgress = () => {}, signal }) {
  const mime = pickMime(settings.exportFormat);
  if (mime === null) throw new Error('Bu tarayıcı MediaRecorder desteklemiyor. Chrome, Edge veya güncel Safari kullan.');
  const res = settings.exportRes || 1080;
  const W = res === 720 ? 720 : res === 1440 ? 1440 : 1080;
  const H = Math.round(W * ratioH(clip.ratio) / 2) * 2;
  const fps = settings.exportFps || 30;

  const video = document.createElement('video');
  video.src = videoUrl;
  video.preload = 'auto';
  video.playsInline = true;
  video.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;opacity:0';
  document.body.appendChild(video);
  await new Promise((r, j) => { video.onloadeddata = r; video.onerror = () => j(new Error('Video yüklenemedi')); });

  audioCtx ||= new AudioContext();
  await audioCtx.resume();
  let node = elementNodes.get(video);
  if (!node) { node = audioCtx.createMediaElementSource(video); elementNodes.set(video, node); }
  const dest = audioCtx.createMediaStreamDestination();
  let clean = null;
  if (clip.cleanAudio) {
    // sesi iyileştir: uğultu kesme + netlik + kompresör
    const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85;
    const pres = audioCtx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 3;
    const comp = audioCtx.createDynamicsCompressor(); comp.threshold.value = -26; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    const make = audioCtx.createGain(); make.gain.value = 1.5;
    node.connect(hp); hp.connect(pres); pres.connect(comp); comp.connect(make); make.connect(dest);
    clean = [hp, pres, comp, make];
  } else node.connect(dest);
  // arka plan müziği (otomatik kısma ile)
  let musicEl = null, musicNode = null, musicGain = null, musicUrl = null;
  const mvol = clip.music?.vol ?? 0.18;
  if (musicBlob && clip.music) {
    musicUrl = URL.createObjectURL(musicBlob);
    musicEl = new Audio(musicUrl); musicEl.loop = true; musicEl.preload = 'auto';
    await new Promise(r => { musicEl.oncanplaythrough = r; musicEl.onerror = r; setTimeout(r, 3000); });
    musicNode = audioCtx.createMediaElementSource(musicEl);
    musicGain = audioCtx.createGain(); musicGain.gain.value = mvol;
    musicNode.connect(musicGain); musicGain.connect(dest);
  }

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const comp = new Compositor(canvas);
  const words = clipWords(clip, project.transcript);
  const ranges = rangesFor(clip, project);
  const total = outDuration(ranges);
  const drawClip = { ...clip, _outDur: total };
  const events = sfxEvents(clip, words, ranges);
  let lastT = -1;

  const stream = canvas.captureStream(fps);
  dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
  const bitrate = W >= 1440 ? 16e6 : W >= 1080 ? 10e6 : 5e6;
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });

  let running = true;
  const draw = () => {
    if (!running) return;
    const t = video.currentTime;
    comp.draw(video, drawClip, project, t, progressAtSeq(ranges, t, video._seg ?? 0), words, ranges);
  };
  // Hem rVFC hem zamanlayıcı: sekme arka plandayken de kare üretmeye devam etmeye çalışır
  const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  const vfc = () => { draw(); if (running && hasRVFC) video.requestVideoFrameCallback(vfc); };
  if (hasRVFC) video.requestVideoFrameCallback(vfc);
  const timer = setInterval(draw, 1000 / fps);

  const seek = t => new Promise(r => {
    const done = () => { video.removeEventListener('seeked', done); r(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });

  try {
    let doneDur = 0;
    for (let i = 0; i < ranges.length; i++) {
      const [s, e] = ranges[i];
      video._seg = i;
      await seek(s);
      draw();
      await sleep(40);
      if (rec.state === 'inactive') rec.start(500);
      else if (rec.state === 'paused') rec.resume();
      lastT = s - 0.001;
      await video.play();
      musicEl?.play().catch(() => {});
      await new Promise((resolve, reject) => {
        const iv = setInterval(() => {
          if (signal?.aborted) { clearInterval(iv); reject(new DOMException('İptal edildi', 'AbortError')); return; }
          const t = video.currentTime;
          for (const ev of crossed(events, lastT, t)) playSfx(audioCtx, dest, ev.type, clip.sfxVol ?? 0.5);
          lastT = t;
          if (musicGain) musicGain.gain.setTargetAtTime(mvol * (clip.music.duck !== false ? duckFactor(t, words, project.energy) : 1), audioCtx.currentTime, 0.12);
          onProgress(Math.min(0.999, (doneDur + Math.max(0, t - s)) / total));
          if (t >= e - 0.02 || video.ended) { clearInterval(iv); resolve(); }
        }, 15);
      });
      video.pause(); musicEl?.pause();
      if (rec.state === 'recording') rec.pause();
      doneDur += e - s;
    }
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
  } finally {
    running = false;
    clearInterval(timer);
    try { node.disconnect(); } catch {}
    clean?.forEach(n => { try { n.disconnect(); } catch {} });
    if (musicEl) { musicEl.pause(); try { musicNode.disconnect(); } catch {} URL.revokeObjectURL(musicUrl); }
    stream.getTracks().forEach(t => t.stop());
    video.pause(); video.removeAttribute('src'); video.load(); video.remove();
  }
  if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
  onProgress(1);
  const type = (mime || 'video/webm').split(';')[0];
  return { blob: new Blob(chunks, { type }), mime: type };
}

/** Klip altyazılarını SRT olarak üretir (klip başına göre zaman) */
export function clipSrt(clip, project) {
  const words = clipWords(clip, project.transcript).filter(w => !w.hidden);
  const ranges = rangesFor(clip, project);
  const total = outDuration(ranges);
  const main = ranges.teaser ? ranges.slice(ranges.teaser) : ranges;
  const offset = total - outDuration(main);
  const map = t => offset + progressAt(main, t) * outDuration(main);
  const lines = []; let cur = [];
  const flush = () => { if (cur.length) { lines.push(cur); cur = []; } };
  for (const w of words) { if (cur.length >= 7 || (cur.length && w.s - cur[cur.length - 1].e > 0.8)) flush(); cur.push(w); }
  flush();
  const ts = t => {
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000) % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  return lines.map((l, i) => `${i + 1}\n${ts(map(Math.max(clip.start, l[0].s)))} --> ${ts(map(Math.min(clip.end, l[l.length - 1].e)))}\n${l.map(w => w.w).join(' ')}\n`).join('\n');
}
