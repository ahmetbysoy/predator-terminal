package com.predator.terminal

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// ============================================================
// MERKEZİ YAPILANDIRMA (ŞİFRELİ SAKLAMA — anahtarlar repo'ya ASLA girmez)
// ============================================================
object Config {

    enum class TradeMode { OFF, PAPER, LIVE }

    const val DEFAULT_SYMBOL = "BTCUSDT"
    const val DEFAULT_POSITION_SIZE = "0.001"
    const val DEFAULT_CATEGORY = "spot"   // "spot" veya "linear" (USDT perpetual)
    const val BYBIT_API_BASE = "https://api.bybit.com"
    const val TELEGRAM_API_BASE = "https://api.telegram.org"

    @Volatile var tradeMode: TradeMode = TradeMode.OFF

    private var prefs: SharedPreferences? = null

    /** MainActivity.onCreate içinde bir kez çağır. */
    fun init(context: Context) {
        if (prefs != null) return
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context,
            "predator_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun getString(key: String, def: String): String = prefs?.getString(key, def) ?: def
    fun putString(key: String, value: String) {
        prefs?.edit()?.putString(key, value)?.apply()
    }

    // ---- Kısa erişimler ----
    val symbol: String get() = getString("symbol", DEFAULT_SYMBOL)
    var positionSize: String
        get() = getString("position_size", DEFAULT_POSITION_SIZE)
        set(v) = putString("position_size", v)
    val category: String get() = getString("category", DEFAULT_CATEGORY)

    val bybitApiKey: String get() = getString("bybit_api_key", "")
    val bybitApiSecret: String get() = getString("bybit_api_secret", "")
    val telegramToken: String get() = getString("telegram_token", "")
    val telegramChatId: String get() = getString("telegram_chat_id", "")

    val isBybitConfigured: Boolean get() = bybitApiKey.isNotBlank() && bybitApiSecret.isNotBlank()
    val isTelegramConfigured: Boolean get() = telegramToken.isNotBlank() && telegramChatId.isNotBlank()
}
