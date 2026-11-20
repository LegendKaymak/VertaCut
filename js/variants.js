// VertaCut — aynı klipten platforma özel sürümler (Shorts, Reels, TikTok) ve ZIP paketi
export const PLATFORMS = {
  shorts: { label: 'YouTube Shorts', short: 'Shorts', titleMax: 100, tag: '#shorts' },
  reels:  { label: 'Instagram Reels', short: 'Reels', titleMax: 120, tag: '#reels', capY: 0.66 },
  tiktok: { label: 'TikTok', short: 'TikTok', titleMax: 150, tag: '#fyp', capY: 0.68 }
};
// sürümde ayrı tutulabilen alanlar; geri kalan her şey ortak kesimden gelir
export const VARIANT_KEYS = ['title', 'description', 'hashtags', 'hook', 'hookOn', 'hookY', 'capY'];

/** Platformun varsayılanları: alt arayüzü yüksek platformlarda altyazı biraz yukarı, platform etiketi eklenir */
export function platformDefaults(clip, id) {
  const P = PLATFORMS[id], out = {};
  const y = clip.caption?.y ?? 0.7;
  if (P.capY && y > P.capY) out.capY = P.capY;
  const tags = clip.hashtags || [];
  if (P.tag && !tags.some(t => t.toLowerCase() === P.tag)) out.hashtags = [...tags, P.tag];
  if (clip.title && clip.title.length > P.titleMax) out.title = clip.title.slice(0, P.titleMax - 1).trimEnd() + '…';
  return out;
}

/** Sürümün etkin değerleri (ortak + varsayılan + kullanıcının değiştirdikleri) */
export function variantValues(clip, id) {
  const base = { title: clip.title, description: clip.description || '', hashtags: clip.hashtags || [], hook: clip.hook || '', hookOn: clip.hookOn !== false, hookY: clip.hookY ?? 0.14, capY: clip.caption?.y ?? 0.7 };
  if (!id || id === 'base') return base;
  return { ...base, ...platformDefaults(clip, id), ...(clip.variants?.[id] || {}) };
}

/** Önizleme ve dışa aktarma için sürüm uygulanmış klip kopyası */
export function applyVariant(clip, id) {
  if (!id || id === 'base') return clip;
  const v = variantValues(clip, id);
  return { ...clip, id: clip.id + ':' + id, title: v.title, description: v.description, hashtags: v.hashtags, hook: v.hook, hookOn: v.hookOn, hookY: v.hookY, caption: { ...clip.caption, y: v.capY } };
}

/** Kullanıcının bu sürümde değiştirdiği alan var mı */
export const isCustom = (clip, id) => !!clip.variants?.[id] && Object.keys(clip.variants[id]).length > 0;

// ---- Sıkıştırmasız ZIP (video zaten sıkıştırılmış; ek sıkıştırma kazandırmaz) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8, crc = 0xFFFFFFFF) { for (let i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8); return crc; }

/** files: [{ name, blob }] → ZIP Blob (UTF-8 dosya adları) */
export async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = new Uint8Array(await f.blob.arrayBuffer());
    let crc = 0xFFFFFFFF; for (let i = 0; i < data.length; i += 1 << 20) crc = crc32(data.subarray(i, i + (1 << 20)), crc);
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true);
    central.push(ch.buffer, name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + (b.byteLength ?? b.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
