package com.predator.terminal

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

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
            }
            webViewClient = PredatorWebViewClient()
            webChromeClient = WebChromeClient()

            // ── DÜZELTME #4: JS ↔ Native alarm bridge ──
            addJavascriptInterface(AlarmBridge(this@MainActivity), "AndroidBridge")
        }

        setContentView(webView)

        // ── Load bundled web app from assets ──
        webView.loadUrl("file:///android_asset/index.html")

        // ── Pass WebView reference to service for JS callbacks ──
        PredatorStreamService.setWebView(webView)

        // ── Start foreground service for background WebSocket ──
        startPredatorService()
    }

    private fun startPredatorService() {
        val intent = Intent(this, PredatorStreamService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        PredatorStreamService.setWebView(null)
        webView.destroy()
        super.onDestroy()
    }
}

/**
 * PredatorWebViewClient: Sayfa yükleme hatalarını yakalar,
 * local asset'lerin doğru yüklendiğini doğrular.
 */
class PredatorWebViewClient : WebViewClient() {

    override fun onReceivedError(
        view: android.webkit.WebView,
        request: android.webkit.WebResourceRequest,
        error: android.webkit.WebResourceError
    ) {
        android.util.Log.e(
            "PredatorWebView",
            "Load error: ${request.url} → ${error.description}"
        )
    }

    override fun shouldInterceptRequest(
        view: android.webkit.WebView,
        request: android.webkit.WebResourceRequest
    ): android.webkit.WebResourceResponse? {
        // ── Block all external requests — force local assets only ──
        val url = request.url.toString()
        if (url.startsWith("file:///android_asset/")) return null

        // Allow data: and blob: URIs
        if (url.startsWith("data:") || url.startsWith("blob:")) return null

        // WebSocket connections (Binance WSS) are handled by OkHttp, not WebView
        // Block any other external request
        android.util.Log.w("PredatorWebView", "Blocked external request: $url")
        return android.webkit.WebResourceResponse(
            "text/plain", "UTF-8",
            java.io.ByteArrayInputStream("Blocked".toByteArray())
        )
    }
}
