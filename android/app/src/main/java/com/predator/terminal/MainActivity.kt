package com.predator.terminal

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

    companion object {
        private const val TAG = "PredatorMain"
    }

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ── Immersive full-screen ──
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
        }

        // ── WebView setup ──
        webView = WebView(this).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                cacheMode = WebSettings.LOAD_DEFAULT
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                databaseEnabled = true
                useWideViewPort = true
                loadWithOverviewMode = true

                // ── KRİTİK: file:// scheme'den https:// API'lere erişim ──
                // Binance REST (https://data-api.binance.vision) ve
                // CORS proxy'lerine fetch() yapabilmek için şart.
                // WebSocket (wss://) de bu sayede çalışır.
                @Suppress("DEPRECATION")
                allowFileAccessFromFileURLs = true
                @Suppress("DEPRECATION")
                allowUniversalAccessFromFileURLs = true

                // ── Mixed content izin ver (file:// → https://) ──
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }
            webViewClient = PredatorWebViewClient()
            webChromeClient = WebChromeClient()

            // ── JS ↔ Native alarm bridge ──
            addJavascriptInterface(AlarmBridge(this@MainActivity), "AndroidBridge")
        }

        setContentView(webView)

        // ── Load bundled web app from assets ──
        webView.loadUrl("file:///android_asset/index.html")

        // ── Pass WebView reference to service for JS callbacks ──
        PredatorStreamService.setWebView(webView)

        // ── Start foreground service (crash-safe) ──
        startPredatorService()
    }

    private fun startPredatorService() {
        try {
            val intent = Intent(this, PredatorStreamService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Exception) {
            // Service başlatılamazsa uygulama çökmesin
            Log.e(TAG, "Foreground service başlatılamadı", e)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        try {
            PredatorStreamService.setWebView(null)
            webView.destroy()
        } catch (e: Exception) {
            Log.e(TAG, "onDestroy error", e)
        }
        super.onDestroy()
    }
}

/**
 * PredatorWebViewClient: Sayfa yükleme hatalarını yakalar ve loglar.
 * Tüm HTTPS/WSS trafiğe izin verilir.
 */
class PredatorWebViewClient : WebViewClient() {

    override fun onReceivedError(
        view: WebView,
        request: android.webkit.WebResourceRequest,
        error: android.webkit.WebResourceError
    ) {
        Log.e("PredatorWebView", "Load error: ${request.url} → ${error.description}")
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: android.webkit.WebResourceRequest,
        errorResponse: android.webkit.WebResourceResponse
    ) {
        Log.w("PredatorWebView", "HTTP ${errorResponse.statusCode}: ${request.url}")
    }
}
