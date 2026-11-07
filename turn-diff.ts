/**
 * turn-diff.ts — 看「这一轮 AI 改了什么」（pi 扩展，纯 git）。
 *
 * 一个功能：每一轮开始时记一个 git 基线，轮次结束时把「基线 → 当前工作区」的增量算出来，
 * 需要时贴进会话或从命令行读。不碰其它 diff 场景（没有面板、没有全量对比模式之外的东西）。
 *
 * 两种用法：
 *   - 会话内（`/turn-diff`）：把最近一轮的统计与 patch 贴进会话，custom entry 只落盘 + 渲染，
 *     不进 LLM 上下文、不耗 token。
 *   - 命令行（`turn-diff`）：读同一份落盘状态，在任意终端打印，不启动 pi、不触发轮次。
 *
 * 基线怎么来的：`git stash create` 把「这一轮开始时已跟踪文件的脏改动」固化成一个游离提交
 * （不写 ref、不动工作区），再配合 `git status` 记下当时的未跟踪文件。结束时 `git diff 基线`
 * 就是本轮增量；新冒出来的未跟踪文件按「新建文件」算。
 *
 * 部署：本文件是 turn-diff 项目的 pi 扩展；install.sh 把副本拷到
 * ~/.pi/agent/extensions/turn-diff.ts（勿直接改副本）。新会话自动生效，已开会话用 /reload。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { Box, Text } from "pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ===== 常量 =====

/** 状态目录（扩展与命令行共用）。 */
const STATE_DIR = path.join(os.homedir(), ".pi/agent/state/turn-diff");
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
const BASELINE_STATE_FILE = path.join(STATE_DIR, "turn-baseline.json");
const LAST_REPORT_FILE = path.join(STATE_DIR, "last-turn.json");

/** 会话内卡片的 entry 类型。 */
const ENTRY_TYPE = "turn-diff-report";
/** 每个仓库最多留几轮。 */
const MAX_STORED_TURNS = 20;
/** 单轮 patch 最多存多少字符（超了截断，统计仍然完整）。 */
const MAX_STORED_PATCH = 80_000;
/** 未跟踪文件超过这个大小就不并进 patch。 */
const MAX_UNTRACKED_BYTES = 200_000;
/** 不展开卡片时最多列几个文件。 */
const VISIBLE_FILES = 8;
/** 自动贴的卡片如果带正文，折叠时只画这么多行（手动要正文时全量渲染）。 */
const VISIBLE_PATCH_LINES = 30;
/** 行内高亮最多处理多少个 token（太长的行只做整行底色）。 */
const MAX_INLINE_TOKENS = 400;

// 底色（256 色）：暗绿 / 亮绿 / 暗红 / 亮红，配白字保证对比度
const C = {
  reset: "\u001b[0m",
  fg: "\u001b[38;5;231m",
  add: "\u001b[48;5;22m",
  addStrong: "\u001b[48;5;28m",
  del: "\u001b[48;5;52m",
  delStrong: "\u001b[48;5;88m",
  addFg: "\u001b[38;5;120m",
  delFg: "\u001b[38;5;210m",
};

// ===== 基础工具 =====

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  error?: string;
}

function run(command: string, args: string[], cwd?: string, timeoutMs = 30_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error: any, stdout: string, stderr: string) => {
        const code = typeof error?.code === "number" ? error.code : error ? null : 0;
        resolve({
          ok: !error,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          code,
          error: error ? String(error.message ?? error) : undefined,
        });
      },
    );
  });
}

const git = (cwd: string, args: string[]) => run("git", args, cwd);

function canonicalPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

async function gitRoot(dir: string): Promise<string | null> {
  const result = await git(dir, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) return null;
  const root = result.stdout.trim().split("\n")[0];
  return root ? canonicalPath(root) : null;
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch {
    // 状态写不进去只影响 CLI 与下次读取，不影响本次会话
  }
}

// ===== 设置（是否每轮自动贴卡片） =====

interface Settings {
  autoPost: boolean;
}

function loadSettings(): Settings {
  const parsed = readJsonFile<{ autoPost?: boolean }>(SETTINGS_FILE);
  // 默认不主动贴：要看就手敲命令。
  return { autoPost: parsed?.autoPost === true };
}

function saveSettings(settings: Settings): void {
  writeJsonFile(SETTINGS_FILE, settings);
}

// ===== 基线与报告的数据结构 =====

