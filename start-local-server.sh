#!/bin/bash
echo "═══════════════════════════════════════════════════"
echo "  Corpus Aegyptiacum · JSesh SVG · 本地测试服务器"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  启动地址: http://localhost:8080"
echo "  按 Ctrl+C 停止"
echo ""
python3 -m http.server 8080
