# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.sendme.dev.* {
  native <methods>;
}

-keep class com.sendme.dev.WryActivity {
  public <init>(...);

  void setWebView(com.sendme.dev.RustWebView);
  java.lang.Class getAppClass(...);
  java.lang.String getVersion();
}

-keep class com.sendme.dev.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.sendme.dev.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.sendme.dev.RustWebChromeClient,com.sendme.dev.RustWebViewClient {
  public <init>(...);
}
