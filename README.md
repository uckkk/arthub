<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ArtHub - 游戏美术工作台

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

游戏美术资产命名规范和路径管理工具，支持 AI 翻译和多种项目预设。

## 🚀 快速开始

### 开发模式

**Prerequisites:** Node.js 20+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the app:
   ```bash
   npm run dev
   ```

### 生成分发版本

运行以下命令生成加密后的分发版本：

```bash
npm run dist
```

或者双击运行 `生成分发版本.bat`

生成完成后，会在根目录创建 `ArtHub` 文件夹，包含：
- `开工.html` - 主文件，双击即可使用
- `index.html` - 备用文件
- `README.txt` - 使用说明

## 📦 分发给其他同事

1. 运行 `npm run dist` 或双击 `生成分发版本.bat` 生成分发版本
2. 将 `ArtHub` 文件夹打包分发给同事
3. 同事收到后，直接双击 `开工.html` 即可使用（无需安装任何依赖）

## ⚙️ 配置 API

首次使用需要在右下角设置中配置：
- **Google Gemini API**（推荐）
- **百度翻译 API**（备选）

## 📝 功能特性

- ✅ 资产命名规范工具（支持多种项目预设）
- ✅ 智能中文翻译（AI 自动翻译为英文）
- ✅ 路径管理器（本地/网络/网页路径）
- ✅ 可直接打开使用（无需服务器）
- ✅ 数据本地存储

## 🔧 系统要求

- Windows 7 或更高版本
- Node.js 16+（安装脚本会自动检测）
