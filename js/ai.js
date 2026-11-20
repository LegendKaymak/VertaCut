// VertaCut — AI sağlayıcıları: konuşmayı yazıya dökme (STT) + klip analizi (LLM)
import { wavChunks, topPeaks } from './audio.js';
import { clamp, fmtTime } from './util.js';
import { sttHint } from './glossary.js';

export const LLM_PROVIDERS = {
  gemini:     { label: 'Google Gemini', model: 'auto', keyUrl: 'https://aistudio.google.com/apikey' },
  openai:     { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic:  { label: 'Anthropic Claude', model: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  groq:       { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'free', keyUrl: 'https://openrouter.ai/keys' },
  xai:        { label: 'xAI Grok', base: 'https://api.x.ai/v1', model: 'grok-3-mini', keyUrl: 'https://console.x.ai' },
  deepseek:   { label: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  ollama:     { label: 'Ollama (yerel)', base: 'http://localhost:11434/v1', model: 'llama3.1', noKey: true },
  custom:     { label: 'Özel (OpenAI uyumlu)', base: '', model: '' }
};

export const STT_PROVIDERS = {
  groq:   { label: 'Groq Whisper (hızlı, ücretsiz katman)', base: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', keyFrom: 'groq', chunk: 600 },
  openai: { label: 'OpenAI Whisper', base: 'https://api.openai.com/v1', model: 'whisper-1', keyFrom: 'openai', chunk: 600 },
  gemini: { label: 'Google Gemini', model: 'auto', keyFrom: 'gemini', chunk: 300 },
  custom: { label: 'Özel (OpenAI uyumlu)', base: '', model: 'whisper-1', keyFrom: 'custom', chunk: 600 }
};

export const CONTENT_TYPES = {
  auto: 'Otomatik algıla', gaming: 'Oyun yayını', podcast: 'Podcast / sohbet', irl: 'IRL / vlog',
  education: 'Eğitim / anlatım', comedy: 'Komedi / eğlence', sports: 'Spor / yorum', business: 'İş / motivasyon'
};

class AIError extends Error {}

function keyFor(settings, provider) {
  return (settings.keys?.[provider] || '').trim();
}

async function asJson(res) {
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || text.slice(0, 300) || res.statusText;
    const hint = res.status === 401 || res.status === 403 ? '. API anahtarını kontrol et.' : res.status === 429 ? '. Kota veya hız sınırı doldu, biraz bekleyip tekrar dene.' : res.status === 413 ? '. Dosya parçası çok büyük.' : '';
    const err = new AIError(`${res.status}: ${(typeof msg === 'string' ? msg : JSON.stringify(msg)).replace(/\.+\s*$/, '')}${hint || '.'}`);
    err.status = res.status;
    throw err;
  }
  return data ?? text;
}

function wrapNetwork(e, where) {
  if (e instanceof AIError || e.name === 'AbortError') return e;
  return new AIError(`${where} bağlantısı kurulamadı (${e.message}). İnternet bağlantını, anahtarı veya CORS/uzak adres ayarını kontrol et.`);
}

// ------------------------------------------------------------------ GEMINI: otomatik model
// Ücretsiz katmanda bir model kotaya takılırsa ya da kapanırsa sıradakini dener.
export const GEMINI_AUTO = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
let geminiWorking = null;
export const lastGeminiModel = () => geminiWorking;

async function geminiRequest(model, key, body, signal) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } catch (e) { throw wrapNetwork(e, 'Gemini'); }
  return asJson(res);
}

async function geminiGenerate(chosen, key, body, signal) {
  if (chosen && chosen !== 'auto') return geminiRequest(chosen, key, body, signal);
  const order = geminiWorking ? [geminiWorking, ...GEMINI_AUTO.filter(m => m !== geminiWorking)] : GEMINI_AUTO;
  let lastErr;
  for (const m of order) {
    try {
      const d = await geminiRequest(m, key, body, signal);
      geminiWorking = m;
      return d;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // anahtar geçersizse diğer modelleri denemenin anlamı yok
      if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED.*key/i.test(e.message)) throw e;
      // ağ hatası veya geçersiz istek modelden bağımsızdır; başka model denemek işe yaramaz
      if (!e.status || e.status === 401 || (e.status === 400 && !/model|not found|not supported/i.test(e.message))) throw e;
      lastErr = e;
    }
  }
  throw new AIError('Hiçbir Gemini modeli yanıt vermedi; ücretsiz kota dolmuş olabilir. Biraz bekleyip tekrar dene ya da başka bir AI seç. Son hata: ' + (lastErr?.message || ''));
}