interface TurnBaseline {
  repoRoot: string;
  head: string;
  /** `git stash create` 的结果；工作区干净时为 null。 */
  snapshot: string | null;
  /** 基线时刻未跟踪文件 → 指纹（大小 + mtime）。 */
  untracked: Record<string, string>;
}

/** 只剩一种口径：本轮增量。 */

interface ReportFile {
  path: string;
  added: number;
  deleted: number;
  kind: "modified" | "added" | "deleted" | "renamed";
  binary?: boolean;
}

interface ReportData {
  repoName: string;
  repoRoot: string;
  files: ReportFile[];
  added: number;
  deleted: number;
  /** 本轮 unified diff 正文（可选；CLI 的 --patch 与会话里的 patch 卡用它）。 */
  patch?: string;
  patchTruncated?: boolean;
  /** 只在 `/turn-diff file` 时置位：卡片里渲染正文。 */
  showPatch?: boolean;
  /** 正文是否全量渲染（显式要过正文就是 true，不再按 30 行折叠）。 */
  fullPatch?: boolean;
}

interface StoredTurn extends ReportData {
  sessionId: string;
  generatedAt: number;
}

interface BaselineState {
  version: number;
  sessions: Record<string, TurnBaseline & { sessionId: string; capturedAt: number }>;
}

interface LastReportState {
  version: number;
  repos: Record<string, { turns: StoredTurn[] }>;
}

// ===== 基线 =====

function fingerprintFile(absPath: string): string {
  try {
    const stat = fs.statSync(absPath);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return "";
  }
}

/** `git status --porcelain -z` → `{ code, path }`；重命名 / 复制取新路径。 */
function parseStatusEntries(buffer: string): Array<{ code: string; path: string }> {
  const chunks = buffer.split("\0");
  const entries: Array<{ code: string; path: string }> = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const code = chunk.slice(0, 2);
    const entryPath = chunk.slice(3);
    if (code.startsWith("R") || code.startsWith("C")) index += 1;
    entries.push({ code, path: entryPath });
  }
  return entries;
}

function countFileLines(absPath: string): number {
  try {
    const text = fs.readFileSync(absPath, "utf8");
    if (!text) return 0;
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return 0;
  }
}

/** 记本轮基线；不在 git 仓库、或仓库还没有提交时返回 null。 */
async function captureTurnBaseline(cwd: string): Promise<TurnBaseline | null> {
  const repoRoot = await gitRoot(cwd);
  if (!repoRoot) return null;
  const headResult = await git(repoRoot, ["rev-parse", "HEAD"]);
  if (!headResult.ok) return null;
  const head = headResult.stdout.trim();
  if (!head) return null;
  const stashResult = await git(repoRoot, ["stash", "create"]);
  const snapshot = stashResult.ok && stashResult.stdout.trim() ? stashResult.stdout.trim() : null;
  const untracked: Record<string, string> = {};
  const statusResult = await git(repoRoot, ["status", "--porcelain", "-z"]);
  if (statusResult.ok) {
    for (const entry of parseStatusEntries(statusResult.stdout)) {
      if (entry.code !== "??") continue;
      untracked[entry.path] = fingerprintFile(path.join(repoRoot, entry.path));
    }
  }
  return { repoRoot, head, snapshot, untracked };
}

// ===== 从基线算增量 =====

async function buildTurnReport(baseline: TurnBaseline): Promise<ReportData | null> {
  const { repoRoot, head, snapshot } = baseline;
  const base = snapshot ?? head;
  const numstat = await git(repoRoot, ["diff", "--numstat", base]);
  if (!numstat.ok) return null;

  const kinds = new Map<string, ReportFile["kind"]>();
  const nameStatus = await git(repoRoot, ["diff", "--name-status", base]);
  if (nameStatus.ok) {
    for (const line of nameStatus.stdout.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const target = parts[parts.length - 1];
      if (!target) continue;
      const letter = parts[0];
      kinds.set(
        target,
        letter.startsWith("A") ? "added" : letter.startsWith("D") ? "deleted" : letter.startsWith("R") ? "renamed" : "modified",
      );
    }
  }

  const files: ReportFile[] = [];
  let added = 0;
  let deleted = 0;
  for (const line of numstat.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t");
    if (!filePath) continue;
    const binary = addedRaw === "-" || deletedRaw === "-";
    const plus = binary ? 0 : Number(addedRaw) || 0;
    const minus = binary ? 0 : Number(deletedRaw) || 0;
    added += plus;
    deleted += minus;
    files.push({ path: filePath, added: plus, deleted: minus, kind: kinds.get(filePath) ?? "modified", binary });
  }

  // 这一轮新出现的未跟踪文件：整份算新增
  const statusResult = await git(repoRoot, ["status", "--porcelain", "-z"]);
  if (statusResult.ok) {
    for (const entry of parseStatusEntries(statusResult.stdout)) {
      if (entry.code !== "??") continue;
      if (baseline.untracked[entry.path] !== undefined) continue;
      const lines = countFileLines(path.join(repoRoot, entry.path));
      added += lines;
      files.push({ path: entry.path, added: lines, deleted: 0, kind: "added" });
    }
  }

  if (files.length === 0) return null;
  files.sort((left, right) => right.added + right.deleted - (left.added + left.deleted));
  return { repoName: path.basename(repoRoot), repoRoot, files, added, deleted };
}

