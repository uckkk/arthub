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

echo "=== 修复 macOS 无法打开: $APP_PATH ==="

# 1. 移除隔离属性（必须）
echo "[1/3] 移除隔离属性..."
xattr -cr "$APP_PATH"
echo "     完成。"

# 2. 从内到外 ad-hoc 签名（先签内部再签整包，避免签名不一致）
if command -v codesign &> /dev/null; then
    echo "[2/3] 执行本地 ad-hoc 签名..."
    # 先签 .app 内所有可执行文件与框架
    find "$APP_PATH" -type f \( -perm -u+x -o -name "*.dylib" -o -name "*.so" \) -print0 2>/dev/null | while IFS= read -r -d '' f; do
        if file "$f" | grep -q "Mach-O"; then
            codesign --force --sign - "$f" 2>/dev/null || true
        fi
    done
    # 再签 Frameworks 目录下的 .framework
    if [ -d "$APP_PATH/Contents/Frameworks" ]; then
        find "$APP_PATH/Contents/Frameworks" -name "*.framework" -maxdepth 2 -print0 2>/dev/null | while IFS= read -r -d '' f; do
            codesign --force --sign - "$f" 2>/dev/null || true
        done
    fi
    # 最后签整个 .app
    if codesign --force --deep --sign - "$APP_PATH" 2>/dev/null; then
        echo "     签名完成。"
    else
        echo "     整体签名跳过（已尝试内部签名，请直接重试打开）。"
    fi
else
    echo "[2/3] 跳过签名（未找到 codesign）。"
fi

echo "[3/3] 完成。"
echo ""
echo "请按以下顺序尝试打开："
echo "  1. 右键点击应用 → 选择「打开」→ 在弹窗中再点「打开」"
echo "  2. 若仍不行：系统设置 → 隐私与安全性 → 找到 ArtHub → 点「仍要打开」"
echo ""
echo "若打开后立刻闪退，请在终端直接运行可执行文件以查看报错："
BIN="$APP_PATH/Contents/MacOS/ArtHub"
if [ -x "$BIN" ]; then
    echo "  $BIN"
else
    echo "  $APP_PATH/Contents/MacOS/<主程序名>"
fi
echo ""
