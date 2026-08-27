package com.predator.terminal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * PREDATOR TERMINAL - Foreground Service
 * ==========================================
 * WebSocket bağlantısı + alarm kontrolü + native notification.
 *
 * - OkHttp WSS: pingInterval 20s, readTimeout 0 (sonsuz)
 * - Exponential backoff: 1s → 30s max
 * - START_STICKY: process kill → auto-restart
 * - Notification channel: "Predator Alerts"
 * - Alarm tetiklendiğinde native Android notification gösterir
 * - WebView açıksa JS'e de callback gönderir
 */
class PredatorStreamService : Service() {

    companion object {
        private const val TAG = "PredatorService"
        private const val CHANNEL_ID = "predator_alerts"
        private const val NOTIFICATION_ID = 1
        private const val ALARM_NOTIFICATION_BASE_ID = 1000

        private const val WS_BASE_URL = "wss://stream.binance.com:9443"
        private const val INITIAL_RECONNECT_DELAY = 1000L
        private const val MAX_RECONNECT_DELAY = 30000L

        // ── WebView reference for JS callbacks (WeakReference to prevent memory leak) ──
        private var webViewRef: WeakReference<android.webkit.WebView>? = null

        fun setWebView(webView: android.webkit.WebView?) {
            webViewRef = webView?.let { WeakReference(it) }
        }

        // ── Alarm update signal ──
        private val alarmsUpdated = AtomicBoolean(false)

        fun notifyAlarmsUpdated() {
            alarmsUpdated.set(true)
        }

        // ── Singleton instance ──
        @Volatile
        private var instance: PredatorStreamService? = null

        fun isRunning(): Boolean = instance != null
    }

    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var reconnectDelay = INITIAL_RECONNECT_DELAY
    private var reconnectAttempt = 0
    private val handler = Handler(Looper.getMainLooper())
    private var isConnected = false
    private var isDestroyed = false

    // ── Alarm tracking ──
    private var alarmIdCounter = ALARM_NOTIFICATION_BASE_ID

    private val reconnectRunnable = Runnable {
        if (!isDestroyed) connect()
    }

    // ─────────────────────────────────────────────
    // SERVICE LIFECYCLE
    // ─────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildPersistentNotification("Bağlanıyor..."))

        client = OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()

        connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isDestroyed = true
        instance = null
        handler.removeCallbacks(reconnectRunnable)
        webSocket?.close(1000, "Service destroyed")
        client?.dispatcher?.executorService?.shutdown()
        super.onDestroy()
    }

    // ─────────────────────────────────────────────
    // WEBSOCKET CONNECTION
    // ─────────────────────────────────────────────

    private fun connect() {
        if (isDestroyed) return

        val streams = "!ticker@arr"
        val url = "$WS_BASE_URL/stream?streams=$streams"

        val request = Request.Builder().url(url).build()

        Log.i(TAG, "Connecting to Binance WSS...")

        webSocket = client?.newWebSocket(request, object : WebSocketListener() {

            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Connected")
                isConnected = true
                reconnectDelay = INITIAL_RECONNECT_DELAY
                reconnectAttempt = 0
                updateNotification("Bağlı — alarm taraması aktif")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    val stream = msg.optString("stream", "")
                    val data = msg.opt("data")

                    if (stream.contains("!ticker@arr") && data is JSONArray) {
                        handleTickerArray(data)
                    }
                } catch (e: Exception) {
                    // Non-JSON or malformed message, ignore
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Disconnected: $reason")
                isConnected = false
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure: ${t.message}")
                isConnected = false
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (isDestroyed) return
        reconnectAttempt++
        val delay = minOf(reconnectDelay * (1L shl (reconnectAttempt - 1)), MAX_RECONNECT_DELAY)
        Log.i(TAG, "Reconnect in ${delay}ms (attempt $reconnectAttempt)")
        updateNotification("Yeniden bağlanıyor... (${reconnectAttempt}. deneme)")
        handler.postDelayed(reconnectRunnable, delay)
    }

    // ─────────────────────────────────────────────
    // ALARM CHECKING
    // ─────────────────────────────────────────────

    private fun handleTickerArray(tickers: JSONArray) {
        // ── Reload alarms if updated from JS ──
        if (alarmsUpdated.compareAndSet(true, false)) {
            // Alarms will be re-read from SharedPreferences below
        }

        val alarmsJson = getSharedPreferences(AlarmBridge.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(AlarmBridge.KEY_ALARMS, "[]") ?: "[]"

        val alarms: JSONArray
        try {
            alarms = JSONArray(alarmsJson)
        } catch (e: Exception) {
            return
        }

        if (alarms.length() == 0) return

        // ── Build price map from ticker data ──
        val priceMap = HashMap<String, Double>(tickers.length())
        for (i in 0 until tickers.length()) {
            val t = tickers.getJSONObject(i)
            val symbol = t.optString("s", "").uppercase()
            val priceStr = t.optString("c", "")
            if (symbol.isNotEmpty() && priceStr.isNotEmpty()) {
                try {
                    priceMap[symbol] = priceStr.toDouble()
                } catch (_: NumberFormatException) { }
            }
        }

        // ── Check each alarm ──
        val triggeredIds = mutableListOf<String>()
        val triggeredAlarms = mutableListOf<JSONObject>()

        for (i in 0 until alarms.length()) {
            val alarm = alarms.getJSONObject(i)

            if (!alarm.optBoolean("active", true)) continue
            if (alarm.optBoolean("triggered", false)) continue

            val symbol = alarm.getString("symbol").uppercase()
            val targetPrice = alarm.getDouble("price")
            val type = alarm.getString("type")

            val currentPrice = priceMap[symbol] ?: continue

            val shouldTrigger = when (type) {
                "above" -> currentPrice >= targetPrice
                "below" -> currentPrice <= targetPrice
                else -> false
            }

            if (shouldTrigger) {
                alarm.put("triggered", true)
                alarm.put("triggeredAt", System.currentTimeMillis())
                triggeredIds.add(alarm.getString("id"))
                triggeredAlarms.add(JSONObject(alarm.toString()))

                // ── Native notification ──
                showAlarmNotification(symbol, type, targetPrice, currentPrice)

                // ── JS callback ──
                notifyJsAlarm(alarm, currentPrice)
            }
        }

        // ── Persist triggered state ──
        if (triggeredIds.isNotEmpty()) {
            getSharedPreferences(AlarmBridge.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(AlarmBridge.KEY_ALARMS, alarms.toString())
                .apply()
        }
    }

    private fun showAlarmNotification(
        symbol: String,
        type: String,
        targetPrice: Double,
        currentPrice: Double
    ) {
        val direction = if (type == "above") "▲" else "▼"
        val title = "$symbol $direction $targetPrice"
        val body = "Alarm tetiklendi! Şu anki fiyat: $currentPrice"

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 200, 100, 200))
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(alarmIdCounter++, notification)
    }

    private fun notifyJsAlarm(alarm: JSONObject, currentPrice: Double) {
        val js = "window.PredatorNative && window.PredatorNative.onAlarmTriggered(" +
            "'${alarm.getString("symbol")}', ${currentPrice}, '${alarm.getString("id")}');"

        handler.post {
            try {
                webViewRef?.get()?.evaluateJavascript(js, null)
            } catch (e: Exception) {
                Log.e(TAG, "JS callback failed", e)
            }
        }
    }

    // ─────────────────────────────────────────────
    // NOTIFICATION
    // ─────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Predator Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alarm bildirimleri ve bağlantı durumu"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 200, 100, 200)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildPersistentNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Predator Terminal")
            .setContentText(text)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildPersistentNotification(text))
    }
}
