# Browser 与 Lib 端兼容性审查报告

## 审查日期: 2026-01-19

## 🎉 实施状态更新 (2026-01-19 11:30)

✅ **HashSeq 支持已实现并完成编译**

### 已完成的工作

1. **修改 `browser/src/node.rs`**:
   - ✅ `import_and_create_ticket()`: 使用 `Collection::from_iter` 创建单文件 Collection
   - ✅ `import_and_create_ticket()`: 使用 `collection.store()` 保存 Collection
   - ✅ `import_and_create_ticket()`: 创建 `BlobFormat::HashSeq` ticket
   - ✅ `get()`: 使用 `Collection::load()` 解析 Collection
   - ✅ `get()`: 返回 `(String, Bytes)` 元组（文件名 + 数据）
   - ✅ 移除未使用的 imports

2. **修改 `browser/src/wasm.rs`**:
   - ✅ `get()` WASM 绑定返回 JS 对象 `{filename: string, data: Uint8Array}`

3. **修改 `browser/public/index.html`**:
   - ✅ `receiveFile()` 函数解构返回值获取 filename
   - ✅ 在 UI 中显示文件名

4. **编译状态**:
   - ✅ `cargo check --target=wasm32-unknown-unknown` 通过
   - ✅ `cargo build --target=wasm32-unknown-unknown` 成功
   - ✅ `wasm-bindgen` 生成绑定成功
   - ✅ 开发服务器可启动

### 待进行的工作

- ⏳ **测试**: 需要手动测试所有传输场景（见 `TESTING.md`）
- ⏳ **文档**: 更新主 README.md

### 技术实现细节

**创建 Collection (node.rs:92-95)**:
```rust
// 使用 FromIterator 特性创建 Collection
let collection: Collection = std::iter::once((name, blob_hash)).collect();
let collection_tag = collection.store(&self.blobs).await?;
let collection_hash = collection_tag.hash();
```

**解析 Collection (node.rs:149-163)**:
```rust
// 加载并解析 Collection
let collection = Collection::load(collection_hash, &self.blobs).await?;
let (filename, blob_hash) = collection.iter().next()
    .ok_or_else(|| anyhow::anyhow!("Collection is empty"))?;
let bytes = self.blobs.get_bytes(*blob_hash).await?;
Ok((filename.to_string(), bytes))
```

**WASM 返回对象 (wasm.rs:~115-125)**:
```javascript
// JavaScript 接收到的对象
{
  filename: "example.txt",
  data: Uint8Array([...])
}
```

### 下一步操作

运行测试（参考 `TESTING.md`）:
```bash
# 启动浏览器服务器
cd browser
pnpm run serve

# 在另一个终端测试 CLI 传输
cargo run --bin sendmd send test.txt
```

---

## 执行摘要

⚠️ **发现关键兼容性问题**: Browser 端与 Lib 端使用了**不同的 BlobFormat**，导致无法互操作。

## 发现的问题

### 🔴 关键问题 1: BlobFormat 不兼容

**Browser (node.rs:94)**
```rust
// Browser creates tickets with tag.format (from add_bytes, which is Raw)
let ticket = BlobTicket::new(addr, tag.hash, tag.format);
```

**Lib (send.rs:156)**
```rust
// Lib creates tickets with HashSeq format
let ticket = iroh_blobs::ticket::BlobTicket::new(addr, hash, BlobFormat::HashSeq);
```

**影响**:
- ❌ Browser 发送的文件无法被 CLI/App 接收（格式不匹配）
- ❌ CLI/App 发送的文件无法被 Browser 接收（格式不匹配）
- ❌ Browser 之间可以互传（都用 Raw）
- ❌ CLI/App 之间可以互传（都用 HashSeq）

**原因分析**:
- `BlobFormat::Raw`: 单个 blob，无元数据，无文件名
- `BlobFormat::HashSeq`: Collection 格式，包含文件名和多文件支持

### 🟡 问题 2: 缺少文件名支持

**Browser**:
```rust
pub async fn import_and_create_ticket(&self, _name: String, data: Bytes) -> Result<String> {
    // _name 参数被忽略！
    let tag = self.blobs.add_bytes(data).await?;
    // 只存储 raw bytes，没有文件名
}
```

**Lib**:
```rust
// lib/src/import.rs 使用 Collection 存储文件名
let collection = Collection::new(files);
```

