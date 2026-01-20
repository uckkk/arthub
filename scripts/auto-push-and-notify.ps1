# 自动推送并通知构建脚本
# 在 Git post-commit hook 中调用

param(
    [string]$CommitMessage = ""
)

# 获取当前分支名
$branch = git branch --show-current
if (-not $branch) {
    $branch = git rev-parse --abbrev-ref HEAD
}

if (-not $branch) {
    Write-Host "无法获取分支名，跳过自动推送" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  自动推送到 GitHub" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "分支: $branch" -ForegroundColor Gray
Write-Host ""

# 执行推送
try {
    $pushResult = git push origin $branch 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 代码已成功推送到 GitHub!" -ForegroundColor Green
        Write-Host ""
        
        # 获取远程仓库 URL
        $remoteUrl = git remote get-url origin
        $repoOwner = ""
        $repoName = ""
        
        if ($remoteUrl -match "github\.com[:/]([^/]+)/([^/]+)\.git?") {
            $repoOwner = $matches[1]
            $repoName = $matches[2] -replace '\.git$', ''
        }
        
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  📦 请前往 GitHub Actions 构建" -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        
        if ($repoOwner -and $repoName) {
            $actionsUrl = "https://github.com/$repoOwner/$repoName/actions"
            Write-Host "构建链接: $actionsUrl" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "操作步骤:" -ForegroundColor Yellow
            Write-Host "  1. 点击上方链接打开 GitHub Actions" -ForegroundColor White
            Write-Host "  2. 点击左侧 'Build' 工作流" -ForegroundColor White
            Write-Host "  3. 点击 'Run workflow' 按钮" -ForegroundColor White
            Write-Host "  4. 选择分支: $branch" -ForegroundColor White
            Write-Host "  5. 点击 'Run workflow' 开始构建" -ForegroundColor White
        } else {
            Write-Host "请访问 GitHub 仓库的 Actions 页面手动触发构建" -ForegroundColor White
        }
        
        Write-Host ""
        Write-Host "提示: 也可以使用以下命令打标签自动触发构建:" -ForegroundColor Gray
        Write-Host "  git tag v1.0.X" -ForegroundColor Gray
        Write-Host "  git push origin v1.0.X" -ForegroundColor Gray
        Write-Host ""
        
        # 尝试打开浏览器（可选）
        if ($repoOwner -and $repoName) {
            $actionsUrl = "https://github.com/$repoOwner/$repoName/actions"
            $openBrowser = Read-Host "是否打开浏览器访问 Actions 页面? (Y/N)"
            if ($openBrowser -eq "Y" -or $openBrowser -eq "y") {
                Start-Process $actionsUrl
            }
        }
    } else {
        Write-Host "✗ 推送失败，请检查网络连接或手动执行: git push origin $branch" -ForegroundColor Red
        Write-Host $pushResult -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ 推送过程中发生错误: $_" -ForegroundColor Red
    exit 1
}
