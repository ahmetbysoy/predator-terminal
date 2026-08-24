package com.predator.terminal

import android.graphics.Color
import android.os.Bundle
import android.widget.TextView
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
    private var uiJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        chartView = findViewById(R.id.chartView)
        tvSignal = findViewById(R.id.tvSignalInfo)
        tvConnection = findViewById(R.id.tvConnection)

        // Veri akışını başlat
        MarketDataStream.start()

        // UI'ı düzenli aralıklarla tazele (Canvas çizimi + sinyal paneli, ~4 FPS akıcı güncelleme)
        uiJob = lifecycleScope.launch {
            while (isActive) {
                chartView.invalidate()
                refreshSignalPanel()
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

    override fun onDestroy() {
        super.onDestroy()
        uiJob?.cancel()
        MarketDataStream.stop()
    }
}
