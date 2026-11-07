# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] - 2026-11-07

### 新增（`view`：把改动片段交给 cmux 渲染，公式可排版）

- **为什么**：用户看 Markdown 文章的 diff 时，`$\frac{...}$` 这类公式只能以源码出现，可读性差；cmux 的 markdown 面板自带 KaTeX，能把公式真正排版出来。整篇丢过去又看不到「改了哪一段」，所以要的是「改动片段 + 渲染」。
- **改了什么**：新增 `view` 动词（会话 `/turn-diff view 2`、命令行 `turn-diff view 2`）。行为：取该文件各 hunk 的**改后一侧**（上下文 + 新增行，去掉 `diff --git` / `@@` / 删除行），写成临时 `.md`，再调 `cmux markdown open <临时文件> --focus false` 用 cmux 的 markdown 面板渲染；成功后回报面板引用，不抢焦点。找不到 cmux 时明确报错，不影响其它子命令。
- **补：颜色与排版兼得**（同日修订）：只给「改后」会把 +/- 信息丢掉，看不出删了什么。生成文档改成两段——上面 `diff` 围栏（highlight.js 给 `+` 绿底、`-` 红底；markdown sanitizer 会清掉行内 `style`，所以这是那个面板里唯一的上色途径），下面渲染「改后」（KaTeX 排版公式）。围栏长度按内容里的反引号自动加长，避免文章内嵌的代码块把围栏切断。
- **补：逐处改动列表**（同日再修订）：代码围栏只能整行上色，看不出「这句话里删了哪几个字」。文档最前面加一段「逐处改动」——把成对 `-`/`+` 行做词级 diff，只列真正变化的片段，删除用 `~~删除线~~`、新增用 `**加粗**`（渲染成真 markdown）。实测那篇文章的改动显示为 `- ~~（一般形式见上文那句话）~~`，被删的正是那句话。
- **拆成两个面板**（同日修订）：用户提醒「cmux 的 diff-viewer 本来就有词级高亮」。核实：`view` 之前用的是 cmux 的 **markdown 面板**（带 KaTeX，但只能整行上色），而 cmux 另有 **diff 面板**——自带行级红绿，`wordDiffs` 选项（选项菜单里打开，存在 `~/Library/Application Support/cmux/diff-viewer/preferences.json`）还能词级高亮，只是不渲染 markdown/数学。所以按目的地拆开：`view` → cmux diff 面板（`cmux diff <临时 patch> --title <文件> --no-focus`），`render` → 原来的 markdown 渲染。
- **验证**：拿 SocialMediaManagerAgent 那篇文章的上一轮改动实测——`turn-diff list` 列出 3 个文件，`turn-diff view 1` 生成 15 行「改后」片段（其中 6 行含公式），cmux 打开 `surface:1000100057`，面板标题是临时文件；测试用的两个旧面板已关掉。
- **边界**：这是片段不是整篇，跨 hunk 的 Markdown 结构（被切开的表格、断掉的段落）可能排版怪异，相对图片路径多半解析不了；`view` 是唯一需要 cmux 的子命令，其余功能仍为纯 git。

## [2.1.0] - 2026-11-07

### 新增（改动文件多时按文件看正文，不再一次糊满屏）

- **为什么**：用户指出 `patch` 给的是这一轮所有文件的正文，改动一多就刷屏、还很难找到想看的那一个。
- **改了什么**：① 摘要列表加编号（`1. M src/a.ts +12 -3`）；② 会话里 `/turn-diff patch` 在多个文件时弹出选择器（「全部」或某个文件），`/turn-diff patch <编号>|<路径片段/通配>` 直接定位，且支持与轮次/口径组合（`/turn-diff 2 patch`、`/turn-diff head patch`）；③ 命令行增加 `--list`（列出编号）与 `--file <编号|模式>`，与 `--patch` 组合只看一个文件；④ 生成的未跟踪文件 hunk 补上 `diff --git` 头，切分更稳，同时兼容老记录里没有该头的格式。
- **验证**：造了一份三文件的假状态——`--list` 编号正确；`--patch --file 2` 只输出第二个文件、`--file '*.md'` 只输出匹配项、`--file 9` 报错退出 1 并提示先看编号；TS 侧 `splitPatchByFile` 对「新格式（3 段）」与「老格式（未跟踪文件段没有 diff --git 头）」都切分正确，`matchPath` 的子串 / 通配 / 大小写用例全过。
- **边界**：编号以摘要列表的顺序（按改动量排序）为准，正文里的顺序仍是 git 的路径序；正文仍受单轮 80 KB 上限约束。
### 变更（用词统一成 `file`，并去掉「和 HEAD 比」这个口径）

