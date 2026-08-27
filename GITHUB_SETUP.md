# GitHub'a Yükleme ve APK Build Rehberi

## 1. GitHub'da Repo Oluştur

1. https://github.com/new adresine git
2. Repository name: `predator-terminal`
3. Public veya Private seç
4. **README, .gitignore, license EKLEME** (zaten mevcut)
5. "Create repository" butonuna bas

## 2. Terminal'den Push Et

```bash
cd predator-terminal

# GitHub repo URL'ini ekle (KULLANICI_ADIN yerine kendi adını yaz)
git remote add origin https://github.com/KULLANICI_ADIN/predator-terminal.git

# Push
git push -u origin main
```

## 3. GitHub Actions Otomatik APK Build

Push ettikten sonra GitHub Actions otomatik olarak:

1. **JDK 17** kurar
2. **Android SDK** kurar
3. **npm install** + **esbuild bundle** çalıştırır
4. `index.html` + `predator.js` → `android/app/src/main/assets/` kopyalar
5. **Gradle assembleDebug** → Debug APK oluşturur
6. **Gradle assembleRelease** → Release APK oluşturur
7. APK'ları **Artifacts** olarak yükler (30 gün saklanır)

### APK İndirme

```
GitHub → Repo → Actions → En son workflow → Artifacts bölümü
├── predator-terminal-debug    (imzalanmamış, test için)
└── predator-terminal-release  (imzalanmamış, sign gerekli)
```

## 4. Release APK İmzalama (Opsiyonel)

Tag push ile otomatik imzalama için GitHub Secrets ekle:

```
Repo → Settings → Secrets and variables → Actions → New secret

SIGNING_KEY       → Keystore dosyasının base64 encoded hali
KEY_ALIAS         → Keystore alias
KEY_STORE_PASSWORD → Keystore şifresi
KEY_PASSWORD      → Key şifresi
```

Sonra:
```bash
git tag v1.0.0
git push origin v1.0.0
```

Bu, otomatik olarak:
- APK'yı imzalar
- GitHub Release oluşturur
- İmzalı APK'yı release'e ekler

## 5. Keystore Oluşturma

```bash
keytool -genkey -v -keystore predator.keystore -alias predator -keyalg RSA -keysize 2048 -validity 10000
```

Base64 encode:
```bash
base64 -w 0 predator.keystore
# Çıkan string'i SIGNING_KEY secret'ına yapıştır
```

## 6. Manuel APK Build (Lokal)

```bash
cd predator-terminal

# Web bundle
npm install
npx esbuild src/main.ts --bundle --outfile=predator.js --minify --format=iife --target=es2020
cp index.html predator.js android/app/src/main/assets/

# Android build
cd android
chmod +x gradlew
./gradlew assembleDebug

# APK burada:
# android/app/build/outputs/apk/debug/app-debug.apk
```

## 7. Workflow Durumu İzleme

```bash
# GitHub CLI ile (gh yüklüyse)
gh run list --repo KULLANICI_ADIN/predator-terminal
gh run watch

# Veya tarayıcıda:
# https://github.com/KULLANICI_ADIN/predator-terminal/actions
```

## Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| Gradle wrapper JAR eksik | CI otomatik indirir, lokal için `gradle wrapper` çalıştır |
| SDK license hatası | CI'da `yes \| sdkmanager --licenses` zaten var |
| Build timeout | Gradle cache aktif, ikinci build hızlı olur |
| APK crash | `adb logcat` ile logları kontrol et |