/** 生成这一轮的 unified diff（已跟踪文件 + 新出现的未跟踪文件）。 */
async function buildTurnPatch(baseline: TurnBaseline): Promise<{ patch: string; truncated: boolean }> {
  const { repoRoot, head, snapshot } = baseline;
  const base = snapshot ?? head;
  const chunks: string[] = [];
  const tracked = await git(repoRoot, ["diff", "--no-color", "--no-ext-diff", base]);
  if (tracked.ok && tracked.stdout.trim()) chunks.push(tracked.stdout);
  const statusResult = await git(repoRoot, ["status", "--porcelain", "-z"]);
  if (statusResult.ok) {
    for (const entry of parseStatusEntries(statusResult.stdout)) {
      if (entry.code !== "??") continue;
      if (baseline.untracked[entry.path] !== undefined) continue;
      const abs = path.join(repoRoot, entry.path);
      let text = "";
      try {
        if (fs.statSync(abs).size > MAX_UNTRACKED_BYTES) continue;
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      const body = lines.map((line) => `+${line}`).join("\n");
      chunks.push(
        `diff --git a/${entry.path} b/${entry.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${entry.path}\n` +
          `@@ -0,0 +1,${lines.length} @@\n${body}\n`,
      );
    }
  }
  const patch = chunks.join("");
  if (patch.length <= MAX_STORED_PATCH) return { patch, truncated: false };
  return { patch: patch.slice(0, MAX_STORED_PATCH), truncated: true };
}

// ===== 落盘 =====

function persistBaseline(sessionKey: string, baseline: TurnBaseline): void {
  const state = readJsonFile<BaselineState>(BASELINE_STATE_FILE) ?? { version: 1, sessions: {} };
  state.version = 1;
  state.sessions[sessionKey] = { ...baseline, sessionId: sessionKey, capturedAt: Date.now() };
  const keys = Object.keys(state.sessions);
  if (keys.length > 20) {
    keys
      .sort((left, right) => (state.sessions[left].capturedAt ?? 0) - (state.sessions[right].capturedAt ?? 0))
      .slice(0, keys.length - 20)
      .forEach((key) => delete state.sessions[key]);
  }
  writeJsonFile(BASELINE_STATE_FILE, state);
}

function persistLastReport(sessionKey: string, repoRoot: string, report: ReportData | null): void {
  if (!report) return;
  const state = readJsonFile<LastReportState>(LAST_REPORT_FILE) ?? { version: 2, repos: {} };
  state.version = 2;
  const bucket = (state.repos[repoRoot] ??= { turns: [] });
  bucket.turns.unshift({ ...report, sessionId: sessionKey, generatedAt: Date.now() });
  bucket.turns = bucket.turns.slice(0, MAX_STORED_TURNS);
  writeJsonFile(LAST_REPORT_FILE, state);
}

function readStoredTurn(repoRoot: string, index = 0): StoredTurn | null {
  const state = readJsonFile<LastReportState>(LAST_REPORT_FILE);
  const bucket = state?.repos?.[repoRoot];
  if (!bucket || !Array.isArray(bucket.turns) || bucket.turns.length === 0) return null;
  return bucket.turns[Math.min(Math.max(index, 0), bucket.turns.length - 1)] ?? null;
}

// ===== 彩色渲染：整行底色 + 行内改动片段高亮 =====

type PatchLineKind = "add" | "del" | "context" | "meta";

interface PatchLine {
  kind: PatchLineKind;
  text: string;
}

function classifyPatchLine(line: string): PatchLine {
  const isHeader =
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("@@") ||
    /^--- (a\/|\/dev\/null)/.test(line) ||
    /^\+\+\+ (b\/|\/dev\/null)/.test(line);
  if (isHeader) {
    return { kind: "meta", text: line };
  }
  if (line.startsWith("+")) return { kind: "add", text: line.slice(1) };
  if (line.startsWith("-")) return { kind: "del", text: line.slice(1) };
  return { kind: "context", text: line.startsWith(" ") ? line.slice(1) : line };
}

/** 切成词元，保留空白与标点，方便做行内 diff。 */
function tokenize(line: string): string[] {
  return line.match(/\s+|\w+|[^\s\w]/g) ?? [];
}

/** 两行之间的 token 级 LCS：返回每段属于 `equal` / `del` / `add`。 */
function inlineTokens(removed: string, added: string): { del: Array<[string, boolean]>; add: Array<[string, boolean]> } {
  const left = tokenize(removed);
  const right = tokenize(added);
  if (left.length === 0 || right.length === 0 || left.length > MAX_INLINE_TOKENS || right.length > MAX_INLINE_TOKENS) {
    return { del: [[removed, true]], add: [[added, true]] };
  }
  // LCS 表：left.length × right.length
  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const del: Array<[string, boolean]> = [];
  const add: Array<[string, boolean]> = [];
  let i = 0;
  let j = 0;
  const push = (list: Array<[string, boolean]>, text: string, strong: boolean) => {
    const last = list[list.length - 1];
    if (last && last[1] === strong) last[0] += text;
    else list.push([text, strong]);
  };
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push(del, left[i], false);
      push(add, right[j], false);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push(del, left[i], true);
      i += 1;
    } else {
      push(add, right[j], true);
      j += 1;
    }
  }
  while (i < left.length) {
    push(del, left[i], true);
    i += 1;
  }
  while (j < right.length) {
    push(add, right[j], true);
    j += 1;
  }
  return { del, add };
}

