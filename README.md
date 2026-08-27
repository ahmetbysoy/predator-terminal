# Predator Terminal

Mobil öncelikli spot order-flow ve likidite terminali. Binance halka açık REST + WebSocket API'lerini kullanır.

## Özellikler

- **Gerçek zamanlı order book** (Binance @depth@100ms)
- **Spread analizi** (BPS tabanlı, sembol bazlı eşikler)
- **Order flow** (CVD, whale, sweep, absorption, spoof tespiti)
- **Sinyal motoru** (3 modüllü skorlama: likidite + flow + spread)
- **Isı haritası** (viewport culling, offscreen canvas blit)
- **Duvar tespiti** (P90 persantil + %58 dominans)
- **Alarm sistemi** (localStorage, global ticker tarama)
- **Foreground Service** (Android arka plan WebSocket)

## Hızlı Başlangıç

### Web (Tarayıcı)

```bash
npm install
npx esbuild src/main.ts --bundle --outfile=predator.js --minify --format=iife --target=es2020
# index.html'i tarayıcıda aç
```

### Android (APK)

```bash
cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Mimari

```
Binance WS → StreamMultiplexer
  ├─ depth@100ms → DepthManager → Heatmap + Walls
  ├─ aggTrade → OrderFlowEngine → SignalEngine
  ├─ kline → KlineManager → Candlestick chart
  └─ !ticker@arr → UserAlarmManager → Global alarmlar
```

## Test

```bash
npx tsx src/phase0/validation.ts  # 48 test
npx tsx src/phase1/validation.ts  # 23 test
npx tsx src/phase2/validation.ts  # 35 test
npx tsx src/phase4/validation.ts  # 44 test
npx tsx src/phase5/validation.ts  # 63 test
# Toplam: 213 test
```

## CI/CD

GitHub Actions ile otomatik APK build:
- Push → Debug APK artifact
- Tag (`v*`) → Signed Release APK + GitHub Release

## Lisans

MIT
