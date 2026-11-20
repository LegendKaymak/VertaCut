<p align="center"><img src="icons/wordmark.png" alt="VertaCut by LegendKaymak" width="520"></p>

<p align="center"><b>Turn long livestreams into captioned 9:16 vertical clips, right in your browser.</b><br>
<a href="https://vertacut.vercel.app"><b>Try it live → vertacut.vercel.app</b></a><br>
<a href="#english">English</a> · <a href="#türkçe">Türkçe</a></p>

---

## English

VertaCut by LegendKaymak finds the best moments in a long stream, places your facecam, adds word-by-word animated captions and a hook, and exports ready-to-post MP4 clips for TikTok, YouTube Shorts and Instagram Reels. Everything runs in the browser: your video never leaves your device.

### Features

**Finding clips**
- AI picks the best moments with a virality score, reason, title, hook, hashtags and emphasis words
- Search by prompt ("funny moments", "tutorial parts")
- Works without an API key: detects hype moments from audio reactions
- Import Twitch / YouTube chat logs; chat spikes feed the hype map and the AI
- One-click highlight montage from the top-scoring moments
- Candidate comparison: alternative cuts of the same moment grouped together, with speech start, audio peak and chat peak markers; preview tight, original and context versions and pick one
- Mark clips manually with `I` / `O`, by dragging on the hype map, or by selecting transcript text

**Editing**
- 6 layouts: facecam + gameplay, full screen, blurred background, picture-in-picture, camera only, half split
- 9:16, 4:5 and 1:1 formats
- Auto zoom on emphasized words and reaction moments, motion-based auto reframing
- Jump-cut silences and remove filler words (uh, um, hmm…)
- Teaser intro: the 3 punchiest moments with flash transitions
- Undo / redo, keyboard shortcuts (`?`)
- Fast audio extraction for MP4/MOV: reads only the audio track with WebCodecs, a 2-hour stream is ready in minutes

**Captions and text**
- 7 animated caption styles, kinetic emphasis, per-word editing and caption translation
- Channel glossary: save player names and game terms once, fix every misspelling in one step (with undo); terms are also sent to the transcription service as hints
- Hook card designer: 8 styles, colors, font, size, tilt, corner radius, emoji and 5 entrance animations; the AI designs it to match the content
- Logo watermark (9 positions), channel name, progress bar
- TikTok / Shorts / Reels safe-zone preview

**Audio**
- Background music with automatic ducking under speech
- Pop sound effect on emphasized words
- Clean audio: hum removal, voice clarity and leveling

**Publishing**
- MP4 export (H.264), SRT download, cover image (PNG)
- Platform titles, descriptions and hashtags; YouTube chapters for the full stream
- Platform versions: separate hook, caption position and text for Shorts, Reels and TikTok, downloaded together as one ZIP with covers and descriptions
- Every extra feature can be turned on or off in Settings → Features
- Share directly from your phone
- Installable as an app (PWA), works offline, mobile mode, 5 themes

### Getting started