function paint(segments: Array<[string, boolean]>, baseBg: string, strongBg: string): string {
  return segments
    .map(([text, strong]) => `${C.fg}${strong ? strongBg : baseBg}${text}${C.reset}`)
    .join("");
}

/** 把 patch 文本渲染成「带底色的行数组」：新增绿底、删除红底，行内改动片段用更亮的底色。 */
function renderPatch(patch: string): string[] {
  const lines = patch.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const parsed = lines.map(classifyPatchLine);
  const out: string[] = [];
  let index = 0;
  while (index < parsed.length) {
    const current = parsed[index];
    if (current.kind === "del") {
      // 收集连续的 - 行与紧随其后的 + 行，按顺序一一配对做行内高亮
      const dels: string[] = [];
      while (index < parsed.length && parsed[index].kind === "del") {
        dels.push(parsed[index].text);
        index += 1;
      }
      const adds: string[] = [];
      let lookahead = index;
      while (lookahead < parsed.length && parsed[lookahead].kind === "add") {
        adds.push(parsed[lookahead].text);
        lookahead += 1;
      }
      const pairs = Math.min(dels.length, adds.length);
      for (let k = 0; k < dels.length; k += 1) {
        if (k < pairs) {
          const { del } = inlineTokens(dels[k], adds[k]);
          out.push(`- ${paint(del, C.del, C.delStrong)}`);
        } else {
          out.push(`- ${C.fg}${C.del}${dels[k]}${C.reset}`);
        }
      }
      for (let k = 0; k < adds.length; k += 1) {
        if (k < pairs) {
          const { add } = inlineTokens(dels[k], adds[k]);
          out.push(`+ ${paint(add, C.add, C.addStrong)}`);
        } else {
          out.push(`+ ${C.fg}${C.add}${adds[k]}${C.reset}`);
        }
      }
      index = lookahead;
      continue;
    }
    if (current.kind === "add") {
      out.push(`+ ${C.fg}${C.add}${current.text}${C.reset}`);
      index += 1;
      continue;
    }
    out.push(`  ${current.text}`);
    index += 1;
  }
  return out;
}

interface PatchChunk {
  path: string;
  text: string;
}

