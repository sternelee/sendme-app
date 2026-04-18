// Android-specific file opening functionality using JNI

use jni::objects::{JClass, JObject, JValue};
use ndk_context::android_context;
use std::fs;
use std::path::Path;

fn with_android_context<F, T>(f: F) -> Result<T, String>
where
    F: for<'local> FnOnce(&mut jni::JNIEnv<'local>, JObject<'local>) -> Result<T, String>,
{
    let ctx = android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get JavaVM: {}", e))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("Failed to attach to JVM: {}", e))?;

    let context_raw = ctx.context() as jni::sys::jobject;
    let context = unsafe { JObject::from_raw(context_raw) };
    f(&mut env, context)
}

fn load_app_class<'local>(
    env: &mut jni::JNIEnv<'local>,
    context: &JObject<'local>,
    class_name: &str,
) -> Result<JClass<'local>, String> {
    let class_loader = env
        .call_method(context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
        .map_err(|e| format!("Failed to get app class loader: {}", e))?
        .l()
        .map_err(|e| format!("Failed to read app class loader: {}", e))?;

    let class_name = env
        .new_string(class_name)
        .map_err(|e| format!("Failed to create class name string: {}", e))?;

    let class = env
        .call_method(
            &class_loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&class_name)],
        )
        .map_err(|e| format!("Failed to load app class with app class loader: {}", e))?
        .l()
        .map_err(|e| format!("Failed to read loaded app class: {}", e))?;

    Ok(JClass::from(class))
}

/// Open a file using Android's Intent system
/// Calls MainActivity.openFile() which handles MediaStore content URIs
pub fn open_file_with_intent(file_path: &str, _filename: &str) -> Result<(), String> {
    // Verify file exists
    if !Path::new(file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }

    with_android_context(|env, activity| {
        let file_path_jstring = env
            .new_string(file_path)
            .map_err(|e| format!("Failed to create file path string: {}", e))?;

        let result = env
            .call_method(
                &activity,
                "openFile",
                "(Ljava/lang/String;)Z",
                &[JValue::Object(&file_path_jstring)],
            )
            .map_err(|e| format!("Failed to call openFile method: {}", e))?;

        let success = result
            .z()
            .map_err(|e| format!("Failed to get boolean result: {}", e))?;

        if !success {
            return Err("Failed to open file".to_string());
        }

        Ok(())
    })
}

pub fn upsert_background_service(payload_json: &str) -> Result<(), String> {
    with_android_context(|env, context| {
        let service_class = load_app_class(env, &context, "io.sendme.app.SendmeForegroundService")?;
        let payload = env
            .new_string(payload_json)
            .map_err(|e| format!("Failed to create payload string: {}", e))?;

        env.call_static_method(
            service_class,
            "upsert",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(&context), JValue::Object(&payload)],
        )
        .map_err(|e| format!("Failed to call SendmeForegroundService.upsert: {}", e))?;

        Ok(())
    })
}

pub fn stop_background_service() -> Result<(), String> {
    with_android_context(|env, context| {
        let service_class = load_app_class(env, &context, "io.sendme.app.SendmeForegroundService")?;

        env.call_static_method(
            service_class,
            "stop",
            "(Landroid/content/Context;)V",
            &[JValue::Object(&context)],
        )
        .map_err(|e| format!("Failed to call SendmeForegroundService.stop: {}", e))?;

        Ok(())
    })
}

/// Find received files in the directory
pub fn find_received_files(base_dir: &str) -> Vec<String> {
    let path = Path::new(base_dir);
    let mut files = Vec::new();

    // Look for files directly in the directory
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.filter_map(Result::ok) {
            let file_path = entry.path();
            if file_path.is_file() {
                // Skip hidden files and temp files
                if let Some(name) = file_path.file_name() {
                    let name_str = name.to_string_lossy();
                    if !name_str.starts_with('.') && !name_str.starts_with(".sendme-") {
                        files.push(file_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_received_files() {
        // Test with a temp directory
        let temp = std::env::temp_dir();
        let files = find_received_files(temp.to_str().unwrap_or("/tmp"));
        // Just verify it doesn't crash and returns a Vec
        assert!(files.len() >= 0);
    }
}
