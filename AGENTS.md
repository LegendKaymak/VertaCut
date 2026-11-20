# VertaCut: ajan talimatları

VertaCut, uzun yayın videolarından 9:16 dikey klipler çıkaran, tamamen tarayıcıda çalışan bir web uygulamasıdır (PWA). Derleme adımı yoktur; saf HTML, CSS ve ES modülleri kullanılır.

## Yapı

- `index.html`: tüm ekranlar ve diyaloglar
- `css/app.css`: tasarım sistemi, temalar (`data-theme`), mobil mod (`body.m`)
- `js/app.js`: arayüz ve uygulama durumu
- `js/render.js`: 9:16 kompozit çizici (düzenler, altyazı, kanca, logo)
- `js/captions.js`: kelime kelime animasyonlu altyazı motoru
- `js/hooks.js`: kanca (başlık) kartı stilleri ve çizimi
- `js/exporter.js`: canvas + MediaRecorder ile dışa aktarma, aralık hesapları
- `js/audio.js`: ses çözme, hype haritası, jump-cut, dolgu kelimeleri, teaser
- `js/ai.js`: transkripsiyon ve LLM sağlayıcıları (Gemini otomatik model dahil)
- `js/sfx.js`: pop efekti ve müzik kısma
- `js/mp4audio.js`: MP4/MOV ses izini WebCodecs ile hızlı çözme
- `js/glossary.js`: kanal sözlüğü, toplu düzeltme ve öneriler
- `js/variants.js`: Shorts/Reels/TikTok sürümleri ve ZIP paketi
- `js/db.js`: IndexedDB projeleri ve ayarlar
- `sw.js`: service worker (dosya eklenirse `SHELL` listesine ve `VERSION`'a dikkat)

## Yerelde çalıştırma

```
python3 -m http.server 8080
```
Sonra `http://localhost:8080`. `file://` ile açılmaz.

## Hata bildirme kuralları

Kod incelemesi istendiğinde **kodu değiştirme; yalnızca GitHub issue aç.** Her hata için ayrı bir issue:

- Başlık: kısa ve net, Türkçe
- Etiket: `bulgu`
- İçerik:
  - **Dosya ve satır**
  - **Nasıl tekrarlanır** (adım adım)
  - **Beklenen / gerçekleşen davranış**
  - **Önerilen çözüm**
  - **Önem:** kritik / orta / düşük

Aynı hata için zaten açık bir issue varsa yenisini açma. Tahmine dayalı ya da doğrulayamadığın bulguları "doğrulanmadı" diye belirt.
