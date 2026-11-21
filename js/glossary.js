// VertaCut — kanal sözlüğü: yanlış yazılan adları bulma, toplu düzeltme ve öneriler
const CORE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;

export const norm = s => String(s).toLocaleLowerCase('tr-TR').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
const tokens = s => String(s).trim().split(/\s+/).map(norm).filter(Boolean);

/** Kelime dizisinde aranan ifadenin (bir veya birkaç kelime) geçtiği yerler */
export function findIn(words, phrase) {
  const want = tokens(phrase);
  if (!want.length || !words?.length) return [];
  const hits = [];
  for (let i = 0; i + want.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) if (norm(words[i + k].w) !== want[k]) { ok = false; break; }
    if (ok) { hits.push({ i, n: want.length }); i += want.length - 1; }
  }
  return hits;
}

/** Bulunan yeri düzeltir: ilk kelimenin metni değişir, diğer kelimeler ona katılır. Zaman ve vurgu korunur. */
export function replaceAt(words, i, n, to) {
  const first = words[i], last = words[i + n - 1];
  const [, lead] = CORE.exec(first.w) || [];
  const [, , , trail] = CORE.exec(last.w) || [];
  first.w = (lead || '') + to + (trail || '');
  if (n > 1) {
    first.e = last.e;
    if (words.slice(i + 1, i + n).some(w => w.emph)) first.emph = true;
    words.splice(i + 1, n - 1);
  }
}

/** Segment metnindeki eşleşmeyi değiştirir (AI analizi bu metni kullanır) */
export function replaceInText(text, phrase, to) {
  const parts = String(phrase).trim().split(/\s+/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!parts.length) return text;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${parts.join('[^\\p{L}\\p{N}]+')}(?=$|[^\\p{L}\\p{N}])`, 'giu');
  return String(text).replace(re, (m, pre) => pre + to);
}

/**
 * Segment metnindeki eşleşmeleri findIn ile aynı kurala göre (boşlukla ayrılmış, Türkçe küçük harf) bulur.
 * pick: değiştirilecek eşleşmelerin sıra numaraları (Set); verilmezse hepsi.
 * Dönüş: { text, count } — count, metindeki toplam eşleşme sayısı.
 */
export function replaceInTextAt(text, phrase, to, pick = null) {
  text = String(text);
  const want = tokens(phrase);
  const toks = [...text.matchAll(/\S+/g)].map(m => ({ s: m.index, e: m.index + m[0].length, w: m[0] }));
  const hits = [];
  if (want.length) for (let i = 0; i + want.length <= toks.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) if (norm(toks[i + k].w) !== want[k]) { ok = false; break; }
    if (ok) { hits.push(i); i += want.length - 1; }
  }
  let out = text;
  for (let h = hits.length - 1; h >= 0; h--) {
    if (pick && !pick.has(h)) continue;
    const first = toks[hits[h]], last = toks[hits[h] + want.length - 1];
    const lead = (CORE.exec(first.w) || [])[1] || '', trail = (CORE.exec(last.w) || [])[3] || '';
    out = out.slice(0, first.s + lead.length) + to + out.slice(last.e - trail.length);
  }
  return { text: out, count: hits.length };
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Sözlükteki her terim için transkriptte benzer ama farklı yazılmış kelimeleri bulur.
 * Önce öğrenilmiş yanlış yazımlar (wrong), sonra küçük yazım farkları.
 */
export function suggestions(words, glossary, limit = 12) {
  if (!words?.length || !glossary?.length) return [];
  const counts = new Map();
  for (const w of words) { const k = norm(w.w); if (k.length >= 3) counts.set(k, (counts.get(k) || 0) + 1); }
  const out = [];
  for (const g of glossary) {
    const t = norm(g.term); if (t.length < 3) continue;
    const seen = new Set([t]);
    for (const wrong of g.wrong || []) {
      const hits = findIn(words, wrong).length;
      if (hits && !seen.has(norm(wrong))) { out.push({ from: wrong, to: g.term, count: hits, learned: true }); seen.add(norm(wrong)); }
    }
    if (/\s/.test(g.term.trim())) continue;
    const max = t.length <= 5 ? 1 : 2;
    // kullanıcı adlarında rakamlar genelde söylenmez/yazılmaz: "fırat" → "Fırat123"
    const stem = t.replace(/[\d_]+/g, '');
    for (const [k, n] of counts) {
      if (seen.has(k)) continue;
      const close = (stem !== t && stem.length >= 3 && (k === stem || lev(k, stem, 1) <= 1 && stem.length > 5))
        || ((k[0] === t[0] || k.slice(-1) === t.slice(-1)) && lev(k, t, max) <= max);
      if (close) { out.push({ from: k, to: g.term, count: n }); seen.add(k); }
    }
  }
  return out.sort((a, b) => (b.learned ? 1 : 0) - (a.learned ? 1 : 0) || b.count - a.count).slice(0, limit);
}

/** Yazıya dökme servisine gönderilecek ipucu metni (Whisper "prompt" alanı) */
export function sttHint(glossary) {
  const terms = (glossary || []).map(g => String(g.term).trim()).filter(Boolean);
  let out = '';
  for (const t of terms) { if ((out + ', ' + t).length > 220) break; out = out ? out + ', ' + t : t; }
  return out;
}