**Try it now:** [vertacut.vercel.app](https://vertacut.vercel.app), no install needed.

VertaCut is a static site with no build step.

- **Vercel / Netlify:** deploy this folder as a static site.
- **GitHub Pages:** Settings → Pages → `main` branch / root.
- **Locally:** `python3 -m http.server 8080`, then open `http://localhost:8080`.

Opening `index.html` directly from disk does not work; modules and the service worker need a server.

### API keys

On first launch a setup guide asks which AI you want to use and walks you through getting a key. Keys are stored only in your browser.

| Task | Recommended | Notes |
|---|---|---|
| Transcription | Groq Whisper | Free tier, very fast, word-level timestamps |
| Clip analysis | Google Gemini | Free tier; automatic model fallback when a quota runs out |

OpenAI, Anthropic Claude, OpenRouter, xAI, DeepSeek, Ollama (local) and any OpenAI-compatible endpoint are also supported.

### Good to know

- Export runs in real time (a 30 s clip takes about 30 s); keep the tab open.
- Best results in Chrome or Edge (H.264 MP4). Firefox exports WebM.
- Videos larger than 1.4 GB are scanned at 4× speed to extract audio.

---

## Türkçe

VertaCut by LegendKaymak, uzun bir yayının en güçlü anlarını bulur, facecam'i yerleştirir, kelime kelime animasyonlu altyazı ve kanca ekler; TikTok, YouTube Shorts ve Instagram Reels için paylaşılmaya hazır MP4 klipler çıkarır. Her şey tarayıcıda çalışır, videon cihazından hiç çıkmaz.

### Özellikler

**Klip bulma**
- AI en iyi anları viral puan, gerekçe, başlık, kanca, etiket ve vurgu kelimeleriyle seçer
- İsteğe göre arama ("komik anlar", "öğretici kısımlar")
- API anahtarı olmadan da çalışır: ses tepkilerinden hype anlarını bulur
- Twitch / YouTube sohbet kaydı içe aktarma; sohbet patlamaları hype haritasına ve AI'ya eklenir
- En yüksek puanlı anlardan tek tıkla montaj
- Aday karşılaştırma: aynı ana ait kesimler tek grupta; konuşma başlangıcı, ses ve sohbet zirvesi işaretleri; sıkı, asıl ve bağlamlı sürümleri dinleyip birini seç
- `I` / `O` ile, hype haritasında sürükleyerek ya da transkriptten metin seçerek elle klip

**Düzenleme**
- 6 düzen: facecam + oyun, tam ekran, bulanık arka plan, resim içinde resim, sadece kamera, yarım bölme
- 9:16, 4:5 ve 1:1 formatlar
- Vurgulu kelimelerde ve tepki anlarında otomatik zoom, hareket takibiyle otomatik kadraj
- Sessiz boşlukları kesme ve dolgu kelimelerini (ııı, eee, hmm…) temizleme
- Teaser girişi: en vurucu 3 an, flaş geçişlerle
- Geri al / yinele, klavye kısayolları (`?`)
- MP4/MOV için hızlı ses çıkarma: WebCodecs ile yalnızca ses izi okunur, 2 saatlik yayın dakikalar içinde hazır

**Altyazı ve metin**
- 7 animasyonlu altyazı stili, kinetik vurgu, kelime kelime düzenleme ve altyazı çevirisi
- Kanal sözlüğü: oyuncu adlarını ve oyun terimlerini bir kez kaydet, yanlış yazımları tek adımda düzelt (geri alınabilir); terimler yazıya dökme servisine ipucu olarak da gider
- Kanca kartı tasarımcısı: 8 stil, renk, yazı tipi, boyut, eğim, köşe, emoji ve 5 giriş animasyonu; AI içeriğe göre kendisi tasarlar
- Logo filigranı (9 konum), kanal adı, ilerleme çubuğu
- TikTok / Shorts / Reels güvenli alan önizlemesi

**Ses**
- Konuşmada otomatik kısılan arka plan müziği
- Vurgulu kelimelerde pop efekti
- Sesi iyileştir: uğultu kesme, netlik ve seviye dengeleme

**Yayınlama**
- MP4 (H.264) dışa aktarma, SRT indirme, kapak görseli (PNG)
- Platformlara özel başlık, açıklama ve etiketler; uzun yayın için YouTube bölümleri
- Platform sürümleri: Shorts, Reels ve TikTok için ayrı kanca, altyazı konumu ve metin; kapak ve açıklamalarla birlikte tek ZIP paketi
- Ek özelliklerin her biri Ayarlar → Özellikler'den açılıp kapatılabilir
- Telefondan doğrudan paylaşma
- Uygulama olarak yüklenebilir (PWA), çevrimdışı açılır, mobil mod, 5 tema

### Başlarken

**Hemen dene:** [vertacut.vercel.app](https://vertacut.vercel.app), kurulum gerekmez.

VertaCut derleme adımı olmayan statik bir sitedir.

- **Vercel / Netlify:** bu klasörü statik site olarak yayınla.
- **GitHub Pages:** Settings → Pages → `main` dalı / kök.
- **Yerelde:** `python3 -m http.server 8080`, sonra `http://localhost:8080`.

`index.html` dosyasını doğrudan diskten açmak çalışmaz; modüller ve service worker için sunucu gerekir.

### API anahtarları

İlk açılışta bir kurulum rehberi hangi AI'ı kullanmak istediğini sorar ve anahtarı nasıl alacağını adım adım gösterir. Anahtarlar yalnızca tarayıcında saklanır.

| İş | Önerilen | Not |
|---|---|---|
| Yazıya dökme | Groq Whisper | Ücretsiz katman, çok hızlı, kelime zamanlı |
| Klip analizi | Google Gemini | Ücretsiz katman; kota dolunca otomatik olarak başka modele geçer |

OpenAI, Anthropic Claude, OpenRouter, xAI, DeepSeek, Ollama (yerel) ve OpenAI uyumlu her uç nokta da desteklenir.

### Bilinmesi gerekenler

- Dışa aktarma gerçek zamanlıdır (30 sn klip yaklaşık 30 sn sürer); sekmeyi açık tut.
- En iyi sonuç Chrome veya Edge'de alınır (H.264 MP4). Firefox WebM üretir.
- 1,4 GB'tan büyük videolarda ses, video 4× hızda taranarak çıkarılır.

---

<sub>Interface font: <b>Allo</b> by Josh Puckett, SIL Open Font License 1.1 (<code>fonts/OFL-Allo.txt</code>).<br>
Arayüz yazı tipi: Josh Puckett'in <b>Allo</b>'su, SIL Open Font License 1.1 ile.</sub>
