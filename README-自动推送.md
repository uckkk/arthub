# 🚀 自动推送和构建通知功能

## ✨ 功能说明

已配置 Git post-commit hook，每次提交代码后会自动：
1. ✅ 推送到 GitHub
2. 🔔 **仅在推送成功后显示 Windows 通知**（Toast 通知或消息框）
3. 📦 显示 GitHub Actions 构建链接
4. 📋 提示构建操作步骤
5. 🌐 （可选）自动打开浏览器或通过通知直接跳转

## ⚠️ 重要原则

**通知只在代码成功推送到 GitHub 后才会显示**

- ✅ 推送成功 → 显示通知
- ❌ 推送失败 → **不显示通知**，只显示错误信息

这样可以确保您只在代码真正推送到 GitHub 后才收到通知，避免误报。

## 🎯 使用方法

### 正常提交代码

```bash
# 1. 修改代码后
git add .

# 2. 提交（会自动推送并提示构建）
git commit -m "你的提交信息"
```

提交后会自动执行推送，成功后您会：

1. **收到 Windows 推送成功通知** 🔔
   - Windows 10/11：显示 Toast 通知（右上角弹出）
   - 旧版 Windows：显示消息框
   - 通知中包含分支信息和构建链接
   - 点击通知中的"查看构建"按钮可直接跳转

2. **在控制台看到提示**：
```
========================================
  自动推送到 GitHub
========================================
分支: main

✓ 代码已成功推送到 GitHub!

========================================
  📦 请前往 GitHub Actions 构建
========================================

构建链接: https://github.com/uckkk/arthub/actions

操作步骤:
  1. 点击上方链接打开 GitHub Actions
  2. 点击左侧 'Build' 工作流
  3. 点击 'Run workflow' 按钮
  4. 选择分支: main
  5. 点击 'Run workflow' 开始构建

提示: 也可以使用以下命令打标签自动触发构建:
  git tag v1.0.X
  git push origin v1.0.X
```

## 🔧 配置检查

运行以下命令检查配置：

```bash
npm run setup-auto-push
```

## 📝 工作流程

```
修改代码
   ↓
git add .
   ↓
git commit -m "提交信息"
   ↓
[自动] 推送到 GitHub
   ↓
[显示] 构建链接和操作步骤
   ↓
[手动] 前往 GitHub Actions 触发构建
   ↓
[自动] GitHub Actions 构建应用
```

## 🎨 自动触发构建（可选）

如果您希望推送后自动触发构建，有两种方式：

### 方式 1：打标签触发（推荐）

```bash
git tag v1.0.2
git push origin v1.0.2
# 这会自动触发 GitHub Actions 构建
```

### 方式 2：修改工作流配置

编辑 `.github/workflows/build.yml`，添加 `push` 触发器：

```yaml
on:
  push:
    branches: [ main ]
  workflow_dispatch:
```

⚠️ **注意**：方式 2 会导致每次推送都触发构建，可能消耗更多 GitHub Actions 额度。

## 🛠️ 故障排除

### 推送失败

如果推送失败，会显示错误信息。常见原因：
- 网络连接问题
- GitHub 认证问题
- 分支冲突

解决方法：
```bash
# 手动推送
git push origin main
```

### Hook 不工作

检查 hook 文件是否存在：
```bash
# Windows PowerShell
Test-Path .git\hooks\post-commit

# 如果不存在，重新设置
npm run setup-auto-push
```

### 禁用自动推送

临时禁用：
```bash
# Windows PowerShell
Rename-Item .git\hooks\post-commit .git\hooks\post-commit.disabled

# 恢复
Rename-Item .git\hooks\post-commit.disabled .git\hooks\post-commit
```

## 📚 相关文件

- `.git/hooks/post-commit` - Git hook 脚本（自动推送和通知）
- `scripts/notify-push-success.ps1` - Windows 推送成功通知脚本
- `scripts/setup-auto-push.ps1` - 设置脚本
- `scripts/auto-push-and-notify.ps1` - PowerShell 版本（备用）
- `auto-push-setup.md` - 详细说明文档

## 💡 提示

- 每次提交后都会自动推送，无需手动执行 `git push`
- 推送成功后会显示构建链接，方便快速访问
- 建议使用标签触发构建，避免频繁构建消耗额度
- 如果不想自动打开浏览器，可以在 hook 中注释掉相关代码
