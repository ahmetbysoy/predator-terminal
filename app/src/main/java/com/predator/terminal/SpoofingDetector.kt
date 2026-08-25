package com.predator.terminal

import kotlin.math.abs
import kotlin.math.max

// ============================================================
// TUZAK (SPOOFING) TESPİTİ
// Sezgisel kural: bir duvar, aynı tarafın ortanca hacminin çok üstünde
// VE fiyatı orta fiyattan (spread'in ötesinde) uzaktaysa -> sahte duvar adayı.
// Gerçek dünyada spoof duvarlar çoğunlukla "görünür destek/direnç" yanılsaması
// yaratmak için spread'in uzağına konur ve dokunulmadan çekilir.
// ============================================================
object SpoofingDetector {

    /** true dönerse: emir GÖNDERME — muhtemel tuzak. */
    fun isSpoofed(bids: List<Level>, asks: List<Level>): Boolean {
        if (bids.isEmpty() || asks.isEmpty()) return false

        val bestBid = bids.maxOfOrNull { it.price } ?: return false
        val bestAsk = asks.minOfOrNull { it.price } ?: return false
        if (bestAsk <= bestBid) return false

        val mid = (bestBid + bestAsk) / 2.0
        val halfSpreadPct = ((bestAsk - bestBid) / mid) * 100.0
        // Duvar sayılması için spread'in en az 2 katı kadar uzağa konmuş olmalı (min %0.05)
        val minDistPct = max(0.05, halfSpreadPct * 2.0)

        fun hasSuspiciousWall(side: List<Level>): Boolean {
            if (side.size < 3) return false
            val sorted = side.map { it.qty }.sorted()
            val median = sorted[sorted.size / 2]
            if (median <= 0.0) return false
            val totalOpposite = if (side === bids) asks.sumOf { it.qty } else bids.sumOf { it.qty }
            return side.any { lv ->
                val distPct = abs(lv.price - mid) / mid * 100.0
                val qtyRatio = lv.qty / median
                // 4x'ten büyük duvar + uzakta, VEYA karşı taraf toplamının %50'sinden büyük tek seviye
                (qtyRatio > 4.0 && distPct > minDistPct) || (lv.qty > totalOpposite * 0.5 && distPct > minDistPct)
            }
        }

        return hasSuspiciousWall(bids) || hasSuspiciousWall(asks)
    }
}
