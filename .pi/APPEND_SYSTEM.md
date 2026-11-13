# turn-diff · 项目硬约束

身份与角色见本仓库根 `AGENTS.md`；团队通用规则见全局 `~/.pi/agent/AGENTS.md`，此处不重述。

## 本项目是什么

一个 **pi 扩展 + 一个命令行工具**，只回答一个问题：「这一轮 AI 改了什么」。扩展在每轮开始时记 git 基线（`git stash create`），轮次结束时算增量并把统计 + unified diff 落盘；会话里用 `/turn-diff`、终端里用 `turn-diff` 读同一份状态。

- **范围纪律**：只做「本轮 diff」。不画面板、不调外部程序、**不提供和 HEAD / 分支对比的口径**——要看全部未提交改动就用 `git diff`，扩展和 CLI 都不管这件事。
- **用词统一**：会话里与命令行用同一套词——不带参数给摘要，`file` 给正文，`file 2` 看某个文件，`list` 列编号，数字看更早的轮次（`turn-diff 2 file 3`）。
- **文件**：`turn-diff.ts`（扩展本体）、`scripts/turn-diff`（命令行）、`install.sh`（部署两者）。
- **颜色**：新增行绿底、删除行红底，行内改动片段用更亮的底色；CLI 默认只在 TTY 上色。

## 🚨 安装会写共享目录

`./install.sh` 把 `turn-diff.ts` 复制到 **`~/.pi/agent/extensions/turn-diff.ts`**，并把命令行装到 `~/.local/bin/turn-diff`——那是全队共享的能力目录。

- 写它之前必须有一次新鲜的飞书快照（`python3 ~/.pi/agent/patch/dev-snapshots/dev-snapshots.py snapshot pi-agent`），否则会被 `snapshot-guard` 拦下。
- 安装完要跑 `node ~/.pi/agent/patch/ts-syntax-check/check.mjs` 确认扩展语法没问题——写好一个坏扩展会让**所有会话**启动失败（pi 加载扩展失败会直接退出）。
- 已开着的会话要 `/reload` 才生效，新会话自动加载。

## 硬约束

- **面板能力只经由 cmux CLI**：`view` → `cmux diff <临时 patch>`，`render` → `cmux open` / `cmux markdown open`。不自己实现 diff 渲染、不写系统级窗口操作；找不到 cmux 时明确报错，不影响其它子命令。
- **`view` / `render` 切换焦点是刻意的**（`--focus true`）：用户敲这个命令就是为了马上看到结果。除此之外不要额外加抢焦点动作（打开面板时保持同一套调用方式）。
- **范围只做「本轮 diff」**：不提供和 HEAD / 分支对比的口径——要看全部未提交改动就用 `git diff`。
- 单文件实现、零外部依赖（只用 pi 扩展 API + 可选的 `cmux` CLI）。要加依赖先在汇报里说明理由。
- 版本号以 `VERSION` 为权威，与 `CHANGELOG.md` / README 徽章一致；不在功能分支 bump。
- 改动记 `CHANGELOG.md`，待办记 `TODO.md`；临时产物放 `tmp/`。

## 验证

- 改完实测：`/turn-diff view 1` 与 `/turn-diff render 1` 能打开对应面板、内容与改动一致；`/turn-diff` 不带参数给摘要。
- 机器上没装 cmux 时，`view` / `render` 给出明确提示而不是报错崩溃（改这块之前先临时改名 `/Applications/cmux*.app` 复核，或直接看代码分支）。
- 验证「本轮无改动」时给的是明确提示而不是空输出。

## 测试文件对 Worker 只读（2026-11-13 立）

测试由 **Leader（dev-agent / Atlas 的会话）在实现开工前**写好，以功能分支上的本地 commit 形式存在。你（Worker）对测试文件**只能读、只能运行**：

- **禁止新建 / 修改 / 删除 / 移动**任何测试文件与测试基础设施：本项目的测试位置是 `test/`（`*.test.ts`，2026-11-13 起新增）；含 fixtures / helpers / conftest 等伴生文件（跑测试缺了也不自己补）。
- **碰到测试跑不通、断言与 Issue 预期不符 → 终止开发、上报 Leader（`Atlas`）或用户裁决**，绝不改测试迁就实现——这是 LLM 的典型失败模式（改不动代码就放宽断言）。
- **`# TEST_CASES_WRITE_OK` 标记的签发权在 Leader**，你不加；被 `test-cases-guard` 拦下时不要绕过。
- 例外：测试运行自产的缓存与构建产物（`__pycache__`、`.pytest_cache`、coverage 输出、`out/` 等）可清理，走授权标记通道。

## 详细说明

`README.md` / `README_cn.md`（功能与安装）、`TODO.md`；通用工作规则见全局 `~/.pi/agent/AGENTS.md`。
