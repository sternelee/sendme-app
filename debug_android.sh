#!/bin/bash

# Android 调试脚本 - 实时监控 Sendme 应用日志

ADB="$HOME/Library/Android/sdk/platform-tools/adb"

echo "========================================"
echo "Sendme Android 实时调试"
echo "========================================"
echo ""

# 检查设备连接
echo "1. 检查设备连接..."
$ADB devices
echo ""

# 获取应用 PID
echo "2. 查找 Sendme 应用进程..."
APP_PID=$($ADB shell pidof com.sendme.app 2>/dev/null)
if [ -z "$APP_PID" ]; then
    echo "   ⚠️  应用未运行，请先启动应用"
    echo "   等待应用启动..."
else
    echo "   ✅ 应用 PID: $APP_PID"
fi
echo ""

# 清除旧日志
echo "3. 清除旧日志..."
$ADB logcat -c
echo "   ✅ 日志已清除"
echo ""

echo "4. 开始监控日志..."
echo "   提示: 现在可以在手机上操作接收文件"
echo "   按 Ctrl+C 停止监控"
echo ""
echo "========================================"
echo ""

# 监控日志 - 过滤多个关键词
$ADB logcat | grep --line-buffered -iE \
    "sendme|RustStdoutStderr|receive_file|iroh|RECEIVE_FILE|transfer_id" | \
    while IFS= read -r line; do
        # 添加时间戳和高亮
        timestamp=$(date '+%H:%M:%S')
        
        # 根据关键词添加颜色
        if echo "$line" | grep -qi "error"; then
            echo -e "\033[1;31m[$timestamp]\033[0m $line"  # 红色
        elif echo "$line" | grep -qi "warn"; then
            echo -e "\033[1;33m[$timestamp]\033[0m $line"  # 黄色
        elif echo "$line" | grep -qi "RECEIVE_FILE START"; then
            echo -e "\033[1;32m[$timestamp]\033[0m $line"  # 绿色
        elif echo "$line" | grep -qi "success\|completed"; then
            echo -e "\033[1;36m[$timestamp]\033[0m $line"  # 青色
        else
            echo "[$timestamp] $line"
        fi
    done
