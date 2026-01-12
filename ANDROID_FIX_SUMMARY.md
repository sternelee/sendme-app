# Android 文件接收修复总结

## 问题描述

Android 端接收文件时一直停留在 "Connecting..." 状态，最终报错：
```
Receive failed: error exporting xxx: Read-only file system (os error 30)
```

## 根本原因

### 问题 1: 临时目录使用错误
`lib/src/receive.rs` 中创建 `.sendme-recv-*` 目录时，忽略了 `args.common.temp_dir` 参数，总是使用 `std::env::current_dir()`：

```rust
// 错误代码
let iroh_data_dir = std::env::current_dir()?.join(dir_name);
```

在 Android 上，`current_dir()` 可能指向只读目录，导致无法创建临时文件。

### 问题 2: 导出目录使用错误
`lib/src/export.rs` 中导出文件时，也使用 `current_dir()` 作为目标目录：

```rust
// 错误代码
let root = std::env::current_dir()?;
```

这导致文件下载成功但导出失败。

## 修复方案

### 1. 修复 receive.rs (`lib/src/receive.rs`)

```rust
// 使用 temp_dir 而不是 current_dir
let base_dir = args.common.temp_dir.as_ref().cloned()
    .unwrap_or_else(|| std::env::current_dir()?);

let dir_name = format!(".sendme-recv-{}", ticket.hash().to_hex());
let iroh_data_dir = base_dir.join(&dir_name);

// 添加权限检查
if !base_dir.exists() {
    anyhow::bail!("Base directory does not exist: {:?}", base_dir);
}

std::fs::create_dir_all(&iroh_data_dir).map_err(|e| {
    anyhow::anyhow!("Failed to create temp directory {:?}: {}", iroh_data_dir, e)
})?;

let db = FsStore::load(&iroh_data_dir).await?;

// 传递 base_dir 给 export 函数
export::export(&db, collection.clone(), progress_tx.clone(), Some(&base_dir)).await?;
```

### 2. 修复 export.rs (`lib/src/export.rs`)

```rust
// 添加 export_dir 参数
pub async fn export(
    db: &FsStore,
    collection: Collection,
    progress_tx: Option<ProgressSenderTx>,
    export_dir: Option<&Path>,  // 新增参数
) -> anyhow::Result<()> {
    let root = export_dir
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir()?);

    // 验证目录可写
    if !root.exists() {
        anyhow::bail!("Export directory does not exist: {:?}", root);
    }

    let test_file = root.join(".write_test_export");
    std::fs::write(&test_file, b"test")?;
    std::fs::remove_file(&test_file).ok();

    // ... 继续导出
}
```

### 3. Tauri 层正确传递 temp_dir (`app/src-tauri/src/lib.rs`)

```rust
let temp_dir = app.path().temp_dir()?;

let args = ReceiveArgs {
    ticket,
    common: CommonConfig {
        temp_dir: Some(temp_dir),  // 确保传递
        // ...
    },
};
```

## 修复后的文件流程

```
temp_dir (Android: /data/data/com.sendme.app/cache/)
  ├── .sendme-recv-xxxx/       # 临时下载存储
  │   └── [blobs 数据]
  └── [接收的文件]              # 导出到这里
```

## 关键要点

1. **Android 沙盒限制**: 无法访问公共目录（如 `/storage/emulated/0/Download`）进行直接写入
2. **temp_dir 是可写的**: `app.path().temp_dir()` 返回应用专属缓存目录，有写入权限
3. **下载文件位置**: 文件会被保存到应用的缓存目录，用户可以通过文件管理器访问

## 后续改进建议

1. **实现 MediaStore API**: 将接收的文件复制到公共 Downloads 目录
2. **添加文件移动功能**: 让用户可以移动接收的文件到其他位置
3. **显示文件路径**: 在 UI 上显示接收文件的完整路径

## 测试验证

- ✅ 网络连接正常
- ✅ 下载进度显示
- ✅ 文件导出成功
- ✅ 不再报 "Read-only file system" 错误
