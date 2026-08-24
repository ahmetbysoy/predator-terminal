package com.predator.terminal

// ============================================================
// 2. MATEMATİKSEL SİNYAL MOTORU (1m Analiz)
// ============================================================
object SignalEngine {

    data class SignalResult(val action: String, val reason: String, val strength: Int) // strength 1-10

    fun analyze(klines: List<KlineData>): SignalResult {
        if (klines.size < 20) return SignalResult("BEKLE", "Veri yetersiz (${klines.size}/20 mum)", 0)

        val current = klines.last()

        // EMA 9 ve EMA 21 (tam seri üzerinden, kararlı değerler)
        val ema9 = calculateEMA(klines.map { it.close }, 9)
        val ema21 = calculateEMA(klines.map { it.close }, 21)

        // Hacim Analizi (Son 20 mumun ortalamasına göre anlık hacim patlaması)
        val avgVol = klines.takeLast(20).map { it.volume }.average()
        val volSpike = current.volume > (avgVol * 1.5)

        var action = "BEKLE"
        var reason = "Piyasa yatay, EMA'lar iç içe."
        var strength = 2

        val closeAbove = current.close > ema9 && ema9 > ema21
        val closeBelow = current.close < ema9 && ema9 < ema21

        when {
            closeAbove && volSpike -> {
                action = "STRONG BUY"
                reason = "Fiyat EMA9/21 üzerinde, Hacim patlaması var (${String.format("%.1f", current.volume / avgVol)}x)"
                strength = 9
            }
            closeBelow && volSpike -> {
                action = "STRONG SELL"
                reason = "Fiyat EMA9/21 altında, Panik satışı hacmi tetikledi."
                strength = 9
            }
            closeAbove -> {
                action = "BUY"
                reason = "Yükseliş trendi korunuyor, hacim ortalama."
                strength = 6
            }
            closeBelow -> {
                action = "SELL"
                reason = "Düşüş trendi hakim, hacim ortalama."
                strength = 6
            }
        }

        return SignalResult(action, reason, strength)
    }

    private fun calculateEMA(prices: List<Double>, period: Int): Double {
        val multiplier = 2.0 / (period + 1)
        var ema = prices.first()
        for (i in 1 until prices.size) {
            ema = (prices[i] - ema) * multiplier + ema
        }
        return ema
    }
}
