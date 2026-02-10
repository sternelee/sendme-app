# Android 调试指南

## 问题描述
接收文件时一直卡在 "Connecting..." 状态，没有报错信息。

## 调试步骤

### 1. 设置 ADB 环境

```bash
# 添加 adb 到 PATH (临时，当前终端会话有效)
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"

# 验证 adb 可用
adb version
```

如果要永久添加，编辑 `~/.zshrc` 或 `~/.bashrc`:
```bash
echo 'export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### 2. 连接 Android 设备

```bash
# 查看已连接的设备
adb devices

# 如果看到类似这样的输出，说明连接成功:
# List of devices attached
# XXXXXXXX	device
```

如果没有设备：
- 确保手机已通过 USB 连接到电脑
- 在手机上启用"USB 调试"（设置 -> 开发者选项）
- 在手机上授权电脑的 USB 调试请求

### 3. 实时查看日志

打开一个新的终端窗口，运行：

```bash
# 方法1: 查看所有 sendmd 相关日志
adb logcat | grep -i "sendmd\|iroh\|rust"

# 方法2: 只看错误和警告
adb logcat | grep -E "ERROR|WARN|sendmd"

# 方法3: 查看所有日志并保存到文件
adb logcat > ~/android_debug.log
```

**保持这个终端窗口打开**，然后在手机上操作：
1. 打开 Sendmd 应用
2. 尝试接收文件
3. 观察日志输出

### 4. 关键日志点

在日志中查找这些关键信息：

#### 4.1 接收启动
```
INFO  sendmd: receive_file called with ticket: ...
```

#### 4.2 目录切换（可能的失败点）
```
WARN  sendmd: Android: output_dir specified but ignored
```
或
```
ERROR sendmd: Failed to change to output directory
```

#### 4.3 Ticket 解析
```
ERROR sendmd: Invalid ticket: ...
```

#### 4.4 网络连接
```
DEBUG iroh: Connecting to peer...
ERROR iroh: Connection failed: ...
```

#### 4.5 进度事件
```
DEBUG sendmd: Progress event: Connecting
DEBUG sendmd: Progress event: Downloading
```

### 5. 检查当前构建

```bash
# 检查 APK 是否存在
ls -lh app/src-tauri/gen/android/app/build/outputs/apk/universal/release/

# 查看 APK 构建时间
stat app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

### 6. 重新构建并安装

```bash
# 清理构建
cd app
rm -rf src-tauri/gen/android/app/build/

# 重新构建
pnpm run tauri android build --target aarch64

# 查看构建结果
ls -lh src-tauri/gen/android/app/build/outputs/apk/universal/release/

# 安装到设备
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

### 7. 调试特定问题

#### 7.1 如果应用崩溃
```bash
# 查看崩溃日志
adb logcat | grep -E "FATAL|AndroidRuntime"
```

#### 7.2 如果无法连接到发送方
```bash
# 检查网络连接
adb shell ping -c 3 8.8.8.8