- **为什么**：用户指出两点——(1) 会话里写 `patch`、命令行写 `--file`，两处用词不一致，应该都叫 `file`（`/turn-diff file 2`）；(2) 本项目专注「本轮 diff」，`head`（工作区相对 HEAD 的全量）属于另一个问题，不该混进来。
- **改了什么**：会话命令改成 `file`（`patch` 保留为别名），命令行从 `--patch` / `--file` 改成动词形式 `turn-diff file`、`turn-diff file 2`、`turn-diff file '*.ts'`、`turn-diff list`，两侧词表完全一致；`--patch` / `--file` / `--list` / `--turn` 作为兼容别名保留。删掉 `head` 口径（`captureHeadBaseline`、`scope` 字段分支一并移除），误输 `head` 时明确提示「本项目只看本轮，要看全部未提交改动请用 git diff」。
- **验证**：假状态（两轮、三轮次文件）跑过 `list`、`file 1/2/3` 各自命中正确文件、`file '*.md'` 通配、`2 file` 取第二轮、`--file 3`、`head` 退出码 2 并给出提示、`file 9` 越界报错。
### 修复（显式要正文时不该再折叠）

- **问题**：`/turn-diff file` 是用户明确要正文，卡片却仍按 30 行折叠，末尾留一句「…patch 还有 2 行（展开查看）」，看起来像没展开完全。
- **改法**：`/turn-diff file` 生成的卡片带 `fullPatch`，渲染时全量输出；30 行折叠只保留给「自动贴且带正文」这种没主动要正文的场景（自动贴本身默认不贴正文，所以这条基本不触发）。
- **验证**：用 60 对 `-`/`+` 行的 patch 跑渲染器，输出 124 行（表头 + 120 行内容 + 空行），确认不再截断。



## [2.0.0] - 2026-11-07

### 变更（更名 turn-diff、范围收敛为「本轮 diff」、diff 正文按改动视图上色）

- **为什么**：用户裁定——(1) 仓库改名 `turn-diff`，**只做本轮 diff**，不再掺其它 diff 功能；(2) 非 git 目录的兜底方案不做（绝大多数场景都是 git 项目）；(3) diff 正文要按「改动视图」呈现：新增块绿底、删除块红底，行内真正改动的片段再高亮。
- **改了什么**：
  - **范围收敛**：删掉 cmux 面板相关的全部代码（`/open-diff`、`/close-diff`、`open_diff` / `close_diff` 两个工具、cmux CLI 发现与 socket 重试、last-turn 基线匹配）。扩展从 800+ 行降到 500 行左右，只剩「记基线 → 算增量 → 落盘 / 贴卡片」。
  - **更名**：仓库 → `xhqing/turn-diff`；扩展文件 `turn-diff.ts`（部署到 `~/.pi/agent/extensions/turn-diff.ts`）；命令 `/turn-diff`；命令行 `turn-diff`（`~/.local/bin/`）；状态目录 `~/.pi/agent/state/turn-diff/`；entry 类型 `turn-diff-report`。`install.sh` 顺带删掉旧的 `diff-view.ts` 与 `diff-report`。
  - **上色**：CLI 与卡片共用一套 256 色——新增行 `48;5;22` 绿底、删除行 `48;5;52` 红底，配 `38;5;231` 白字保证对比度；一对 `-`/`+` 行先做 token 级 LCS，只有真正变化的片段用更亮的底色（`48;5;28` / `48;5;88`）。CLI 默认只在 TTY 上色，支持 `--color auto|always|never`，并尊重 `NO_COLOR`。
- **验证**：见下方「验证」小节（CLI 三档颜色 + 行内高亮 + 无 TTY 降级都实测过）。
- **边界**：颜色是写死的暗色底（配白字），亮色终端下依然可读但不算原生适配；行内高亮对超长行（> 400 token）退化为整行底色。

## [1.3.0] - 2026-11-07

### 修复（`--patch` 在旧轮次上不再像报错）

- `diff-report -p` 遇到「这一轮没有存 patch」（1.3.0 之前的报告）时，原来把提示写到 stderr、还以退出码 1 结束，终端里看起来像命令失败了。现在统计照常输出、提示跟在后面写进 stdout、退出码 0；只有「连统计都没有」才算失败。