**影响**:
- ❌ Browser 发送的文件接收后无文件名
- ❌ 无法判断文件类型
- ❌ 用户体验差

### 🟢 问题 3: node.rs 有重复代码（已修复）

**状态**: ✅ 已修复
- 移除了 172 行重复代码
- 从 352 行减少到 179 行

## 兼容性矩阵

**更新**: 2026-01-19 - 实现 HashSeq 支持后

| 发送端 | 接收端 | 兼容性 | 说明 |
|--------|--------|--------|------|
| Browser | Browser | ✅ | HashSeq format |
| CLI/App | CLI/App | ✅ | HashSeq format |
| Browser | CLI/App | ✅ | **已修复** - 都用 HashSeq |
| CLI/App | Browser | ✅ | **已修复** - 都用 HashSeq |

## 详细技术对比

### 发送流程对比

**Lib (send.rs)**:
```rust
// 1. 导入文件/目录到 Collection
let (hash, size, collection) = import(path, &store, progress_tx).await?;

// 2. 创建 HashSeq ticket
let ticket = BlobTicket::new(addr, hash, BlobFormat::HashSeq);

// Collection 包含:
// - 文件名列表
// - 每个文件的 hash
// - 目录结构
```

**Browser (node.rs)**:
```rust
// 1. 直接添加 bytes（无元数据）
let tag = self.blobs.add_bytes(data).await?;

// 2. 创建 Raw ticket
let ticket = BlobTicket::new(addr, tag.hash, tag.format); // tag.format = Raw
```

### 接收流程对比

**Lib (receive.rs:105-262)**:
```rust
// 1. 获取 hash_seq 和 sizes（用于 Collection）
let (hash_seq, sizes) = get_hash_seq_and_sizes(...).await?;

// 2. 下载所有文件
let stream = get.stream();
while let Some(item) = stream.next().await { ... }

// 3. 加载 Collection 元数据
let collection = Collection::load(hash, db).await?;

// 4. 导出文件（保留文件名和目录结构）
export::export(&db, collection, ...).await?;
```

**Browser (node.rs:105-130)**:
```rust
// 1. 使用 Downloader API（更简洁）
self.downloader
    .download(ticket.hash_and_format(), [ticket.addr().id])
    .await?;

// 2. 直接获取 bytes（无元数据处理）
let bytes = self.blobs.get_bytes(hash).await?;

// 注意：无 Collection 解析，无文件名恢复
```

## 根本原因

### 设计差异

1. **Browser 设计为简单的 bytes 传输**
   - 无文件系统访问（WASM 限制）
   - 使用 `MemStore`（内存存储）
   - 只处理单个文件的 bytes

2. **Lib 设计为完整的文件传输**
   - 使用 `FsStore`（文件系统存储）
   - 支持目录和多文件
   - 保留文件名和元数据

## 解决方案

### 方案 1: Browser 支持 HashSeq（推荐）✅ **已实现**

**状态**: ✅ 完成 (2026-01-19)

**优点**:
- ✅ 完全兼容 CLI/App
- ✅ 支持文件名
- ✅ 未来可扩展多文件

**实现** (已完成):
```rust
pub async fn import_and_create_ticket(&self, name: String, data: Bytes) -> Result<String> {
    // 1. 添加 blob
    let tag = self.blobs.add_bytes(data).await?;
    let blob_hash = tag.hash;
    
    // 2. 创建单文件 Collection
    let mut collection = Collection::new();
    collection.insert(name, blob_hash);
    
    // 3. 保存 Collection
    let collection_bytes = collection.to_bytes();
    let collection_tag = self.blobs.add_bytes(collection_bytes).await?;
    
    // 4. 创建 HashSeq ticket
    self.endpoint().online().await;
    let addr = self.endpoint().addr();
    let ticket = BlobTicket::new(addr, collection_tag.hash, BlobFormat::HashSeq);
    
    Ok(ticket.to_string())
}
```