# 检查 WiFi 状态
adb shell dumpsys wifi | grep "mWifiInfo"
```

#### 7.3 如果 Ticket 无效
- 确保从发送方复制的 ticket 完整
- ticket 应该是类似这样的格式: `blob:xxxxx...`

### 8. 添加更多调试日志

如果日志不够详细，可以修改 `app/src-tauri/src/lib.rs`，在 `receive_file` 函数开头添加：

```rust
#[tauri::command]
async fn receive_file(
    app: AppHandle,
    transfers: tauri::State<'_, Transfers>,
    request: ReceiveFileRequest,
) -> Result<String, String> {
    tracing::info!("=== RECEIVE_FILE START ===");
    tracing::info!("Ticket: {}", request.ticket);
    tracing::info!("Output dir: {:?}", request.output_dir);
    tracing::info!("Current dir: {:?}", std::env::current_dir());
    
    // ... 其余代码
```

在关键位置添加日志：
```rust
tracing::info!("Ticket parsed successfully");
tracing::info!("Creating transfer info with id: {}", transfer_id);
tracing::info!("Calling pisend_lib::receive_with_progress...");
```

然后重新构建并安装。

### 9. 前端控制台调试

在浏览器（或 Android WebView）中查看 JavaScript 控制台：

#### 9.1 Android Chrome DevTools

1. 在电脑上打开 Chrome
2. 访问 `chrome://inspect`
3. 找到你的设备和 Sendmd 应用
4. 点击 "inspect"
5. 查看 Console 标签

#### 9.2 在应用中添加 vConsole (已添加)

应用已经集成了 vConsole，在应用中：
1. 点击右下角的绿色按钮打开 vConsole
2. 查看 Console 和 Network 标签
3. 尝试接收文件时观察输出

### 10. 常见问题排查

#### 问题1: 一直显示 "Connecting..."

可能原因：
1. **网络问题**: 发送方和接收方不在同一网络
2. **Relay 服务器问题**: 无法连接到中继服务器
3. **Ticket 过期**: Ticket 可能已经失效
4. **代码卡住**: `receive_file` 函数在某处阻塞

排查方法：
```bash
# 查看是否有网络错误
adb logcat | grep -i "network\|connection\|timeout"

# 查看函数是否被调用
adb logcat | grep "RECEIVE_FILE START"

# 查看是否进入 receive_with_progress
adb logcat | grep "receive_with_progress"
```

#### 问题2: 没有任何日志输出

可能原因：
1. 应用没有正确安装
2. 日志级别太高
3. 应用使用了旧版本

解决方法：
```bash
# 完全卸载应用
adb uninstall com.sendmd.app

# 重新安装
adb install src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

# 清除应用数据
adb shell pm clear com.sendmd.app
```

#### 问题3: set_current_dir 错误

已修复，但如果仍然出现，检查代码是否正确使用了 `#[cfg(not(target_os = "android"))]`。

### 11. 测试简单场景

为了排除其他因素，先测试最简单的场景：

1. **本地回环测试**:
   - 在同一台设备上（电脑）发送和接收
   - 确认基本功能正常

2. **同一 WiFi 测试**:
   - 电脑发送，手机接收
   - 确保两者在同一 WiFi 网络

3. **使用已知有效的 ticket**:
   - 使用刚刚生成的 ticket，不要等待太久

### 12. 收集信息给开发者

如果问题仍然存在，收集以下信息：

```bash
# 1. 设备信息
adb shell getprop ro.build.version.release  # Android 版本
adb shell getprop ro.product.model           # 设备型号

# 2. 应用版本
adb shell dumpsys package com.sendmd.app | grep versionName

# 3. 完整日志 (在操作时运行)
adb logcat > ~/pisend_debug_full.log
# 在手机上操作，然后 Ctrl+C 停止

# 4. 查看最近的崩溃
adb shell dumpsys dropbox --print > ~/pisend_crash.log
```

将这些日志和以下信息一起提供：
- 具体操作步骤
- 预期行为 vs 实际行为
- 错误消息（如果有）
- 截图

### 13. 下一步行动

基于日志输出，我们可以：

1. **如果看到 "Invalid ticket" 错误**:
   - 检查 ticket 格式
   - 确认 ticket 没有被截断

2. **如果看到 "Connection failed" 错误**:
   - 检查网络连接
   - 尝试使用其他网络

3. **如果看到 "set_current_dir" 错误**:
   - 确认代码已更新
   - 重新构建应用

4. **如果没有任何日志**:
   - 检查应用是否正确安装
   - 检查是否有 Rust panic

5. **如果看到 "RECEIVE_FILE START" 但没有后续日志**:
   - 函数在某处阻塞
   - 需要添加更多调试点

## 快速调试脚本

创建 `debug.sh`:

```bash
#!/bin/bash

echo "=== Sendmd Android Debug ==="
echo ""

echo "1. 检查设备连接..."
adb devices
echo ""

echo "2. 清除旧日志..."
adb logcat -c
echo ""

echo "3. 开始监控日志 (Ctrl+C 停止)..."
echo "   现在请在手机上操作..."
echo ""

adb logcat | grep --line-buffered -E "sendmd|iroh|ERROR|WARN" | while read line; do
    echo "[$(date '+%H:%M:%S')] $line"
done
```

使用方法：
```bash
chmod +x debug.sh
./debug.sh
```

## 联系支持

如果以上步骤无法解决问题，请提供：
1. `adb logcat` 的完整输出
2. 前端控制台的截图
3. 操作的详细步骤
4. 设备和网络信息