### 新增（能看到文件内部的具体改动，不再只有文件级统计）

- **为什么**：用户看完统计后问「可以看文件内部的具体改动内容吗」。之前只存了「哪个文件、加减多少行」，正文得自己 `git diff`，而且过一轮就被覆盖，回头看历史轮次根本没有正文。
- **改了什么**：① 轮次结束时多算一份 unified diff（已跟踪文件走 `git diff <基线>`；这一轮新出现的未跟踪文件手工拼成「新建文件」的 hunk），随报告一起落盘，单轮上限 80 000 字符、超了截断并标记；② CLI 增加 `--patch` / `-p`，把该轮的 patch 正文接在统计后面打印；③ 会话里新增 `/diff-report patch`，卡片里直接显示 patch（折叠时先给 30 行，展开看全；新增行绿、删除行红）。
- **验证**：抽出函数在临时仓库里跑真 git 场景——一个已跟踪文件改一行 + 一个新文件两行，`buildTurnPatch` 输出的 patch 同时包含 `diff --git` 的修改 hunk 与 `/dev/null → b/new.txt` 的新建 hunk，行数与统计一致；`--patch` 走真实落盘状态打印正常。
- **边界**：patch 只覆盖「这一轮」的文本改动；二进制文件、超过 200 KB 的未跟踪文件不进 patch；单轮 patch 超过 80 KB 会被截断（统计仍然完整）。

## [1.2.0] - 2026-11-07

### 变更（改成手动触发，并补一个不经过 pi 的 `diff-report` 命令行）

- **为什么**：用户要的是「本轮增量（turn diff）」，但**由他手动触发**，不是每轮自动贴；而 `/diff-report` 之前拿不到本轮结果——基线在轮次结束时就被消费掉了，命令只能临时抓一个「现在」当基线，于是永远报「没有可汇报的改动」。再加一层：他想在终端里随便敲个命令就看，不触发 pi 的任何轮次。
- **改了什么**：① 每轮基线（仓库根 / HEAD / `git stash create` 快照 / 未跟踪文件指纹）改成**落盘**到 `~/.pi/agent/state/cmux-diff/turn-baseline.json`（按会话 id）；② 轮次结束时算出「本轮增量」并落盘到 `last-turn.json`（按仓库根），**默认不再自动贴卡片**（`inlineReport` 默认 false，要就 `/diff-report on`）；③ `/diff-report` 默认贴「上一轮的落盘报告」，本轮正在跑时贴当前进度，`/diff-report head` 才看「工作区相对 HEAD 的全量」；④ 新增 `scripts/diff-report`（Python 3，无第三方依赖）并让 `install.sh` 装到 `~/.local/bin/`：读落盘状态直接打印，支持 `--repo` / `--all` / `--json` / `--since`，完全不启动 pi、不触发轮次。
- **修掉时间戳单位不一致**：扩展写的是 JS 的毫秒（`Date.now()`），CLI 按秒解析，直接跑会炸 `year 58820 is out of range`；CLI 里统一折成秒再格式化，排序也按秒算。
- **每仓库保留最近 20 轮，空轮次不再冲掉历史**：原先每个仓库只存一条，空轮次会把上一轮的报告写成空；现在改成按仓库存一串（新的在前），空轮次只记基线、不写报告。CLI 支持 `--turn N` 翻更早的轮次。
- **验证**：见下一条目里的 CLI 与扩展场景验证。
- **边界**：CLI 只读扩展落盘的结果，所以必须先在某个仓库里跑过至少一轮带文件改动的 pi 任务；`--since` 用的是落盘基线，若基线已被后续轮次覆盖，结果会从那一轮的起点算起。

## [1.1.0] - 2026-11-07

### 新增（会话内直接汇报本轮改动，不依赖任何外部软件）

