// Android-specific file opening functionality using JNI

use ndk_context::android_context;
use std::fs;
use std::path::Path;

/// Open a file using Android's Intent system
/// Calls MainActivity.openFile() which handles MediaStore content URIs
pub fn open_file_with_intent(file_path: &str, _filename: &str) -> Result<(), String> {
    let ctx = android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get JavaVM: {}", e))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("Failed to attach to JVM: {}", e))?;

    // Verify file exists
    if !Path::new(file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Get the MainActivity instance
    let activity_raw = ctx.context() as jni::sys::jobject;
    let activity = unsafe { jni::objects::JObject::from_raw(activity_raw) };

    // Call MainActivity.openFile(String)
    let file_path_jstring = env
        .new_string(file_path)
        .map_err(|e| format!("Failed to create file path string: {}", e))?;

    let result = env
        .call_method(
            &activity,
            "openFile",
            "(Ljava/lang/String;)Z",
            &[jni::objects::JValue::Object(&file_path_jstring)],
        )
        .map_err(|e| format!("Failed to call openFile method: {}", e))?;

    // Check the result (Z = boolean)
    let success = result
        .z()
        .map_err(|e| format!("Failed to get boolean result: {}", e))?;

    if !success {
        return Err("Failed to open file".to_string());
    }

    Ok(())
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
                    if !name_str.starts_with('.') && !name_str.starts_with(".sendmd-") {
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
