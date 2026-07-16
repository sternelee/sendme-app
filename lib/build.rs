//! Reads [`SENDME_RELAY_URL`] at compile time and embeds it as
//! `SENDME_BUILTIN_RELAY_URL` so packaged binaries default to a custom relay
//! without requiring the env var to be set at runtime.
//!
//! Build with `SENDME_RELAY_URL=https://relay.example.com cargo build` to
//! bake a non-default relay into the produced binaries. The same env var is
//! still honored at runtime — runtime wins if both are present.

fn main() {
    println!("cargo:rerun-if-env-changed=SENDME_RELAY_URL");

    let Ok(value) = std::env::var("SENDME_RELAY_URL") else {
        return;
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }

    println!("cargo:rustc-env=SENDME_BUILTIN_RELAY_URL={trimmed}");
}