- **为什么**：面板模式离不开 cmux——cmux 得在跑、控制 socket 得放行、`last-turn` 还要求 pi 是从 cmux 里启动的。用户要的是「不依赖外部软件，pi 会话最后汇报时就把改动讲清楚」。查了 pi 的扩展 API，`pi.appendEntry()` + `pi.registerEntryRenderer()` 正好是为此设计的：自定义 entry 只落盘 + 渲染，不进 LLM 上下文、不消耗 token。
- **改了什么**：新增「会话内汇报」这条线。① 每轮 `before_agent_start` 记基线：仓库根 + HEAD + `git stash create` 的游离提交（把基线时刻已跟踪文件的脏改动固化，不写 ref、不动工作区）+ 未跟踪文件的大小 / mtime 指纹；② 轮次彻底结束（`agent_settled`，不再有重试 / 补充）时用 `git diff --numstat` + `--name-status` 算这一轮的文件与行数，再补上「基线之后才出现的未跟踪文件」（按整份文件算新增行），生成一张卡片追加到会话末尾；③ 卡片不展开时最多列 8 个文件，展开看全部；④ 新增 `/diff-report` 命令：不带参数立刻出一次，`on` / `off` 切换每轮自动汇报（默认开，状态存 `~/.pi/agent/state/cmux-diff/settings.json`）。
- **口径区分（同日修订）**：手敲 `/diff-report` 原本复用「本轮基线」，可轮次一结束基线就清空了，于是命令只能临时抓一个「现在」当基线，结果永远报「没有可汇报的改动」——用户实际就是这么撞上的。现在分两种口径：**自动卡片**报「本轮增量」（基线 = 提示词提交那一刻）；**手敲 `/diff-report`** 报「工作区相对 HEAD 的全部未提交改动」，本轮正在进行时才退回本轮增量；标题里分别写「本轮改动」与「工作区改动（相对 HEAD）」，空结果也分开提示「不是 git 仓库」与「工作区是干净的」。
- **验证**：把扩展的函数抽到临时模块跑了三组真 git 场景（`node --experimental-strip-types`）——干净基线：改 1 文件 +2 −1、新增未跟踪文件 +3、删除文件 −2，全部算对；脏基线：基线前已有的改动不计入、只报基线之后新增的 +1；无改动时返回 null（不刷空卡片）。
- **边界**：只给统计与状态字母（A / M / D / R），不给 patch 正文（要看正文仍用 `/open-diff` 面板）；基线上就已存在的未跟踪文件即使本轮又被改，也不会出现在汇报里（拿不到它的 diff 基准）；不是 git 仓库的会话静默跳过。

## [1.0.4] - 2026-11-07

### 修复（不在 cmux 里启动时也能用：自己找 app 内置 CLI + 说明 socket 权限）

- **为什么**：在 Ghostty 里跑的 pi 会话敲 `/open-diff` 直接报「连不上 cmux」，报错里只有 cmux 的 `Access denied - only processes started inside cmux can connect`。两个原因叠在一起：① 扩展找 CLI 只看 `CMUX_BUNDLED_CLI_PATH`（只有 cmux 启动的进程才有）和 PATH 上的 `cmux`（本机没装），在别的终端里根本找不到二进制；② cmux 的自动化 socket 默认 `cmuxOnly`，只接受 cmux 自己启动的进程树，外部进程一律拒。前者是扩展的锅，后者是 cmux 的默认安全档位。
- **改了什么**：① `cmuxCandidates()` 增加 app 包内 CLI 的发现——扫 `/Applications` 与 `~/Applications` 下的 `cmux*.app`，取 `Contents/Resources/bin/cmux`（release / staging 并存时全收）；② `runCmux()` 改成「候选 CLI × 候选 socket」矩阵重试：先按默认解析试（CLI 自己读 marker 文件），失败再显式带 `--socket` 逐个重试，这样才能配对上「哪个 app 真在跑」；③ 命中 `Access denied` 时，报错里直接写明原因是 `automation.socketControlMode = cmuxOnly`，以及改成 `automation` 或改在 cmux 里启动 pi 两种解法。
- **顺带修掉 `/close-diff` 在外部终端关不掉**：`cmux close-surface --surface <ref>` 要调用者上下文（env 里的 `CMUX_WORKSPACE_ID`，或 cwd 能匹配到某个 workspace），外部终端里两者都没有，CLI 直接报「close-surface requires --workspace or --window with explicit --surface」。现在命中这条错误时先遍历窗口的 panel 列表定位该 surface 属于哪个窗口，再带 `--window` 重试。
- **再修 `/close-diff` 报「没关掉」但其实面板早就不在**：登记文件里可能留着已经不存在的 surface（面板被手动关掉、cmux 重启过）。旧逻辑在「定位窗口」这一步查不到时直接拿第一条错误去报失败，界面上什么也没有、用户只看到一句「没关掉」。现在结果分三种——找到窗口／任何窗口都没有这个 surface（按已关闭处理并清掉登记）／查询本身失败（保留原错误）——不再把「已经没了」当成「关不掉」。
- **验证**：`node --experimental-strip-types --check diff-view.ts` 通过；在本机 Ghostty 会话（无 `CMUX_BUNDLED_CLI_PATH`、PATH 无 `cmux`）实测发现到 `/Applications/cmux STAGING xhqing.app/Contents/Resources/bin/cmux`，配合 `/tmp/cmux-staging-xhqing.sock` 能列出窗口；cmux 侧把 `automation.socketControlMode` 设成 `automation` 后，同一条命令从「Access denied」变为正常返回。
- **边界**：`automation` 档放开到「同一 macOS 用户的本地进程」，等于本机任何同用户进程都能控制 cmux（含往终端里发命令）；共用机器建议保持 `cmuxOnly`、把 pi 放在 cmux 里跑。

