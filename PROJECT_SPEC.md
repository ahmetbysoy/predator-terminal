# Predator Terminal Projesi — Tam Spesifikasyon

## Bu proje ne?

PREDATOR TERMINAL, tek bir HTML dosyasına sıkıştırılmış, mobil öncelikli bir spot order-flow ve likidite terminalidir. Binance'in halka açık REST + WebSocket uçlarını kullanır, backend'i yoktur, tüm state tarayıcının localStorage'ında saklanır. Lightweight Charts üzerine kendi canvas katmanlarını bindirerek normal bir mum grafiğini "derinlik görselleştiricisine" dönüştürür.

Kısaca: Bookmap / Exocharts tarzı likidite haritasının, cep telefonu ekranına sığdırılmış hafif bir klonu.

---

## Mimari

```
Binance Public API
├── REST: exchangeInfo, klines, depth, ticker/24hr
│   └── fetchJSONPath / restRoute cache
│       └── DepthManager (snapshot + diff senkronu)
│           ├── LiquidityHeatmap (zaman x fiyat kovaları)
│           ├── SignalEngine (likidite + flow modülleri)
│           └── RenderEngine (dirty-flag katmanlı rAF)
│
└── WS: kline, aggTrade, ticker, depth@100ms
    └── StreamManager
        ├── DepthManager
        ├── OrderFlowEngine (CVD, whale, sweep, spoof)
        │   └── SignalEngine
        └── Kline History
            └── RenderEngine
                └── Canvas overlay + DOM ladder + HUD
                    └── Sinyal kartları + geçmiş/isabet
```

## Stack

- **Tek dosya:** `index.html`
- **Dil:** Vanilla JS (ES2020, `'use strict'`)
- **Grafik:** Lightweight Charts 4.1.0
- **API:** Binance public REST + WebSocket
- **Canvas:** `#heatmap-canvas` (z=8), `#orderbook-overlay` (z=10)
- **Persistence:** localStorage
- **Backend YOK, build step YOK, npm YOK**

## Mevcut Sınıflar

`TimerRegistry`, `LiquidityHeatmap`, `OrderFlowEngine`, `LevelManager`, `UserAlarmManager`, `DepthManager`, `RenderEngine`, `PredatorSignalEngine`, `StreamManager`

---

## DEĞİŞMEZ KURALLAR (ihlal = görev başarısız)

1. Tek dosya, harici bağımlılık eklemek yasak (Lightweight Charts hariç)
2. Mevcut generation-guard deseni korunacak: `symbolGen` / `klineGen` / `streamRunId`
3. Yeni timer/interval SADECE `TimerRegistry` üzerinden, isimli prefix ile
4. Yeni çizim işi SADECE `RenderEngine` dirty-flag'leri üzerinden
5. Binance rate limit disiplini bozulmayacak
6. Mobil ergonomi: minimum dokunma hedefi 44×44 px
7. Erişilebilirlik gerilemesi yok
8. Her faz sonunda 480px + BTCUSDT + DOGEUSDT ile manuel doğrulama

---

## FAZ PLANI

### FAZ 0 — Doğruluk Hataları
| # | Konu | Detay |
|---|------|-------|
| 0.1 | Spread BPS | Mutlak dolar → BPS: `(ba-bb)/mid*10000` |
| 0.2 | İsabet takibi | `barTime + m*60` → `intervalSec * N_mum` |
| 0.3 | Long-press/pan | `pointermove > 8px` → `clearTimeout(pressTimer)` |
| 0.4 | S/R tazeleme | Her kapanmış mumda + 30s throttle rebuild |
| 0.5 | Regex → yapısal | `side: 'buy'|'sell'|null` event alanı |
| 0.6 | Ölü kod | CVD/legend no-op koruması |

### FAZ 1 — Temel Okunabilirlik
| # | Konu |
|---|------|
| 1.1 | Crosshair OHLC legend |
| 1.2 | Hacim histogramı |
| 1.3 | Isı haritası blend/katman |
| 1.4 | Duvar etiket yaşı |

### FAZ 2 — Order Flow Derinleştirme
| # | Konu |
|---|------|
| 2.1 | Time & Sales tape |
| 2.2 | Footprint modu |
| 2.3 | CVD şeridi |
| 2.4 | Likidite boşluğu (void) |
| 2.5 | Spoof güven düzeltmesi |

### FAZ 3 — Analitik Araçlar
| # | Konu |
|---|------|
| 3.1 | Session VWAP + anchored VWAP |
| 3.2 | Volume Profile (POC/VAH/VAL) |
| 3.3 | S/R görünürlüğü |
| 3.4 | Ölçüm aracı |

### FAZ 4 — Sinyal Kalitesi
| # | Konu |
|---|------|
| 4.1 | momentumModule, volatilityRegime, wallProximity |
| 4.2 | Adaptif eşikler (P75/P25) |
| 4.3 | MFE/MAE isabet analitiği |

### FAZ 5 — Dayanıklılık & Performans
| # | Konu |
|---|------|
| 5.1 | Offscreen canvas blit |
| 5.2 | Geliştirici HUD |
| 5.3 | Settings JSON export/import |
| 5.4 | Global watchlist alarm |
| 5.5 | Hata paneli |

---

## Regresyon Kontrol Listesi (Her Faz Sonrası)

- [ ] Sembol değişimi
- [ ] Timeframe değişimi
- [ ] Arka plana alıp 30 sn sonra dönüş
- [ ] Offline/online geçişi
- [ ] 380px ve 480px genişlik
- [ ] Renk körü modu
- [ ] DOGEUSDT fiyat hassasiyeti
