# 掼蛋ArtHub - macOS 打包说明

## ⚠️ macOS 下提示「无法打开」或「已损坏」的解决办法

应用未经过 Apple 官方签名时，首次打开可能被系统拦截。任选其一即可：

### 方法一：终端一键修复（推荐）

在终端执行（把路径换成你的 .app 实际路径）：

```bash
# 若已拖到「应用程序」文件夹：
xattr -cr /Applications/ArtHub.app
```

或使用项目自带脚本（先给执行权限）：

```bash
chmod +x scripts/fix-mac-app-open.sh
./scripts/fix-mac-app-open.sh /Applications/ArtHub.app
```

然后再次双击打开应用。

### 方法二：系统设置里允许

1. 打开 **系统设置**（或「系统偏好设置」）→ **隐私与安全性**
2. 在 **安全性** 区域，若看到「ArtHub 无法打开」等提示，点击 **仍要打开**
3. 在弹窗中再次点击 **打开**

### 方法三：右键打开

**右键点击** 应用图标 → 选择 **打开** → 在弹窗中确认 **打开**，之后即可正常双击启动。

---

## 方式一：在 Mac 上直接打包（推荐）

### 步骤

1. **将整个项目文件夹复制到 Mac 电脑**
   - 可以使用 U盘、网盘、或 AirDrop

2. **打开终端（Terminal）**
   - 按 `Command + 空格`，搜索 "终端" 或 "Terminal"

3. **进入项目目录**
   ```bash
   cd /path/to/arthub
   ```

4. **给脚本添加执行权限**
   ```bash
   chmod +x build-mac.sh
   ```

5. **运行打包脚本**
   ```bash
   ./build-mac.sh
   ```

6. **等待打包完成**
   - 首次运行可能需要安装 Rust 和 Tauri CLI
   - 整个过程约需 5-10 分钟

7. **获取打包文件**
   - DMG 安装包: `src-tauri/target/release/bundle/dmg/`
   - App 应用: `src-tauri/target/release/bundle/macos/`

### 安装到 Mac

- **方式 A**: 双击 `.dmg` 文件，将应用拖到「应用程序」文件夹
- **方式 B**: 直接复制 `.app` 文件到「应用程序」文件夹

### 首次运行若提示「无法打开」

请直接看本文档开头的 **「macOS 下提示无法打开」的解决办法**，用终端执行 `xattr -cr` 或按系统提示点击「仍要打开」即可。

---

## 方式二：使用 GitHub Actions 自动构建

如果你的项目托管在 GitHub 上，可以使用自动化构建。

### 步骤

1. **将项目推送到 GitHub**
   ```bash
   git add .
   git commit -m "准备打包"
   git push origin main
   ```

2. **触发构建**
   - 方式 A：创建一个版本标签
     ```bash
     git tag v1.0.0
     git push origin v1.0.0
     ```
   - 方式 B：在 GitHub 仓库页面，点击 Actions → Build macOS → Run workflow

3. **下载构建产物**
   - 等待 Actions 完成后，在 Artifacts 区域下载 `.dmg` 或 `.app` 文件

---

## 常见问题

### Q: 打包时报错 "未找到 Xcode Command Line Tools"
```bash
xcode-select --install
```

### Q: 打包时报错 "cargo not found"
需要安装 Rust：
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### Q: 应用无法打开，提示「无法打开」或「已损坏」
在终端运行（路径按实际 .app 位置修改）：
```bash
xattr -cr /Applications/ArtHub.app
```
或运行脚本：`./scripts/fix-mac-app-open.sh /Applications/ArtHub.app`（需先 `chmod +x scripts/fix-mac-app-open.sh`）

### Q: 想要给应用签名
需要购买 Apple Developer 账号（每年 $99），然后使用 `tauri.conf.json` 配置签名信息。

---

## 文件结构

```
打包后的文件位置:
src-tauri/target/release/bundle/
├── dmg/
│   └── ArtHub_x.x.x_aarch64.dmg  (或 x64)
└── macos/
    └── ArtHub.app
```

---

## 技术要求

- **macOS**: 10.15 (Catalina) 或更高版本
- **Node.js**: 18+ 
- **Rust**: 最新稳定版
- **磁盘空间**: 约 2GB（用于编译）