## [1.0.3] - 2026-11-06

### 变更（撤回临时 patch 中转，根因改在 cmux CLI 源码修复）

- **为什么**：1.0.2 为了在窗口路由冲突时保住 last-turn 内容，去读 cmux 写在 `/tmp/cmux-diff-viewer-<uid>/` 的临时 patch 再重开面板。用户指出 `/tmp` 是随时会被清理的临时目录，不该拿它做依赖；而且 `xhqing/cmux` 是我们自己维护的项目，正确做法是直接改 CLI 源码，而不是在扩展里绕一圈。
- **改了什么**：① 在 `xhqing/cmux` 的 `CLI/cmux_open.swift`（PR #20）修根因——`runDiffCommand` 不再把环境变量注入的 `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` 塞进 `browser.open_split` 的路由参数，只把用户显式指定的 `--window` / `--workspace` / `--surface` 用作面板目标，环境变量仍只用于定位 last-turn 基线；② 本扩展删掉 `SOURCE_TITLES`、`diffViewerDir()` / `patchNames()` / `findReplayPatch()` 与整段 patch 重放逻辑，不再读写 `/tmp` 下的任何文件；③ 对尚未更新的旧版 app 保留一段极简兼容：命中冲突或 socket 断连时去掉两个环境变量重试，`last-turn` 暂时退到 `unstaged`，等 cmux 新版本构建后这段自然不再触发。
- **验证**：cmux 侧 `swiftc -parse CLI/cmux_open.swift` 通过；本扩展 `node --experimental-strip-types --check` 与 36 个扩展文件语法复核通过，真实 cmux 回归三场景通过；grep 确认源码里已无 `cmux-diff-viewer` / `viewer.patch` / `findReplayPatch` 等残留。
- **边界**：当前运行的 cmux app 仍是旧 CLI 二进制（本机与 macmini 都没有完整 Xcode，源码改动要等构建/发版才进 app），因此在更新前 `/open-diff` 遇到冲突会走兼容降级；cmux 新版本里根因已消除，last-turn 直接可用。

## [1.0.2] - 2026-11-06

### 修复（窗口路由冲突不再降级，last-turn 内容原样保留）

- **为什么**：1.0.1 为了让面板在 `Conflicting Dock routing selectors` 时还能打开，把 `last-turn` 降成 `unstaged`，并在 TODO 里挂了「等上游 cmux 修好后去掉降级」（T3）。这不对：cmux 是我们自己维护的分叉，而且修复不该等任何新版本——CLI 在拒绝打开面板之前已经把本轮 patch 算好并写到临时目录，扩展自己捡回来重开即可，不需要 cmux 改一行代码。
- **改了什么**：`openDiff()` 在调用前后比对 cmux 的 diff viewer 临时目录，找出这次新写出且非空的 patch；遇到路由冲突（以及同类请求常伴随的 socket 断连）就用这个 patch 调 `cmux diff <patch> --title <来源标题>`、去掉 `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` 重开面板，来源和内容都不变。找不到 patch 时才退回原来的 `unstaged` 兜底。新增 `SOURCE_TITLES` 与 `diffViewerDir()` / `patchNames()` / `findReplayPatch()` / `cleanRoutingEnv()` 四个小函数，重试触发条件也覆盖 `Broken pipe` / `Socket closed before reply`。
- **验证**：mock pi API 加载扩展、接真实 cmux 跑三类场景——用临时基线目录（`CMUX_AGENT_HOOK_STATE_DIR`）构造一条匹配的 last-turn 基线，冲突后提示「已用 cmux 算好的本轮 patch 重新打开；来源不变」且面板打开；无基线时退回 unstaged；`staged` 冲突时保留原来源；面板都能用 `/close-diff` 关掉。`node --experimental-strip-types --check` 通过。
- **边界**：重开依赖 cmux 把 patch 写在 `/tmp/cmux-diff-viewer-<uid>/` 且文件名以 `-viewer.patch` 结尾；将来 cmux 改了这套临时目录布局，找不到 patch 就自动走 unstaged 兜底，不会打不开面板。TODO T3 已归档（问题在本项目内解决，不再等任何上游）。

