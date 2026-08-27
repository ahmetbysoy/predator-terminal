package com.predator.terminal

import android.content.Context
import android.content.SharedPreferences
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * PREDATOR TERMINAL - AlarmBridge
 * =================================
 * WebView ↔ Native Android alarm senkronizasyonu.
 *
 * JS tarafı: window.AndroidBridge.addAlarm("ETHUSDT", 4000, "above")
 * Native taraf: SharedPreferences'a kaydeder, Service ticker geldiğinde kontrol eder.
 * Alarm tetiklendiğinde: window.PredatorNative.onAlarmTriggered(json) ile JS'e iletir.
 */
class AlarmBridge(private val context: Context) {

    companion object {
        const val PREFS_NAME = "predator_alarms"
        const val KEY_ALARMS = "active_alarms"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ─────────────────────────────────────────────
    // JS → Native: Alarm ekle
    // ─────────────────────────────────────────────

    @JavascriptInterface
    fun addAlarm(symbol: String, price: Double, type: String): String {
        val id = "native_${System.currentTimeMillis()}"
        val alarm = JSONObject().apply {
            put("id", id)
            put("symbol", symbol.uppercase())
            put("price", price)
            put("type", type)
            put("active", true)
            put("triggered", false)
            put("createdAt", System.currentTimeMillis())
        }

        val alarms = loadAlarmsJson()
        alarms.put(alarm)
        saveAlarmsJson(alarms)

        PredatorStreamService.notifyAlarmsUpdated()
        return id
    }

    // ─────────────────────────────────────────────
    // JS → Native: Alarm kaldır
    // ─────────────────────────────────────────────

    @JavascriptInterface
    fun removeAlarm(alarmId: String): Boolean {
        val alarms = loadAlarmsJson()
        val filtered = JSONArray()
        var removed = false

        for (i in 0 until alarms.length()) {
            val a = alarms.getJSONObject(i)
            if (a.getString("id") == alarmId) {
                removed = true
            } else {
                filtered.put(a)
            }
        }

        if (removed) {
            saveAlarmsJson(filtered)
            PredatorStreamService.notifyAlarmsUpdated()
        }
        return removed
    }

    // ─────────────────────────────────────────────
    // JS → Native: Tüm alarmları senkronize et (bulk)
    // ─────────────────────────────────────────────

    @JavascriptInterface
    fun syncAlarms(jsonArray: String) {
        try {
            val alarms = JSONArray(jsonArray)
            saveAlarmsJson(alarms)
            PredatorStreamService.notifyAlarmsUpdated()
        } catch (e: Exception) {
            android.util.Log.e("AlarmBridge", "syncAlarms parse error", e)
        }
    }

    // ─────────────────────────────────────────────
    // Native → JS: Alarm tetiklendiğinde çağrılır
    // ─────────────────────────────────────────────

    @JavascriptInterface
    fun getAlarms(): String {
        return loadAlarmsJson().toString()
    }

    // ─────────────────────────────────────────────
    // Native → JS: Platform bilgisi
    // ─────────────────────────────────────────────

    @JavascriptInterface
    fun getPlatform(): String = "android"

    @JavascriptInterface
    fun getSdkVersion(): Int = android.os.Build.VERSION.SDK_INT

    // ─────────────────────────────────────────────
    // PRIVATE: Persistence
    // ─────────────────────────────────────────────

    private fun loadAlarmsJson(): JSONArray {
        val raw = prefs.getString(KEY_ALARMS, "[]") ?: "[]"
        return try {
            JSONArray(raw)
        } catch (e: Exception) {
            JSONArray()
        }
    }

    private fun saveAlarmsJson(alarms: JSONArray) {
        prefs.edit().putString(KEY_ALARMS, alarms.toString()).apply()
    }
}
