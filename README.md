# VertaCut

Uzun yayın videolarından altyazılı 9:16 dikey klipler çıkaran web uygulaması. Tamamen tarayıcıda çalışır, sunucu gerekmez.

## Yayınlama

Statik bir sitedir; derleme adımı yoktur.

- **Netlify:** app.netlify.com/drop adresine bu klasörü sürükle bırak.
- **GitHub Pages:** Klasörü bir depoya yükle, Settings → Pages → `main` dalı / kök.
- **Yerelde:** `python -m http.server 8080` ve `http://localhost:8080`.

`index.html` dosyasına çift tıklayarak açmak çalışmaz (modüller ve service worker için sunucu gerekir).

## Uygulama olarak yükleme

Chrome/Edge'de site açıkken adres çubuğundaki yükle simgesine veya sağ üstteki **Uygulamayı yükle** düğmesine bas. Yüklenince video dosyalarına sağ tıklayıp "Birlikte aç → VertaCut" diyebilirsin.

## API anahtarları

Ayarlar → AI analizi ve Transkript bölümleri. Anahtarlar sadece tarayıcında (localStorage) saklanır.

| İş | Önerilen | Not |
|---|---|---|
| Yazıya dökme | Groq Whisper | Ücretsiz katman, çok hızlı, kelime zamanları |
| Klip analizi | Google Gemini | Ücretsiz katman, uzun transkriptleri rahat okur |

Ayrıca OpenAI, Anthropic Claude, OpenRouter, xAI, DeepSeek, Ollama (yerel) ve OpenAI uyumlu özel uç noktalar desteklenir. Anahtar yoksa "Sesten" düğmesi yüksek ses tepkilerinden klip bulur.

## Öne çıkan özellikler

- AI ile en iyi anları bulma: viral puan, gerekçe, başlık, kanca, etiket ve emojili vurgu kelimeleri
- API anahtarı olmadan ses tepkilerinden hype anı bulma, SRT/VTT içe aktarma
- 6 düzen (facecam + oyun, tam ekran, bulanık arka plan, PiP, sadece kamera, yarım bölme)
- 7 animasyonlu altyazı stili, kelime kelime düzenleme, altyazı çevirisi
- Otomatik zoom: vurgulu kelimelerde ve tepki anlarında yumuşak yakınlaşma
- Jump-cut: sessiz boşlukları otomatik kesme
- TikTok / Shorts / Reels güvenli alan önizlemesi
- AI ile 5 kanca önerisi, kapak görseli (PNG), SRT indirme
- Tek tıkla montaj: en yüksek puanlı anlardan tek "en iyi anlar" videosu
- Sohbet kaydı ile hype: TwitchDownloader / chat-downloader JSON veya zaman damgalı metin
- Arka plan müziği (konuşmada otomatik kısılır) ve vurgulu kelimelerde pop efekti
- Telefonda dışa aktarılan klibi doğrudan paylaşma
- Kanca kartı tasarımcısı: 8 stil, renk, yazı tipi, boyut, eğim, köşe, emoji, 5 animasyon; AI klip bulurken stili içeriğe göre kendisi seçer, "AI tasarlasın" ile yeniden tasarlar
- Teaser girişi: klibin en vurucu 3 anı flaş geçişlerle başta
- Dolgu kelimesi temizleme (ııı, eee, hmm, um…)
- Otomatik kadraj: tam ekran düzende hareket takibi
- Logo filigranı (9 konum, boyut, saydamlık)
- 9:16, 4:5 ve 1:1 formatlar
- İsteğe göre klip arama ("komik anlar" gibi)
- Sesi iyileştir (uğultu kesme, netlik, kompresör)
- YouTube bölümleri, başlık ve açıklama
- Kinetik altyazı vurgusu
- Geri al / yinele, klavye kısayolları (`?`)
- İlk açılışta adım adım API kurulum rehberi: hangi AI'ı kullanacağını seçersin (ücretsiz / ücretli / önerilen etiketleriyle); Ayarlar → AI analizi'nden de açılır
- Gemini için otomatik model: bir model kotaya takılırsa sıradakini dener
- Yazıya dökmeden önce konuşma dili ve başlık dili seçimi
- Mobil mod: alt gezinme (Video / Klipler / Metin), önizlemesi sabit editör, alttan açılan paneller; Ayarlar → Görünüm'den zorla açılabilir
- Temalar: Gün batımı, Açık, OLED siyah, Gece moru, Sisteme uy

## Bilinmesi gerekenler

- Dışa aktarma gerçek zamanlıdır (30 sn klip ≈ 30 sn). Bu sürede sekmeyi açık tut.
- En iyi sonuç: Chrome veya Edge (H.264 MP4). Firefox WebM üretir.
- 1,4 GB'tan büyük videolarda ses, videoyu 4× hızda tarayarak çıkarılır (2 saatlik yayın ≈ 30 dk).
- Ollama için `OLLAMA_ORIGINS=*` ortam değişkeniyle başlatman gerekir.

## Yazı tipi

Arayüz yazı tipi **Allo** (Josh Puckett), SIL Open Font License 1.1 ile lisanslıdır ve `fonts/` klasöründen sunulur. Lisans metni: `fonts/OFL-Allo.txt`.
