#!/usr/bin/env node
/**
 * Stage 6 — after human confirmation in Rippling, commit generated application
 * artifacts and push the current branch. This intentionally runs only from the
 * local dev server or CLI, never from the static dashboard.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const generatedPaths = [
  "application/job-posting.md",
  "application/surface-comparison.md",
  "application/requirements-map.md",
  "application/resume.md",
  "application/cover-letter.md",
  "application/stage3-rubric.md",
  "application/agent-log.md",
  "application/model-calls.jsonl",
  "application/resume-print.html",
  "application/cover-letter-print.html",
  "application/generated",
  "application/screenshots",
  "public/index.html",
  "public/application",
];

async function git(args, options = {}) {
  const { stdout, stderr } = await execFileAsync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return { stdout, stderr };
}

async function run() {
  await execFileAsync("npm", ["run", "build"], { encoding: "utf8" });

  await git(["add", "-A", "--", ...generatedPaths]);
  await git(["add", "-f", "--", "application/generated", "application/resume-print.html", "application/cover-letter-print.html", "public/index.html"]);

  let committed = false;
  try {
    await git(["diff", "--cached", "--quiet"]);
  } catch {
    const message = "chore: add submitted application artifacts";
    await git(["commit", "-m", message]);
    committed = true;
  }

  try {
    await git(["push"]);
  } catch (err) {
    const stderr = String(err?.stderr || "");
    const stdout = String(err?.stdout || "");
    if (!/no upstream branch|set the remote as upstream/i.test(stderr + stdout)) throw err;
    await git(["push", "-u", "origin", "HEAD"]);
  }

  return { committed };
}

try {
  const result = await run();
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (err) {
  console.error(String(err?.stderr || err?.message || err));
  process.exit(1);
}
