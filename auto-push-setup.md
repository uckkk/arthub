# 自动推送设置说明

已配置 Git post-commit hook，每次提交后会自动推送到 GitHub，并提示您前往构建。

## 工作原理

当您执行 `git commit` 后，Git 会自动执行 `.git/hooks/post-commit` 脚本，该脚本会：
1. 获取当前分支名
2. 自动执行 `git push origin <分支名>`
3. 推送成功后显示 GitHub Actions 构建链接
4. 提示您前往 GitHub Actions 手动触发构建
5. （可选）自动打开浏览器访问 Actions 页面

## 使用方法

正常提交代码即可，推送会自动执行：

```bash
git add .
git commit -m "你的提交信息"
# 提交后会自动推送到 GitHub，并显示构建提示
```

推送成功后，您会看到类似以下提示：

```
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
```

## 快速设置

运行以下命令进行快速设置和测试：

```bash
npm run setup-auto-push
```

## 注意事项

1. **需要网络连接**：自动推送需要能够访问 GitHub
2. **推送失败处理**：如果推送失败（如网络问题），会显示错误信息，您可以稍后手动执行 `git push`
3. **首次推送**：如果是新分支首次推送，可能需要手动执行 `git push -u origin <分支名>`
4. **构建触发**：推送后需要手动在 GitHub Actions 页面触发构建（或打标签自动触发）

## 自动触发构建（可选）

如果您希望推送后自动触发构建，可以：

1. **打标签触发**（推荐）：
   ```bash
   git tag v1.0.2
   git push origin v1.0.2
   # 这会自动触发 GitHub Actions 构建
   ```

2. **修改工作流配置**：
   编辑 `.github/workflows/build.yml`，添加 `push` 触发器：
   ```yaml
   on:
     push:
       branches: [ main ]
     workflow_dispatch:
   ```

## 禁用自动推送

如果需要临时禁用自动推送，可以：

1. **重命名 hook 文件**：
   ```bash
   mv .git/hooks/post-commit .git/hooks/post-commit.disabled
   ```

2. **恢复自动推送**：
   ```bash
   mv .git/hooks/post-commit.disabled .git/hooks/post-commit
   ```

## 手动推送

即使启用了自动推送，您仍然可以手动执行推送命令：
```bash
git push origin main
```
