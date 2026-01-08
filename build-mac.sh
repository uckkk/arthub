#!/bin/bash

# ========================================
# 掼蛋ArtHub - macOS 一键打包脚本
# ========================================

set -e

echo "========================================"
echo "  掼蛋ArtHub - macOS 打包工具"
echo "========================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否在 macOS 上运行
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}错误: 此脚本只能在 macOS 上运行${NC}"
    echo "请将项目复制到 Mac 电脑上，然后运行此脚本"
    exit 1
fi

echo -e "${YELLOW}[1/6] 检查开发环境...${NC}"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未找到 Node.js${NC}"
    echo "请先安装 Node.js: https://nodejs.org/"
    echo "或使用 Homebrew: brew install node"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}错误: 未找到 npm${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm $(npm -v)${NC}"

# 检查 Rust
if ! command -v rustc &> /dev/null; then
    echo -e "${YELLOW}未找到 Rust，正在安装...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi
echo -e "${GREEN}✓ Rust $(rustc --version)${NC}"

# 检查 Tauri CLI
if ! npm list -g @tauri-apps/cli &> /dev/null; then
    echo -e "${YELLOW}正在安装 Tauri CLI...${NC}"
    npm install -g @tauri-apps/cli
fi
echo -e "${GREEN}✓ Tauri CLI 已安装${NC}"

echo ""
echo -e "${YELLOW}[2/6] 生成 macOS 图标...${NC}"

# 进入 icons 目录
ICONS_DIR="src-tauri/icons"
mkdir -p "$ICONS_DIR"

# 检查是否有源图标
if [ -f "icon.ico" ]; then
    SOURCE_ICON="icon.ico"
elif [ -f "$ICONS_DIR/icon.ico" ]; then
    SOURCE_ICON="$ICONS_DIR/icon.ico"
elif [ -f "public/icon.ico" ]; then
    SOURCE_ICON="public/icon.ico"
else
    echo -e "${YELLOW}未找到 icon.ico，使用默认图标${NC}"
    SOURCE_ICON=""
fi

if [ -n "$SOURCE_ICON" ]; then
    echo "源图标: $SOURCE_ICON"
    
    # 检查是否已有 icns 文件
    if [ ! -f "$ICONS_DIR/icon.icns" ]; then
        echo "正在生成 macOS 图标..."
        
        # 创建临时 iconset 目录
        ICONSET_DIR="$ICONS_DIR/icon.iconset"
        mkdir -p "$ICONSET_DIR"
        
        # 使用 sips 从 ico 提取并转换为各种尺寸的 png
        # 首先尝试将 ico 转换为 png
        sips -s format png "$SOURCE_ICON" --out "$ICONS_DIR/icon_source.png" 2>/dev/null || true
        
        if [ -f "$ICONS_DIR/icon_source.png" ]; then
            # 生成各种尺寸
            sips -z 16 16 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_16x16.png"
            sips -z 32 32 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_16x16@2x.png"
            sips -z 32 32 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_32x32.png"
            sips -z 64 64 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_32x32@2x.png"
            sips -z 128 128 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_128x128.png"
            sips -z 256 256 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_128x128@2x.png"
            sips -z 256 256 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_256x256.png"
            sips -z 512 512 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_256x256@2x.png"
            sips -z 512 512 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_512x512.png"
            sips -z 1024 1024 "$ICONS_DIR/icon_source.png" --out "$ICONSET_DIR/icon_512x512@2x.png"
            
            # 生成 icns
            iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"
            
            # 复制常用尺寸到 icons 目录
            cp "$ICONSET_DIR/icon_32x32.png" "$ICONS_DIR/32x32.png"
            cp "$ICONSET_DIR/icon_128x128.png" "$ICONS_DIR/128x128.png"
            cp "$ICONSET_DIR/icon_128x128@2x.png" "$ICONS_DIR/128x128@2x.png"
            cp "$ICONSET_DIR/icon_256x256.png" "$ICONS_DIR/256x256.png"
            
            # 清理临时文件
            rm -rf "$ICONSET_DIR"
            rm -f "$ICONS_DIR/icon_source.png"
            
            echo -e "${GREEN}✓ macOS 图标生成完成${NC}"
        else
            echo -e "${YELLOW}无法转换图标，将使用 Tauri 默认图标${NC}"
        fi
    else
        echo -e "${GREEN}✓ macOS 图标已存在${NC}"
    fi
else
    echo -e "${YELLOW}跳过图标生成（未找到源文件）${NC}"
fi

echo ""
echo -e "${YELLOW}[3/6] 安装项目依赖...${NC}"
npm install

echo ""
echo -e "${YELLOW}[4/6] 构建前端资源...${NC}"
npm run build

echo ""
echo -e "${YELLOW}[5/6] 构建 macOS 应用...${NC}"
echo "这可能需要几分钟时间，请耐心等待..."
npm run tauri build

echo ""
echo -e "${YELLOW}[6/6] 打包完成！${NC}"
echo ""

# 查找生成的文件
DMG_PATH="src-tauri/target/release/bundle/dmg"
APP_PATH="src-tauri/target/release/bundle/macos"

echo "========================================"
echo -e "${GREEN}  构建成功！${NC}"
echo "========================================"
echo ""

if [ -d "$DMG_PATH" ]; then
    echo "DMG 安装包位置:"
    ls -la "$DMG_PATH"/*.dmg 2>/dev/null || echo "  (未找到 DMG 文件)"
    echo ""
fi

if [ -d "$APP_PATH" ]; then
    echo "App 应用位置:"
    ls -la "$APP_PATH"/*.app 2>/dev/null || echo "  (未找到 App 文件)"
    echo ""
fi

echo "你可以:"
echo "  1. 双击 .dmg 文件安装应用"
echo "  2. 或直接将 .app 文件拖到「应用程序」文件夹"
echo ""
echo -e "${YELLOW}注意: 首次运行可能需要在「系统偏好设置 > 安全性与隐私」中允许运行${NC}"
echo ""

# 尝试打开输出文件夹
if [ -d "$DMG_PATH" ]; then
    open "$DMG_PATH"
elif [ -d "$APP_PATH" ]; then
    open "$APP_PATH"
fi

echo "打包完成！"
