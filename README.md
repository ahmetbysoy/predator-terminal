# 🎯 PREDATOR TERMINAL

Binance'ten **canlı 1m mum** ve **emir defteri (depth)** verisini aynı anda çeken, **sıfır grafik kütüphanesi** ile saf `Canvas` üzerine çizim yapan gerçek zamanlı bir BTC/USDT savaş paneli.

> ⚠️ **Sorumluluk reddi:** Bu uygulama eğitim/analiz amaçlıdır. Yatırım tavsiyesi değildir. Kripto piyasası yüksek risklidir; kaybettiğiniz parayı geri isteyemezsiniz. Tetiği kendi riskinle çek.

## 🚀 Özellikler

| Özellik | Açıklama |
|---|---|
| 📡 Canlı veri | Binance Public WSS: `btcusdt@kline_1m` + `btcusdt@depth20@100ms` (API key gerekmez) |
| 📊 Custom Canvas | Mum grafiği, grid ve fiyat etiketleri — 0 grafik kütüphanesi, saf `android.graphics` |
| 🧱 Likidite Duvarları | Depth'teki büyük bid/ask yığınları grafik üzerinde yarı saydam yeşil/kırmızı barlar |
| 🧠 Sinyal Motoru | EMA 9/21 kesişimi + hacim patlaması → `STRONG BUY` / `STRONG SELL` (güç 1-10) |
| 🔄 Otomatik yeniden bağlanma | Bağlantı koparsa üstel backoff ile tekrar bağlanır |
| ⚡ Performans | `CopyOnWriteArrayList` + throttle edilmiş UI güncellemesi (250ms) |

## 📦 APK'yi indir

**En kolay yol:** `main` dalına her push'ta **GitHub Actions** otomatik olarak:

1. `assembleDebug` + `assembleRelease` ile APK derler
2. APK'ları **Actions artifact** olarak yükler → *Actions → en son çalışma → Artifacts*
3. Ayrıca **GitHub Release** oluşturur → *Releases* sekmesinden `predator-terminal-debug.apk` ve `predator-terminal-release.apk` indirilebilir

APK'yı telefona kurmak için **"Bilinmeyen kaynaklar"** iznini açman gerekir.

## 🛠️ Yerelde derleme

Gereksinimler: **JDK 17**, **Android SDK (platform 35)**

```bash
# Android SDK yolu (local.properties'a da yazabilirsin)
export ANDROID_HOME=$HOME/Library/Android/sdk        # macOS
export ANDROID_HOME=$HOME/Android/Sdk                # Linux

./gradlew assembleDebug        # debug APK
./gradlew assembleRelease      # release APK (R8 minify açık)
```

Çıktı: `app/build/outputs/apk/debug/app-debug.apk` ve `app/build/outputs/apk/release/app-release.apk`

## 🧰 Proje yapısı

```
app/src/main/java/com/predator/terminal/
├── MarketDataStream.kt    # WSS motoru (kline + depth), yeniden bağlanma
├── SignalEngine.kt        # EMA 9/21 + hacim patlaması sinyal analizi
├── PredatorChartView.kt   # Custom Canvas mum grafiği + likidite duvarları
└── MainActivity.kt        # Kontrol merkezi, 250ms UI döngüsü
```

## ⚙️ Otomatik Build (GitHub Actions)

`.github/workflows/build-apk.yml` dosyası şunları yapar:

- **`main`'a her push** (veya PR / manuel `workflow_dispatch`) → Ubuntu runner'da JDK 17 + Gradle ile **debug ve release APK** derler
- APK'ları `upload-artifact` ile **Actions Artifacts**'a ekler
- Push ise ayrıca `gh release create` ile **otomatik GitHub Release** oluşturur (her push = yeni sürüm `v1.0.<run#>`) ve APK'ları sürüme ekler

### Sürümlerin düzgün çalışması için

Repo'ya push ederken **yalnızca `main` dalına** push et (ilk push `git push -u origin main`).

### Gerçek imzalı release (opsiyonel)

Release APK'sı varsayılan olarak debug anahtarıyla imzalanır (telefona kurulum için yeterli). Play Store / gerçek imza istersen:

