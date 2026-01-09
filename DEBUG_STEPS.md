# 🐛 Android 调试步骤

## 问题: 接收文件时一直显示 "Connecting..."

## 快速调试步骤

### 1️⃣ 安装最新的调试版本

```bash
# 设置 adb 路径
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"

# 完全卸载旧版本
adb uninstall com.sendme.app

# 安装新版本（带详细日志）
adb install app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

### 2️⃣ 启动日志监控

在**新的终端窗口**运行：

```bash
cd /Users/sternelee/www/github/iroh-sendme
./debug_android.sh
```

保持这个窗口打开！

### 3️⃣ 在手机上测试

1. 打开 Sendme 应用
2. 切换到 "Receive" 标签页
3. 输入 ticket（从发送方获取）
4. 点击 "Receive" 按钮
5. **观察终端日志输出**

### 4️⃣ 分析日志输出

日志会显示详细的执行过程，查找这些关键信息：

#### ✅ 正常流程应该看到：

```
[时间] 🚀 RECEIVE_FILE STARTED
[时间] 📋 Request details:
[时间]   - Ticket length: xxx chars
[时间] 📝 Generated transfer_id: xxxx
[时间] 📱 Android platform detected
[时间] 🎫 Parsing ticket...
[时间] ✅ Ticket parsed successfully
[时间] 📁 Getting temp directory...
[时间] ✅ Temp dir: /data/user/0/com.sendme.app/cache
[时间] 💾 Storing transfer in state...
[时间] 🔄 Spawning progress listener task...
[时间] 🌐 Calling sendme_lib::receive_with_progress...
[时间]   [Progress Task] Event #1: Connection(...)
[时间]   [Progress Task] Event #2: Download
[时间] ✅ RECEIVE COMPLETED SUCCESSFULLY
```

#### ❌ 如果出错，会看到：

```
[时间] ❌ Ticket parse failed: ...
```
或
```
[时间] ❌ Failed to get temp directory: ...
```
或
```
[时间] ❌ RECEIVE FAILED
[时间] Error: ...
```

### 5️⃣ 常见问题及解决方法

#### 问题 A: 看到 "RECEIVE_FILE STARTED" 但之后没有任何输出

**可能原因**: 
- 代码在某处卡住/阻塞
- 异步任务没有正确执行

**排查**:
```bash
# 查看是否有 panic
adb logcat | grep -i "panic\|fatal"
```

#### 问题 B: 看到 "Calling sendme_lib::receive_with_progress" 后卡住

**可能原因**:
- 网络连接问题
- 无法连接到发送方
- Relay 服务器不可达

**排查**:
1. 确保手机和发送方在同一 WiFi 网络
2. 检查网络日志:
   ```bash
   adb logcat | grep -i "connection\|network\|timeout"
   ```

#### 问题 C: 看到 "Invalid ticket" 错误

**解决方法**:
- 重新复制 ticket，确保完整
- 检查 ticket 格式是否正确（应该很长的字符串）
- 确保 ticket 未过期（重新生成一个新的）

#### 问题 D: 看到 "Progress Task" 事件但状态不更新

**可能原因**: 前端没有正确接收事件

**排查**:
1. 在手机上打开 vConsole（点击应用右下角绿色按钮）
2. 查看 Console 标签
3. 查看是否有 JavaScript 错误

### 6️⃣ 手动测试网络连接

测试是否能连接到 iroh relay 服务器：

```bash
# 在手机上测试网络
adb shell ping -c 3 8.8.8.8

# 查看 WiFi 状态
adb shell dumpsys wifi | grep "mWifiInfo"

# 查看当前 IP 地址
adb shell ip addr show wlan0
```

### 7️⃣ 收集完整日志用于分析

如果问题仍未解决，收集完整日志：

```bash
# 清除日志
adb logcat -c

# 在手机上操作（接收文件）

# 导出完整日志
adb logcat -d > ~/sendme_full_debug.log

# 压缩并提供
gzip ~/sendme_full_debug.log
```

然后提供以下信息：
1. `~/sendme_full_debug.log.gz`
2. 手机型号和 Android 版本
3. 详细的操作步骤
4. 发送方的类型（桌面/手机）
5. 是否在同一 WiFi 网络

## 🔍 深度调试

### 查看更多底层日志

```bash
# 查看所有 Rust 输出
adb logcat RustStdoutStderr:D *:S

# 查看 iroh 库的日志
adb logcat | grep -i "iroh"

# 查看应用的所有日志
adb logcat --pid=$(adb shell pidof com.sendme.app)
```

### 查看应用文件

```bash
# 查看应用数据目录
adb shell run-as com.sendme.app ls -la /data/data/com.sendme.app/

# 查看缓存目录
adb shell run-as com.sendme.app ls -la /data/data/com.sendme.app/cache/

# 查看接收到的文件
adb shell run-as com.sendme.app ls -la /data/data/com.sendme.app/files/
```

### 提取接收到的文件（如果有）

```bash
# 从应用数据目录提取文件
adb shell run-as com.sendme.app cat /data/data/com.sendme.app/files/文件名 > ~/提取的文件
```

## 📱 使用 Chrome DevTools

1. 在电脑上打开 Chrome
2. 访问 `chrome://inspect`
3. 等待设备出现（需要启用 USB 调试）
4. 找到 Sendme 应用
5. 点击 "inspect"
6. 在 Console 查看 JavaScript 日志
7. 在 Network 查看网络请求

## 🆘 需要帮助？

如果以上步骤都无法解决问题，请提供：

1. **日志文件**: `~/sendme_full_debug.log.gz`
2. **设备信息**:
   ```bash
   adb shell getprop ro.build.version.release  # Android 版本
   adb shell getprop ro.product.model          # 设备型号
   adb shell getprop ro.product.manufacturer   # 制造商
   ```
3. **网络信息**: 是否在同一 WiFi？使用的是哪种网络？
4. **Ticket 信息**: Ticket 的长度，是从哪里获取的
5. **发送方信息**: 使用的是桌面版还是手机版？
6. **截图**: 手机界面的截图

## 💡 临时解决方法

如果接收一直失败，可以尝试：

### 方法 1: 使用桌面版接收

在桌面版（macOS/Windows/Linux）上接收文件通常更稳定。

### 方法 2: 切换网络

- 尝试使用移动热点
- 或者使用其他 WiFi 网络

### 方法 3: 生成新的 Ticket

发送方重新生成一个新的 ticket，不要使用旧的。

### 方法 4: 使用 Nearby 功能

如果两个设备都在同一 WiFi，尝试使用 Nearby Devices 功能直接选择设备。
