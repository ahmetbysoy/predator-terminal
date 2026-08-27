# Predator Terminal ProGuard Rules
-keepattributes *Annotation*
-keep class com.predator.terminal.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
