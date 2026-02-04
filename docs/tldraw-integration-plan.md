# tldraw 无限画布集成实施方案

## 一、实施步骤

### 阶段 1：基础集成（MVP）

#### 1.1 安装依赖
```bash
npm i tldraw
```

#### 1.2 创建 Whiteboard 组件
创建 `components/Whiteboard.tsx`，实现基础画布功能。

#### 1.3 集成到菜单
在 `App.tsx` 中添加菜单项，使用懒加载。

#### 1.4 文件处理
- 实现文件拖拽上传
- 使用 Tauri API 处理本地文件路径
- 支持图片和 MP4 视频

### 阶段 2：功能完善

#### 2.1 数据持久化
- 使用 IndexedDB 存储画布数据
- 实现自动保存
- 支持导入/导出

#### 2.2 性能优化
- 代码分割
- 懒加载
- 资源压缩

#### 2.3 用户体验
- 快捷键支持
- 工具栏自定义
- 主题适配

## 二、关键技术点

### 1. Tauri 文件路径处理

**问题**：tldraw 需要 URL 或 Blob，但 Tauri 提供的是文件路径。

**解决方案**：
```typescript
import { convertFileSrc } from '@tauri-apps/api/tauri';

// 转换文件路径为可访问的 URL
const fileUrl = convertFileSrc(filePath);
```

### 2. 文件上传处理

**拖拽文件到画布**：
```typescript
const handleDrop = async (e: React.DragEvent) => {
  const files = e.dataTransfer.files;
  for (const file of files) {
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      // 处理图片或视频
      const url = URL.createObjectURL(file);
      // 添加到画布
    }
  }
};
```

### 3. 数据存储

**使用 IndexedDB**：
```typescript
import { openDB } from 'idb';

const db = await openDB('tldraw-db', 1, {
  upgrade(db) {
    db.createObjectStore('canvases');
  }
});

// 保存画布数据
await db.put('canvases', canvasData, canvasId);

// 加载画布数据
const canvasData = await db.get('canvases', canvasId);
```

## 三、潜在问题及解决方案

### 问题 1：包大小
**影响**：11.4 MB 未压缩，可能影响应用体积

**解决方案**：
- 使用懒加载（只在需要时加载）
- 代码分割（单独打包）
- 压缩优化

### 问题 2：文件路径
**影响**：Tauri 文件路径需要转换

**解决方案**：
- 使用 `convertFileSrc` API
- 对于大文件，考虑复制到临时目录

### 问题 3：性能
**影响**：大量元素可能影响性能

**解决方案**：
- tldraw 内置虚拟化
- 限制同时加载的资源
- 优化图片/视频尺寸

### 问题 4：许可证
**影响**：免费使用需保留水印

**解决方案**：
- 接受水印（免费）
- 或购买商业许可证移除水印

## 四、实施建议

### 推荐方案：渐进式集成

1. **第一步**：创建基础 Whiteboard 组件（只读/基础绘制）
2. **第二步**：添加图片支持
3. **第三步**：添加视频支持
4. **第四步**：完善数据持久化
5. **第五步**：优化性能

### 代码结构建议

```
components/
  Whiteboard/
    index.tsx           # 主组件
    WhiteboardCanvas.tsx # tldraw 画布组件
    FileUploader.tsx    # 文件上传处理
    StorageService.ts   # 数据存储服务
```

## 五、测试计划

1. **功能测试**：
   - 基础绘制功能
   - 图片上传和显示
   - 视频上传和播放
   - 数据保存和加载

2. **性能测试**：
   - 大量元素性能
   - 大文件处理
   - 内存占用

3. **兼容性测试**：
   - Windows/Mac 平台
   - 不同文件格式
   - 不同文件大小

## 六、风险评估

| 风险 | 等级 | 影响 | 缓解措施 |
|------|------|------|----------|
| 包大小增加 | 中 | 应用体积增大 | 懒加载、代码分割 |
| 文件路径处理 | 低 | 需要额外开发 | 使用 Tauri API |
| 性能问题 | 中 | 可能影响体验 | 优化、限制资源 |
| 许可证限制 | 低 | 有水印 | 接受或购买许可证 |

## 七、结论

**建议**：✅ **可以集成**

**理由**：
1. 技术可行性高
2. 功能符合需求
3. 风险可控
4. 可以渐进式实施

**下一步**：
1. 创建 MVP 版本
2. 测试基础功能
3. 逐步完善
4. 性能优化