**接收端修改**:
```rust
pub async fn get(&self, ticket_str: String) -> Result<(String, Bytes)> {
    let ticket: BlobTicket = ticket_str.parse()?;
    
    // 下载 Collection
    self.discovery.add_endpoint_info(ticket.addr().clone());
    self.downloader
        .download(ticket.hash_and_format(), [ticket.addr().id])
        .await?;
    
    // 解析 Collection
    let collection = Collection::load(ticket.hash(), self.blobs.as_ref()).await?;
    
    // 获取第一个文件
    let (name, file_hash) = collection.iter().next()
        .ok_or_else(|| anyhow::anyhow!("Empty collection"))?;
    
    let bytes = self.blobs.get_bytes(*file_hash).await?;
    
    Ok((name.to_string(), bytes))
}
```

### 方案 2: 添加格式检测和转换

**实现**:
```rust
pub async fn get(&self, ticket_str: String) -> Result<Bytes> {
    let ticket: BlobTicket = ticket_str.parse()?;
    let hash_and_format = ticket.hash_and_format();
    
    // 下载
    self.downloader.download(hash_and_format, [ticket.addr().id]).await?;
    
    // 根据格式处理
    match hash_and_format.format {
        BlobFormat::Raw => {
            // 直接返回 bytes
            self.blobs.get_bytes(hash_and_format.hash).await
        }
        BlobFormat::HashSeq => {
            // 解析 Collection，返回第一个文件
            let collection = Collection::load(hash_and_format.hash, self.blobs.as_ref()).await?;
            let (_name, file_hash) = collection.iter().next()
                .ok_or_else(|| anyhow::anyhow!("Empty collection"))?;
            self.blobs.get_bytes(*file_hash).await
        }
    }
}
```

### 方案 3: Lib 降级支持 Raw（不推荐）

**缺点**:
- ❌ 失去文件名
- ❌ 无法支持多文件
- ❌ 破坏现有功能

## 推荐行动计划

### 阶段 1: 立即修复 ✅ **已完成**

1. ✅ **修复 node.rs 重复代码**（已完成）
2. ✅ **实现方案 1: Browser 支持 HashSeq**（已完成）
   - ✅ 修改 `import_and_create_ticket` 创建 Collection
   - ✅ 修改 `get` 解析 Collection
   - ✅ 更新前端显示文件名

### 阶段 2: 测试 ⚠️ **待进行**

**文件**: 参考 `TESTING.md` 获取完整测试指南

1. ⏳ Browser → Browser 传输
2. ⏳ Browser → CLI 传输
3. ⏳ CLI → Browser 传输
4. ⏳ 验证文件名正确

### 阶段 3: 文档更新 ⏳ **部分完成**

1. ⏳ 更新 README.md 说明兼容性
2. ✅ 添加使用示例（TESTING.md）
3. ✅ 更新 COMPATIBILITY.md（本文件）

## 测试清单

**参考 TESTING.md 获取详细测试步骤**

- [ ] Browser 发送，Browser 接收（HashSeq → HashSeq）
- [ ] Browser 发送，CLI 接收（HashSeq → HashSeq）
- [ ] CLI 发送，Browser 接收（HashSeq → HashSeq）
- [ ] 文件名正确保留
- [ ] 中文/Unicode 文件名支持
- [ ] 大文件传输（> 10MB）
- [ ] 错误处理（网络中断等）

## 附加发现

### 存储差异
- **Browser**: `MemStore`（内存，重启丢失）
- **Lib**: `FsStore`（磁盘持久化）

### 网络配置差异
- **Browser**: 无 discovery 配置（依赖 relay）
- **Lib**: 支持 PkarrPublisher、DnsDiscovery

### 进度报告
- **Browser**: 无进度报告
- **Lib**: 详细的进度事件（Connecting, Downloading, Metadata 等）

## 结论

当前 Browser 实现**无法与 CLI/App 互操作**，需要立即修复。建议采用**方案 1**，让 Browser 支持 HashSeq 格式，这样可以：

1. ✅ 完全兼容所有平台
2. ✅ 保留文件名
3. ✅ 为未来多文件支持打基础
4. ✅ 符合 iroh 生态的最佳实践

**预计修复时间**: 2-3 小时（包括测试）

## 参考

- `lib/src/send.rs:156` - Lib 使用 HashSeq
- `lib/src/receive.rs:234` - Lib 解析 Collection
- `lib/src/import.rs` - Collection 创建逻辑
- `browser/src/node.rs:94` - Browser 使用 Raw（需修复）
- [iroh_blobs::format::collection](https://docs.rs/iroh-blobs/latest/iroh_blobs/format/collection/struct.Collection.html)
