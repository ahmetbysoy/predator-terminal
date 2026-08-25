package com.predator.terminal

import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

// ============================================================
// TELEGRAM BİLDİRİM SES TELLERİ (Bot API)
// ============================================================
object TelegramNotifier {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    /** Fire-and-forget: hata olursa sessizce geç (asıl akışı asla bozma). IO thread'den çağır. */
    fun send(message: String, important: Boolean = false) {
        if (!Config.isTelegramConfigured) return
        val token = Config.telegramToken
        val chatId = Config.telegramChatId
        val text = (if (important) "\uD83D\uDD34 " else "") + message
        val url = "${Config.TELEGRAM_API_BASE}/bot$token/sendMessage?chat_id=$chatId&text=" +
            URLEncoder.encode(text, "UTF-8")
        try {
            client.newCall(Request.Builder().url(url).get().build()).execute().close()
        } catch (_: Throwable) {
            // yoksay
        }
    }
}
