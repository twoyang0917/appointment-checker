#!/bin/bash
set -e

# ==================== 配置 ====================
BINARY_NAME="appointment-checker-linux-x64"
COMPILED_BINARY="./$BINARY_NAME"  # 你本地编译好的文件
CONFIG_PATH="/etc/appointment-checker/config.yaml"
LOG_DIR="/var/log/appointment-checker"
INSTALL_PATH="/usr/local/bin/$BINARY_NAME"
SERVICE_FILE="/etc/systemd/system/$BINARY_NAME.service"
# ==============================================

# 权限检查
if [ "$EUID" -ne 0 ]; then
  echo "❌ 请用 sudo 运行: sudo bash install.sh"
  exit 1
fi

# 检查二进制是否存在
if [ ! -f "$COMPILED_BINARY" ]; then
  echo "❌ 未找到编译好的二进制文件: $COMPILED_BINARY"
  echo "👉 请先在本地执行编译命令："
  echo "   bun build src/index.ts --compile --target=bun-linux-x64 --outfile appointment-checker"
  exit 1
fi

echo "🚀 开始部署预编译二进制文件..."

# ==================== 1. 安装二进制 ====================
echo ""
echo "[1/3] 安装二进制文件到 /usr/local/bin"
cp -f "$COMPILED_BINARY" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"
echo "✅ 二进制已安装"

# ==================== 2. 配置文件 ====================
echo ""
echo "[2/4] 检查配置文件"
if [ ! -f "$CONFIG_PATH" ]; then
  echo "💡 未找到配置文件，创建目录并打开编辑器"
  mkdir -p "$(dirname "$CONFIG_PATH")"
  read -p "按 Enter 开始编辑配置..."
  nano "$CONFIG_PATH"

  if [ ! -s "$CONFIG_PATH" ]; then
    echo "❌ 配置文件不能为空，安装中止"
    exit 1
  fi
  echo "✅ 配置已保存"
else
  echo "✅ 配置文件已存在"
fi

# ==================== 3. 创建日志目录 ====================
echo ""
echo "[3/4] 创建日志目录"
mkdir -p "$LOG_DIR"
chown $(logname):$(logname) "$LOG_DIR"
chmod 755 "$LOG_DIR"
echo "✅ 日志目录已创建: $LOG_DIR"

# ==================== 4. 安装 systemd 服务 ====================
echo ""
echo "[4/4] 注册并启动服务"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Appointment Checker Service
After=network.target

[Service]
User=$(logname)
ExecStart=$INSTALL_PATH -c $CONFIG_PATH
Restart=on-failure
RestartSec=5s
StandardOutput=append:$LOG_DIR/appointment-checker.log
StandardError=append:$LOG_DIR/appointment-checker-error.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $BINARY_NAME
systemctl restart $BINARY_NAME

echo ""
echo "🎉 部署完成！"
echo "查看状态: systemctl status $BINARY_NAME"
echo "查看日志: journalctl -u $BINARY_NAME -f"
echo "查看文件日志: tail -f $LOG_DIR/appointment-checker.log"