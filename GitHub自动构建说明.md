# 掼蛋ArtHub - GitHub Actions 自动构建指南

## 一键构建 Windows + macOS + Web 全平台应用

---

## 📦 第一次使用

### 步骤 1：创建 GitHub 仓库

1. 登录 [GitHub](https://github.com)
2. 点击右上角 **+** → **New repository**
3. 填写仓库名称（如 `arthub`）
4. 选择 **Private**（私有）或 **Public**（公开）
5. 点击 **Create repository**

### 步骤 2：推送代码

在项目目录打开终端（PowerShell），执行：

```bash
# 初始化 Git（如果还没有）
git init

# 添加所有文件
git add .

# 提交
git commit -m "Initial commit"

# 添加远程仓库（替换成你的仓库地址）
git remote add origin https://github.com/你的用户名/arthub.git

# 推送
git push -u origin main
```

### 步骤 3：触发构建

**方式 A：手动触发（推荐新手）**
1. 打开你的 GitHub 仓库
2. 点击 **Actions** 标签
3. 左侧选择 **Build**
4. 点击 **Run workflow** → **Run workflow**

**方式 B：打标签自动触发**
```bash
git tag v1.0.0
git push origin v1.0.0
```

### 步骤 4：下载构建产物

1. 等待构建完成（约 10-15 分钟）
2. 在 **Actions** 页面点击完成的构建
3. 滚动到底部 **Artifacts** 区域
4. 下载你需要的文件：
   - `ArtHub-Web` - **网页版**（可部署到任何服务器）
   - `ArtHub-Windows-MSI` - Windows 安装包
   - `ArtHub-Windows-EXE` - Windows 便携版
   - `ArtHub-macOS-Intel-DMG` - Intel Mac 安装包
   - `ArtHub-macOS-ARM-DMG` - Apple Silicon Mac 安装包

---

## 🔄 日常使用

### 更新代码后重新构建

```bash
# 修改代码后...
git add .
git commit -m "更新功能"
git push

# 然后去 GitHub Actions 手动触发构建
# 或者打一个新版本号的标签自动触发
git tag v1.0.1
git push origin v1.0.1
```

---

## ⚙️ 配置说明

### 构建内容

| 平台 | 架构 | 输出文件 | 说明 |
|------|------|----------|------|
| **Web** | 通用 | `.zip` 压缩包 | 解压后部署到任意 Web 服务器 |
| Windows | x64 | `.msi` 安装包, `.exe` 安装程序 | 桌面应用 |
| macOS | Intel (x64) | `.dmg` 安装包, `.app` 应用 | 桌面应用 |
| macOS | Apple Silicon (ARM) | `.dmg` 安装包, `.app` 应用 | 桌面应用 |

### Web 版本部署

下载 `ArtHub-Web.zip` 后：

```bash
# 解压
unzip ArtHub-Web.zip -d arthub-web

# 方式1：使用 Python 快速启动本地服务器
cd arthub-web
python -m http.server 8080
# 访问 http://localhost:8080

# 方式2：部署到任意 Web 服务器
# 将 arthub-web 文件夹内容上传到服务器即可
```

支持部署到：GitHub Pages、Vercel、Netlify、阿里云 OSS、腾讯云 COS 等

### 自动发布

当你推送版本标签（如 `v1.0.0`）时，构建完成后会自动创建 GitHub Release 草稿，包含所有安装包。

---

## ❓ 常见问题

### Q: 构建失败怎么办？
1. 点击失败的构建查看日志
2. 常见原因：
   - 代码有语法错误
   - `package.json` 或 `Cargo.toml` 配置问题
   - 依赖安装失败

### Q: 可以只构建某一个平台吗？
可以修改 `.github/workflows/build.yml` 中的 `matrix` 部分，注释掉不需要的平台。

### Q: 构建时间太长？
- 首次构建约 15-20 分钟（需要编译 Rust）
- 后续构建会快一些（有缓存）

### Q: 私有仓库有限制吗？
GitHub 免费账户私有仓库每月有 2000 分钟的 Actions 额度，一般够用。

---

## 📁 相关文件

- `.github/workflows/build.yml` - 构建配置
- `.gitignore` - Git 忽略规则
- `build-mac.sh` - Mac 本地构建脚本（备用）
