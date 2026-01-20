# ComfyUI 日志说明

## 📋 常见日志分析

当您使用 ArtHub 与 ComfyUI 交互时，浏览器控制台可能会显示一些日志。这些日志大多数是 **ComfyUI 内部的**，不是 ArtHub 的问题。

### ✅ 正常日志（可忽略）

以下日志是 ComfyUI 的正常行为，可以安全忽略：

#### 1. 404 错误（资源未找到）

```
Failed to load resource: the server responded with a status of 404
- user.css
- favicon.ico
- /api/userdata?dir=subgraphs...
- /api/userdata/comfy.templates.json
- /api/pysssss/autocomplete
```

**原因**：这些是 ComfyUI 的可选资源或扩展 API，不存在时返回 404 是正常的。

**处理**：无需处理，不影响功能。

#### 2. Deprecated 警告

```
[ComfyUI Deprecated] Importing from "scripts/ui.js" is deprecated...
[ComfyUI Notice] "scripts/widgets.js" is an internal module...
```

**原因**：ComfyUI 或其扩展使用了即将废弃的 API。

**处理**：这是 ComfyUI 或其扩展的问题，等待更新即可。

#### 3. Extension 禁用消息

```
Extension pysssss.SnapToGrid is disabled.
Extension pysssss.FaviconStatus is disabled.
```

**原因**：某些 ComfyUI 扩展被禁用。

**处理**：这是正常的，不影响 ArtHub 功能。

#### 4. HTTPS 警告

```
The file at 'http://...' was loaded over an insecure connection.
```

**原因**：ComfyUI 通过 HTTP 加载资源（本地开发环境常见）。

**处理**：本地开发环境可以忽略。生产环境建议使用 HTTPS。

#### 5. ExecutableNodeDTO 类型错误

```
[ExecutableNodeDTO.resolveOutput] No input types match type [IMAGE]...
```

**原因**：ComfyUI 节点类型匹配问题，通常是工作流配置问题。

**处理**：检查 ComfyUI 工作流配置，确保节点连接正确。

### ⚠️ ArtHub 相关日志

ArtHub 会输出以下日志，这些是正常的：

```
[ArtHub] 当前版本号: 1.0.202601200304
[appService] Launching app: ...
[appService] App launched successfully via Rust backend
[AppLauncher] App launched successfully
```

### 🔧 如何减少日志噪音

如果您想减少控制台日志：

1. **过滤日志**：在浏览器控制台中使用过滤器
   - Chrome/Edge: 输入 `-404` 过滤掉 404 错误
   - 或使用 `-[ComfyUI]` 过滤 ComfyUI 日志

2. **调整日志级别**：
   - 在控制台设置中，将日志级别设置为 `Warnings` 或 `Errors`
   - 这样只会显示警告和错误，忽略信息日志

3. **使用生产构建**：
   - 生产构建会减少调试日志输出

### 📝 总结

- ✅ **404 错误**：ComfyUI 的可选资源，正常
- ✅ **Deprecated 警告**：ComfyUI 内部问题，不影响使用
- ✅ **Extension 消息**：扩展状态信息，正常
- ✅ **HTTPS 警告**：本地开发环境常见，可忽略
- ✅ **类型错误**：工作流配置问题，检查 ComfyUI 工作流

**这些日志都不会影响 ArtHub 的正常功能！** 🎉
