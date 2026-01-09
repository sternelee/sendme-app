# 使用 eprintln! 调试 Android 接收问题

## 问题
经过多次测试，使用 android_logger 后仍然看不到日志，只看到加密的 HKS 信息。

## 新的调试方法

我添加了 `eprintln!` 输出，它会直接写入 stderr，绕过日志系统。

### 已添加的调试点

1. **应用启动时** (`run()` 函数):
   ```
   ========================================
   🚀 Sendme app starting...
   ========================================
   Initializing android_logger...
   android_logger initialized!
   Creating transfers state...
   Building Tauri app...
   ```

2. **接收文件开始时** (`receive_file()` 函数):
   ```
   ════════════════════════════════════════
   🚀 RECEIVE_FILE STARTED
   ════════════════════════════════════════
   Ticket length: 180
   Output dir: Some("/storage/emulated/0/Download")
   Current dir: Ok("/data/data/com.sendme.app/files")
   Generated transfer_id: xxxxx
   ```

3. **关键步骤**:
   ```
   Parsing ticket...
   ✅ Ticket parsed successfully
   Getting temp directory...
   ✅ Temp dir: "/data/data/com.sendme.app/cache"
   🌐 About to call receive_with_progress...
      Ticket format: BlobTicket { ... }
      Relay mode: Default
   ```

4. **成功或失败时**:
   ```
   ✅ RECEIVE COMPLETED!
      Files: 1
      Bytes: 12345
   
   或
   
   ❌ RECEIVE FAILED!
      Error: connection timeout
   ```

## 如何测试

### 1. 安装新 APK

```bash
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"

# 安装
adb install -r app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

### 2. 监控 logcat (三种方法)

**方法 A - 监控所有输出（最推荐）：**
```bash
adb logcat -c  # 清除旧日志
adb logcat | grep -E "(sendme|🚀|════|✅|❌)"
```

**方法 B - 只看 app 的输出：**
```bash
adb logcat -c
adb logcat --pid=$(adb shell pidof com.sendme.app)
```

**方法 C - 查看所有日志级别：**
```bash
adb logcat -c
adb logcat *:V | grep -i "sendme"
```

### 3. 操作步骤

1. **清除日志**: `adb logcat -c`
2. **启动监控**: `adb logcat | grep -E "(sendme|🚀|════|✅|❌)"`
3. **打开应用**: 在手机上启动 Sendme
   - 应该看到: "🚀 Sendme app starting..."
4. **尝试接收文件**: 扫描或输入 ticket
   - 应该看到: "🚀 RECEIVE_FILE STARTED"
5. **观察输出**: 看看卡在哪一步

### 4. 如果还是没有输出

尝试这些命令查看是否有任何输出：

```bash
# 查看所有日志（非常详细）
adb logcat -v threadtime

# 只看错误和警告
adb logcat *:E *:W

# 查看 Rust panic 信息
adb logcat | grep -i "panic"

# 查看崩溃信息
adb logcat | grep -i "crash\|fatal\|exception"
```

## 预期结果

### 如果看到 eprintln 输出

说明 Rust 代码在运行，我们能看到具体卡在哪一步：

1. **卡在启动**: 连 "🚀 Sendme app starting..." 都看不到
   - 问题：Tauri 初始化失败
   
2. **卡在票据解析**: 看到 "Parsing ticket..." 但没有 "✅ Ticket parsed"
   - 问题：票据格式错误或解析失败
   
3. **卡在 receive_with_progress**: 看到 "🌐 About to call..." 后就没消息了
   - 问题：网络连接问题（最可能）

### 如果还是看不到任何 eprintln 输出

说明问题更深层：

1. **Rust 代码根本没执行**
   - 可能是 JNI 绑定问题
   - 可能是权限问题阻止了代码运行

2. **stderr 被重定向或屏蔽**
   - 某些 Android 设备可能阻止 stderr 输出
   - 系统安全设置问题

## 替代调试方法（如果 eprintln 也不工作）

如果连 `eprintln!` 都看不到，我们需要：

1. **通过前端显示错误**
   - 修改前端代码，显示 Tauri 命令的返回值
   - 在 UI 上显示详细错误信息

2. **写入文件日志**
   - 将调试信息写入 `/data/data/com.sendme.app/files/debug.log`
   - 使用 `adb pull` 提取日志文件

3. **使用 Toast 通知**
   - 在关键步骤显示 Android Toast
   - 至少能看到执行到哪一步了

## 重要提示

`eprintln!` 输出应该比 `log::info!` 更可靠，因为：
- 直接写入标准错误流
- 不依赖任何日志框架
- 不需要初始化
- 通常不会被过滤

如果连 `eprintln!` 都看不到，说明问题可能在：
1. **应用根本没启动 Rust 部分**
2. **设备的日志系统有特殊限制**
3. **需要特殊权限才能查看应用日志**

## APK 位置

```
app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

## 测试并反馈

请安装此 APK，按照上述步骤操作，然后告诉我：

1. **能否看到启动时的 "🚀 Sendme app starting..." 消息？**
2. **能否看到 "🚀 RECEIVE_FILE STARTED" 消息？**
3. **最后看到的消息是什么？**
4. **是否有任何错误消息？**

这些信息将帮助我们确定问题的确切位置。
