#!/usr/bin/env bash
# 编辑器本地服务:退出自动重启 + 健康检查(曾多次静默退出)。用法: scripts/serve.sh [端口]
PORT=${1:-8765}; DIR="$(cd "$(dirname "$0")/.." && pwd)/www"
while true; do
  if ! curl -fs -o /dev/null "http://localhost:$PORT/" ; then
    (python3 -m http.server "$PORT" --directory "$DIR" >/dev/null 2>&1 &) ; sleep 1
  fi
  sleep 5
done
