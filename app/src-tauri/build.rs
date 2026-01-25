fn main() {
    tauri_build::build();

    // On Android, copy our custom Kotlin files to the generated project
    #[cfg(target_os = "android")]
    {
        // The gen directory is at src-tauri/gen/android
        // We need to find it relative to the build directory
        let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());

        // Navigate from target/.../build/NAME/out to src-tauri/gen/android
        // OUT_DIR structure: target/{ARCH}/release/build/{crate-hash}/out
        // We need to go up to workspace root, then to src-tauri/gen/android
        let mut android_gen_dir = out_dir.clone();
        // Go up 5 levels: out -> {crate-hash} -> build -> release -> {ARCH} -> target
        for _ in 0..5 {
            android_gen_dir = android_gen_dir.parent().unwrap_or(&android_gen_dir).to_path_buf();
        }
        // Now we're at target/, go to app/src-tauri/gen/android/app/src/main/java/pisend/leechat/app
        android_gen_dir = android_gen_dir.join("app/src-tauri/gen/android/app/src/main/java/pisend/leechat/app");

        let source_dir = std::path::PathBuf::from("android-includes/pisend/leechat/app");

        if let Ok(entries) = std::fs::read_dir(&source_dir) {
            for entry in entries.flatten() {
                let source_file = entry.path();
                let file_name = source_file.file_name().unwrap();
                let dest_file = android_gen_dir.join(file_name);

                if source_file.extension().map_or(false, |e| e == "kt") {
                    // Create destination directory if it doesn't exist
                    if let Some(parent) = dest_file.parent() {
                        std::fs::create_dir_all(parent).ok();
                    }
                    println!(
                        "cargo:warning=Copying {} to {}",
                        file_name.display(),
                        dest_file.display()
                    );
                    std::fs::copy(&source_file, &dest_file).ok();
                }
            }
        }
    }
}
