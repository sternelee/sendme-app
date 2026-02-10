# Android Content URI 文件名保留方案

## 问题背景

在 Android 平台上，文件选择器返回的是 `content://` URI 而不是直接的文件路径。之前的实现使用通用的临时文件名：

```
sendme-content-{timestamp}-{uuid}.bin
```

这导致接收方无法获知原始文件名和扩展名，影响用户体验。

## 解决方案

### 技术实现

通过 JNI（Java Native Interface）调用 Android 的 `ContentResolver` API 来查询文件的元数据，获取真实的文件名。

### 实现细节

#### 1. 文件名查询函数 (lib.rs:26-138)

```rust
#[cfg(target_os = "android")]
fn get_filename_from_content_uri(uri: &str) -> Result<String, String>
```

**功能：**
- 通过 JNI 获取 JavaVM 和 JNIEnv
- 解析 content URI 为 Android Uri 对象
- 获取 ContentResolver
- 查询 `_display_name` 列获取文件名
- 返回原始文件名

**Android API 调用链：**
```
Uri.parse(uri) 
  → Context.getContentResolver() 
  → ContentResolver.query(uri, ["_display_name"], ...) 
  → Cursor.getString(columnIndex)
```

#### 2. 修改后的 handle_content_uri 函数 (lib.rs:145-242)

**文件名处理策略：**

1. **成功获取原始文件名**
   - 清理文件名中的非法字符（`/`, `\`, `\0` → `_`）
   - 保留原始扩展名
   - 添加 8 位 UUID 后缀防止冲突
   - 格式：`{original_name}-{uuid}.{ext}` 或 `{original_name}-{uuid}`

2. **获取到空文件名**
   - 使用时间戳和 UUID 作为备用方案
   - 格式：`sendme-content-{timestamp}-{uuid}.bin`

3. **查询失败**
   - 记录警告日志
   - 使用与空文件名相同的备用方案

### 文件名示例

| 原始文件名 | 临时文件名 |
|-----------|-----------|
| `photo.jpg` | `photo-a1b2c3d4.jpg` |
| `document.pdf` | `document-e5f6g7h8.pdf` |
| `My Video.mp4` | `My Video-i9j0k1l2.mp4` |
| `report-2024.xlsx` | `report-2024-m3n4o5p6.xlsx` |
| (查询失败) | `sendme-content-1736395200-q7r8s9t0.bin` |

## 安全考虑

1. **路径遍历防护**
   - 替换 `/`, `\`, `\0` 为下划线
   - 确保文件名不会逃出临时目录

2. **文件名冲突**
   - 添加 UUID 后缀确保唯一性
   - 即使同名文件也不会覆盖

3. **错误处理**
   - JNI 调用失败时使用备用方案
   - 不会因为文件名查询失败而中断传输

## 平台兼容性

- ✅ **Android**: 完整支持，通过 JNI 查询 ContentResolver
- ✅ **iOS/Desktop**: 直接使用文件路径，无需特殊处理
- ✅ **跨平台**: 使用条件编译 `#[cfg(target_os = "android")]`

## 日志输出

实现中添加了详细的日志记录：

```rust
tracing::info!("Retrieved original filename from content URI: {}", name);
tracing::warn!("Retrieved empty filename, using fallback");
tracing::warn!("Failed to get filename from content URI: {}, using fallback", e);
tracing::info!("Copied content URI to temporary file: {:?}", temp_file_path);
```

可以通过这些日志追踪文件名获取过程和问题诊断。

## 用户体验改进

### 之前
```
发送：family-photo.jpg
接收：sendme-content-1736395200-a1b2c3d4.bin ❌
```

### 之后
```
发送：family-photo.jpg
接收：family-photo-a1b2c3d4.jpg ✅
```

接收方现在可以：
- 看到原始文件名
- 识别文件类型（通过扩展名）
- 无需手动重命名即可使用文件
- 文件关联自动工作（如在文件管理器中双击打开）

## 测试建议

在 Android 设备上测试以下场景：

1. ✅ 选择常见文件类型（图片、文档、视频）
2. ✅ 选择包含特殊字符的文件名
3. ✅ 选择不同来源的文件（相册、下载、云存储）
4. ✅ 验证接收端显示的文件名正确
5. ✅ 确认传输后文件可正常打开

## 代码位置

- **主要实现**: `app/src-tauri/src/lib.rs`
  - `get_filename_from_content_uri()`: 第 26-138 行
  - `handle_content_uri()`: 第 145-242 行

## 依赖项

```toml
[target.'cfg(target_os = "android")'.dependencies]
jni = "0.21"
ndk-context = "0.1"
```

这些依赖已经在项目中配置，无需额外添加。
