# Nearby Device Discovery — mDNS 冲突问题

## 现象

在同一局域网内，macOS、Android、iOS 三台设备同时启动 sendme App 时，Nearby（附近设备）列表显示不一致：

- **iOS**：只看到 Android
- **Android**：只看到 Mac
- **Mac**：只看到 Android

文件传输本身可以正常工作（如 iOS → Android），但发现列表的结果不对。

## 根因

**mDNS 服务名冲突。**

Nearby 发现使用 [mdns-sd](https://crates.io/crates/mdns-sd) 库发布 `_sendme._udp` 服务。旧代码中，所有设备都使用相同的 `instance_name` 和 `hostname`：

```rust
// 所有设备都叫这个名字 → 冲突
let instance_name = "Sendme";                // mDNS 服务实例名
let hostname = "Sendme.local.";              // 局域网主机名
```

mDNS 规范要求**同一局域网内服务实例名必须唯一**。当多个设备发布相同实例名时，各平台的 mDNS 守护进程（macOS mDNSResponder / Android avahi / iOS mDNSResponder）在冲突解决时表现不一致，导致：

- 部分平台将某台设备的服务视为"已被替代"
- 浏览时只能看到某个子集的设备
- 结果在不同平台上各不相同

## 修复

### 方案：让服务名唯一 + 保留显示名

修改 `lib/src/nearby/core.rs`：

1. **让 `instance_name` 唯一**：追加 endpoint ID 的前 8 位 hex 后缀：
   ```rust
   let unique_suffix = {
       let id_str = endpoint_addr.id.to_string();
       &id_str[..id_str.len().min(8)].to_string()
   };
   let instance_name = format!("{}-{}", name.replace(" ", "-"), unique_suffix);
   // 例如：Sendme → "Sendme-a3f7b2d1"
   ```

2. **同步让 `hostname` 唯一**：
   ```rust
   let hostname = format!("{}.local.", instance_name);
   // 例如：Sendme-a3f7b2d1.local.
   ```

3. **在 TXT 记录中保留原始显示名**：
   ```rust
   properties.push(("name", "Sendme"));   // 实际显示的名字
   ```

4. **UI 解析时优先用 TXT 中的 `name`**：
   ```rust
   let name = info
       .get_property_val_str("name")
       .map(|s| s.to_string())
       .or_else(|| extract_instance_name(fullname))?;
   ```

5. **自我过滤改为前缀匹配**：
   ```rust
   if id.starts_with(&format!("{}.", our_name)) {
       // skip our own service
   }
   ```

## 验证

修复后 `cargo check` 通过，逻辑上：

- 每台设备的 mDNS 服务名在局域网内唯一，不会再触发冲突
- 所有平台看到的设备列表趋于一致
- 显示名仍通过 TXT 记录保留，UI 不发生变化

## iOS 平台限制

即使修复了冲突，**iOS 仍可能不被其他设备发现**，因为：

- iOS 14+ 要求 `com.apple.developer.networking.multicast` entitlement 才能**发送** mDNS 广播
- 没有这个 entitlement 时，iOS 只能**接收**广播，无法**发布**自己的服务
- 该 entitlement 需要 Apple Developer 的特殊权限，个人开发团队通常无法申请

因此 **Android 和 Mac 的列表里可能仍然看不到 iOS**，这是系统限制，不是代码 bug。

若要彻底解决这个问题，可考虑增加 UDP 单播/广播到特定端口的**备用发现机制**，作为 mDNS 的 fallback。

## 相关代码

- `lib/src/nearby/core.rs` — mDNS 发现核心逻辑
- `app/src-tauri/src/lib.rs` — Tauri 后端 Nearby runtime 管理
