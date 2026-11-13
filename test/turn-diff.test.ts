/**
 * turn-diff 核心逻辑测试（node:test + 类型擦除，无第三方测试框架）。
 *
 * 覆盖两件事：
 *   1. 纯函数：git status -z 解析（含重命名）、patch 行分类、行数 / 指纹。
 *   2. 真实 git 仓库集成：基线捕获 → 改文件 / 新增未跟踪文件 → 本轮统计与 patch。
 *
 * 为什么这样测：turn-diff 的全部价值是「只算本轮增量」——基线之后才出现的改动要进、
 * 基线之前就存在的脏改动不能进、新冒出来的未跟踪文件按新建算。这三条只有真 git 仓库能验。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
	buildTurnPatch,
	buildTurnReport,
	captureTurnBaseline,
	classifyPatchLine,
	countFileLines,
	fingerprintFile,
	parseStatusEntries,
} from "../turn-diff.ts";

/** 建一个临时 git 仓库（有 user 配置，能提交）。 */
function makeRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-diff-test-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Turn Diff Test");
	return dir;
}

test("parseStatusEntries 解析已跟踪改动与未跟踪文件", () => {
	assert.deepEqual(parseStatusEntries(" M a.txt\0?? b.txt\0"), [
		{ code: " M", path: "a.txt" },
		{ code: "??", path: "b.txt" },
	]);
});

test("parseStatusEntries 对重命名跳过源路径", () => {
	// -z 形态下重命名是 `R  new\0old\0`：新路径在前、源路径在后。
	assert.deepEqual(parseStatusEntries("R  new.txt\0old.txt\0"), [
		{ code: "R ", path: "new.txt" },
	]);
});

test("classifyPatchLine 区分 meta / add / del / context", () => {
	assert.equal(classifyPatchLine("diff --git a/x b/x").kind, "meta");
	assert.equal(classifyPatchLine("@@ -1 +1 @@").kind, "meta");
	assert.equal(classifyPatchLine("--- a/x").kind, "meta");
	assert.equal(classifyPatchLine("+++ b/x").kind, "meta");
	assert.equal(classifyPatchLine("+added").kind, "add");
	assert.equal(classifyPatchLine("-removed").kind, "del");
	assert.equal(classifyPatchLine(" context").kind, "context");
	assert.equal(classifyPatchLine("+added").text, "added");
});

test("countFileLines / fingerprintFile 处理存在与缺失", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-diff-lines-"));
	const withNewline = path.join(dir, "a.txt");
	fs.writeFileSync(withNewline, "a\nb\n");
	assert.equal(countFileLines(withNewline), 2);
	const noNewline = path.join(dir, "b.txt");
	fs.writeFileSync(noNewline, "a\nb");
	assert.equal(countFileLines(noNewline), 2);
	const empty = path.join(dir, "c.txt");
	fs.writeFileSync(empty, "");
	assert.equal(countFileLines(empty), 0);
	assert.equal(countFileLines(path.join(dir, "missing.txt")), 0);
	assert.equal(fingerprintFile(path.join(dir, "missing.txt")), "");
	assert.match(fingerprintFile(withNewline), /^\d+:\d+$/);
});

test("captureTurnBaseline + buildTurnReport 统计本轮改动", async () => {
	const dir = makeRepo();
	fs.writeFileSync(path.join(dir, "tracked.txt"), "one\ntwo\n");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });

	const baseline = await captureTurnBaseline(dir);
	assert.ok(baseline, "干净仓库也应拿到基线");
	assert.equal(baseline!.untracked["new.txt"], undefined);

	// 本轮：已跟踪文件加 1 行、新增未跟踪文件 2 行。
	fs.writeFileSync(path.join(dir, "tracked.txt"), "one\ntwo\nthree\n");
	fs.writeFileSync(path.join(dir, "new.txt"), "alpha\nbeta\n");

	const report = await buildTurnReport(baseline!);
	assert.ok(report, "本轮有改动应产出报告");
	const byPath = new Map(report!.files.map((file) => [file.path, file]));
	assert.deepEqual(byPath.get("tracked.txt"), {
		path: "tracked.txt",
		added: 1,
		deleted: 0,
		kind: "modified",
		binary: false,
	});
	// 未跟踪文件按「新建」计入，不经过 numstat，因此没有 binary 字段。
	assert.deepEqual(byPath.get("new.txt"), {
		path: "new.txt",
		added: 2,
		deleted: 0,
		kind: "added",
	});
	assert.equal(report!.added, 3);
	assert.equal(report!.deleted, 0);

	const { patch, truncated } = await buildTurnPatch(baseline!);
	assert.equal(truncated, false);
	assert.match(patch, /\+three/);
	assert.match(patch, /\+alpha/);
	assert.match(patch, /new file mode 100644/);
});

test("基线之前就存在的脏改动不计入本轮", async () => {
	const dir = makeRepo();
	fs.writeFileSync(path.join(dir, "a.txt"), "base\n");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });

	// 基线之前就有脏改动（属于上一轮遗留），它不应计入本轮。
	fs.writeFileSync(path.join(dir, "a.txt"), "base\nbefore-turn\n");
	const baseline = await captureTurnBaseline(dir);
	assert.ok(baseline);
	assert.ok(baseline!.snapshot, "有脏改动时应生成 stash 快照");

	fs.writeFileSync(path.join(dir, "a.txt"), "base\nbefore-turn\nafter-turn\n");
	const report = await buildTurnReport(baseline!);
	assert.ok(report);
	assert.equal(report!.added, 1, "只应统计基线之后新增的那一行");
	assert.equal(report!.deleted, 0);
});

test("本轮没有任何改动时返回 null", async () => {
	const dir = makeRepo();
	fs.writeFileSync(path.join(dir, "a.txt"), "base\n");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });

	const baseline = await captureTurnBaseline(dir);
	assert.ok(baseline);
	assert.equal(await buildTurnReport(baseline!), null);
	const { patch } = await buildTurnPatch(baseline!);
	assert.equal(patch, "");
});
