#!/bin/bash
# 清理构建缓存和输出目录

echo "清理构建缓存..."

# 清理 dist 目录
if [ -d "dist" ]; then
  rm -rf dist
  echo "✓ 已清理 dist 目录"
fi

# 清理 node_modules/.vite 缓存
if [ -d "node_modules/.vite" ]; then
  rm -rf node_modules/.vite
  echo "✓ 已清理 Vite 缓存"
fi

# 清理 Tauri 构建缓存（Windows）
if [ -d "src-tauri/target" ]; then
  echo "⚠  Tauri 构建缓存位于 src-tauri/target，如需完全清理请手动删除"
fi

echo "清理完成！现在可以重新构建了。"
echo "运行: npm run build 或 npm run tauri:build"
