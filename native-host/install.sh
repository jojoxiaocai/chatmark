#!/bin/bash
# 豆包收藏助手 - Native Helper 安装程序 (macOS / Linux)

set -e

echo "============================================"
echo "  豆包收藏助手 - Native Helper 安装程序"
echo "============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js，请先安装："
    echo "  brew install node   (macOS)"
    echo "  或访问 https://nodejs.org/"
    exit 1
fi

echo "[OK] Node.js $(node -v) 已安装"

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_JS="${SCRIPT_DIR}/host.js"
HOST_NAME="com.doubao_collector.native_host"

# Determine Chrome native messaging hosts directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
else
    # Linux
    TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
fi

MANIFEST_PATH="${TARGET_DIR}/${HOST_NAME}.json"

# Get extension ID
echo ""
echo "请打开 chrome://extensions/ 页面，开启"开发者模式"，"
echo "找到"豆包收藏助手"的扩展 ID（一串字母）。"
echo ""
read -p "请输入扩展 ID: " EXT_ID

if [ -z "$EXT_ID" ]; then
    echo "[错误] 扩展 ID 不能为空"
    exit 1
fi

# Make host.js executable
chmod +x "$HOST_JS"

# Create target directory
mkdir -p "$TARGET_DIR"

# Create native host manifest
# macOS/Linux 的 path 直接指向 node 脚本（需要 shebang）
cat > "$MANIFEST_PATH" << EOF
{
  "name": "${HOST_NAME}",
  "description": "Doubao Collector Native Helper",
  "path": "${HOST_JS}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXT_ID}/"
  ]
}
EOF

echo ""
echo "[OK] 配置文件已创建: ${MANIFEST_PATH}"
echo ""
echo "============================================"
echo "  安装完成！"
echo ""
echo "  扩展 ID: ${EXT_ID}"
echo "  重启 Chrome 后生效。"
echo "============================================"
