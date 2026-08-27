# Predator Terminal Projesi - PDF OCR Çıktısı

> **Toplam Sayfa:** 13  
> **OCR:** Tesseract 5.5.0 (tur+eng)  

---

## Sayfa 1 (1558 karakter)

Ns j
> use.ai
Predator Terminal Projesi
meh5deetgege: (File: pasted-text.txt]
bu projeyi incele analiz et özellikleri listele ve ne işe yarıyor detaylı anlat. nasıl kullanılır. ne için
kullanılır grafikteki geliştirme fikirleri için beyin fırtınası yapıyoruz. detaylı todo promtu hazırla.
use.ai: ## Bu proje ne?
PREDATOR TERMINAL, tek bir HTML dosyasına sıkıştırılmış, mobil öncelikli bir spot order-flow ve
likidite terminali. Binance'in halka açık REST * WebSocket uçlarını kullanıyor, backend'i yok, tüm
state tarayıcının localStorage ‘Inda. Lightweight Charts üzerine kendi canvas katmanlarını
bindirerek normal bir mum grafiğini "derinlik görselleştiricisine" dönüştürüyor.
Kısaca: Bookmap / Exocharts tarzı likidite haritasının, cep telefonu ekranına sığdırılmış hafif bir
klonu.
Mimari
flowchart TB
subgraph Kaynak["Binance Public API"]
REST[ "REST: exchangelnfo, klines, depth, ticker/24hr"]
WS["WS: kline, aggTrade, ticker, depth@100ms" ]
end
REST -->|"çok yollu + CORS proxy fallback"| RL["fetchJSONPath /
restRoute cache")

WS --> SM["StreamManager" ]

RL --> DM["DepthManager<br/>snapshot + diff senkronu"]

SM --> DM

SM --> OF["OrderFlowEngine<br/>CVD, whale, sweep, spoof"]

SM --> KL["Kline History" ]

DM --> HM["LiquidityHeatmap<br/>zaman x fiyat kovalari" ]

DM --> SE["SignalEngine<br/>likidite + flow modülleri"|

OF --> SE

HM --> RE["RenderEngine<br/>dirty-flag katmanlı rAF"]

DM --> RE

KL --> RE

RE --> UI["Canvas overlay + DOM ladder + HUD"]

SE --> Cards["Sinyal kartları + gecmis/isabet" ]
Veri katmanı: aslında en sağlam kisim

---

## Sayfa 2 (1910 karakter)

Bileşen Ne yapıyor
Çoklu REST dağ Biri NE pü , vision + api hinanne Psi, üstüne 3 ie ee
rotası Promise.any ile yarıştırıp kazananı localStorage ayazıyor, 5 abir
yeniden ölçüyor.
Rate-limit 429/418 yakalayınca Retry-After okuyup bekliyor, snapshot'ı dakikada 4 ile
disiplini sınırlıyor.
Rinanre'in resmi local-order-book algoritmasını doğru uygulamış: snapshot al,
DepthManager U/u sıranumaralarıyla diff'leri tampondan işle, boşluk varsa resync.
Exponential backoff * jitter, watchdog, "crossed book" temizliği var.
Sekme arkaya alınınca tüm WS'leri kapatıyor; 15 sn'den uzun sürdüyse REST'ten
StreamManager | tazeleyip yeniden bağlanıyor. Her 5 sn watchdog: mesaj yaşı 15-20 sn'yi geçen
stream'i yeniden kuruyor.
. symbolGen / klineGen / streamRunId Sayaçlarıyla eski async cevapların
Generation 5 ELER ; > Lİ ;
yeni sembolün üstüne yazmasını engelliyor — çoğu hobi projesinde olmayan bir
guard NE
titizlik.
Özellik listesi
Grafik ve overlay katmanları
Likidite ısı haritası: emir defterinin son 15 dakikasını 1 sn'lik dilimler hâlinde saklıyor, log-ölçekli
alfa ile fiyat-zaman düzlemine boyuyor. Bid yeşil, ask kırmızı, screen blendile.
DOM ladder şeridi: sağ kenarda, her 2 px'lik fiyat kovasındaki notional'ı yatay bar olarak gösteren
canlı derinlik çubuğu. Genişliği ayarlanabilir (28—72 px).
Duvar (wall) tespiti: kovalardaki notional'ın persentil eşiğini (P80—P99) aşan ve tek tarafın >%58
baskın olduğu blokları kümeleyip gradient "ray" olarak çiziyor. Etiketi $1.2M formatında; 30
saniyeden uzun yaşayan duvara Ö ekliyor. Etiket çakışma önleme * yasak bölge mantığı var.
MID / spread / son fiyat işaretleri: kesikli MID çizgisi, mor spread bandı, son işlem fiyatı için kısa
yön renkli tick.
Whale ok işaretleri: eşiği aşan tek print, mumun altına/üstüne ok * notional etiketi olarak
düşüyor.
Alarm çizgileri: kullanıcı alarmları kesikli price line olarak; tetiklenen gri'ye düşüyor.
Order flow motoru

---

## Sayfa 3 (1610 karakter)

Dedektör Tetik koşulu
Whale print Tek aggTrade = eşik (varsayılan $250K), 1.8 sn cooldown
Sweep 1.8 sn içinde aynı yönde 24 print ve toplam = eşikx1.8
Absorption 10 sn'de delta = esikx2.2 ama fiyat hareketi <%0.035
Delta burst CVD eğimi (1 dk) = eşikx2.5
Spoof Eşik üstü seviye 8 sn içinde silinmiş ya da %68'den fazla daralmış
CVD Kümülatif delta, 1 saatlik nokta serisi + dakika bazlı eğim
Sinyal motoru
Modüler skorlama: 1iquidityModule (+%25 imbalance — +2 puan) * £lowModule (CVD
eğimi +1.5, son yüksek şiddetli flow olayı +1). Ağırlıklar ayarlardan slider ile.
Toplam = +2.5 — BUY, < -2.5 — SELL. Güven:low/medium/high.
Her sinyale invalidation cümlesi ("Kapanış X altı zayıflatır").
Kapanmış mumda değerlendirme varsayılan; "Intrabar Preview" açılırsa canlı mumda da üretiyor
(ayrı cooldown ile).
Geçmiş & isabet sekmesi: son 500 sinyal localStorage da, 3/5/7/15 dakika sonraki kapanışa
göre //x ve % ile skorlanıyor, toplam isabet oranı hesaplanıyor.
HUD, watchlist, alarmlar
8 hücreli alt HUD: VOL, SPREAD, IMB, DUVAR sayısı, BID, ASK, MID, BASKI (bid/ask yüzdesi).
Kompakt/normal/büyük boyut.
3 watchlist grubu (Favoriler / Scalp / Swing), 40 sembole kadar multiplex @ticker stream, 5
sıralama modu (sabit, A-Z, yükselen, düşen, hacim), pin, filtre kutusu, dakikada bir "not mover"
taraması.
Fiyat alarmları: grafikte çift dokun veya uzun bas — alarm; çizgiyi uzun basıp sürükle — taşı;
"Geri Al" toast'ı; Notification API desteği; sembol başına ayrı saklama.
Otomatik S/R: pivot tespiti + tolerans kümelemesi ile 8 seviye; çizgi çizilmiyor, sadece alarm için
kullanılıyor.
Altyapı ve erişilebilirlik

---

## Sayfa 4 (2164 karakter)

RenderEngine: katman bazlı dirty flag (chart / heatmap / depth / annotation / cvd), tek rAF
döngüsü, overlay için 50 ms throttle, Float64Array havuzu, frame-drop sayacı.
TimerRegistry: tüm timer'lar isimli; sembol değişiminde clearPrefix('depth:') gibi toplu
temizlik.
PWA manifest + service worker kaydı, wake lock, theme-color , Safe-area inset'leri, 100dvh .
ARIA rolleri ( switch, tablist , dialog ), klavye navigasyonu ve focus trap arama
prefers-
reduced-motion
Nasıl kullanılır
1. Sembol seç — Başlıktaki sembole dokun, alt sayfa açılır. Son kullanılanlar chip olarak üstte; arama
yaz, fiyat/değişim/hacim canlı geliyor; X ile aktif watchlist'e ekle.
2. Bağlantı durumunu doğrula — Sembolün yanındaki badge: CANLI (dört stream + defter senkron,
gecikme <6 sn), GECİKME Xs , SENK (defter yeniden senkronlanıyor), KOPUK , OFFLINE .
Badge CANLI değilken duvar ve imbalance okumaları güvenilmez.
3. Grafiği oku — Soldan sağa mumlar, arkada ısı haritası (nerede kalıcı likidite birikmiş), sağ kenarda
ladder (şu an nerede duruyor), mumlardan sağa uzanan gradient raylar * $x etiketleri (aktif
duvarlar). © etiketi o duvarın 30 saniyeden uzun süredir yerinde durduğunu, yani spoof olma
olasılığının düştüğünü söylüyor.
4. HUD'a bak — IMB pozitifse +%1 bandında bid notional'ı ağır basıyor, BASKI hücresi aynı şeyin
okunabilir hâli. DUVAR o an tespit edilen küme sayısı.
5. Alarm koy — İlgilendiğin seviyede uzun bas. Yanlış yere düştüyse toast'taki "Geri Al". Fiyat hareket
ettikçe çizgiyi sürükleyerek taşı.
6. Sinyal sekmesi — Canlı akışta order-flow olayları ve skorlu sinyaller; filtre chip'leriyle sadece flow
ya da sadece alarm. "Geçmiş & İsabet" sekmesi kendi ayarlarının gerçekten işe yarayıp yaramadığını
gösteren tek dürüst metrik.
7. Ayarları kalibre et — Whale eşiği sembolün likiditesine göre ayarlanmalı (BTC'de $250K anlamlı,
küçük altcoin'de gürültü). Duvar eşiği P90 çok kalabaliksa P95-P97. Isı haritası opaklığı mumları
boğuyorsa “40'a çek.
Ne için uygun, ne için değil
Uygun: kısa vadeli scalp'te giriş/çıkış zamanlaması, likidite boşluğu ve duvar avı, spoof/absorption
gözlemi, seviye bazlı alarm bekçiliği, tek elle telefondan defter izleme.

---

## Sayfa 5 (2332 karakter)

Uygun değil: pozisyon yönetimi ve emir gönderme (borsa entegrasyonu yok), vadeli piyasa analizi

(funding, open interest, likidasyon yok), swing/yatırım kararı (indikatör ve haber katmanı yok),

backtest (sadece ileriye dönük 15 dakikalık isabet takibi var).

Tespit ettiğim gerçek problemler

Bunlar geliştirme listesinin en tepesine yazılmalı, çünkü kullanıcıyı yanlış yönlendiriyorlar:
Spread renk eşikleri mutlak dolar — sp<5 ? bull : sp>20 ? bear mantığı BTC için
yazılmış. DOGE'da spread 0.00001 olduğu için her zaman yeşil, yani hücre bilgi taşımıyor. bps'e
çevrilmeli ( spread/mid*10000 ).
İsabet takibi 1 dakikalık mum varsayıyor — sig.barTime + m*60 hesabı 5m/15m/1h
grafiklerde 3-5-7-15. mumu değil, gelecekteki yanlış zamanı arıyor. Timeframe'in saniye cinsinden
uzunluğuyla çarpılmalı ya da hedef "N mum sonrası" olarak tanımlanmalı.
Uzun basma pan hareketiyle çakışıyor — pointermove İçinde moved set ediliyor ama

pressTimer iptal edilmiyor. Grafiği yavaşça kaydırırken 650 ms geçince istenmeyen alarm
düşüyor.
Otomatik S/R bayatlıyor — leve lManager.rebuild yalnızca loadKlines içinde
çağrılıyor. Sembol ya da timeframe değişmedikçe seviyeler saatlerce güncellenmiyor.
Flow modülü metinden yön çıkarıyor — /BUY|BID/.test(lastHigh.text) gibi regex ile
sinyal yönü belirlemek kırılgan; olay nesnesinde zaten side alanı var, o kullanılmalı.
Isı haritası her çizimde tam yeniden hesap — 900 frame x 220 kova en kötü senaryoda ~200 bin
fillRect . Offscreen canvas'a çizip yeni kolonu ekleyerek kaydırmak (blit + translate) gerekir.

Ölü kod ve sıfır boyutlu canvas — CVD paneli ve OHLC legend display:none, drawCvd()
boşama flowDirty her trade'de tetikleniyor; cvdCanvas gizli elementten 0x0 boyut alıyor.
Ya tamamen kaldırılmalı ya da geri getirilmeli.
Crosshair'de fiyat okuması yok — legend kapatıldığı için imleci bir muma götürdüğünde OHLC
göremiyorsun; bu grafiğin en temel işlevi.
Alarmlar sadece aktif sembolde çalışıyor — watchlist'teki 20 coin için alarm kurabiliyorsun ama
sembolü değiştirmedikçe hiçbiri tetiklenmiyor. Bu, alarm özelliğinin vaadini yarı yarıya boşa
düşürüyor.
Hacim verisi çekiliyor ama grafikte hiç kullanılmıyor — volume alanı klineHistory 'de
duruyor, tek satır histogram serisiyle bedava değer üretebilir.

Grafik geliştirme fikirleri — beyin fırtınası

A. Okunabilirlik ve temel eksikler

---

## Sayfa 6 (1919 karakter)

Kompakt crosshair legend geri gelsinn Oo H L C « A7. voL,teksatır, sol üst, mumları
kapatmayan yarı saydam kapsül.
Hacim histogramı alt 915'e ayrı price scale ile; delta renklendirmesi (satın alan/satan baskın
hacim).
CVD panelini geri getir ama grafiğin altına gömülü ince şerit olarak, fiyat-CVD uyumsuzluğu
(divergence) otomatik işaretlensin.
Isı haritası mumların arkasına alınsın ( z-index ve blend modu revizyonu) — şuan screen ile
fitilleri yiyor.
Duvar etiketlerinde notional yanında yaş göster: $1.2M - 4m12s.
Fiyat ekseninde son fiyat, MID, best bid/ask için özel etiket rozetleri.

B. Order flow derinleştirme
Footprint / cluster delta: her mum içinde fiyat seviyesine göre bid/ask hacim ayrımı — bu
terminalin doğal sonraki adımı.
Time & Sales tape: sağ kenarda kayan print listesi, whale'ler vurgulu, dokununca grafikte o ana
zıplasın.
Kümülatif derinlik eğrisi (depth curve): sağ panelde bid/ask kümülatif likidite profili, duvarların ne
kadar "arkalıklı" olduğunu gösterir.
Absorption/iceberg izi: aynı seviyede tekrar tekrar yenilenen emir — grafikte kalıcı ikon.
Likidite boşluğu (void) tespiti: defterin ince olduğu fiyat aralıklarını farklı renkle boya; fiyat oraya
girdiğinde hızlı hareket beklenir.
Spoof yoğunluk göstergesi: son 60 sn'deki spoof sayısını HUD hücresine taşı; yüksekse duvar
sinyallerinin güvenini otomatik düşür.

C. Klasik analiz katmanı
Session VWAP + anchored VWAP (kullanıcı bir muma dokunup sabitler), 10/20 bantları.
Volume Profile (görünür aralık) + POC / VAH / VAL çizgileri; likidite ısı haritasıyla üst üste
bindiğinde çok güçlü.
Otomatik S/R'yi görünür kıl: tam genişlik değil, sağdan 60 px uzunlukta kısa çubuklar *
dokunulunca genişleyen etiket.
Higher-timeframe overlay: 1m grafikte 15m mumlarının gölge kutuları.
Basit indikatör seti opsiyonel: EMA 20/50/200, ATR bazlı volatilite bandı (fazlasına gerek yok,
terminalin kimliği order flow).

D. Etkileşim ve mobil UX

---

## Sayfa 7 (2298 karakter)

Olçüm aracı: iki parmakla iki fiyat arasını seç — “© ,Ş, ATR katı, süre.

Alarm oluşturmada haptic * ön izleme: uzun basarken parmağın altında canlı fiyat etiketi

görünsün, bırakınca kesinleşsin.

Alarm tipini seçtirme: şu an her şey touch . Sürükleme sırasında yukarı/aşağı jest ile above /

below / breakout .

Grafik kilidi: #ocusRecentCandles kullanıcı manuel kaydirdiktan sonra resize'da görünümü

zorla sıfırlamasın (kullanıcı niyeti saklanmalı).

Yatay mod: orientation.lockl'portrait') kaldırılıp yatayda ladder + footprint yan yana

gösterilebilir.

Çift dokunma ile ısı haritası/ladder aç-kapa (ayarlar sayfasına gitmeden hızlı görünüm değişimi).
E. Sinyal kalitesi

Modül ekle: momentum (kapanış serisi + ATR normalize), volatilite rejimi (sıkışma/genişleme),

duvar yakınlığı (fiyat büyük duvara X bps yakınsa yön skoru bastır).

Eşikleri adaptif yap: «2.5 sabit yerine son N sinyalin skor dağılımının persentili.

Whale eşiği otomatik: sembolün 24s hacminin sabit bir oranı ya da son 1 saatlik print dağılımının

P99'u.

İsabet takibini genişlet: MFE/MAE (maksimum lehte/aleyhte hareketi), sinyal tipine göre kırılım

tablosu, ayar kombinasyonuna göre isabet.

Sinyal kartına "neden şimdi" mini sparkline: tetikleyen CVD eğimi ve imbalance'ın son 5 dakikası.
F. Veri genişliği

Futures kanalı: funding rate, open interest değişimi, likidasyon akışı ( ! forceOrder@arr ). Bu,

spot defterle birleşince sinyal kalitesini en çok artıracak tek ekleme.

Çoklu borsa toplaması (Bybit/OKX defterlerini aynı ısı haritasında toplamak) — CORS/proxy

maliyeti yüksek, uzun vadeli.

Arka plan alarmı: service worker * push, sembol dışı watchlist alarmları için hafif ticker polling.
G. Performans ve dayanıklılık

Isı haritası için offscreen canvas * kolon blit (yukarıdaki #6).

Duvar tespitini worker'a taşı; depth@100ms mesaj işlemeyi requestIdleCallback ile ayir.

Frame bütçesi göstergesi: geliştirici modunda overlayDrawMs , frameDropCount ,

visibleBinCount görünsün (değişkenler zaten var, hiç gösterilmiyor).

Ayar/alarm dışa-içe aktarma (JSON), cihaz değiştirdiğinde her şey sifirlanmasin.

Hata rozeti: son 5 hatayı gösteren küçük log paneli; şuan console .warn ‘da kayboluyor.
Kod ajanına verilecek detaylı TODO promptu

# GÖREV: PREDATOR TERMINAL v5 - Grafik ve Order Flow Geliştirme

---

## Sayfa 8 (2292 karakter)

## Bağlam
Tek dosyalı (index.html) mobil kripto order-flow terminali.
Stack: vanilla JS (ES2020, 'use strict'), Lightweight Charts 4.1.0,
Binance public
REST + WebSocket, iki canvas overlay (#heatmap-canvas 2-8, #orderbook-
overlay 2-10),
localStorage persistence. Backend YOK, build step YOK, npm YOK.
Mevcut ana sınıflar: TimerRegistry, LiguidityHeatmap, OrderFlowEngine,
LevelManager,
UserAlarmManager, DepthManager, RenderEngine, PredatorSignalEngine,
StreamManager.
## DEĞİŞMEZ KURALLAR (ihlal - görev başarısız)
1. Tek dosya, harici bağımlılık eklemek yasak (Lightweight Charts
hariç).
2. Mevcut generation-guard desenini koru: symbolGen / klineĞen /
streamRunld
kontrolleri her async dönüşte kalmalı.
3. Yeni timer/interval SADECE TimerRegistry üzerinden, isimli prefix
ale «
4. Yeni çizim işi SADECE RenderEngine dirty-flag’leri üzerinden; ham
reguestAnimationFrame döngüsü açmak yasak.
5. Binance rate limit disiplinini bozma: yeni REST çağrısı eklersen
fetchJSONPath üzerinden geçir, snapshot throttle'a dokunma.
6. Mobil ergonomi: minimum dokunma hedefi 44x44 px, safe-area
inisie ty lenis kolun
7. Erişilebilirlik gerilemesi yok: ARIA rolleri, focus-visible, renk
körü modu,
prefers-reduced-motion destegi korunacak.
8. Her fazın sonunda 480px genişlikte, 1m/5m/15m/1h ve hem BTCUSDT hem
düşük
fiyatlı bir altcoin (ör. DOGEUSDT) ile manuel doğrulama yapılabilir
olmalı.
## FAZ 0 - Doğruluk hataları (önce bunlar, hepsi bug)
### O.1 Spread göstergesini bps'e çevir
drawDepthOverlay sonundaki se.className mantığı mutlak dolar eşiği
kullanıyor
(sp<5 bull / sp>20 bear). Bu sadece BTC için doğru.
- spreadBps - (ba - bb) / mid * 10000 hesapla.
- HUD metni: "1.4 bps" (mid > 100 için) veya fiyat + bps kombinasyonu.
- Renk: <1 bps bull, 1-5 bps warn, >5 bps bear (eşikler sabit değil,
const olarak
tanımlı ve ayarlanabilir olsun).
Kabul: DOGEUSDT'de spread hücresi artık sabit yeşil değil, gerçek
durumu yansıtıyor.
### O.2 Sinyal isabet takibini timeframe'e bağla
checkSignalOutcomes içindeki sig.barTime + m*60 yanlış: 1m dışı tüm
timeframe'lerde hedef zamanı kaçırıyor.
- Sinyale üretim anında intervalSec ve interval alanlarını yaz.
- Ufukları "N mum sonrası" olarak yeniden tanımla: (1, 3, 5, 10] mum.
11 avea b lam amam wana wen AZI sare laa lale e im bamersal Gam. vealsma Cain

---

## Sayfa 9 (2124 karakter)

ER İl Kaytttat 144i BeLiAYS UULLULK UyullLuLuk. EV abo cc: yunrs5da UU
varsay.
> LOMA CObwCOMos Sealed YS) m mi EO EM EE aioe diö misil
Kabul: 15m grafikte üretilen sinyalin ilk sonucu ~15 dk sonra
üşaretleniyor.
### 0.3 Uzun basma / pan çakışması
setupManualAlarmlnput içinde pointermove moved-true yapıyor ama
pressTimer'ı
iptal etmiyor —> yavaş kaydırmada istenmeyen alarm.
- Hareket > 8px olduğunda clearTimeout(pressTimer).
- Sürükleme modundaysa (dragld var) bu kural uygulanmaz.
Kabul: grafiği 3 saniye boyunca yavaşça kaydırmak alarm oluşturmuyor.
### 0.4 Otomatik S/R tazeleme
levelManager.rebuild sadece loadKlines'ta çağrılıyor.
- Her kapanmış mumda (kline WS'inde candle.closed) ve en fazla 30
saniyede bir
olacak şekilde throttle"'lı rebuild ekle.
Kabul: sembol değiştirmeden 10 dakika beklendiğinde seviye alarmları
güncel
fiyat yapısını yansıtıyor.
### 0.5 Flow modülünde regex yerine yapısal veri
PredatorSignalEngine.flowModule ~ /BUY|BID/.test(lastHigh.text)'
kullanıyor.
- OrderFlowEngine.event çağrılarının hepsine side: 'buy'|'sell'|/null
ekle.
- flowModule yönü ev.side'dan okusun; text parse'ı tamamen kaldır.
Kabul: metin formatı değiştiğinde sinyal yönü bozulmuyor.
### 0.6 Ölü kodu temizle
- #cvd-panel, #cvd-canvas, ctxC, drawCvd, cvdView ayarı, #ohlc-legend
ve
paintLegend'in boş gövdesi: FAZ 1'de geri geleceği için bir karar
ver —
legend geri gelecek (1.1), CVD geri gelecek (2.3).
- O zamana kadar flowDirty bayrağının boşa RenderEngine turu
tetikleme same:
engelle (drawCvd no-op ise flag set etme).
Kabul: aggTrade akışı sırasında gereksiz overlay turu yok.
## FAZ 1 - Temel okunabilirlik
### 1.1 Kompakt crosshair legend (geri getir)
- Sol üstte tek satır, yarı saydam kapsül: 'OHLC Aş VOL.
- Renk: kapanış açılıştan yüksekse bull, değilse bear.
- Crosshair yoksa son mumu göster.
- Ladder/duvar etiketlerinin bulunduğu bölgeyi kapatmayacak konumda
(blockedlabelZones ile uyumlu).
Kabul: herhangi bir muma dokununca OHLC okunabiliyor, FPS düşmüyor.
### 1.2 Hacim histogramı
- addHistogramSeries, ayrı priceScaleld, scaleMargins { top: 0.86,
bottom: 0 |.
- Mum yönüne göre renk, %35 opaklık.

---

## Sayfa 10 (2041 karakter)

- Ayarlarda aç/kapa toggle'ı (varsayılan açık), settings şemasına
e kile
Kabul: klineHistory'deki volume alanı artık görsel olarak
kullanılıyor.
### 1.3 Isı haritası katman sırası ve blend
- Heatmap mum serisinin arkasında kalacak şekilde z-index / blend
revizyonu;
“screen modunun fitilleri yemesi giderilecek.
- Ayarlara "Isı haritası modu: arka plan / üst katman" seçeneği.
Kabul: yogun ası haritasında mum gövdeleri ve fitaller net okunuyor.
### 1.4 Duvar etiketine yaş bilgisi
- Etiket: ~$1.2M - 4m12s , 30 sn üstü kalın + ©.
- Yer yoksa (tw+8 > raySpan) sadece notional; asla taşma yok.
Kabul: 380px ekranda etiketler grafiği kesmiyor.
## FAZ 2 — Order flow derinlestirme
### 2.1 Time & Sales tape
- Sağ kenarda opsiyonel, 40 satır kayan print listesi (fiyat, boyut,
yön).
- whaleThresholdNotional üstü satırlar vurgulu.
- Ayardan aç/kapa; kapalıyken hiç DOM olusturmasin.
- DOM node havuzu kullan (her print'te createElement yasak).
### 2.2 Footprint (cluster delta) modu
- Timeframe pill'lerinin yanına görünüm modu: MUM / FOOTPRINT.
- Her mum içinde fiyat kovası başına buy/sell hacim ayrımı,
aggTrade'lerden
canlı biriktirilir (geçmiş için REST'te veri yok - sadece oturum
boyunca).
- Kova boyutu: symbolMeta.minMove * WALL TICK GROUP ile hizalı.
- Bellek sınırı: en fazla son 60 mum.
### 2.3 CVD şeridi (yeniden)
- Grafigin altında 34px ince satır, çizgi + sıfır ekseni.
- Fiyat yeni tepe yaparken CVD yapmıyorsa (ya da tersi) otomatik
"DIVERGENCE"
isareti ve orderFlow.event('cvd divergence', ...).
- Pencere secimi 5/15/60 dk (mevcut cvdView ayari yeniden aktiflesir).
### 2.4 Likidite boslugu (void) tespiti
- Ladder kovaları arasında notional'in P20 altında kaldığı ardışık
bölgeleri
bul, sag kenarda soluk tarama deseni ile göster.
- HUD'a "VOID" hücresi: en yakın boşluğun mid'e uzaklığı (bps).
### 2.5 Spoof güven düzeltmesi
- Son 60 sn'deki spoof sayısını hesapla (orderFlow.spoofs zaten var).
- 3'ten fazlaysa: duvar etiketlerine soluk "?" ekle ve liguidityModule
skorunu
0.6 katsayısıyla bastır.
- HUD'a "SPOOF" hücresi.

---

## Sayfa 11 (1629 karakter)

## FAZ 3 - Analiz katmanı
### 3.1 Session VWAP + anchored VWAP
- Günlük (UTC 00:00) VWAP çizgisi + 10/20 bantları.
- Bir muma uzun bas — "Buradan VWAP" seçeneği (alarm menüsüyle
çakışmayan jest).
### 3.2 Görünür aralık Volume Profile
- Sağ tarafta yatay profil, POC/VAH/VAL çizgileri.
- Ladder ile aynı alanı paylaşıyor: ikisi birden açıksa profil sola
kayar,
çakışma testi zorunlu.
### 3.3 Otomatik S/R görünürlüğü
- levelManager.levels artık çizilecek: tam genişlik değil, sağdan 60px
kısa
çubuk + dokununca açılan etiket.
- Güç göstergesi (n * w) çubuk kalınlığına yansısın.
### 3.4 Ölçüm aracı
- İki parmak ile fiyat aralığı seçimi: A$, A%, süre, ATR katı.
- Bırakınca kaybolur; kalıcı çizim state'i tutulmaz.
## FAZ 4 - Sinyal kalitesi
### 4.1 Yeni modüller
- momentumModule: ATR-normalize kapanış serisi eğimi.
- volatilityRegimeModule: sıkışma/genişleme, sıkışmada skor eşiğini
yükselt.
- wallProximityModule: fiyat büyük duvara < 15 bps ise ters yön
skorunu bastır.
- Her modül için ayarlarda ağırlık slider'ı (mevcut wFlow/wLiquidity
deseni).
### 4.2 Adaptif eşikler
- Sabit 42.5 yerine son 100 skorun P75/P25'i; yetersiz örnekte sabite
düş.
- Whale eşiği: manuel değer * "Otomatik (24s hacmin oranı)" seçeneği.
### 4.3 İsabet analitiği genişletme
- MFE/MAE kaydı, sinyal tipine göre kırılım tablosu, güven seviyesine
göre
isabet oranı.
- Geçmiş sekmesinde özet tablo (tip x isabet x ortalama 7).
## FAZ 5 — Dayanıklılık ve performans
### 5.1 Isı haritası offscreen blit
- LiguidityHeatmap.draw tam yeniden çizim yapıyor (en kötü ~200k
fillRect).
- OffscreenCanvas (yoksa gizli canvas) üzerinde kolon kolon çiz, her
veni

---

## Sayfa 12 (1765 karakter)

yum

örnekte içeriği sola kaydırıp (drawlmage self-translate) sadece yeni
kolonu ekle.
- Timeframe / zoom değişiminde tam yeniden inşa.
Kabul: overlayDrawMs medyanı mevcut değerin yarısının altında.
### 5.2 Geliştirici HUD'u
- Ayarlarda "Geliştirici modu": overlayDrawMs, frameDropCount,
visibleBinCount,

depth resync sayısı, WS mesaj yaşları. Değişkenler zaten mevcut,
sadece

görselleştirilecek.
### 5.3 Ayar / alarm dışa-içe aktarma
- Tüm localStorage anahtarlarını tek JSON'a serialize et, kopyala /
yapıştır ile

geri yükle, şema versiyonu ve migration fonksiyonu ile.
### 5.4 Sembol dışı alarm bekçisi
= Watchlist, ticker stream'i zaten canlı: o veriyle watchlist
sembollerindeki

alarmları da kontrol et (UserAlarmManager tüm semboller için
okunacak şekilde

genişletilsin).
= Letiklenince Notification + sinyal kartı; sembolü değiştirmeye
zorlamadan.
### 5.5 Hata paneli
- Son 20 reportError kaydını gösteren ayar bölümü (zaman, kaynak,
mesaj).
## OPSİYONEL / SONRAKİ TUR
- Binance Futures kanalı: funding, open interest, !forceOrder
likidasyon akışı;

jos EloirjeGiwlkS jojaisdlailkie@ flyyiwal [oalse Wiewincayy joes k 115 UD LG e siye
sinyal modülü.
- Yatay ekran düzeni: ladder * footprint yan yana.
- Service worker push ile arka plan alarmı.
## Teslim formatı
- Her faz ayrı, çalışır durumda teslim edilir; yarım bırakılmış faz
Yok
- Değişiklik başına: ne değişti, hangi fonksiyon/satır bölgesi, nasıl
bende eelilir,
- Her fazdan sonra regresyon kontrol listesi: sembol değişimi,
timeframe değişimi,

arka plana alıp 30 sn sonra dönüş, offline/online geçişi, 380px ve
480px genişlik,

renk körü modu, düşük fiyatlı altcoin (DOGEUSDT) fiyat hassasiyeti.

Faz 0'ı atlamadan baslamak önemli: 1.. 2. ve 4. maddeler kullanıcının ekranda doğru sanıp vanlis

---

## Sayfa 13 (196 karakter)

okuduğu verileri üretiyor, yani yeni özellik eklemek onların üstüne inşa etmek olur. Özellikle spread
bps düzeltmesi tek satırlık iş ve terminali BTC dışındaki her sembolde anlamlı hâle getiriyor.

---

