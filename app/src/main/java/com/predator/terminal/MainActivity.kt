package com.predator.terminal

import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var chartView: PredatorChartView
    private lateinit var tvSignal: TextView
    private lateinit var tvConnection: TextView
    private lateinit var tvTriggerLog: TextView
    private lateinit var btnAutoMode: Button
    private lateinit var btnSettings: Button
    private var uiJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Config.init(this)
        setContentView(R.layout.activity_main)

        chartView = findViewById(R.id.chartView)
        tvSignal = findViewById(R.id.tvSignalInfo)
        tvConnection = findViewById(R.id.tvConnection)
        tvTriggerLog = findViewById(R.id.tvTriggerLog)
        btnAutoMode = findViewById(R.id.btnAutoMode)
        btnSettings = findViewById(R.id.btnSettings)

        btnAutoMode.setOnClickListener { cycleTradeMode() }
        btnSettings.setOnClickListener { showSettingsDialog() }
        updateModeButton()

        // Veri akışını başlat
        MarketDataStream.start()

        // UI'ı düzenli aralıklarla tazele (Canvas çizimi + sinyal paneli, ~4 FPS akıcı güncelleme)
        uiJob = lifecycleScope.launch {
            while (isActive) {
                chartView.invalidate()
                refreshSignalPanel()
                refreshTriggerLog()
                delay(250)
            }
        }

        // Bağlantı durumunu canlı göster
        MarketDataStream.connectionStateListener = { state ->
            runOnUiThread {
                tvConnection.text = when (state) {
                    ConnectionState.CONNECTING -> "● Bağlanıyor…"
                    ConnectionState.CONNECTED -> "● CANLI AKIŞ"
                    ConnectionState.DISCONNECTED -> "○ Bağlantı koptu — yeniden bağlanılıyor…"
                }
                tvConnection.setTextColor(
                    when (state) {
                        ConnectionState.CONNECTED -> Color.parseColor("#00FF00")
                        ConnectionState.CONNECTING -> Color.parseColor("#FFFF00")
                        ConnectionState.DISCONNECTED -> Color.parseColor("#FF0000")
                    }
                )
            }
        }
    }

    private fun refreshSignalPanel() {
        val klines = MarketDataStream.klines1m
        if (klines.isEmpty()) return
        val signal = SignalEngine.analyze(klines)
        tvSignal.setTextColor(
            when (signal.action) {
                "STRONG BUY" -> Color.parseColor("#00FF00")
                "STRONG SELL" -> Color.parseColor("#FF0000")
                "BUY" -> Color.parseColor("#00DD00")
                "SELL" -> Color.parseColor("#DD0000")
                else -> Color.parseColor("#FFFF00")
            }
        )
        tvSignal.text = "${signal.action}  (Güç ${signal.strength}/10)\n${signal.reason}"
    }

    private fun refreshTriggerLog() {
        val last = SignalLog.items.lastOrNull()
        tvTriggerLog.text =
            if (last == null) "Tetikleyici bekliyor… (güçlü sinyal ≥ 7/10 + değişim)"
            else "Tetik: $last"
    }

    // ---------------- OTOMATİK MOD (OFF -> PAPER -> LIVE) ----------------

    private fun cycleTradeMode() {
        when (Config.tradeMode) {
            Config.TradeMode.OFF -> {
                Config.tradeMode = Config.TradeMode.PAPER
                PredatorTrigger.start()
                Toast.makeText(this, "PAPER mod: sinyaller izleniyor, gerçek emir yok.", Toast.LENGTH_SHORT).show()
            }
            Config.TradeMode.PAPER -> {
                if (!Config.isBybitConfigured) {
                    Toast.makeText(this, "CANLI mod için önce ⚙ Ayarlar'dan Bybit API key gir.", Toast.LENGTH_LONG).show()
                    return
                }
                Config.tradeMode = Config.TradeMode.LIVE
                PredatorTrigger.start()
                Toast.makeText(this, "CANLI mod: güçlü sinyal gelince GERÇEK emir gönderilecek!", Toast.LENGTH_LONG).show()
            }
            Config.TradeMode.LIVE -> {
                Config.tradeMode = Config.TradeMode.OFF
                PredatorTrigger.stop()
                Toast.makeText(this, "Tetikleyici kapatıldı.", Toast.LENGTH_SHORT).show()
            }
        }
        updateModeButton()
    }

    private fun updateModeButton() {
        val (text, color) = when (Config.tradeMode) {
            Config.TradeMode.OFF -> "AUTO: KAPALI" to 0xFF777777.toInt()
            Config.TradeMode.PAPER -> "AUTO: PAPER 📄" to 0xFFFFAA00.toInt()
            Config.TradeMode.LIVE -> "AUTO: CANLI 🔴" to 0xFF00FF00.toInt()
        }
        btnAutoMode.text = text
        btnAutoMode.setTextColor(color)
    }

    // ---------------- AYARLAR DİYALOĞU ----------------

    private fun showSettingsDialog() {
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(24), px(12), px(24), 0)
        }

        fun field(label: String, key: String, hint: String, secret: Boolean = false): EditText {
            val et = EditText(this).apply {
                setText(Config.getString(key, ""))
                setSingleLine(true)
                if (secret) {
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                }
            }
            container.addView(
                TextView(this).apply {
                    text = label
                    setTextColor(Color.LTGRAY)
                    setPadding(0, px(12), 0, px(4))
                }
            )
            container.addView(et)
            return et
        }

        val etSymbol = field("Sembol", "symbol", "BTCUSDT")
        val etQty = field("Pozisyon büyüklüğü", "position_size", "0.001 (spot: BTC miktarı)")
        val etCategory = field("Kategori", "category", "spot | linear")
        val etKey = field("Bybit API Key", "bybit_api_key", "••••••••", secret = true)
        val etSecret = field("Bybit API Secret", "bybit_api_secret", "••••••••", secret = true)
        val etTgToken = field("Telegram Bot Token", "telegram_token", "123456:ABC-…", secret = true)
        val etChat = field("Telegram Chat ID", "telegram_chat_id", "-100123456789")

        AlertDialog.Builder(this)
            .setTitle("⚙ Predator Ayarları")
            .setMessage(
                "Bybit API key: bybit.com → API → Create API Key (sadece trade izni ver).\n" +
                "Telegram: @BotFather'dan bot aç, chat ID'ni al.\n" +
                "Tüm anahtarlar cihazda ŞİFRELİ saklanır, repo'ya asla yazılmaz."
            )
            .setView(container)
            .setPositiveButton("KAYDET") { _, _ ->
                Config.putString("symbol", etSymbol.text.toString().trim().uppercase())
                Config.putString("position_size", etQty.text.toString().trim())
                Config.putString("category", etCategory.text.toString().trim().lowercase())
                Config.putString("bybit_api_key", etKey.text.toString().trim())
                Config.putString("bybit_api_secret", etSecret.text.toString().trim())
                Config.putString("telegram_token", etTgToken.text.toString().trim())
                Config.putString("telegram_chat_id", etChat.text.toString().trim())
                Toast.makeText(this, "Ayarlar kaydedildi (şifreli)", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    override fun onDestroy() {
        super.onDestroy()
        uiJob?.cancel()
        PredatorTrigger.stop()
        MarketDataStream.stop()
    }
}