## [1.0.1] - 2026-11-06

### 修复（cmux 的 Dock 路由冲突导致 `/open-diff` 完全打不开面板）

- **为什么**：2026-11-06 用户实测 `/open-diff` 报 `Error: invalid_params: Conflicting Dock routing selectors`（source=last-turn），面板一个也开不出来。根因在 cmux：`cmux diff` 会把 `CMUX_WORKSPACE_ID` 与 `CMUX_SURFACE_ID` 一起作为 `workspace_id` / `surface_id` 路由选择器交给 `browser.open_split`；当终端在 Dock 里、或这两个环境变量与当前窗口对不上时，服务端的 Dock 路由判定认为两个选择器互相矛盾，直接拒绝创建面板。本机实测复现：`cmux diff --workspace <普通 workspace id>` 必现冲突，把 workspace 换成当前窗口 id、或干脆不带选择器就正常。
- **改了什么**：`diff-view.ts` 加入冲突检测与自动重试——首次调用若返回 `Conflicting Dock routing selectors`，就从子进程环境里去掉 `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` 再调一次，让 cmux 走默认窗口路由。`last-turn` 的内容定位依赖这两个值，因此这种情况下退到 `unstaged`（工作区全部改动）并在提示里写明；`unstaged` / `staged` / `branch` 保持用户要的来源不变。`run()` / `runCmux()` 增加可选的 env 参数以支持覆盖；两次都失败时保留原始错误，并注明已经重试过。
- **验证**：用 mock pi API 加载扩展、接真实 cmux 跑三个场景——`/open-diff last-turn`（冲突 → 降级 unstaged → 面板打开）、`/open-diff staged`（冲突 → 保留来源重试 → 面板打开）、`/close-diff --all`（两个面板都关掉）；`node --experimental-strip-types --check` 语法检查通过。
- **边界**：重试时不带选择器，多窗口场景下面板会开在 cmux 的默认窗口；上游修好路由冲突后应去掉这段降级（见 TODO T3）。

## [1.0.0] - 2026-11-05

### 变更（架构重写：VSCode 双组件 → cmux 单扩展）

- **为什么**：用户 2026-11-05 要求「把 diff-view 改成适用于 cmux 的版本，只要 `/open-diff` / `/close-diff` 两条斜杠命令就够」。cmux 自带 diff viewer（`cmux diff` 渲染面板、`cmux close-surface` 关面板），原方案里「抓改动前快照 + VSCode 侧静默关标签」的两半组合已失去意义：快照目录曾涨到约 925 MB，而 cmux 的 `--last-turn` 基线直接给出了「这一轮 AI 改了什么」。
- **改了什么**：项目重写为单一 pi 扩展 `diff-view.ts`——注册 `/open-diff`、`/close-diff` 两条命令与 `open_diff`、`close_diff` 两个工具；打开时调 `cmux diff --<source> --cwd <仓库>`，从输出解析面板引用并登记到 `~/.pi/agent/state/cmux-diff/opened.json`；关闭时按登记逐个 `cmux close-surface`，已被手动关掉的面板按已关闭处理并清理登记。支持四种来源：`last-turn`（这一轮 AI 改动）、`unstaged`（默认后备）、`staged`、`branch`；来源省略时自动判断（有本轮基线用 last-turn，否则 unstaged）。
- **关闭的作用域**：默认只关本会话打开的面板，`--all` 关全部，给路径只关该仓库——不碰用户自己开的面板与终端。
- **焦点策略**：手敲斜杠命令切到面板；AI 调工具时传 `--no-focus`，不打断用户。
- **socket 自愈**：cmux app 重启后环境变量里的 socket 可能过期，扩展在默认解析失败后会拿 `CMUX_SOCKET` / `CMUX_SOCKET_PATH` 与 `~/Library/Application Support/cmux/*-last-socket-path` 的候选路径重试。
- **移除**：`diff-view-pie/`、`diff-view-vsce/`、`build.sh`（不再有 VSIX 产物与「请求文件 + 确认文件」协议），以及快照 / 镜像 / 跨会话变更通知那一整套机制（根因见上：内容交给 cmux，本扩展不做文件跟踪）。
- **验证**：用 jiti 加载扩展、mock pi API 跑通九个场景——自动 source、显式 staged、不存在的路径、非 git 目录、非法 source、`/close-diff` 关本会话、重复关闭提示、`/open-diff last-turn`、`/close-diff --all`；真实 cmux 面板的打开与关闭均成功。
- **已知边界**（记入 README）：cmux 面板内的 source 切换器切「Last turn」不生效（其 sidecar 不支持 last-turn 作为可切换来源，属上游问题），要看 last-turn 请用 `/open-diff last-turn` 重开面板。

