package com.predator.terminal

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

// ============================================================
// OTOMATİK TETİKLEYİCİ (SİNYAL GELİNCE EMİR GÖNDER)
// Mod: OFF (kapalı) / PAPER (sadece log+telegram) / LIVE (gerçek emir)
// ============================================================
object PredatorTrigger {

    private var job: Job? = null

    @Volatile private var lastSignal = ""
    @Volatile private var lastActionTs = 0L

    // Aynı sinyalin 60 saniyede bir defadan fazla emir basmasını engelle
    private const val COOLDOWN_MS = 60_000L

    fun start() {
        if (job?.isActive == true) return
        job = CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            while (isActive) {
                delay(1000) // Her saniye kontrol et

                val klines = MarketDataStream.klines1m
                if (klines.isEmpty()) continue

                val signal = SignalEngine.analyze(klines)
                val currentPrice = klines.last().close

                val action = when {
                    signal.action.contains("BUY") -> "Buy"
                    signal.action.contains("SELL") -> "Sell"
                    else -> null
                }

                // Sinyal değiştiyse, güçlüyse (7+) ve soğuma süresi dolduysa
                val strong = signal.strength >= 7
                val changed = signal.action != lastSignal
                val cooldownOk = System.currentTimeMillis() - lastActionTs >= COOLDOWN_MS

                if (action != null && strong && changed && cooldownOk) {
                    lastSignal = signal.action
                    lastActionTs = System.currentTimeMillis()

                    // Emir defteri kontrolü (spoofing)
                    val ob = MarketDataStream.orderBook
                    if (SpoofingDetector.isSpoofed(ob.bids, ob.asks)) {
                        TelegramNotifier.send(
                            "TUZAK TESPİTİ — ${signal.action} (${Config.symbol}) @ $currentPrice — sahte duvar algılandı, emir iptal."
                        )
                        SignalLog.add("TUZAK: ${signal.action} @ $currentPrice")
                        continue
                    }

                    when (Config.tradeMode) {
                        Config.TradeMode.OFF -> { /* tetikleyici kapalı */ }

                        Config.TradeMode.PAPER -> {
                            TelegramNotifier.send(
                                "📄 [PAPER] ${signal.action} tetiklendi @ $currentPrice — gerçek emir GÖNDERİLMEDİ."
                            )
                            SignalLog.add("PAPER $action @ $currentPrice")
                        }

                        Config.TradeMode.LIVE -> {
                            TelegramNotifier.send("🎯 ${signal.action} (${Config.symbol}) @ $currentPrice — emir gönderiliyor…")
                            when (val res = BybitExecutor.executeMarketOrder(action)) {
                                is BybitExecutor.Result.Success -> {
                                    TelegramNotifier.send(
                                        "✅ İNFAZ BAŞARILI — ${Config.symbol} $action, fiyat ${res.price}, emir #${res.orderId}",
                                        important = true
                                    )
                                    SignalLog.add("CANLI ✅ $action @ ${res.price}")
                                }
                                is BybitExecutor.Result.Failure -> {
                                    TelegramNotifier.send("❌ İNFAZ BAŞARISIZ — ${res.reason}", important = true)
                                    SignalLog.add("CANLI ❌ $action: ${res.reason}")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        lastSignal = ""
    }
}
