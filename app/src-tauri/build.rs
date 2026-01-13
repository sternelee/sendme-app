fn main() {
    tauri_build::build();

    // On Android, copy our custom Kotlin files to the generated project
    #[cfg(target_os = "android")]
    {
        let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        let android_gen_dir = out_dir.join("../../gen/android/app/src/main/java/com/sendme/app");

        if let Ok(metadata) = std::fs::metadata(&android_gen_dir) {
            if metadata.is_dir() {
                let source_dir = std::path::PathBuf::from("android-includes/com/sendme/app");

                if let Ok(entries) = std::fs::read_dir(&source_dir) {
                    for entry in entries.flatten() {
                        let source_file = entry.path();
                        let file_name = source_file.file_name().unwrap();
                        let dest_file = android_gen_dir.join(file_name);

                        if source_file.extension().map_or(false, |e| e == "kt") {
                            println!("cargo:warning=Copying {} to {}", file_name.display(), dest_file.display());
                            std::fs::copy(&source_file, &dest_file).ok();
                        }
                    }
                }
            }
        }
    }
}
