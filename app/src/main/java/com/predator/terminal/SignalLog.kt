package com.predator.terminal

// ============================================================
// TETİKLEYİCİ OLAY GÜNLÜĞÜ (UI panelinde gösterilir, thread-safe)
// ============================================================
object SignalLog {
    private val entries = java.util.ArrayDeque<String>()

    val items: List<String>
        get() = synchronized(this) { entries.toList() }

    fun add(entry: String) = synchronized(this) {
        entries.addLast(entry)
        while (entries.size > 30) entries.removeFirst()
    }
}
