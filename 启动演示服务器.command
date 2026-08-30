#!/bin/bash
# 配料侠网页演示服务器 —— 双击本文件即可启动
# 电脑重启/休眠后服务会停止，再双击一次即可恢复
cd "$(dirname "$0")"
lsof -ti:8123 | xargs kill 2>/dev/null
sleep 1
IP=$(ipconfig getifaddr en0)
echo "───────────────────────────────────────"
echo "  配料侠演示服务器已启动"
echo ""
echo "  手机/电脑浏览器访问（同一 Wi-Fi）："
echo "  用户端演示   http://$IP:8123/web/"
echo "  成分知识库   http://$IP:8123/web/kb.html"
echo "  营养师审核页 http://$IP:8123/tools/review/review.build.html"
echo ""
echo "  保持本窗口开着，关闭窗口即停止服务"
echo "───────────────────────────────────────"
# 不加 --bind：Python 3.8+ 默认双栈监听（IPv4+IPv6+局域网全可达）
python3 -m http.server 8123
