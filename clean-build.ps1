# PowerShell 清理构建缓存脚本

Write-Host "清理构建缓存..." -ForegroundColor Cyan

# 清理 dist 目录
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
    Write-Host "✓ 已清理 dist 目录" -ForegroundColor Green
}

# 清理 node_modules/.vite 缓存
if (Test-Path "node_modules\.vite") {
    Remove-Item -Recurse -Force "node_modules\.vite"
    Write-Host "✓ 已清理 Vite 缓存" -ForegroundColor Green
}

# 清理 Tauri 构建缓存
if (Test-Path "src-tauri\target") {
    Write-Host "⚠  Tauri 构建缓存位于 src-tauri\target，如需完全清理请手动删除" -ForegroundColor Yellow
}

Write-Host "清理完成！现在可以重新构建了。" -ForegroundColor Green
Write-Host "运行: npm run build 或 npm run tauri:build" -ForegroundColor Cyan
