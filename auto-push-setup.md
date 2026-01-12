# 自动推送设置说明

已配置 Git post-commit hook，每次提交后会自动推送到 GitHub。

## 工作原理

当您执行 `git commit` 后，Git 会自动执行 `.git/hooks/post-commit` 脚本，该脚本会：
1. 获取当前分支名
2. 自动执行 `git push origin <分支名>`
3. 显示推送结果

## 使用方法

正常提交代码即可，推送会自动执行：

```bash
git add .
git commit -m "你的提交信息"
# 提交后会自动推送到 GitHub
```

## 注意事项

1. **需要网络连接**：自动推送需要能够访问 GitHub
2. **推送失败处理**：如果推送失败（如网络问题），会显示错误信息，您可以稍后手动执行 `git push`
3. **首次推送**：如果是新分支首次推送，可能需要手动执行 `git push -u origin <分支名>`

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