// ------------------------------------------------------------------ OPENROUTER: ücretsiz modeller
// "free" seçiliyken yalnızca ":free" modeller kullanılır; biri kotaya takılırsa sıradakine geçilir.
const OR_BASE = 'https://openrouter.ai/api/v1';
const OR_PREFER = [/deepseek/i, /qwen3|qwen-3/i, /llama-4|llama-3\.3-70b/i, /gemini|gemma-3-27b/i, /gpt-oss/i, /mistral|mixtral/i, /glm|kimi|nemotron/i];
let orFreeCache = null, orWorking = null;
export const lastOpenRouterModel = () => orWorking;
const orFreeId = m => /:free$/.test(m.id) || (m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0 && !/^openrouter\//.test(m.id));

export async function openRouterFreeModels(force = false) {
  if (orFreeCache && !force) return orFreeCache;
  let d;
  try { d = await asJson(await fetch(`${OR_BASE}/models`)); } catch (e) { throw wrapNetwork(e, 'OpenRouter'); }
  const textOnly = m => {
    const a = m.architecture || {};
    const out = a.output_modalities || (a.modality ? [a.modality.split('->')[1] || 'text'] : ['text']);
    return out.join(',').includes('text') && !/image|audio/.test(out.join(','));
  };
  const score = m => { const i = OR_PREFER.findIndex(r => r.test(m.id)); return i < 0 ? OR_PREFER.length : i; };
  orFreeCache = (d?.data || [])
    .filter(m => orFreeId(m) && textOnly(m) && (m.context_length || 0) >= 32000)
    .sort((a, b) => score(a) - score(b) || (b.context_length || 0) - (a.context_length || 0))
    .map(m => m.id);
  return orFreeCache;
}

async function openRouterRequest(model, key, body, signal) {
  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': location.origin, 'X-Title': 'VertaCut' },
    body: JSON.stringify({ ...body, model })
  });
  const d = await asJson(res);
  const out = d?.choices?.[0]?.message?.content || '';
  if (!out) { const e = new AIError(`${model} boş yanıt döndürdü.`); e.status = 502; throw e; }
  return out;
}

async function openRouterFree(key, body, signal) {
  let list;
  try { list = await openRouterFreeModels(); } catch (e) { if (e.name === 'AbortError') throw e; list = []; }
  if (!list.length) throw new AIError('OpenRouter\'da şu anda kullanılabilir ücretsiz model bulunamadı. Biraz sonra tekrar dene ya da Ayarlar → AI\'dan bir model yaz.');
  const order = (orWorking && list.includes(orWorking) ? [orWorking, ...list.filter(m => m !== orWorking)] : list).slice(0, 8);
  let lastErr;
  for (const m of order) {
    try {
      const out = await openRouterRequest(m, key, body, signal);
      orWorking = m;
      return out;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (!e.status || e.status === 401) throw e; // ağ hatası ya da anahtar geçersiz
      lastErr = e;
    }
  }
  throw new AIError('Ücretsiz OpenRouter modellerinin hiçbiri şu an yanıt vermedi; günlük ücretsiz kota dolmuş olabilir. Biraz bekleyip tekrar dene. Son hata: ' + (lastErr?.message || ''));
}

