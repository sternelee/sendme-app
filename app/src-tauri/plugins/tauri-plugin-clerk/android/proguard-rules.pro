# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in the Android SDK tools/proguard/proguard-android.txt file.

# Keep all Tauri plugin classes
-keep class app.tauri.clerk.** { *; }
