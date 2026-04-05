package app.tauri.clerk

/**
 * Tauri Clerk Plugin for Android
 *
 * This plugin provides Clerk authentication integration for Tauri mobile apps.
 */
object ClerkPlugin {
    init {
        System.loadLibrary("sendme_app")
    }
}