/**
 * 把整段 patch 按文件切开。
 *
 * 正常情况下每段都以 `diff --git a/x b/x` 开头；老版本落盘的 patch 里，未跟踪文件
 * 那几段没有这个头，只能靠 `--- /dev/null` + `+++ b/x` 认出来，这里两种都兼容。
 */
function splitPatchByFile(patch: string): PatchChunk[] {
  const lines = patch.split("\n");
  const chunks: PatchChunk[] = [];
  let current: string[] = [];
  let currentPath = "";
  const flush = () => {
    if (current.length > 0) chunks.push({ path: currentPath, text: current.join("\n") });
    current = [];
    currentPath = "";
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("diff --git ")) {
      flush();
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentPath = match ? match[2] : "";
      current.push(line);
      continue;
    }
    if (line === "--- /dev/null") {
      const match = /^\+\+\+ b\/(.+)$/.exec(lines[index + 1] ?? "");
      if (match) {
        // 老记录的未跟踪文件段没有 `diff --git` 头：碰到「另一个文件」就以这里为界切开。
        // 正常的新文件段 currentPath 已经等于它，不切。
        if (currentPath !== "" && currentPath !== match[1]) flush();
        currentPath = match[1];
      }
    }
    if (line === "" && index === lines.length - 1) continue;
    current.push(line);
  }
  flush();
  return chunks.filter((chunk) => chunk.text.trim() !== "");
}

