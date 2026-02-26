# DirectML.dll 嵌入说明

## 功能说明

此功能可以将 `DirectML.dll` 嵌入到 `.exe` 主程序中，使得应用只需要一个单独的 exe 文件即可运行，无需额外的 DLL 文件。

## 工作原理

1. **构建时** (`build.rs`)：
   - 自动查找 `DirectML.dll`（由 `ort` crate 下载）
   - 将 DLL 内容编译进二进制文件
   - 生成嵌入代码

2. **运行时** (`main.rs`)：
   - 程序启动时检查 exe 目录是否存在 `DirectML.dll`
   - 如果不存在，从嵌入的资源中提取 DLL 到 exe 同目录
   - ONNX Runtime 可以正常加载 DLL

## 使用方法

### 自动模式（推荐）

1. 正常构建应用：
   ```bash
   cargo tauri build
   ```

2. `build.rs` 会自动：
   - 查找 `DirectML.dll`（通常在 `target` 目录）
   - 如果找到，自动嵌入到 exe 中
   - 如果未找到，会显示警告，但不会阻止构建

3. 构建完成后，`DirectML.dll` 会被嵌入到 exe 中

### 手动模式

如果自动查找失败，可以手动指定 DLL 位置：

1. 找到 `DirectML.dll`（通常在构建后的 `target` 目录）
2. 将其复制到 `src-tauri/resources/` 目录
3. 修改 `src-tauri/src/embedded_resources.rs`，取消注释：
   ```rust
   pub const DIRECTML_DLL: &[u8] = include_bytes!("../../resources/DirectML.dll");
   ```

## 注意事项

1. **文件大小**：嵌入 DLL 会增加 exe 文件大小（DirectML.dll 约 1-2 MB）

2. **首次运行**：首次运行时会在 exe 目录提取 DLL，之后会复用已提取的文件

3. **权限问题**：如果 exe 目录不可写，提取会失败，但不会阻止应用启动（如果 DLL 已存在）

4. **性能影响**：提取 DLL 的时间很短（< 100ms），对启动速度影响可忽略

## 验证

构建后检查：
- exe 文件大小应该明显增加（包含嵌入的 DLL）
- 运行应用后，exe 目录应该出现 `DirectML.dll` 文件
- 应用日志中应该看到 `[DLL Extract]` 相关信息

## 故障排除

如果 DLL 未正确嵌入：

1. 检查构建日志中是否有 `已找到并准备嵌入 DirectML.dll` 的提示
2. 确认 `ort` crate 的 `download-binaries` 特性已启用
3. 检查 `target` 目录中是否存在 `DirectML.dll`
4. 查看 `target/*/out/embedded_directml.rs` 文件是否生成
