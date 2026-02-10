# ProGuard rules for JNI-called classes
# These classes are called FROM native Rust code via JNI,
# so ProGuard can't detect them and would strip them by default.

# Keep FileUtils class - called from Rust via JNI for Android SAF operations
-keep class sendmd.leechat.app.FileUtils {
    public static boolean writeFileToContentUri(android.content.Context, java.lang.String, java.lang.String, byte[]);
}

# Keep all classes with methods called from JNI (pattern matching)
-keepclassmembers class * {
    public static ** *ContentUri(...);
}
