## VertaCut 2.0.0

### New in 2.0
- **Fast audio extraction** for MP4/MOV: only the audio track is read and decoded with WebCodecs, so a 2-hour stream is ready in minutes instead of ~30 minutes
- **Candidate comparison**: alternative cuts of the same moment are grouped, with speech start, audio peak and chat peak markers; preview tight / original / context versions and pick one
- **Channel glossary**: save player names and game terms once, fix every misspelling in one step with undo; terms are sent to transcription as hints
- **Platform versions**: separate hook, caption position and text for Shorts, Reels and TikTok, downloaded as one ZIP with covers and descriptions
- Each of these can be turned on or off in Settings → Features
- 38 bug fixes (memory use on long streams, caption edits lost on trim, SRT timing, offline cache and more)

**VertaCut by LegendKaymak** — **VertaCut by LegendKaymak** — turn long stream VODs into vertical 9:16 short clips, right in your browser.

### Highlights
- **AI clip finder** with your own API keys (Gemini, OpenAI, Anthropic, Groq, OpenRouter, xAI, DeepSeek, Ollama) — Gemini "Auto" mode tries working models automatically
- **Transcription** (Groq / OpenAI Whisper / Gemini) with language selection, or import your own SRT/VTT
- **Hype map** from audio energy + Twitch chat density
- **Facecam + content framing** with split, fill, fit, PiP, cam-only and 3-way layouts; motion-based auto reframe
- **Animated word-by-word captions** with 7 presets
- **Customizable hook card** (8 styles, 5 animations) — AI designs it automatically, you can override everything
- Jump cuts, filler-word removal, teaser intro, clean-audio voice chain, background music with ducking, logo & safe zones
- 9:16, 4:5 and 1:1 export as MP4 (H.264), SRT export, montage of multiple clips
- Installable PWA, desktop and mobile layouts, 5 themes, first-run API setup guide
- Everything runs locally — your videos never leave your device

### Getting started
Try it live at **[vertacut.vercel.app](https://vertacut.vercel.app)**, or download `VertaCut-2.0.0.zip`, extract it and serve the folder with any static server (e.g. `npx serve`). Chrome or Edge recommended.

---

## VertaCut 2.0.0 (Türkçe)

### 2.0'daki yenilikler
- **Hızlı ses çıkarma** (MP4/MOV): yalnızca ses izi okunup WebCodecs ile çözülür; 2 saatlik yayın yaklaşık 30 dakika yerine birkaç dakikada hazır
- **Aday karşılaştırma**: aynı ana ait kesimler gruplanır; konuşma başlangıcı, ses ve sohbet zirvesi işaretlenir; sıkı, asıl ve bağlamlı sürümleri dinleyip birini seçersin
- **Kanal sözlüğü**: oyuncu adları ve terimler bir kez kaydedilir, yanlış yazımlar tek adımda düzeltilir (geri alınabilir); terimler yazıya dökmede ipucu olarak gider
- **Platform sürümleri**: Shorts, Reels ve TikTok için ayrı kanca, altyazı konumu ve metin; kapak ve açıklamalarla tek ZIP paketi
- Hepsi Ayarlar → Özellikler'den açılıp kapatılabilir
- 38 hata düzeltmesi (uzun yayında bellek, kırpmada kaybolan altyazı düzeltmeleri, SRT zamanları, çevrimdışı önbellek ve daha fazlası)

**VertaCut by LegendKaymak** — uzun yayın videolarından tarayıcıda dikey 9:16 kısa klipler çıkarın.

### Öne çıkanlar
- Kendi API anahtarlarınızla **yapay zekâ klip bulucu** (Gemini, OpenAI, Anthropic, Groq, OpenRouter, xAI, DeepSeek, Ollama) — Gemini "Otomatik" modu çalışan modeli kendisi bulur
- Dil seçimli **transkripsiyon** (Groq / OpenAI Whisper / Gemini) ya da kendi SRT/VTT dosyanızı yükleme
- Ses enerjisi ve Twitch sohbet yoğunluğundan **heyecan haritası**
- **Facecam + içerik çerçeveleme**: bölünmüş, doldur, sığdır, PiP, sadece kamera ve 3'lü düzen; harekete göre otomatik çerçeveleme
- 7 hazır stille **kelime kelime animasyonlu altyazı**
- **Özelleştirilebilir başlık kartı** (8 stil, 5 animasyon) — yapay zekâ otomatik tasarlar, istediğiniz her şeyi değiştirebilirsiniz
- Atlamalı kesim, dolgu kelime temizleme, teaser girişi, temiz ses zinciri, otomatik kısılan arka plan müziği, logo ve güvenli alanlar
- 9:16, 4:5 ve 1:1 MP4 (H.264) dışa aktarma, SRT, birden fazla klipten montaj
- Uygulama olarak yüklenebilir (PWA), masaüstü ve mobil düzen, 5 tema, ilk açılışta API kurulum rehberi
- Her şey cihazınızda çalışır — videolarınız hiçbir yere yüklenmez

### Başlarken
**[vertacut.vercel.app](https://vertacut.vercel.app)** adresinden hemen deneyin ya da `VertaCut-2.0.0.zip` dosyasını indirip klasörü herhangi bir statik sunucuyla açın (ör. `npx serve`). Chrome veya Edge önerilir.