// ------------------------------------------------------------------ STT
export async function transcribe(samples, sr, settings, onProgress = () => {}, signal) {
  const p = settings.sttProvider;
  const def = STT_PROVIDERS[p];
  if (!def) throw new AIError('Geçersiz transkripsiyon sağlayıcısı');
  const key = keyFor(settings, def.keyFrom);
  if (!key) throw new AIError(`${def.label} için API anahtarı gerekli. Ayarlar → AI bölümünden ekle.`);
  const chunks = wavChunks(samples, sr, def.chunk);
  const results = new Array(chunks.length);
  let done = 0;
  onProgress(0, `0 / ${chunks.length} parça`);
  // bir parça kalıcı hata verirse diğer işçiler de durur ve süren istekler iptal edilir
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal?.aborted) ac.abort(); else signal?.addEventListener('abort', onAbort, { once: true });
  const sig = ac.signal;
  const worker = async i => {
    const c = chunks[i];
    let attempt = 0;
    try {
      for (;;) {
        if (sig.aborted) throw new DOMException('İptal', 'AbortError');
        try {
          results[i] = p === 'gemini'
            ? await sttGemini(c, key, settings, sig)
            : await sttOpenAI(c, key, settings, def, sig);
          break;
        } catch (e) {
          if (e.name === 'AbortError' || ++attempt >= 3 || !(e.status === 429 || e.status >= 500 || !e.status)) throw e;
          await new Promise(r => setTimeout(r, 1500 * attempt * attempt));
        }
      }
    } finally { c.release(); }
    done++;
    onProgress(done / chunks.length, `${done} / ${chunks.length} parça`);
  };
  const queue = chunks.map((_, i) => i);
  const conc = Math.min(3, queue.length);
  let firstErr = null;
  try {
    await Promise.all(Array.from({ length: conc }, async () => {
      try { while (queue.length && !sig.aborted) await worker(queue.shift()); }
      catch (e) { if (!firstErr) firstErr = e; queue.length = 0; ac.abort(); }
    }));
  } finally { signal?.removeEventListener('abort', onAbort); }
  if (firstErr) throw firstErr;
  const words = [], segments = [];
  for (const r of results) { words.push(...r.words); segments.push(...r.segments); }
  words.sort((a, b) => a.s - b.s);
  segments.sort((a, b) => a.start - b.start);
  return { words, segments, source: p, language: settings.language };
}

async function sttOpenAI(chunk, key, settings, def, signal) {
  const base = (settings.sttProvider === 'custom' ? settings.sttBaseUrl : def.base || '').replace(/\/$/, '');
  if (!base) throw new AIError('Özel STT için temel adres (base URL) gerekli.');
  const fd = new FormData();
  fd.append('file', chunk.blob, 'audio.wav');
  fd.append('model', settings.sttModel || def.model);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('timestamp_granularities[]', 'segment');
  if (settings.language && settings.language !== 'auto') fd.append('language', settings.language);
  // kanal sözlüğü: özel adların doğru yazılması için ipucu
  const hint = settings.features?.glossary !== false ? sttHint(settings.glossary) : '';
  if (hint) fd.append('prompt', hint);
  let res;
  try {
    res = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal });
  } catch (e) { throw wrapNetwork(e, 'Transkripsiyon'); }
  const data = await asJson(res);
  const off = chunk.offset;
  const num = v => (typeof v === 'number' || typeof v === 'string') && Number.isFinite(+v) ? +v : NaN;
  const segments = (Array.isArray(data?.segments) ? data.segments : [])
    .map(s => ({ start: num(s?.start) + off, end: num(s?.end) + off, text: String(s?.text ?? '').trim() }))
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text);
  if (!segments.length && typeof data?.text === 'string' && data.text.trim()) segments.push({ start: off, end: off + chunk.duration, text: data.text.trim() });
  let words = (Array.isArray(data?.words) ? data.words : [])
    .map(w => ({ w: String(w?.word ?? '').trim(), s: num(w?.start) + off, e: num(w?.end) + off }))
    .filter(w => w.w && Number.isFinite(w.s) && Number.isFinite(w.e));
  if (!words.length) words = wordsFromSegments(segments);
  return { words, segments };
}

