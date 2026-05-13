#!/usr/bin/env node
/**
 * OpenRouter helper — reads OPENROUTER_API_KEY from env or .env file.
 * Usage: node scripts/openrouter.mjs --model <slug> --prompt-file <path> [--stage <id>]
 * Appends one JSON line per call to application/model-calls.jsonl
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_PATH = path.join(ROOT, "application", "model-calls.jsonl");
const ENV_PATH = path.join(ROOT, ".env");

function loadDotEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

function parseArgs(argv) {
  const out = { model: "", promptFile: "", stage: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") out.model = argv[++i];
    else if (a === "--prompt-file") out.promptFile = argv[++i];
    else if (a === "--stage") out.stage = argv[++i];
  }
  return out;
}

function providerFromModel(slug) {
  const p = slug.split("/")[0];
  const map = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    perplexity: "Perplexity",
    deepseek: "DeepSeek",
  };
  return map[p] ?? p;
}

async function main() {
  loadDotEnv();
  const { model, promptFile, stage } = parseArgs(process.argv);
  if (!model || !promptFile) {
    console.error("Usage: node scripts/openrouter.mjs --model <slug> --prompt-file <path> [--stage <id>]");
    process.exit(1);
  }
  const key = process.env.OPENROUTER_API_KEY;
  const prompt = fs.readFileSync(path.resolve(promptFile), "utf8");
  const started = Date.now();

  if (!key) {
    const row = {
      ts: new Date().toISOString(),
      stage: stage || "unknown",
      model,
      provider: providerFromModel(model),
      skipped: true,
      reason: "OPENROUTER_API_KEY missing",
      prompt_chars: prompt.length,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      latency_ms: null,
      response_preview: "",
    };
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
    console.log(JSON.stringify({ ok: false, skipped: true, reason: row.reason }));
    process.exit(0);
  }

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
  };

  let data;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/aaronte/ai-ops-engineer",
        "X-Title": "Opendoor AI Ops Application Pipeline",
      },
      body: JSON.stringify(body),
    });
    data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || JSON.stringify(data));
    }
  } catch (e) {
    const row = {
      ts: new Date().toISOString(),
      stage: stage || "unknown",
      model,
      provider: providerFromModel(model),
      error: String(e?.message || e),
      prompt_chars: prompt.length,
      latency_ms: Date.now() - started,
    };
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
    console.error(e);
    process.exit(1);
  }

  const choice = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage ?? {};
  const tokensIn = usage.prompt_tokens ?? usage.input_tokens ?? null;
  const tokensOut = usage.completion_tokens ?? usage.output_tokens ?? null;
  const cost =
    data?.usage?.total_cost ??
    data?.usage?.cost ??
    data?.usage?.cost_details?.total ??
    null;

  const row = {
    ts: new Date().toISOString(),
    stage: stage || "unknown",
    model,
    provider: providerFromModel(model),
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: typeof cost === "number" ? cost : null,
    latency_ms: Date.now() - started,
    prompt_chars: prompt.length,
    response_chars: choice.length,
    response_preview: choice.slice(0, 4000),
  };
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
  process.stdout.write(choice);
}

main();
