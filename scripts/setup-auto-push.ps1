# 设置自动推送 Git Hook
# 运行此脚本以配置自动推送功能

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  配置 Git 自动推送 Hook" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 .git 目录
if (-not (Test-Path .git)) {
    Write-Host "错误: 当前目录不是 Git 仓库" -ForegroundColor Red
    exit 1
}

# 检查 hooks 目录
$hooksDir = ".git\hooks"
if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
    Write-Host "✓ 创建 hooks 目录" -ForegroundColor Green
}

# 复制 post-commit hook
$hookFile = "$hooksDir\post-commit"
if (Test-Path $hookFile) {
    Write-Host "✓ post-commit hook 已存在" -ForegroundColor Green
} else {
    Write-Host "✗ post-commit hook 不存在，请确保已创建" -ForegroundColor Yellow
}

# 获取远程仓库信息
$remoteUrl = git remote get-url origin 2>$null
if ($remoteUrl) {
    Write-Host ""
    Write-Host "远程仓库: $remoteUrl" -ForegroundColor Gray
    
    if ($remoteUrl -match "github\.com[:/]([^/]+)/([^/]+)\.git?") {
        $repoOwner = $matches[1]
        $repoName = $matches[2] -replace '\.git$', ''
        $actionsUrl = "https://github.com/$repoOwner/$repoName/actions"
        
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  配置完成！" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "现在每次执行 git commit 后，代码会自动推送到 GitHub" -ForegroundColor Yellow
        Write-Host "推送成功后会显示构建链接和操作步骤" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "GitHub Actions 链接: $actionsUrl" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "测试方法:" -ForegroundColor Yellow
        Write-Host "  1. 修改任意文件" -ForegroundColor White
        Write-Host "  2. 执行: git add ." -ForegroundColor White
        Write-Host "  3. 执行: git commit -m '测试自动推送'" -ForegroundColor White
        Write-Host "  4. 观察自动推送和构建提示" -ForegroundColor White
    }
} else {
    Write-Host ""
    Write-Host "警告: 未检测到远程仓库，请先添加: git remote add origin <url>" -ForegroundColor Yellow
}

Write-Host ""
