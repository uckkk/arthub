# Conveyor 集成说明

本项目使用 Hydraulic Conveyor 为 Windows 生成 MSIX 安装包，提供 Windows 11 原生卡片式安装界面。

## 配置说明

### 1. Conveyor 配置文件 (`conveyor.conf`)

配置文件位于项目根目录，定义了：
- 应用元数据（名称、版本、描述）
- Windows MSIX 打包配置
- 输入文件路径（Tauri 构建的二进制文件）

### 2. 构建流程

**Windows 构建：**
1. Tauri 构建应用（`--bundles none`，跳过 NSIS 打包）
2. 上传构建产物到 GitHub Actions artifacts
3. 单独的 `package-windows` job 在 Linux runner 上运行 Conveyor
4. Conveyor 生成 MSIX 包和安装程序

**macOS 构建：**
- 继续使用 Tauri 原生的 DMG 打包（不受影响）

## Windows 11 原生界面

Conveyor 生成的 MSIX 包使用 Windows 原生的 AppInstaller 界面，特点：
- ✅ 圆角卡片式设计
- ✅ Fluent Design 阴影效果
- ✅ 应用图标大图显示
- ✅ 深色/浅色主题自动适配
- ✅ 符合 Windows 11 设计规范

## 许可证

Conveyor 对开源项目免费使用，需要在配置中设置 `vcs-url`。

## 本地测试

如果需要本地测试 Conveyor：

1. 安装 Conveyor：
   ```bash
   # 下载并安装 Conveyor
   # 参考：https://conveyor.hydraulic.dev/2/download-conveyor/
   ```

2. 构建 Tauri 应用（跳过 bundler）：
   ```bash
   cd src-tauri
   cargo tauri build --bundles none --target x86_64-pc-windows-msvc
   ```

3. 运行 Conveyor：
   ```bash
   conveyor make site
   ```

## GitHub Actions

工作流会自动：
1. 在 Windows runner 上构建 Tauri 应用
2. 在 Linux runner 上使用 Conveyor 打包 MSIX
3. 上传 MSIX 和安装程序到 artifacts
