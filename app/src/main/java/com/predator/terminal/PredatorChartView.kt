package com.predator.terminal

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import kotlin.math.max
import kotlin.math.min

// ============================================================
// 3. PREDATOR CHART VIEW (Custom Canvas, Sıfır Kütüphane)
// ============================================================
class PredatorChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val candleFill = Paint().apply { style = Paint.Style.FILL }
    private val candleWick = Paint().apply { style = Paint.Style.STROKE; strokeWidth = 2f }
    private val wallPaint = Paint().apply { style = Paint.Style.FILL }
    private val textPaint = Paint().apply { color = Color.WHITE; isFakeBoldText = true }
    private val gridPaint = Paint().apply { style = Paint.Style.STROKE; strokeWidth = 1f }
    private val lastLinePaint = Paint().apply { style = Paint.Style.STROKE; strokeWidth = 2f }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.BLACK)

        val klines = MarketDataStream.klines1m
        if (klines.isEmpty()) {
            drawEmptyState(canvas)
            return
        }

        val w = width.toFloat()
        val h = height.toFloat()
        val topPad = 110f
        val bottomPad = 42f
        val chartHeight = h - topPad - bottomPad
        if (chartHeight <= 0f) return

        // 1. Ölçekleme Hesaplamaları
        var minPrice = klines.minOf { it.low }
        var maxPrice = klines.maxOf { it.high }

        // Depth duvarları da grafik dışına taşmasın diye aralığa dahil et
        val ob = MarketDataStream.orderBook
        val allLevelPrices = ob.bids.map { it.price } + ob.asks.map { it.price }
        if (allLevelPrices.isNotEmpty()) {
            minPrice = min(minPrice, allLevelPrices.min())
            maxPrice = max(maxPrice, allLevelPrices.max())
        }
        val padRange = (maxPrice - minPrice) * 0.06
        minPrice -= padRange
        maxPrice += padRange
        val priceRange = maxPrice - minPrice
        if (priceRange <= 0.0) return

        fun yOf(price: Double): Float =
            topPad + (chartHeight * (1f - ((price - minPrice) / priceRange).toFloat()))

        // 2. Grid + fiyat etiketleri
        drawGrid(canvas, w, topPad, chartHeight, minPrice, maxPrice, ::yOf)

        // 3. Mumları Çiz
        val slot = w / klines.size
        val candleWidth = (slot * 0.7f).coerceAtLeast(1.5f)

        for (i in klines.indices) {
            val k = klines[i]
            val x = i * slot + (slot - candleWidth) / 2f
            val isGreen = k.close >= k.open
            val color = if (isGreen) 0xFF00FF00.toInt() else 0xFFFF0000.toInt()

            // Fitil (Wick)
            candleWick.color = color
            val highY = yOf(k.high)
            val lowY = yOf(k.low)
            canvas.drawLine(x + candleWidth / 2f, highY, x + candleWidth / 2f, lowY, candleWick)

            // Gövde (Body)
            val openY = yOf(k.open)
            val closeY = yOf(k.close)
            val top = minOf(openY, closeY)
            val bottom = maxOf(openY, closeY)
            val bodyHeight = maxOf(1.5f, bottom - top) // En az 1px görünsün
            candleFill.color = color
            canvas.drawRect(x, top, x + candleWidth, top + bodyHeight, candleFill)
        }

        // 4. Emir Defteri Duvarlarını (Liquidity Walls) Görselleştir
        drawLiquidityWalls(canvas, w, topPad, chartHeight, ::yOf)

        // 5. Canlı Sinyal Overlay (Dopamin Vuruşu)
        val signal = SignalEngine.analyze(klines)
        drawSignalHeader(canvas, signal, klines.last().close)

        // 6. Son fiyat çizgisi
        val lastPrice = klines.last().close
        val lastY = yOf(lastPrice)
        lastLinePaint.color = 0xFF444444.toInt()
        canvas.drawLine(0f, lastY, w, lastY, lastLinePaint)
        textPaint.color = Color.WHITE
        textPaint.textSize = 24f
        canvas.drawText(String.format("%.2f", lastPrice), 8f, lastY - 8f, textPaint)
    }

    // ---------- Yardımcı çizimler ----------

    private fun drawGrid(
        canvas: Canvas,
        w: Float,
        topPad: Float,
        chartHeight: Float,
        minPrice: Double,
        maxPrice: Double,
        yOf: (Double) -> Float
    ) {
        gridPaint.color = 0xFF1A1A1A.toInt()
        val hLines = 5
        for (i in 0..hLines) {
            val frac = i.toFloat() / hLines
            val price = maxPrice - (maxPrice - minPrice) * frac
            val y = yOf(price)
            canvas.drawLine(0f, y, w, y, gridPaint)
            textPaint.color = 0xFF666666.toInt()
            textPaint.textSize = 22f
            canvas.drawText(String.format("%.1f", price), 6f, y - 6f, textPaint)
        }
        gridPaint.color = 0xFF101010.toInt()
        for (i in 1..9) {
            val x = w * i / 10f
            canvas.drawLine(x, topPad, x, topPad + chartHeight, gridPaint)
        }
    }

    private fun drawLiquidityWalls(
        canvas: Canvas,
        w: Float,
        topPad: Float,
        chartHeight: Float,
        yOf: (Double) -> Float
    ) {
        val ob = MarketDataStream.orderBook
        val maxQty = max(
            ob.bids.maxOfOrNull { it.qty } ?: 0.0,
            ob.asks.maxOfOrNull { it.qty } ?: 0.0
        )
        if (maxQty <= 0.0) return

        val barMaxLen = w * 0.42f
        val rowH = (chartHeight / 90f).coerceAtLeast(6f)

        // Bid Duvarları (Yeşil - Destek, sol taraftan içeri)
        wallPaint.color = 0x3300FF00 // yarı saydam yeşil
        for (bid in ob.bids) {
            val y = yOf(bid.price) - rowH / 2f
            val barLen = (bid.qty / maxQty * barMaxLen).coerceAtLeast(2.0).toFloat()
            canvas.drawRect(0f, y, barLen, y + rowH, wallPaint)
        }

        // Ask Duvarları (Kırmızı - Direnç, sağ taraftan içeri)
        wallPaint.color = 0x33FF0000 // yarı saydam kırmızı
        for (ask in ob.asks) {
            val y = yOf(ask.price) - rowH / 2f
            val barLen = (ask.qty / maxQty * barMaxLen).coerceAtLeast(2.0).toFloat()
            canvas.drawRect(w - barLen, y, w, y + rowH, wallPaint)
        }
    }

    private fun drawSignalHeader(canvas: Canvas, signal: SignalEngine.SignalResult, lastClose: Double) {
        val w = width.toFloat()
        val signalColor = when (signal.action) {
            "STRONG BUY" -> 0xFF00FF00.toInt()
            "STRONG SELL" -> 0xFFFF0000.toInt()
            "BUY" -> 0xFF00DD00.toInt()
            "SELL" -> 0xFFDD0000.toInt()
            else -> 0xFFFFFF00.toInt()
        }

        // Sinyal metni (sol üst)
        textPaint.color = signalColor
        textPaint.textSize = 30f
        canvas.drawText("${signal.action}  (Güç: ${signal.strength}/10)", 16f, 42f, textPaint)

        // Neden (sol üst, alt satır)
        textPaint.color = 0xFFBBBBBB.toInt()
        textPaint.textSize = 20f
        canvas.drawText(signal.reason, 16f, 68f, textPaint)

        // Son fiyat (sağ üst)
        textPaint.color = Color.WHITE
        textPaint.textSize = 32f
        val priceLabel = "BTC: ${String.format("%.2f", lastClose)}"
        val priceWidth = textPaint.measureText(priceLabel)
        canvas.drawText(priceLabel, w - priceWidth - 16f, 42f, textPaint)
    }

    private fun drawEmptyState(canvas: Canvas) {
        textPaint.color = 0xFF666666.toInt()
        textPaint.textSize = 26f
        val msg = "Veri yükleniyor — Binance WSS bağlantısı bekleniyor…"
        val tw = textPaint.measureText(msg)
        canvas.drawText(msg, (width - tw) / 2f, height / 2f, textPaint)
    }
}
