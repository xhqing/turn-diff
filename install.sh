#!/usr/bin/env bash
# turn-diff 安装脚本：部署 pi 扩展 + 命令行工具。
#   - 扩展：turn-diff.ts → ~/.pi/agent/extensions/turn-diff.ts
#   - 命令行：scripts/turn-diff → ~/.local/bin/turn-diff
#   - 生效方式：新会话自动加载；已打开的会话在 pi 里执行 /reload
#   - 卸载：删掉上面两个文件即可（状态在 ~/.pi/agent/state/turn-diff/，可一并删除）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.pi/agent/extensions/turn-diff.ts"
CLI_DEST="$HOME/.local/bin/turn-diff"

mkdir -p "$(dirname "$DEST")"
cp "$ROOT/turn-diff.ts" "$DEST"

# 老版本（diff-view / diff-report）留下的文件：新扩展换了名字，旧的留着会重复注册命令
LEGACY_EXT="$HOME/.pi/agent/extensions/diff-view.ts"
LEGACY_CLI="$HOME/.local/bin/diff-report"
if [ -f "$LEGACY_EXT" ]; then
  rm -f "$LEGACY_EXT"
  echo "已移除旧扩展：$LEGACY_EXT"
fi
if [ -f "$LEGACY_CLI" ]; then
  rm -f "$LEGACY_CLI"
  echo "已移除旧命令：$LEGACY_CLI"
fi

mkdir -p "$(dirname "$CLI_DEST")"
install -m 0755 "$ROOT/scripts/turn-diff" "$CLI_DEST"

echo "已部署：$DEST"
echo "已部署：$CLI_DEST"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "⚠️  $HOME/.local/bin 不在 PATH 里，直接敲 turn-diff 会找不到，需要把它加进 PATH。" ;;
esac
echo "新会话自动生效；已打开的 pi 会话执行 /reload 后生效。"
echo
echo "用法："
echo "  /turn-diff                 把上一轮 AI 改了什么贴进会话（默认不自动贴）"
echo "  /turn-diff file            带上 unified diff 正文（绿底新增 / 红底删除；多文件时让你挑）"
echo "  /turn-diff file 2          只看列表里的第 2 个文件"
echo "  /turn-diff list            只列文件与编号"
echo "  /turn-diff view 2          在 cmux 的 diff 面板打开该文件（可开词级高亮）"
echo "  /turn-diff render 2        把该文件的改后片段交给 cmux 的 markdown 面板渲染（公式排版）"
echo "  /turn-diff 2               更早一轮"
echo "  /turn-diff on|off          切换每轮结束是否自动贴"
echo
echo "命令行（不经过 pi，随时可敲）： turn-diff [list] [file [N|模式]] [N] [--repo <路径>] [--all] [--json] [--color auto|always|never]"