## [未发布]

### 注销（2026-10-31 用户决定，功能停用）

- **为什么**：用户认为需要看 diff 时，用 `add-mode` / `commit-mode` 暂停自动提交即可（改动保留在工作区，直接 `git diff` / `git diff --cached`），不再需要专门的快照工具。原先每步 AI 编辑都要留快照，状态目录累计约 925MB。
- **做了什么**：卸载两个扩展（`~/.pi/agent/extensions/diff-view.ts` 与 VSCode 扩展 `xhqing.diff-view-vsce`），清理 `~/.pi/agent/state/ai-edit-diff` 快照目录；README 顶部加注销说明（中英双语）。项目代码与 GitHub 仓库保留作存档，不再维护。不涉版本号（不发版）。
- **能力差异**（如实记录）：暂停自动提交后看到的是 `git diff` 的累计改动（相对暂存区或 HEAD）；原工具能逐步回看每次 AI 编辑的前后快照。需要逐步历史时用 `git log -p` 或分段提交。

### 变更（`.pi` 由软链接改为真实目录 + 资源引用：全局规矩 2026-10-30 修订）

- **为什么改**：2026-10-30 用户修订了子项目的智能体专属文件规则。旧形态把 `.pi` 整个挂成指向负责 Agent 的软链接，「共享」与「独占」被压在同一个符号上：子项目要放自己的配置时无处安放，硬写进 `.pi` 等于直接写进 Kit 的 Agent 项目——会瞬间影响全部兄弟子项目、并进 Agent 仓库的 git 历史。新规则分层：身份层（`AGENTS.md`）继续保持软链接一致（pi 的上下文文件没有 include 机制，超集只能靠复制、复制必然漂移）；能力层（`.pi/`）改在子项目里建真实目录，用 `settings.json` 以**路径引用** Agent 项目的资源目录，本地专属内容放自己的目录——行为上是超集，结构上无副本、不漂移。
- **改了什么**：删除 `.pi` 软链接（原指向 `../ExecutiveAssistantAgent/.pi`），改为真实目录加 `.pi/settings.json`：`extensions` / `skills` / `prompts` / `themes` 四组各指向 `~/Developer/ExecutiveAssistantAgent/.pi/` 下对应目录，并附带本地 `./extensions` / `./skills` / `./prompts` / `./themes`（本地目录不存在时自动跳过）。`AGENTS.md` 软链接保持不变。本项仅涉及开发环境配置，**不影响扩展功能与 vsix 产物**，不涉版本号。
- **验证**：据 pi 官方文档（`settings.md`「Resources」、`skills.md` / `extensions.md`）；同批在 `xhqing` 子项目实跑 `pi --approve -p`，技能与项目级扩展均从 Agent 项目加载成功。
- **规则出处**：全局 `~/.pi/agent/docs/agents-registry.md`「智能体专属文件归属与子项目映射（2026-10-30 修订）」节。

## [0.2.1] - 2026-10-20

### Added

- VS Code 扩展图标：`diff-view-vsce/icon.png`（512×512 圆角方形、indigo 渐变、双窗格 + 跨桥弧线——与项目 logo 同一套符号）；`package.json` 的 `icon` 字段指向它，扩展详情页 / 列表不再显示默认占位图。

### Fixed

- CI workflow YAML 语法错误修复：步骤名里的冒号未加引号，导致 GitHub Actions 无法解析、启动即失败（0 秒失败、无任务）；已加本地 YAML 校验并推送后验证 CI 运行。

## [0.2.0] - 2026-10-19

### Changed