async function sttGemini(chunk, key, settings, signal) {
  const b64 = await blobToBase64(chunk.blob);
  const lang = (settings.language && settings.language !== 'auto' ? `Dil: ${settings.language}.` : '')
    + (settings.features?.glossary !== false && sttHint(settings.glossary) ? ` Şu özel adları ve terimleri tam bu yazımla yaz: ${sttHint(settings.glossary)}.` : '');
  const prompt = `Bu ses kaydını kelimesi kelimesine yazıya dök. ${lang} Konuşmayı 2-8 saniyelik doğal cümle parçalarına böl.
Sadece şu JSON'u döndür: {"segments":[{"start":saniye,"end":saniye,"text":"..."}]}. Zamanlar kaydın başından itibaren saniye cinsinden ondalıklı olsun. Sessiz bölümleri atla.`;
  const model = settings.sttModel || STT_PROVIDERS.gemini.model;
  const data = await geminiGenerate(model, key, {
    contents: [{ parts: [{ inline_data: { mime_type: 'audio/wav', data: b64 } }, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  }, signal);
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  const parsed = parseJsonLoose(text);
  const off = chunk.offset;
  const segments = (parsed?.segments || []).filter(s => s && s.text).map(s => ({
    start: clamp(+s.start || 0, 0, chunk.duration) + off,
    end: clamp(+s.end || +s.start + 2, 0, chunk.duration) + off,
    text: String(s.text).trim()
  }));
  return { words: wordsFromSegments(segments), segments };
}

/** Kelime zaman damgası yoksa: segment süresini harf sayısına göre kelimelere dağıt */
export function wordsFromSegments(segments) {
  const out = [];
  for (const sg of segments) {
    const toks = sg.text.split(/\s+/).filter(Boolean);
    const total = toks.reduce((a, t) => a + t.length + 1, 0) || 1;
    let t = sg.start; const dur = Math.max(0.2, sg.end - sg.start);
    for (const tk of toks) {
      const d = dur * (tk.length + 1) / total;
      out.push({ w: tk, s: t, e: t + d * 0.92 });
      t += d;
    }
  }
  return out;
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

// ------------------------------------------------------------------ SRT / VTT / JSON içe aktarma
export function parseSubtitleFile(text, name = '') {
  text = text.replace(/^﻿/, '');
  if (/\.json$/i.test(name) || /^\s*[\[{]/.test(text)) {
    const d = JSON.parse(text);
    const fin = v => (typeof v === 'number' || typeof v === 'string') && v !== '' && Number.isFinite(+v);
    const rawSegs = Array.isArray(d) ? d : Array.isArray(d?.segments) ? d.segments : [];
    const segs = rawSegs.filter(s => s && fin(s.start) && fin(s.end) && s.text != null)
      .map(s => ({ start: +s.start, end: +s.end, text: String(s.text).trim() })).filter(s => s.text);
    let words = Array.isArray(d?.words) ? d.words.filter(w => w && fin(w.start ?? w.s) && fin(w.end ?? w.e))
      .map(w => ({ w: String(w.word ?? w.w ?? '').trim(), s: +(w.start ?? w.s), e: +(w.end ?? w.e) })).filter(w => w.w) : [];
    if (!words.length) words = wordsFromSegments(segs);
    if (!segs.length && !words.length) throw new Error('JSON dosyasında geçerli zaman damgalı satır bulunamadı.');
    return { segments: segs, words, source: 'import' };
  }
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  const segments = [];
  const tre = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
  const toSec = (h, m, s, ms) => (parseInt(h || '0') * 3600) + parseInt(m) * 60 + parseInt(s) + parseInt(ms.padEnd(3, '0')) / 1000;
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex(l => tre.test(l));
    if (i < 0) continue;
    const m = lines[i].match(tre);
    const start = toSec(m[1]?.replace(':', ''), m[2], m[3], m[4]);
    const end = toSec(m[5]?.replace(':', ''), m[6], m[7], m[8]);
    const t = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (t) segments.push({ start, end, text: t });
  }
  if (!segments.length) throw new Error('Altyazı dosyasında zaman damgalı satır bulunamadı.');
  return { segments, words: wordsFromSegments(segments), source: 'import' };
}

// ------------------------------------------------------------------ LLM çağrısı
export async function chat(settings, system, user, { json = true, signal, maxTokens = 8000 } = {}) {
  const p = settings.llmProvider;
  const def = LLM_PROVIDERS[p];
  if (!def) throw new AIError('Geçersiz AI sağlayıcısı');
  const key = keyFor(settings, p);
  if (!key && !def.noKey) throw new AIError(`${def.label} için API anahtarı gerekli. Ayarlar → AI bölümünden ekle.`);
  const model = settings.llmModelByProvider?.[p] || def.model;
  if (!model) throw new AIError('Model adı gerekli.');
  try {
    if (p === 'gemini') {
      const d = await geminiGenerate(model, key, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) }
      }, signal);
      const out = d?.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') || '';
      if (!out) throw new AIError('Gemini boş yanıt döndürdü' + (d?.promptFeedback?.blockReason ? ` (${d.promptFeedback.blockReason})` : ''));
      return out;
    }
    if (p === 'openrouter' && model === 'free') {
      return await openRouterFree(key, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.5, max_tokens: maxTokens }, signal);
    }
    if (p === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: {
          'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
      });
      const d = await asJson(res);
      return (d.content || []).map(c => c.text || '').join('');
    }
    const base = (p === 'custom' || p === 'ollama' ? (settings.llmBaseByProvider?.[p] || def.base) : def.base).replace(/\/$/, '');
    if (!base) throw new AIError('Özel sağlayıcı için temel adres (base URL) gerekli.');
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (p === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'VertaCut'; }
    const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.5 };
    if (json && ['openai', 'groq', 'xai', 'deepseek', 'openrouter'].includes(p)) body.response_format = { type: 'json_object' };
    const res = await fetch(`${base}/chat/completions`, { method: 'POST', signal, headers, body: JSON.stringify(body) });
    const d = await asJson(res);
    return d?.choices?.[0]?.message?.content || '';
  } catch (e) { throw wrapNetwork(e, def.label); }
}

