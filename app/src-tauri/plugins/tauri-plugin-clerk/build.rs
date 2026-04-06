use std::path::Path;

const COMMANDS: &[&str] = &[
    "initialize",
    "set_client_authorization_header",
    "get_client_authorization_header",
];

fn main() {
    let builder = tauri_plugin::Builder::new(COMMANDS).android_path("android");

    if Path::new("ios/Package.swift").exists() {
        builder.ios_path("ios").build();
    } else {
        builder.build();
    }
}
