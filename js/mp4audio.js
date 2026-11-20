// VertaCut — MP4/MOV dosyasından yalnızca ses izini okuyup WebCodecs ile çözer.
// Dosyanın tamamı belleğe alınmaz; ses örnekleri parça parça okunur. 2 saatlik yayın ≈ 1–2 dk.
const TARGET = 16000;

class Unsupported extends Error {}

async function readAt(file, off, len) {
  return new DataView(await file.slice(off, off + len).arrayBuffer());
}
const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
const u64 = (dv, o) => dv.getUint32(o) * 2 ** 32 + dv.getUint32(o + 4);

/** Üst düzey kutuları gezip moov kutusunu bulur (moov sonda da olabilir) */
async function findMoov(file) {
  let off = 0;
  let sawMoof = false;
  while (off + 8 <= file.size) {
    const h = await readAt(file, off, 16);
    let size = h.getUint32(0); const type = fourcc(h, 4); let hdr = 8;
    if (size === 1) { size = u64(h, 8); hdr = 16; } else if (size === 0) size = file.size - off;
    if (size < hdr) break;
    if (type === 'moof') sawMoof = true;
    if (type === 'moov') {
      if (size > 512 * 1024 * 1024) throw new Unsupported('moov çok büyük');
      return { moov: new DataView(await file.slice(off + hdr, off + size).arrayBuffer()), sawMoof };
    }
    off += size;
  }
  throw new Unsupported('moov bulunamadı');
}

function children(dv, start = 0, end = dv.byteLength) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o); const type = fourcc(dv, o + 4); let hdr = 8;
    if (size === 1) { size = u64(dv, o + 8); hdr = 16; } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o + hdr, end: o + size });
    o += size;
  }
  return out;
}
const child = (dv, box, type) => children(dv, box.start, box.end).find(b => b.type === type);
const path = (dv, box, ...types) => types.reduce((b, t) => b && child(dv, b, t), box);

// esds içindeki tanımlayıcı uzunluğu (1–4 bayt, 7 bit)
function descLen(dv, o) {
  let len = 0, i = 0, b;
  do { b = dv.getUint8(o + i); len = (len << 7) | (b & 0x7f); i++; } while (b & 0x80 && i < 4);
  return { len, n: i };
}

function parseEsds(dv, box) {
  let o = box.start + 4; // version + flags
  const end = box.end;
  let oti = 0, asc = null;
  while (o < end) {
    const tag = dv.getUint8(o); const { len, n } = descLen(dv, o + 1); const body = o + 1 + n;
    if (tag === 0x03) { // ES_Descriptor
      const flags = dv.getUint8(body + 2);
      let p = body + 3;
      if (flags & 0x80) p += 2;
      if (flags & 0x40) p += 1 + dv.getUint8(p);
      if (flags & 0x20) p += 2;
      o = p; continue;
    }
    if (tag === 0x04) { oti = dv.getUint8(body); o = body + 13; continue; } // DecoderConfigDescriptor
    if (tag === 0x05) { asc = new Uint8Array(dv.buffer, dv.byteOffset + body, len).slice(); break; }
    o = body + len;
  }
  return { oti, asc };
}

