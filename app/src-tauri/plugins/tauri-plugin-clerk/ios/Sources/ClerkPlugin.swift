// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import Tauri
import WebKit

class ClerkPlugin: Plugin {
  @objc override public func load(webview: WKWebView) {
    super.load(webview: webview)
  }
}

@_cdecl("init_plugin_clerk")
func initPlugin() -> Plugin {
  return ClerkPlugin()
}
