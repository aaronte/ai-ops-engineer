#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const promptPath = path.join(ROOT, "application", "_smoke-prompt.txt");
fs.mkdirSync(path.dirname(promptPath), { recursive: true });
fs.writeFileSync(promptPath, "Reply with exactly: OPENROUTER_OK\n", "utf8");

const cheap = process.env.OPENROUTER_SMOKE_MODEL || "google/gemini-2.0-flash-001";
const r = spawnSync(
  process.execPath,
  [path.join(__dirname, "openrouter.mjs"), "--model", cheap, "--prompt-file", promptPath, "--stage", "smoke"],
  { encoding: "utf8", cwd: ROOT },
);

console.log(r.stdout || "");
console.error(r.stderr || "");
process.exit(r.status ?? 1);
