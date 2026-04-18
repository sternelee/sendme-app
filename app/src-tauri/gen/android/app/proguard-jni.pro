# ProGuard rules for JNI-called classes
# These classes are called FROM native Rust code via JNI,
# so ProGuard can't detect them and would strip them by default.

# Keep FileUtils class - called from Rust via JNI for Android SAF operations
-keep class io.sendme.app.FileUtils {
    public static boolean writeFileToContentUri(android.content.Context, java.lang.String, java.lang.String, byte[]);
}

# Keep foreground-service entrypoints - called from Rust via JNI in release builds
-keep class io.sendme.app.SendmeForegroundService {
    public static void upsert(android.content.Context, java.lang.String);
    public static void stop(android.content.Context);
}

# Keep all classes with methods called from JNI (pattern matching)
-keepclassmembers class * {
    public static ** *ContentUri(...);
}
