# PowerShell 清理构建缓存脚本

Write-Host "清理构建缓存..." -ForegroundColor Cyan

# 清理 dist 目录
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
    Write-Host "已清理 dist 目录" -ForegroundColor Green
}

# 清理 node_modules/.vite 缓存
$viteCachePath = Join-Path "node_modules" ".vite"
if (Test-Path $viteCachePath) {
    Remove-Item -Recurse -Force $viteCachePath
    Write-Host "已清理 Vite 缓存" -ForegroundColor Green
}

# 清理 Tauri 构建缓存提示
$tauriTargetPath = Join-Path "src-tauri" "target"
if (Test-Path $tauriTargetPath) {
    Write-Host "Tauri 构建缓存位于 src-tauri/target，如需完全清理请手动删除" -ForegroundColor Yellow
}

Write-Host "清理完成！现在可以重新构建了。" -ForegroundColor Green
Write-Host "运行: npm run build 或 npm run tauri:build" -ForegroundColor Cyan
