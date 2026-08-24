package com.predator.terminal

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlin.math.min

enum class ConnectionState { CONNECTING, CONNECTED, DISCONNECTED }

// ============================================================
// 1. GERÇEK ZAMANLI VERİ MOTORU (WSS: KLINE + DEPTH)
// ============================================================
object MarketDataStream {

    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var ws: WebSocket? = null
    private var reconnectJob: Job? = null
    private var scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var reconnectAttempt = 0
    private var userInitiatedClose = false

    // Canlı veri havuzları (Thread-safe)
    val klines1m = CopyOnWriteArrayList<KlineData>()
    val orderBook = OrderBookData()

    // Bağlantı durumu değişiklikleri (UI'da göstermek için)
    var connectionStateListener: ((ConnectionState) -> Unit)? = null

    fun start() {
        userInitiatedClose = false
        connect()
    }

    fun stop() {
        userInitiatedClose = true
        reconnectJob?.cancel()
        ws?.close(1000, "App closing")
        ws = null
        scope.cancel()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }

    private fun setState(state: ConnectionState) {
        connectionStateListener?.invoke(state)
    }

    private fun connect() {
        setState(ConnectionState.CONNECTING)
        // Binance: 1m Mumlar + 20 seviye derinlik (100ms güncelleme)
        val request = Request.Builder()
            .url("wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/btcusdt@depth20@100ms")
            .build()

        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectAttempt = 0
                setState(ConnectionState.CONNECTED)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                // Bağlantı koptu → üstel geri çekilme (backoff) ile yeniden bağlan
                setState(ConnectionState.DISCONNECTED)
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!userInitiatedClose) {
                    setState(ConnectionState.DISCONNECTED)
                    scheduleReconnect()
                }
            }
        })
    }

    private fun scheduleReconnect() {
        if (reconnectJob?.isActive == true) return
        reconnectJob = scope.launch {
            val backoff = min(30_000L, (reconnectAttempt * 2_000L) + 2_000L)
            reconnectAttempt++
            delay(backoff)
            if (isActive && !userInitiatedClose) connect()
        }
    }

    private fun handleMessage(text: String) {
        try {
            val json = JSONObject(text)
            val stream = json.getString("stream")
            val data = json.getJSONObject("data")

            if (stream.contains("kline")) {
                val k = data.getJSONObject("k")
                val kline = KlineData(
                    time = k.getLong("t"),
                    open = k.getString("o").toDouble(),
                    high = k.getString("h").toDouble(),
                    low = k.getString("l").toDouble(),
                    close = k.getString("c").toDouble(),
                    volume = k.getString("v").toDouble(),
                    isClosed = k.getBoolean("x")
                )
                updateKline(kline)
            } else if (stream.contains("depth")) {
                orderBook.bids = parseLevels(data.getJSONArray("bids"))
                orderBook.asks = parseLevels(data.getJSONArray("asks"))
            }
        } catch (t: Throwable) {
            // Bozuk / eksik bir mesaj geldi — yoksay ve akışa devam et
        }
    }

    private fun updateKline(newKline: KlineData) {
        val last = klines1m.lastOrNull()
        if (last != null && last.time == newKline.time) {
            klines1m[klines1m.size - 1] = newKline // Güncelle
        } else {
            if (klines1m.size > 100) klines1m.removeAt(0) // Hafıza yönetimi (Son 100 mum)
            klines1m.add(newKline)
        }
    }

    private fun parseLevels(array: JSONArray): List<Level> {
        val levels = mutableListOf<Level>()
        for (i in 0 until min(array.length(), 10)) { // Sadece en yakın 10 duvarı al (performans için)
            val arr = array.getJSONArray(i)
            levels.add(Level(arr.getString(0).toDouble(), arr.getString(1).toDouble()))
        }
        return levels
    }
}

data class KlineData(
    val time: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
    val isClosed: Boolean
)

data class Level(val price: Double, val qty: Double)

class OrderBookData {
    @Volatile var bids: List<Level> = emptyList()
    @Volatile var asks: List<Level> = emptyList()
}