export async function listModels(settings) {
  const p = settings.llmProvider, def = LLM_PROVIDERS[p], key = keyFor(settings, p);
  try {
    if (p === 'gemini') {
      const d = await asJson(await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`));
      return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''));
    }
    if (p === 'anthropic') {
      const d = await asJson(await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }));
      return (d.data || []).map(m => m.id);
    }
    if (p === 'openrouter') return await openRouterFreeModels(true);
    const base = (p === 'custom' || p === 'ollama' ? (settings.llmBaseByProvider?.[p] || def.base) : def.base).replace(/\/$/, '');
    const d = await asJson(await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }));
    return (d.data || []).map(m => m.id).sort();
  } catch (e) { throw wrapNetwork(e, def.label); }
}

export async function testConnection(settings) {
  const out = await chat(settings, 'Sadece JSON döndür.', 'Şunu döndür: {"ok":true}', { json: true, maxTokens: 50 });
  const j = parseJsonLoose(out);
  if (!j) throw new AIError('Bağlantı kuruldu ama beklenmeyen yanıt geldi: ' + String(out).slice(0, 120));
  return true;
}

export function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

// ------------------------------------------------------------------ Klip analizi
const HOOK_STYLE_IDS = 'card|accent|bold|sticker|glass|neon|pill|news';
const HOOK_ANIM_IDS = ['drop', 'pop', 'type', 'glitch', 'none'];
const SYSTEM = `Sen TikTok, YouTube Shorts ve Instagram Reels için viral kısa video kurgucususun.
Uzun bir yayının zaman damgalı transkriptini inceleyip tek başına anlaşılan, güçlü bir kancayla açılan ve tatmin edici biçimde biten anları seçersin.
İyi bir klip: ilk 2 saniyede merak uyandırır, bağlam gerektirmez, bir duygu zirvesi (komik, şaşırtıcı, tartışmalı, öğretici, duygusal, epik oyun anı) içerir ve cümle ortasında başlamaz/bitmez.
Yanıtın her zaman geçerli JSON olmalı.`;

function buildTranscriptText(transcript, from = 0, to = Infinity) {
  const segs = transcript?.segments?.length ? transcript.segments : [];
  return segs.filter(s => s.end > from && s.start < to).map(s => `[${s.start.toFixed(1)}] ${s.text}`).join('\n');
}

export async function analyzeClips(project, settings, onProgress = () => {}, signal) {
  const tr = project.transcript;
  if (!tr?.segments?.length) throw new AIError('Önce transkript oluştur veya altyazı dosyası içe aktar.');
  const duration = project.video.duration;
  const full = buildTranscriptText(tr);
  const MAX = 90000;
  const windows = [];
  if (full.length <= MAX) windows.push([0, duration]);
  else {
    const n = Math.ceil(full.length / MAX);
    const step = duration / n;
    for (let i = 0; i < n; i++) windows.push([Math.max(0, i * step - 60), Math.min(duration, (i + 1) * step + 60)]);
  }
  const peaks = topPeaks(project.energy, 20);
  const chatPeaks = project.chat?.length ? topPeaks(project.chat, 20) : [];
  const want = settings.clipCount || 8;
  const all = [];
  for (let wi = 0; wi < windows.length; wi++) {
    const [a, b] = windows[wi];
    onProgress(wi / windows.length, windows.length > 1 ? `Bölüm ${wi + 1}/${windows.length} analiz ediliyor` : 'AI en iyi anları arıyor');
    const count = windows.length > 1 ? Math.max(2, Math.ceil(want * 1.5 / windows.length)) : want;
    const pk = peaks.filter(p => p.t >= a && p.t <= b);
    const user = `Video süresi: ${fmtTime(duration)} (${Math.round(duration)} sn). İçerik türü: ${CONTENT_TYPES[settings.contentType] || 'otomatik'}.
Hedef: en iyi ${count} klip. Her klip ${settings.clipMin}–${settings.clipMax} saniye arası olsun. Klipler çakışmasın.
Başlık, kanca ve açıklama dili: ${settings.titleLang === 'en' ? 'İngilizce' : settings.titleLang === 'auto' ? 'transkriptin dili' : 'Türkçe'}.
${pk.length ? `Ses seviyesi tepe noktaları (seyirci/yayıncı tepkisi olabilir) [saniye, seviye 0-1]: ${pk.map(p => `${p.t}s:${p.level}`).join(', ')}` : ''}
${chatPeaks.filter(p => p.t >= a && p.t <= b).length ? `Sohbet (chat) mesaj yoğunluğu tepe noktaları; izleyicilerin en çok tepki verdiği anlar, güçlü klip adaylarıdır [saniye, yoğunluk 0-1]: ${chatPeaks.filter(p => p.t >= a && p.t <= b).map(p => `${p.t}s:${p.level}`).join(', ')}. Sohbet tepkisi genelde olaydan 5-20 sn sonra gelir.` : ''}
${settings.customPrompt ? `Ek talimat: ${settings.customPrompt}` : ''}

Şu JSON'u döndür:
{"clips":[{
 "start": saniye (bir cümlenin başı),
 "end": saniye (bir cümlenin sonu),
 "title": "kısa, merak uyandıran başlık (en fazla 60 karakter)",
 "hook": "videonun üstünde ilk 3 saniye görünecek kanca metni (en fazla 8 kelime)",
 "score": 0-100 viral potansiyel puanı,
 "reason": "neden işe yarar, 1 cümle",
 "category": "komik|şaşırtıcı|öğretici|duygusal|tartışmalı|epik|hikâye",
 "description": "platform açıklaması, 1-2 cümle",
 "hashtags": ["#etiket", "..."] (5-8 adet),
 "emphasis": [{"word":"klipte geçen önemli bir kelime","emoji":"uygun tek emoji"}] (3-6 adet),
 "hookStyle": "${HOOK_STYLE_IDS}" içinden içeriğe en uygun kanca kartı stili,
 "hookEmoji": "kancanın başına konacak tek emoji ya da boş"
}]}
Kanca stili rehberi: komik → sticker, şok/şaşırtıcı → bold, epik oyun anı → neon, öğretici → card, duygusal → glass, tartışmalı/drama → news, hikâye → pill, genel → card veya accent.

Transkript ([başlangıç saniyesi] metin):
${buildTranscriptText(tr, a, b)}`;
    const out = await chat(settings, SYSTEM, user, { json: true, signal });
    const j = parseJsonLoose(out);
    if (!j || !Array.isArray(j.clips)) throw new AIError('AI yanıtı çözümlenemedi. Farklı bir model dene. Yanıt: ' + String(out).slice(0, 200));
    all.push(...j.clips);
  }
  onProgress(1, 'Klipler hazırlanıyor');
  return postProcess(all, tr, duration, settings).slice(0, want);
}

function postProcess(raw, tr, duration, settings) {
  const words = tr.words || [];
  const minD = settings.clipMin, maxD = settings.clipMax;
  const clips = [];
  for (const c of raw) {
    let s = +c.start, e = +c.end;
    if (!isFinite(s) || !isFinite(e)) continue;
    if (e < s) [s, e] = [e, s];
    s = clamp(s, 0, duration); e = clamp(e, 0, duration);
    if (e - s < minD) e = Math.min(duration, s + minD);
    if (e - s > maxD * 1.15) e = s + maxD;
    // kelime sınırlarına hizala
    if (words.length) {
      const ws = words.find(w => w.e > s - 0.3);
      if (ws && Math.abs(ws.s - s) < 2.5) s = Math.max(0, ws.s - 0.08);
      let we = null;
      for (let i = words.length - 1; i >= 0; i--) if (words[i].s < e + 0.3) { we = words[i]; break; }
      if (we && Math.abs(we.e - e) < 2.5) e = Math.min(duration, we.e + 0.25);
    }
    // ayarlardaki azami süre kesin sınırdır; mümkünse son tam kelimede bitir
    if (e - s > maxD) {
      let cut = s + maxD;
      for (let i = words.length - 1; i >= 0; i--) if (words[i].e <= s + maxD && words[i].e > s + maxD - 4) { cut = words[i].e + 0.05; break; }
      e = Math.min(cut, s + maxD);
    }
    if (e - s < 3) continue;
    clips.push({
      start: s, end: e,
      title: String(c.title || 'Klip').slice(0, 90),
      hook: String(c.hook || '').slice(0, 90),
      score: clamp(Math.round(+c.score || 60), 0, 100),
      reason: String(c.reason || ''),
      category: String(c.category || ''),
      description: String(c.description || ''),
      hashtags: Array.isArray(c.hashtags) ? c.hashtags.map(h => String(h).startsWith('#') ? String(h) : '#' + h).slice(0, 10) : [],
      emphasis: Array.isArray(c.emphasis) ? c.emphasis.filter(x => x && x.word).map(x => ({ word: String(x.word), emoji: x.emoji ? String(x.emoji) : '' })).slice(0, 8) : [],
      hookStyle: HOOK_STYLE_IDS.split('|').includes(c.hookStyle) ? c.hookStyle : undefined,
      hookEmoji: c.hookEmoji ? String(c.hookEmoji).slice(0, 4) : ''
    });
  }
  clips.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of clips) {
    if (kept.some(k => overlap(k, c) > 0.4)) continue;
    kept.push(c);
  }
  return kept;
}

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) / Math.min(a.end - a.start, b.end - b.start);

/** Tek klip için yeniden başlık/kanca/metadata üret */
export async function regenerateMeta(clip, project, settings) {
  const text = buildTranscriptText(project.transcript, clip.start, clip.end);
  const user = `Bu kısa video klibi için ${settings.titleLang === 'en' ? 'İngilizce' : 'Türkçe'} yeni bir başlık, kanca ve platform metni yaz. Öncekinden farklı ve daha çarpıcı olsun.
Önceki başlık: ${clip.title}
JSON: {"title":"","hook":"en fazla 8 kelime","description":"","hashtags":["#..."],"emphasis":[{"word":"","emoji":""}]}
Klip transkripti:\n${text}`;
  const j = parseJsonLoose(await chat(settings, SYSTEM, user, { json: true, maxTokens: 1500 }));
  if (!j) throw new AIError('AI yanıtı çözümlenemedi.');
  return j;
}

/** Kurulum rehberi için bir sağlayıcının anahtarını hızlıca doğrular (model listesi ister, ücret yazmaz) */
export async function testKey(provider, key, baseUrl = '') {
  key = (key || '').trim();
  const def = LLM_PROVIDERS[provider] || STT_PROVIDERS[provider] || {};
  if (!key && !def.noKey) throw new AIError('Önce anahtarı yapıştır.');
  try {
    if (provider === 'gemini') {
      await asJson(await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`));
      return true;
    }
    if (provider === 'anthropic') {
      await asJson(await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }));
      return true;
    }
    const base = (baseUrl || def.base || '').replace(/\/$/, '');
    await asJson(await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }));
    return true;
  } catch (e) { throw wrapNetwork(e, def.label || provider); }
}

