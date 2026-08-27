package com.predator.terminal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * PREDATOR TERMINAL - Foreground Service
 * ========================================
 * OS seviyesi kalıcı WebSocket bağlantısı.
 * Android Doze Mode / App Standby / Battery Saver bypass.
 *
 * Bu servis olmadan arka planda alarm ÇALMAZ.
 */
class PredatorStreamService : Service() {

    companion object {
        private const val TAG = "PredatorService"
        private const val CHANNEL_ID = "predator_stream"
        private const val NOTIF_ID = 1001
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .build()

    private var depthSocket: WebSocket? = null
    private var tickerSocket: WebSocket? = null
    private var currentSymbol: String = "btcusdt"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Bağlanıyor..."))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        currentSymbol = intent?.getStringExtra("symbol") ?: "btcusdt"

        serviceScope.launch { connectDepthStream() }
        serviceScope.launch { connectTickerStream() }

        // START_STICKY: OS öldürürse yeniden doğar
        return START_STICKY
    }

    // ─────────────────────────────────────────
    // DEPTH STREAM (Binance @depth@100ms)
    // ─────────────────────────────────────────

    private suspend fun connectDepthStream(retryAttempt: Int = 0) {
        val url = "wss://data-stream.binance.vision/ws/${currentSymbol}@depth@100ms"
        val request = Request.Builder().url(url).build()

        depthSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Depth stream connected: $currentSymbol")
                updateNotification("CANLI — $currentSymbol")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                // DepthManager.processEvent() çağrılacak
                // FAZ 7'de DepthManager Kotlin portu eklenecek
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "Depth stream closing: $code $reason")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "Depth stream closed: $code")
                updateNotification("KOPUK — Yeniden bağlanıyor...")
                serviceScope.launch {
                    reconnectWithBackoff(retryAttempt) { connectDepthStream(it) }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Depth stream failure: ${t.message}")
                updateNotification("HATA — Yeniden bağlanıyor...")
                serviceScope.launch {
                    reconnectWithBackoff(retryAttempt) { connectDepthStream(it) }
                }
            }
        })
    }

    // ─────────────────────────────────────────
    // TICKER STREAM (!ticker@arr — global alarmlar)
    // ─────────────────────────────────────────

    private suspend fun connectTickerStream(retryAttempt: Int = 0) {
        val url = "wss://data-stream.binance.vision/ws/!ticker@arr"
        val request = Request.Builder().url(url).build()

        tickerSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Ticker stream connected")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                // UserAlarmManager.checkAll() çağrılacak
                // FAZ 7'de UserAlarmManager Kotlin portu eklenecek
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                serviceScope.launch {
                    reconnectWithBackoff(retryAttempt) { connectTickerStream(it) }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                serviceScope.launch {
                    reconnectWithBackoff(retryAttempt) { connectTickerStream(it) }
                }
            }
        })
    }

    // ─────────────────────────────────────────
    // EXPONENTIAL BACKOFF
    // ─────────────────────────────────────────

    private suspend fun reconnectWithBackoff(attempt: Int, connect: suspend (Int) -> Unit) {
        val maxRetries = 10
        if (attempt >= maxRetries) {
            Log.e(TAG, "Max retries exhausted")
            updateNotification("BAĞLANTI YOK")
            return
        }
        val delayMs = (1000L * (1 shl attempt)).coerceAtMost(30_000L)
        Log.i(TAG, "Reconnecting in ${delayMs}ms (attempt ${attempt + 1})")
        delay(delayMs)
        connect(attempt + 1)
    }

    // ─────────────────────────────────────────
    // NOTIFICATION
    // ─────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Predator Stream",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "WebSocket bağlantısı arka planda aktif"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("Predator Terminal")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIF_ID, buildNotification(text))
    }

    // ─────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────

    override fun onDestroy() {
        depthSocket?.close(1000, "Service destroyed")
        tickerSocket?.close(1000, "Service destroyed")
        serviceScope.cancel()
        super.onDestroy()
    }
}
