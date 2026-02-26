# DirectML.dll 嵌入到 EXE 的说明

## 功能说明

此功能可以将 `DirectML.dll` 嵌入到 `.exe` 主程序中，使得应用只需要一个单独的 exe 文件即可运行，无需额外的 DLL 文件。

## 工作原理

1. **构建时** (`build.rs`):
   - 自动查找由 `ort` crate 下载的 `DirectML.dll`
   - 如果找到，将 DLL 内容编译进二进制文件
   - 生成嵌入代码到 `OUT_DIR/embedded_directml.rs`

2. **运行时** (`main.rs`):
   - 程序启动时检查 `DirectML.dll` 是否存在于 exe 同目录
   - 如果不存在，从嵌入的资源中提取 DLL 到 exe 同目录
   - 这样 ONNX Runtime 就能正常加载 DirectML.dll

## 使用方法

### 自动模式（推荐）

1. **首次构建**：
   ```bash
   cd src-tauri
   cargo build --release
   ```
   
   构建脚本会自动查找 `DirectML.dll` 并准备嵌入。

2. **验证嵌入**：
   - 查看构建输出，如果看到 `已找到并准备嵌入 DirectML.dll`，说明 DLL 已找到
   - 如果看到 `未找到 DirectML.dll`，需要手动处理（见下方）

3. **运行应用**：
   - 首次运行时会自动提取 DLL 到 exe 同目录
   - 后续运行会检测到 DLL 已存在，跳过提取

### 手动模式

如果自动查找失败，可以手动操作：

1. **找到 DirectML.dll**：
   - 通常位于 `target/x86_64-pc-windows-msvc/release/` 目录
   - 或 `target/release/` 目录

2. **复制到 resources 目录**：
   ```bash
   mkdir -p src-tauri/resources
   copy target\release\DirectML.dll src-tauri\resources\DirectML.dll
   ```

3. **修改 `embedded_resources.rs`**：
   取消注释以下行：
   ```rust
   pub const DIRECTML_DLL: &[u8] = include_bytes!("../../resources/DirectML.dll");
   ```
   并注释掉临时占位符。

## 注意事项

1. **文件大小**：嵌入 DLL 会增加 exe 文件大小（DirectML.dll 约 1-2 MB）

2. **首次运行**：首次运行时需要提取 DLL，可能会有短暂延迟

3. **权限问题**：如果 exe 所在目录没有写权限，提取可能会失败，但不会阻止应用启动（会尝试使用外部 DLL）

4. **安全考虑**：提取的 DLL 文件会保留在 exe 同目录，不会自动删除

## 故障排除

### 问题：构建时未找到 DirectML.dll

**解决方案**：
1. 确保 `Cargo.toml` 中启用了 `ort` 的 `download-binaries` 特性
2. 先运行一次 `cargo build`，让 ort crate 下载 DLL
3. 检查 `target` 目录下是否有 `DirectML.dll`

### 问题：运行时提取失败

**解决方案**：
1. 检查 exe 所在目录是否有写权限
2. 查看控制台输出的错误信息
3. 手动将 `DirectML.dll` 复制到 exe 同目录

### 问题：应用启动后 ONNX Runtime 报错

**解决方案**：
1. 确认 `DirectML.dll` 存在于 exe 同目录
2. 检查 DLL 版本是否与 ort crate 版本匹配
3. 查看应用日志中的 DLL 提取信息

## 技术细节

- **嵌入方式**：使用 Rust 的 `include_bytes!` 宏或构建时生成的常量数组
- **提取位置**：exe 文件所在目录
- **提取时机**：应用启动时的 `setup` 回调中
- **兼容性**：仅 Windows 平台，其他平台自动跳过
