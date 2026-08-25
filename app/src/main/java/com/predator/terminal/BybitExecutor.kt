package com.predator.terminal

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

// ============================================================
// BYBIT İNFAZ MOTORU (Resmi v5 REST API — HMAC-SHA256 imzalı)
// ============================================================
object BybitExecutor {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json".toMediaType()

    sealed class Result {
        data class Success(val orderId: String, val price: String) : Result()
        data class Failure(val reason: String) : Result()
    }

    /**
     * Piyasa emri gönderir.
     * @param side "Buy" veya "Sell"
     */
    fun executeMarketOrder(side: String): Result {
        val apiKey = Config.bybitApiKey
        val secret = Config.bybitApiSecret
        if (apiKey.isBlank() || secret.isBlank()) {
            return Result.Failure("Bybit API key tanımlı değil (Ayarlar)")
        }

        val timestamp = System.currentTimeMillis().toString()
        val recvWindow = "5000"

        val body = JSONObject().apply {
            put("category", Config.category)
            put("symbol", Config.symbol)
            put("side", side)                    // "Buy" / "Sell"
            put("orderType", "Market")
            put("qty", Config.positionSize)      // spot: baseCoin miktarı (örn. 0.001 BTC), linear: kontrat
        }.toString()

        // Bybit v5 imza: timestamp + apiKey + recvWindow + body
        val signPayload = timestamp + apiKey + recvWindow + body
        val sign = hmacSha256(secret, signPayload)

        val request = Request.Builder()
            .url("${Config.BYBIT_API_BASE}/v5/order/create")
            .post(body.toRequestBody(jsonMedia))
            .header("X-BAPI-API-KEY", apiKey)
            .header("X-BAPI-TIMESTAMP", timestamp)
            .header("X-BAPI-SIGN", sign)
            .header("X-BAPI-RECV-WINDOW", recvWindow)
            .build()

        return try {
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                val json = JSONObject(text)
                val retCode = json.optLong("retCode", -1)
                if (resp.isSuccessful && retCode == 0L) {
                    val result = json.optJSONObject("result")
                    Result.Success(
                        orderId = result?.optString("orderId") ?: "?",
                        price = result?.optString("price") ?: "0"
                    )
                } else {
                    Result.Failure(json.optString("retMsg", "Bilinmeyen hata (HTTP ${resp.code})"))
                }
            }
        } catch (t: Throwable) {
            Result.Failure(t.message ?: "Ağ hatası")
        }
    }

    private fun hmacSha256(secret: String, payload: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(payload.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
