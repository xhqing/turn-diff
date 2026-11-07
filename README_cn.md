<div align="center">
  <img src="assets/logo.svg" alt="turn-diff" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-2.1.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-pi%20extension-6E56CF)](#)
  [![Platform](https://img.shields.io/badge/Platform-git-000000)](#)

  [English](README.md)
</div>

# turn-diff

> 「这一轮 AI 改了什么？」——你提交提示词时记基线，这一轮结束时算增量，随时能在会话里或终端里看。

这是一个只干一件事的 pi 扩展：报 git 仓库的「本轮 diff」。它不画面板、不比分支、不依赖任何其它程序在跑。

## 为什么需要它

- 「你刚才改了什么」是最常问的问题，而 `git diff` 回答的是另一个问题：所有未提交改动，连昨天的残留一起算。
- 按轮次切一份就准确了：只算「你提交提示词」到「这一轮结束」之间的变化。
- 运行时几乎零成本：基线是一个 `git stash create` 的游离提交（不写 ref、不动工作区），报告是一条自定义 session entry，永远不进 LLM 上下文。

## 安装

```bash
./install.sh
```

脚本部署两样东西：

- `turn-diff.ts` → `~/.pi/agent/extensions/turn-diff.ts`（新会话自动加载；已开的会话执行 `/reload`）
- `scripts/turn-diff` → `~/.local/bin/turn-diff`（命令行）

## 用法

### 在 pi 会话里

```
/turn-diff              把上一轮的改动贴进会话（统计 + 文件列表）
/turn-diff list         只列出这一轮改了哪些文件（带编号）
/turn-diff file         这一轮所有文件的正文
/turn-diff file 2       只看列表里的第 2 个文件
/turn-diff file src/    只看路径匹配这个片段 / 通配的文件
/turn-diff 2            再往前一轮
/turn-diff 2 file 3     那一轮里的第 3 个文件
/turn-diff on|off       每轮结束是否自动贴（默认关）
```

### 在终端里（不经过 pi）

```bash
turn-diff                   当前仓库上一轮的改动
turn-diff list              只列出这一轮改了哪些文件（带编号）
turn-diff file              这一轮所有文件的正文
turn-diff file 2            只看第 2 个文件
turn-diff file '*.ts'       只看路径匹配的文件
turn-diff 2                 看再往前一轮（1 = 最近一轮）
turn-diff 2 file 3          那一轮里的第 3 个文件
turn-diff --repo ~/x        指定仓库
turn-diff --all             每个有轮次报告的仓库各一行摘要
turn-diff --json            机器可读输出
turn-diff --color always    强制上色（另有 auto / never）
```

`turn-diff` 只读扩展落盘的状态，不启动 pi、不触发任何轮次。

## 颜色

diff 正文按「改动视图」来画，不是普通日志：

- 新增行**绿底**，删除行**红底**；
- 一对 `-` / `+` 行里，只有**真正变的那几个片段**用更亮的底色标出来，改一个词不会把整行刷一遍。

默认跟随终端（只在 TTY 上上色）；`--color never` 关掉，`--color always` 在管道里也强制输出颜色。会话里的卡片用同一套配色。

改动文件多的时候不会一次性糊满屏幕：`/turn-diff file` 会弹出选择器（「全部」或某个文件），`/turn-diff file <编号>|<片段>` 直接定位到一个文件；**你明确要的正文会全量渲染**，不会出现「还有 N 行（展开查看）」。命令行用同一套词：`turn-diff file 2`。

## 工作原理

1. `before_agent_start` 记基线：仓库根、`HEAD`、`git stash create` 生成的游离提交（已跟踪文件的脏改动，不写 ref、不动工作区）、当时未跟踪文件的指纹。
2. `agent_settled` 拿基线和工作区做差：`git diff --numstat` 出行数、`--name-status` 出 A/M/D/R、完整 `git diff` 出 patch 正文；这一轮新冒出来的未跟踪文件按「新建文件」算。
3. 统计和 patch 一起按仓库落盘（最近 20 轮）到 `~/.pi/agent/state/turn-diff/`，`/turn-diff`、命令行、会话卡片读的都是这份状态。

为什么用 `git stash create` 而不是碰暂存区：它同时收编已暂存与未暂存的改动，且两边都不改动；生成的提交因为内容去重，几乎不占空间。

## 已知边界

- **只支持 git**：不是 git 仓库的目录直接跳过（没有基线可做差）。
- **只有轮次口径**：报告回答「这一轮改了什么」；要「所有未提交改动」直接 `git diff`——本项目只报本轮。
- **基线时就存在的未跟踪文件**：即使本轮又被改，也不会出现在报告里（git 没有它的 diff 基准）。
- patch 只含文本：二进制、超过 200 KB 的未跟踪文件不并进正文；单轮 patch 上限 80 KB（统计仍然完整）。
- 每个仓库保留最近 20 轮，更早的会被丢弃。

## 开发

- `turn-diff.ts` — 扩展本体（单文件，除 `pi-tui` 外无依赖）
- `scripts/turn-diff` — 命令行（Python 3，只用标准库）
- `install.sh` — 两样一起部署；`node --experimental-strip-types --check turn-diff.ts` 是 CI 跑的语法门

## License

Copyright (c) 2026 All Contributors。以 [MIT License](LICENSE.md) 发布。