/** Ses izinin örnek tablosunu çıkarır */
function audioTrack(moov) {
  for (const trak of children(moov, 0, moov.byteLength).filter(b => b.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia'); if (!mdia) continue;
    const hdlr = child(moov, mdia, 'hdlr');
    if (!hdlr || fourcc(moov, hdlr.start + 8) !== 'soun') continue;
    const mdhd = child(moov, mdia, 'mdhd');
    const v = moov.getUint8(mdhd.start);
    const timescale = v === 1 ? moov.getUint32(mdhd.start + 20) : moov.getUint32(mdhd.start + 12);
    const duration = v === 1 ? u64(moov, mdhd.start + 24) : moov.getUint32(mdhd.start + 16);
    const stbl = path(moov, mdia, 'minf', 'stbl'); if (!stbl) continue;
    const stsd = child(moov, stbl, 'stsd');
    const entry = children(moov, stsd.start + 8, stsd.end)[0];
    if (!entry || entry.type !== 'mp4a') throw new Unsupported('ses kodeki desteklenmiyor: ' + (entry?.type || '?'));
    // AudioSampleEntry: 6 rezerv + 2 ref + 8 + 2 kanal + 2 bit + 4 + 4 örnek hızı(16.16)
    const qtVer = moov.getUint16(entry.start + 8);
    const channels = moov.getUint16(entry.start + 16);
    const sampleRate = moov.getUint32(entry.start + 24) >>> 16;
    const extra = qtVer === 1 ? 16 : qtVer === 2 ? 36 : 0;
    const subStart = entry.start + 28 + extra;
    const esdsBox = children(moov, subStart, entry.end).find(b => b.type === 'esds')
      || children(moov, subStart, entry.end).filter(b => b.type === 'wave').map(w => child(moov, w, 'esds')).find(Boolean);
    if (!esdsBox) throw new Unsupported('esds yok');
    const { oti, asc } = parseEsds(moov, esdsBox);
    if (oti !== 0x40 && oti !== 0x66 && oti !== 0x67 && oti !== 0x68) throw new Unsupported('AAC değil');
    if (!asc?.length) throw new Unsupported('AudioSpecificConfig yok');
    let aot = asc[0] >> 3; if (aot === 31) aot = 32 + (((asc[0] & 7) << 3) | (asc[1] >> 5));

    // örnek boyutları
    const stsz = child(moov, stbl, 'stsz') || child(moov, stbl, 'stz2');
    const fixed = moov.getUint32(stsz.start + 4), count = moov.getUint32(stsz.start + 8);
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || moov.getUint32(stsz.start + 12 + i * 4);
    // parça ofsetleri
    const stco = child(moov, stbl, 'stco'), co64 = child(moov, stbl, 'co64');
    const cb = stco || co64; const nChunks = moov.getUint32(cb.start + 4);
    const chunkOff = new Float64Array(nChunks);
    for (let i = 0; i < nChunks; i++) chunkOff[i] = stco ? moov.getUint32(cb.start + 8 + i * 4) : u64(moov, cb.start + 8 + i * 8);
    // parça başına örnek sayısı
    const stsc = child(moov, stbl, 'stsc'); const nE = moov.getUint32(stsc.start + 4);
    const offsets = new Float64Array(count);
    let s = 0;
    for (let e = 0; e < nE; e++) {
      const first = moov.getUint32(stsc.start + 8 + e * 12) - 1;
      const per = moov.getUint32(stsc.start + 12 + e * 12);
      const next = e + 1 < nE ? moov.getUint32(stsc.start + 8 + (e + 1) * 12) - 1 : nChunks;
      for (let c = first; c < next && s < count; c++) {
        let o = chunkOff[c];
        for (let k = 0; k < per && s < count; k++) { offsets[s] = o; o += sizes[s]; s++; }
      }
    }
    // zaman damgaları (stts)
    const stts = child(moov, stbl, 'stts'); const nT = moov.getUint32(stts.start + 4);
    const times = new Float64Array(count);
    let t = 0; s = 0;
    for (let e = 0; e < nT; e++) {
      const n = moov.getUint32(stts.start + 8 + e * 8), d = moov.getUint32(stts.start + 12 + e * 8);
      for (let k = 0; k < n && s < count; k++) { times[s++] = t; t += d; }
    }
    return { timescale, duration: duration / timescale, channels, sampleRate, asc, codec: `mp4a.40.${aot}`, sizes, offsets, times, count };
  }
  throw new Unsupported('ses izi yok');
}

export function fastAudioSupported(file) {
  return typeof AudioDecoder !== 'undefined' && /\.(mp4|m4v|mov|m4a)$/i.test(file?.name || '') ;
}

/**
 * Ses izini 16 kHz mono Float32Array olarak döndürür. Desteklenmeyen dosyada Unsupported hatası fırlatır.
 */
export async function extractMp4Audio(file, onProgress = () => {}, signal) {
  const { moov, sawMoof } = await findMoov(file);
  const tr = audioTrack(moov);
  if (!tr.count) throw new Unsupported(sawMoof ? 'parçalı MP4' : 'ses örneği yok');
  const config = { codec: tr.codec, sampleRate: tr.sampleRate, numberOfChannels: tr.channels, description: tr.asc };
  const sup = await AudioDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Unsupported('tarayıcı bu AAC türünü çözemiyor');

  const out = new Float32Array(Math.ceil(tr.duration * TARGET) + TARGET);
  let maxJ = 0, failed = null;
  const dec = new AudioDecoder({
    output: ad => {
      try {
        const n = ad.numberOfFrames, sr = ad.sampleRate, ch = ad.numberOfChannels;
        const mono = new Float32Array(n), tmp = new Float32Array(n);
        for (let c = 0; c < ch; c++) {
          ad.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
          for (let i = 0; i < n; i++) mono[i] += tmp[i];
        }
        if (ch > 1) for (let i = 0; i < n; i++) mono[i] /= ch;
        const t0 = ad.timestamp / 1e6;
        const j0 = Math.max(0, Math.ceil(t0 * TARGET)), j1 = Math.min(out.length, Math.ceil((t0 + n / sr) * TARGET));
        for (let j = j0; j < j1; j++) {
          const x = (j / TARGET - t0) * sr, i0 = Math.floor(x), f = x - i0;
          const a = mono[Math.min(n - 1, i0)], b = mono[Math.min(n - 1, i0 + 1)];
          out[j] = a + (b - a) * f;
        }
        if (j1 > maxJ) maxJ = j1;
      } finally { ad.close(); }
    },
    error: e => { failed = e; }
  });
  dec.configure(config);

  // ardışık örnekleri büyük bloklar hâlinde oku (disk erişimini azaltır)
  const BLOCK = 8 * 1024 * 1024;
  let i = 0;
  try {
    while (i < tr.count) {
      if (signal?.aborted) throw new DOMException('İptal', 'AbortError');
      if (failed) throw failed;
      const startOff = tr.offsets[i];
      let j = i, endOff = startOff;
      while (j < tr.count && tr.offsets[j] === endOff && endOff - startOff < BLOCK) { endOff += tr.sizes[j]; j++; }
      if (j === i) { endOff = startOff + tr.sizes[i]; j = i + 1; }
      const buf = new Uint8Array(await file.slice(startOff, endOff).arrayBuffer());
      for (let k = i; k < j; k++) {
        const rel = tr.offsets[k] - startOff;
        dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(tr.times[k] / tr.timescale * 1e6), data: buf.subarray(rel, rel + tr.sizes[k]) }));
      }
      i = j;
      // çözücü kuyruğu çok dolmasın
      while (dec.decodeQueueSize > 200) await new Promise(r => setTimeout(r, 5));
      onProgress(Math.min(0.98, i / tr.count), 'Ses çözülüyor (hızlı mod)');
    }
    await dec.flush();
    if (failed) throw failed;
  } finally {
    if (dec.state !== 'closed') dec.close();
  }
  const len = Math.min(out.length, Math.max(maxJ, Math.round(tr.duration * TARGET)));
  onProgress(1, 'Hazır');
  return { samples: out.subarray(0, len), sampleRate: TARGET, method: 'fast' };
}

export { Unsupported };
