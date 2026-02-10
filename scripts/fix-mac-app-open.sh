#!/bin/bash
# macOS 下解决「无法打开」或「已损坏」提示
# 用法: ./scripts/fix-mac-app-open.sh [应用路径]
# 示例: ./scripts/fix-mac-app-open.sh /Applications/ArtHub.app

set -e

APP_PATH="${1:-/Applications/ArtHub.app}"

if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "此脚本仅适用于 macOS。"
    exit 1
fi

if [ ! -d "$APP_PATH" ]; then
    echo "错误: 未找到应用: $APP_PATH"
    echo "用法: $0 [应用路径]"
    echo "示例: $0 /Applications/ArtHub.app"
    echo "或先拖入 .app 到终端获取路径"
    exit 1
fi

echo "正在移除隔离属性，使应用可以打开: $APP_PATH"
xattr -cr "$APP_PATH"
echo "完成。请再次双击打开应用。"

# 可选：本地 ad-hoc 签名（无需 Apple 开发者账号，仅便于本机打开）
if command -v codesign &> /dev/null; then
    echo "正在执行本地签名（可选）..."
    if codesign --force --deep --sign - "$APP_PATH" 2>/dev/null; then
        echo "签名完成。"
    else
        echo "签名跳过（不影响使用，已通过 xattr 修复）。"
    fi
fi