/** Klip için birbirinden farklı kanca metinleri */
export async function suggestHooks(clip, project, settings) {
  const text = buildTranscriptText(project.transcript, clip.start, clip.end) || clip.title;
  const user = `Bu kısa video için ${settings.titleLang === 'en' ? 'İngilizce' : 'Türkçe'} 5 farklı kanca metni yaz. Her biri en fazla 8 kelime olsun ve farklı bir teknik kullansın: merak boşluğu, şok, soru, iddia, gizli bilgi.
Önceki kanca: ${clip.hook || '-'}
JSON: {"hooks":["...","...","...","...","..."]}
Klip transkripti:\n${text}`;
  const j = parseJsonLoose(await chat(settings, SYSTEM, user, { json: true, maxTokens: 800 }));
  const hooks = Array.isArray(j?.hooks) ? j.hooks.map(String).filter(Boolean).slice(0, 5) : [];
  if (!hooks.length) throw new AIError('AI kanca önerisi döndürmedi, tekrar dene.');
  return hooks;
}

/** Altyazı satırlarını çevirir; satır sayısı korunur */
export async function translateLines(lines, lang, settings) {
  const user = `Aşağıdaki ${lines.length} altyazı satırını ${lang} diline çevir. Kısa, doğal ve konuşma dilinde olsun. Satır sayısını ve sırasını aynen koru, birleştirme veya bölme yapma.
JSON: {"lines":["..."]}
Satırlar:
${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
  const j = parseJsonLoose(await chat(settings, 'Sen profesyonel bir altyazı çevirmenisin. Sadece JSON döndür.', user, { json: true, maxTokens: 4000 }));
  if (!Array.isArray(j?.lines)) throw new AIError('Çeviri yanıtı çözümlenemedi.');
  return lines.map((l, i) => String(j.lines[i] ?? l));
}

/** Tek klip için kanca metni + kart tasarımı */
export async function designHook(clip, project, settings) {
  const text = buildTranscriptText(project.transcript, clip.start, clip.end) || clip.title;
  const user = `Bu kısa video için ilk 3 saniyede görünecek kanca kartını tasarla. Metin ${settings.titleLang === 'en' ? 'İngilizce' : 'Türkçe'}, en fazla 8 kelime, merak uyandırıcı olsun.
Stil seçenekleri: ${HOOK_STYLE_IDS} (komik → sticker, şok → bold, epik → neon, öğretici → card, duygusal → glass, drama → news, hikâye → pill).
Animasyon: ${HOOK_ANIM_IDS.join('|')}. Renkler hex olsun, metin rengi arka planla yüksek kontrastlı olsun (stil "bold" veya "pill" ise arka plan "none").
JSON: {"hook":"","style":"","bg":"#RRGGBB veya none","fg":"#RRGGBB","emoji":"tek emoji veya boş","anim":"","tilt": -4 ile 4 arası sayı}
Önceki kanca: ${clip.hook || '-'}
Klip transkripti:\n${text}`;
  const j = parseJsonLoose(await chat(settings, SYSTEM, user, { json: true, maxTokens: 600 }));
  if (!j?.hook) throw new AIError('AI kanca tasarımı döndürmedi, tekrar dene.');
  const hex = v => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : undefined;
  return {
    hook: String(j.hook).slice(0, 90),
    hookStyle: HOOK_STYLE_IDS.split('|').includes(j.style) ? j.style : 'card',
    hookBg: j.bg === 'none' ? 'none' : hex(j.bg),
    hookFg: hex(j.fg),
    hookEmoji: j.emoji ? String(j.emoji).slice(0, 4) : '',
    hookAnim: HOOK_ANIM_IDS.includes(j.anim) ? j.anim : undefined,
    hookTilt: isFinite(+j.tilt) ? clamp(+j.tilt, -6, 6) : undefined
  };
}

/** Uzun yayın için YouTube bölümleri, başlık ve açıklama */
export async function youtubeChapters(project, settings, signal) {
  const tr = project.transcript;
  if (!tr?.segments?.length) throw new AIError('Önce transkript gerekli.');
  let text = buildTranscriptText(tr);
  if (text.length > 120000) {
    // çok uzun yayınlarda her 3. satırı al (bölüm başlığı için yeterli)
    text = tr.segments.filter((_, i) => i % 3 === 0).map(s => `[${s.start.toFixed(0)}] ${s.text}`).join('\n');
  }
  const lang = settings.titleLang === 'en' ? 'İngilizce' : 'Türkçe';
  const user = `Bu yayının YouTube videosu için ${lang} bölüm (chapter) listesi, 3 başlık önerisi ve açıklama yaz.
Kurallar: ilk bölüm 0 saniyede başlar, bölümler en az 60 sn arayla, toplam 5-20 bölüm, bölüm adları kısa ve merak uyandırıcı.
JSON: {"titles":["","",""],"description":"2-3 cümle","chapters":[{"t":saniye,"title":""}]}
Video süresi: ${Math.round(project.video.duration)} sn.
Transkript ([saniye] metin):
${text}`;
  const j = parseJsonLoose(await chat(settings, SYSTEM, user, { json: true, signal, maxTokens: 3000 }));
  if (!Array.isArray(j?.chapters)) throw new AIError('Bölüm listesi çözümlenemedi.');
  const ch = j.chapters.map(c => ({ t: Math.max(0, Math.round(+c.t || 0)), title: String(c.title || '').trim() })).filter(c => c.title).sort((a, b) => a.t - b.t);
  if (ch.length && ch[0].t !== 0) ch[0].t = 0;
  return { titles: (j.titles || []).map(String).slice(0, 5), description: String(j.description || ''), chapters: ch };
}