- **整合为 diff-view 项目（两个组件、一次安装）**：2026-10-18 用户决定——pi 侧与 VSCode 侧本是一个功能，应放同一个项目。原 `diff-bridge` 拆为两个组件：
  - `diff-view-pie/`：pi 侧扩展（源 `diff-view.ts`，部署到 `~/.pi/agent/extensions/`）；
  - `diff-view-vsce/`：VS Code 侧扩展（原项目主体代码迁入；扩展身份 `xhqing.diff-bridge` → `xhqing.diff-view-vsce`，名称 / 显示名 / 命令 id / 输出渠道 / 状态栏文案同步更新）。
- 新增 `install.sh`：一次安装两个组件（pi 侧拷贝部署 + VS Code 侧打包安装，含旧 `xhqing.diff-bridge` 卸载）；README 双语重写，说明两个组件各自职责、都必须安装、协作机制与排障。
- logo 更名为 `diff-view`（双窗格 + 跨桥弧线不变）；版本号 0.1.0 → 0.2.0。
- 内部管道不变（有意）：状态目录 `~/.pi/agent/state/ai-edit-diff/` 与环境变量 `AI_EDIT_DIFF_*` 保持原名——两个组件与旧版本会话都指向它们，改名会打断请求 / 确认协议。

### Added

- `build.sh`：产出**唯一**发布产物 `dist/diff-view-<version>.zip`——内含 `diff-view-vsce-<version>.vsix`（VS Code 侧）与 `diff-view.ts`（pi 侧），两个组件共用项目 `VERSION` 版本号（构建前校验与 `package.json` 一致）；`install.sh` 改为基于该产物安装 VS Code 侧。
- `.github/workflows/ci.yml`：JS 语法检查、shell 语法检查、版本号一致性（`VERSION` ↔ `package.json` / CHANGELOG / README 徽章）、产物构建冒烟（校验 zip 内含两个组件）。
- 开源到 GitHub：公开仓库 `xhqing/diff-view`（README 与 vsix 元数据里的地址自此生效）；发布 `v0.2.0`，产物为上述 zip。

## 2026-10-18

### Changed

- 引用更名：全局 pi 扩展 `ai-edit-diff` → `diff-view`（原名把范围说窄成「AI 编辑产生的 diff」，实际定位是「独立于 git 的文件内容 diff 视图」）。README 双语与 `extension.js` 注释同步更新（双语文案语义对齐）；pi 状态目录 `~/.pi/agent/state/ai-edit-diff/` 不变——已装版本的扩展仍指向它，运行行为零变化。

### Added

- 项目标配补齐（commit skill 第 9 步）：`assets/logo.svg`（项目象征 logo——双窗格 + 跨桥弧线、indigo 渐变，文字全英文）、README 双语顶部 logo + License/Version/Type 徽章块、双语底部「版权与署名」段；配套写入 `.commit-cache.md` 检测缓存。

## [0.1.0] - 2026-10-18

### Added

- **diff-bridge 初版**：pi「改动可视化」的 VSCode 侧助手。每个 VSCode 窗口内每 1 秒轮询 pi 的关闭请求（`~/.pi/agent/state/ai-edit-diff/close-requests/`），把请求落实为「静默关闭由 pi 打开的 diff 标签」（只关左侧为 pi 改动前快照的 diff；`preserveFocus` 不抢焦点），并把关闭数量回写为确认（`close-acks/`），供 pi 的 `/close-diff` 命令与 `close_diff` 工具汇总回报用户。
- 请求有效性：只处理 30 秒内写入的请求，过期请求与确认文件自动清理（多窗口各自轮询、互不影响）。
- 命令面板命令：「Diff Bridge: 关闭全部由 pi 打开的 diff 标签」（手动兜底）。
- 输出渠道 `diff-bridge`：记录处理过的请求与关闭数量，便于排障。

### Why

- pi 侧 2026-10-18 新增 `/open-diff`、`/close-diff` 命令（用户需求：diff 的打开 / 关闭做成可直接键入的命令）。VSCode 没有「从外部关闭标签页」的官方接口——`code` CLI 无子命令、AppleScript 查不了 VSCode 窗口（实测 `-1728`）、UI 脚本抢焦点——因此把「关闭」这一步放进 VSCode 内部执行：由本扩展消费 pi 写下的请求文件。

### Project

- 初始项目骨架：`extension.js`（轮询与关闭逻辑）、`lib/util.js`（纯逻辑，便于测试）、README 双语、CHANGELOG、VERSION、LICENSE。