1. Repo'ya **secrets** ekle: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`
2. `app/build.gradle.kts`'e `signingConfigs` bloğu ve workflow'a imza adımı ekle (rehber istenirse yazarım)

## 🔧 Parametreler

- Sembol değiştirmek için `MarketDataStream.kt` içindeki URL: `wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/btcusdt@depth20@100ms`
- Grafikte tutulan mum sayısı: 100 (`updateKline` içindeki sabit)
- UI yenileme hızı: 250ms (`MainActivity`)

## 🔫 OTOMATİK İNFAZ (PredatorTrigger)

Terminal sadece **izlemez** — istersen sinyal geldiğinde **kendisi emir gönderir**. Üç mod:

| Mod | Ne yapar? |
|---|---|
| `AUTO: KAPALI` | Sadece görüntüleme (varsayılan) |
| `AUTO: PAPER 📄` | Sinyal ≥7/10 + değişim → log + Telegram bildirimi, **gerçek emir yok** |
| `AUTO: CANLI 🔴` | Aynı koşul → Bybit'te **gerçek market emri** |

Akış: `SignalEngine` sinyal üretir → `SpoofingDetector` emir defterini kontrol eder (sahte duvar = emir iptal) → `BybitExecutor` Bybit v5 REST API'ye imzalı emir gönderir → `TelegramNotifier` her adımı telefonuna bildirir.

### Kurulum (2 dk)

1. **Bybit API key:** bybit.com → API → Create API Key → sadece **trade** izni, IP kısıtla
2. **Telegram:** @BotFather'dan bot aç → token al, chat ID'ni bul (`@userinfobot` ile öğrenebilirsin)
3. Uygulamada **⚙ Ayarlar** → sembol (örn. `BTCUSDT`), pozisyon büyüklüğü (`0.001` = spot'ta 0.001 BTC), kategori (`spot` veya `linear`), API key/secret, Telegram token/chat ID
4. **AUTO** butonuna bas → `PAPER` → (key tanımlıysa) `CANLI`

> ⚠️ **Anahtarlar cihazda şifreli saklanır** (`EncryptedSharedPreferences`), repo'ya asla yazılmaz. APK'ya gömülü hiçbir anahtar yoktur.
>
> ⚠️ **Risk:** CANLI mod gerçek parayla işlem yapar. Önce PAPER'da çalıştır, küçük pozisyonla başla. EMA+hacim sinyali **garanti kazanç değildir**; piyasa kaybettirir. Bu yazılım yatırım tavsiyesi değildir.

### Neden "proxy rotation / blackhat" YOK?

İlk taslakta öyle bir istek vardı ama o kısım bilinçli olarak yapılmadı: kendi Bybit hesabına resmi API ile bağlanmak zaten meşru ve çalışıyor. Kimlik gizleyen proxy kullanımı Bybit'in kullanım şartlarını ihlal eder, hesabın kapatılmasına ve varlıkların donmasına yol açabilir. Kısaca: **proxy'ye ihtiyacın yok, sadece kendi key'lerine ihtiyacın var.**

### Mimari

```
app/src/main/java/com/predator/terminal/
├── MarketDataStream.kt    # WSS motoru (kline + depth), yeniden bağlanma
├── SignalEngine.kt        # EMA 9/21 + hacim patlaması sinyal analizi
├── PredatorChartView.kt   # Custom Canvas mum grafiği + likidite duvarları
├── SpoofingDetector.kt    # Sahte duvar (spoof) sezgisel tespiti
├── BybitExecutor.kt       # Bybit v5 REST — HMAC-SHA256 imzalı market emri
├── TelegramNotifier.kt    # Telegram Bot API bildirimleri
├── PredatorTrigger.kt     # 1 sn döngü: sinyal → tuzak kontrolü → infaz
├── SignalLog.kt           # Tetikleyici olay günlüğü
├── Config.kt              # Şifreli ayarlar (symbol, boyut, anahtarlar)
└── MainActivity.kt        # Kontrol merkezi + AUTO mod + ayarlar
```

---

*Avını gözlerinle gör. Analiz et. Ve parayı sök.* 🔫
