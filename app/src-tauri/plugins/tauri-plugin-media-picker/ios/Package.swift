// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-media-picker",
  platforms: [
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-media-picker",
      type: .static,
      targets: ["tauri-plugin-media-picker"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-media-picker",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources"
    )
  ]
)
