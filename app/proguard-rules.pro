# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.predator.terminal.**$$serializer { *; }
-keepclassmembers class com.predator.terminal.** {
    *** Companion;
}
-keepclasseswithmembers class com.predator.terminal.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# EncryptedSharedPreferences (security-crypto)
-keep class androidx.security.crypto.** { *; }
-dontwarn androidx.security.crypto.**
-dontwarn com.google.errorprone.annotations.**