/** 路径匹配：先按子串，再按 `*` / `?` 通配（都忽略大小写）。 */
function matchPath(candidate: string, pattern: string): boolean {
  const lowerCandidate = candidate.toLowerCase();
  const lowerPattern = pattern.toLowerCase();
  if (lowerCandidate.includes(lowerPattern)) return true;
  const regex = new RegExp(
    `^${lowerPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
    "i",
  );
  return regex.test(candidate);
}

/** 选择器里一行：`2. src/a.ts  +12 -3`。 */
function formatChunkLabel(chunk: PatchChunk, report: ReportData, index: number): string {
  const file = report.files.find((item) => item.path === chunk.path);
  if (!file) return `${index + 1}. ${chunk.path}`;
  const stat = file.binary ? "二进制" : `+${file.added} -${file.deleted}`;
  return `${index + 1}. ${chunk.path}  ${stat}`;
}

/** 找 cmux 的命令行（app 包内）；没装 cmux 时返回 null。 */
function findCmuxCli(): string | null {
  const homes = ["/Applications", path.join(os.homedir(), "Applications")];
  const found: string[] = [];
  for (const dir of homes) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!/^cmux.*\.app$/i.test(name)) continue;
        const cli = path.join(dir, name, "Contents/Resources/bin/cmux");
        if (fs.existsSync(cli)) found.push(cli);
      }
    } catch {
      // 目录不存在就跳过
    }
  }
  found.sort((left, right) => (left.includes("STAGING") ? -1 : right.includes("STAGING") ? 1 : 0));
  return found[0] ?? null;
}

/** HTML 转义：正文里的 < > & 不能原样塞进 span，否则会破坏结构。 */
function escapeHtml(text: string): string {
  // `~` 也要转义：否则原文里的 ~~删除线~~ 会被 markdown 当成真删除线，和本次改动混淆
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/~/g, "&#126;");
}

/** 原文里本来就有删除线 / 下划线标记吗（用来提示可能混淆）。 */
function hasOwnMarks(text: string): boolean {
  return /~~|\<\/?u\>|\<\/?ins\>|\<\/?del\>|\<\/?s\>/.test(text);
}

/**
 * 组装 `render` 交给 cmux markdown 面板的文档。
 *
 * 只呈现「红的删除行 / 绿的新增行」：整行套 `.hljs-deletion` / `.hljs-addition`（cmux 的
 * diff CSS 给了红/绿底色与浅色字，这是那个面板里唯一能用上颜色的方式——sanitizer 会清掉
 * 行内 style），行内真正变了的片段再用 `<del>` 划中划线、`<u>` 加下划线。上下文行一律不渲染，
 * 也不放源码围栏（要看源码请用 `/turn-diff file`）。
 */
function buildRenderDocument(chunkText: string): string {
  const lines = chunkText.split("\n");
  const out: string[] = [];
  let ambiguous = false;
  const wrap = (kind: "deletion" | "addition", line: string, segments: Array<[string, boolean]>, mark: "del" | "u") => {
    const body = segments
      .map(([text, strong]) => (strong ? `<${mark}>${escapeHtml(text)}</${mark}>` : escapeHtml(text)))
      .join("");
    out.push(`<span class="hljs-${kind}">${body}</span>`);
    out.push("");
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const isRemoved = line.startsWith("-") && !line.startsWith("--- ");
    const isAdded = line.startsWith("+") && !line.startsWith("+++ ");
    if (!isRemoved && !isAdded) {
      index += 1;
      continue;
    }
    // 收集连续的删除行与紧随其后的新增行，按顺序配对做词级 diff
    const removed: string[] = [];
    while (index < lines.length && lines[index].startsWith("-") && !lines[index].startsWith("--- ")) {
      removed.push(lines[index].slice(1));
      index += 1;
    }
    const added: string[] = [];
    while (index < lines.length && lines[index].startsWith("+") && !lines[index].startsWith("+++ ")) {
      added.push(lines[index].slice(1));
      index += 1;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      if (hasOwnMarks(removed[pair]) || hasOwnMarks(added[pair])) ambiguous = true;
      const { del, add } = inlineTokens(removed[pair], added[pair]);
      wrap("deletion", removed[pair], del, "del");
      wrap("addition", added[pair], add, "u");
    }
    for (const text of removed.slice(pairs)) {
      if (hasOwnMarks(text)) ambiguous = true;
      wrap("deletion", text, [[text, false]], "del");
    }
    for (const text of added.slice(pairs)) {
      if (hasOwnMarks(text)) ambiguous = true;
      wrap("addition", text, [[text, false]], "u");
    }
  }

  const header = [
    "**改动**：<span class=\"hljs-deletion\">红底=删除行</span>（被删的片段加<del>中划线</del>）、"
      + "<span class=\"hljs-addition\">绿底=新增行</span>（新增的片段加<u>下划线</u>）。未变动的行不在这里显示。",
  ];
  if (ambiguous) {
    header.push(
      "",
      "> ⚠️ 这一轮的改动内容里本来就有删除线 / 下划线标记（`~~`、`<u>`、`<ins>` 之类），下面的颜色与划线是本次改动的标记，可能和原文样式混在一起——原文里的标记这里一律按字面显示。",
    );
  }
  if (out.length === 0) {
    return "";
  }
  return [...header, "", ...out].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** 把「改后片段」写到临时文件并交给 cmux 的 markdown 面板（不抢焦点）。 */
async function openRenderedInCmux(chunk: PatchChunk): Promise<{ ok: boolean; message: string }> {
  const cli = findCmuxCli();
  if (!cli) return { ok: false, message: "没找到 cmux（/Applications 下没有 cmux*.app），无法渲染。" };
  const fragment = buildRenderDocument(chunk.text);
  if (!fragment.trim()) return { ok: false, message: "这个文件的改动没有可显示的内容。" };
  const target = path.join(os.tmpdir(), `turn-diff-view-${Date.now()}.md`);
  try {
    fs.writeFileSync(target, fragment + "\n");
  } catch (error) {
    return { ok: false, message: `写临时文件失败：${String(error)}` };
  }
  const result = await run(cli, ["markdown", "open", target, "--focus", "false"], undefined, 20_000);
  if (!result.ok) {
    return { ok: false, message: `cmux 渲染失败：${(result.stderr || result.error || "").trim().split("\n")[0]}` };
  }
  const surface = /surface=\S+/.exec(result.stdout)?.[0] ?? "";
  return { ok: true, message: `已交给 cmux 渲染改动片段：${chunk.path}（${surface || "面板已打开"}，未抢焦点）` };
}

/** 统计行的加减号上色（CLI 与会话共用同一套）。 */
function colorStat(kind: ReportFile["kind"], added: number, deleted: number): string {
  if (kind === "deleted") return `${C.delFg}-${deleted}${C.reset}`;
  if (kind === "added") return `${C.addFg}+${added}${C.reset}`;
  return `${C.addFg}+${added}${C.reset} ${C.delFg}-${deleted}${C.reset}`;
}

// ===== 会话内渲染 =====

function registerRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<ReportData>(ENTRY_TYPE, (entry: any, options: any, theme: any) => {
    const expanded = Boolean(options?.expanded);
    const data = entry?.data as ReportData | undefined;
    const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
    if (!data || data.files.length === 0) {
      box.addChild(new Text(theme.fg("dim", "没有文件变化"), 0, 0));
      return box;
    }
    const title = "本轮改动";
    box.addChild(
      new Text(
        theme.fg("accent", `${title} · ${data.files.length} 个文件 · +${data.added} -${data.deleted} · ${data.repoName}`),
        0,
        0,
      ),
    );
    const limit = expanded ? data.files.length : Math.min(VISIBLE_FILES, data.files.length);
    data.files.slice(0, limit).forEach((file, index) => {
      const mark = file.kind === "added" ? "A" : file.kind === "deleted" ? "D" : file.kind === "renamed" ? "R" : "M";
      const stat = file.binary ? "二进制" : colorStat(file.kind, file.added, file.deleted);
      box.addChild(new Text(`  ${index + 1}. ${mark} ${file.path}  ${stat}`, 0, 0));
    });
    if (data.files.length > limit) {
      box.addChild(new Text(theme.fg("dim", `  …还有 ${data.files.length - limit} 个文件（展开查看）`), 0, 0));
    }
    if (data.showPatch && data.patch) {
      const painted = renderPatch(data.patch);
      const patchLimit = expanded || data.fullPatch ? painted.length : VISIBLE_PATCH_LINES;
      for (const line of painted.slice(0, patchLimit)) {
        box.addChild(new Text(line, 0, 0));
      }
      if (painted.length > patchLimit) {
        box.addChild(new Text(theme.fg("dim", `  …patch 还有 ${painted.length - patchLimit} 行（展开查看）`), 0, 0));
      }
      if (data.patchTruncated) {
        box.addChild(new Text(theme.fg("dim", "  …patch 过长已截断"), 0, 0));
      }
    }
    return box;
  });
}

// ===== 扩展入口 =====

export default function (pi: ExtensionAPI) {
  let sessionId = "";
  let sessionCwd = process.cwd();
  let settings = loadSettings();
  let turnBaseline: TurnBaseline | null = null;

  registerRenderer(pi);

  pi.on("session_start", async (_event: any, ctx: any) => {
    try {
      sessionId = String(ctx?.sessionManager?.getSessionId?.() ?? "");
    } catch {
      sessionId = "";
    }
    if (!sessionId) sessionId = `pid-${process.pid}`;
    sessionCwd = String(ctx?.cwd ?? process.cwd());
  });

  pi.on("before_agent_start", async (_event: any, ctx: any) => {
    const cwd = String(ctx?.cwd ?? sessionCwd);
    try {
      turnBaseline = await captureTurnBaseline(cwd);
      if (turnBaseline) persistBaseline(sessionId, turnBaseline);
    } catch {
      turnBaseline = null;
    }
  });

  pi.on("agent_settled", async () => {
    const baseline = turnBaseline;
    turnBaseline = null;
    if (!baseline) return;
    try {
      const report = await buildTurnReport(baseline, "turn");
      if (report) {
        const { patch, truncated } = await buildTurnPatch(baseline);
        if (patch) {
          report.patch = patch;
          if (truncated) report.patchTruncated = true;
        }
      }
      persistLastReport(sessionId, baseline.repoRoot, report);
      if (settings.autoPost && report) pi.appendEntry(ENTRY_TYPE, report);
    } catch {
      // 汇报失败不影响 agent 本身
    }
  });

  pi.registerCommand("turn-diff", {
    description:
      "把上一轮 AI 改了什么贴进会话（纯 git）：不带参数给摘要，file 给正文（file 2 看某个文件），view 2 在 cmux 的 diff 面板打开该文件（词级高亮可开），render 2 在 cmux 的 markdown 面板渲染改后片段（公式可排版），on/off 切换自动贴",
    handler: async (args: string, ctx: any) => {
      const tokens = (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);

      // 词表：file（正文，别名 patch）/ head（相对 HEAD）/ on / off；数字与其它词按位置解释。
      let wantBody = false;
      let wantView = false;
      let wantRender = false;
      let turnIndex = 0;
      let fileFilter: string | null = null;
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === "on" || token === "off") {
          const on = token === "on";
          settings = { autoPost: on };
          saveSettings(settings);
          ctx?.ui?.notify?.(`每轮结束自动贴改动卡片已${on ? "开启" : "关闭"}。`, "info");
          return;
        }
        if (token === "head") {
          // 项目只做「本轮 diff」；和 HEAD 比是另一个问题，交给 git
          ctx?.ui?.notify?.("这个项目只看「本轮改了什么」。要看全部未提交改动，请直接用 `git diff`。", "info");
          return;
        }
        if (token === "view" || token === "render") {
          // view：交给 cmux 的 diff 面板（行级红绿 + 可选词级高亮）
          // render：交给 cmux 的 markdown 面板（改后片段 + 公式排版）
          wantBody = true;
          if (token === "view") wantView = true;
          else wantRender = true;
          const next = tokens[index + 1];
          if (next && !["file", "patch", "head", "list", "view"].includes(next)) {
            fileFilter = next;
            index += 1;
          }
          continue;
        }
        if (token === "file" || token === "patch") {
          wantBody = true;
          const next = tokens[index + 1];
          if (next && !["file", "patch", "head", "list"].includes(next)) {
            fileFilter = next;
            index += 1;
          }
          continue;
        }
        if (token === "list") continue; // 默认就是摘要，接受但不改变行为
        if (/^\d+$/.test(token)) {
          if (wantBody) fileFilter = fileFilter ?? token;
          else turnIndex = Number.parseInt(token, 10);
          continue;
        }
        fileFilter = fileFilter ?? token;
      }

      const cwd = String(ctx?.cwd ?? sessionCwd);
      let report: ReportData | null = null;
      let patchSource: TurnBaseline | null = null;
      if (turnBaseline) {
        report = await buildTurnReport(turnBaseline);
        if (wantBody) patchSource = turnBaseline;
      } else {
        const repoRoot = await gitRoot(cwd);
        if (!repoRoot) {
          ctx?.ui?.notify?.("这里不是 git 仓库（或仓库还没有任何提交）。", "info");
          return;
        }
        report = readStoredTurn(repoRoot, turnIndex > 0 ? turnIndex - 1 : 0);
        if (!report) {
          ctx?.ui?.notify?.("这个仓库还没有轮次报告：跑一轮带文件改动的任务后再来（或直接跑 `turn-diff` 命令）。", "info");
          return;
        }
      }
      if (!report) {
        ctx?.ui?.notify?.("没有可汇报的改动。", "info");
        return;
      }

      if (wantBody) {
        if (patchSource) {
          const { patch, truncated } = await buildTurnPatch(patchSource);
          if (patch) {
            report.patch = patch;
            if (truncated) report.patchTruncated = true;
          }
        }
        if (!report.patch) {
          ctx?.ui?.notify?.("这一轮没有存正文（旧记录或没有文本改动）；当前工作区可以直接 `git diff`。", "info");
          return;
        }
        const chunks = splitPatchByFile(report.patch);
        if (chunks.length === 0) {
          ctx?.ui?.notify?.("这一轮没有可显示的正文。", "info");
          return;
        }
        let chosen: PatchChunk[] = [];
        if (fileFilter) {
          if (/^\d+$/.test(fileFilter)) {
            const file = report.files[Number.parseInt(fileFilter, 10) - 1];
            if (file) chosen = chunks.filter((chunk) => chunk.path === file.path);
          } else {
            chosen = chunks.filter((chunk) => matchPath(chunk.path, fileFilter!));
          }
          if (chosen.length === 0) {
            ctx?.ui?.notify?.(`没有匹配 \`${fileFilter}\` 的文件；可用 /turn-diff list 看编号。`, "info");
            return;
          }
        } else if (chunks.length === 1) {
          chosen = chunks;
        } else {
          const current = report;
          const options = [`全部（${chunks.length} 个文件）`, ...chunks.map((chunk, index) => formatChunkLabel(chunk, current, index))];
          const picked = await ctx?.ui?.select?.("看哪个文件的正文？", options);
          if (!picked) return;
          const position = options.indexOf(picked);
          chosen = position <= 0 ? chunks : [chunks[position - 1]];
        }
        if (wantView || wantRender) {
          if (chosen.length > 1) {
            const verb = wantView ? "view" : "render";
            ctx?.ui?.notify?.(`${verb} 一次只看一个文件；用 ${verb} <编号> 指定（先 /turn-diff list 看编号）。`, "info");
            return;
          }
          const opened = wantView ? await openPatchInCmux(chosen[0]) : await openRenderedInCmux(chosen[0]);
          ctx?.ui?.notify?.(opened.message, opened.ok ? "info" : "error");
          return;
        }
        report = { ...report, patch: chosen.map((chunk) => chunk.text).join("\n"), showPatch: true, fullPatch: true };
      }

      pi.appendEntry(ENTRY_TYPE, report);
    },
  });
}
