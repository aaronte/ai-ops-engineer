import fs from "fs";
import http from "http";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");
const src = path.join(root, "application", "dashboard.html");
const appSrcDir = path.join(root, "application");
const outDir = path.join(root, "public");
const dest = path.join(outDir, "index.html");
const appDestDir = path.join(outDir, "application");
const port = Number(process.env.PORT || 4173);
const envPath = path.join(root, ".env");
const logPath = path.join(root, "application", "model-calls.jsonl");
const statePath = path.join(root, "application", "dashboard-state.json");
const artifactPaths = [
  "application/job-posting.md",
  "application/surface-comparison.md",
  "application/requirements-map.md",
  "application/credentials.md",
  "application/resume.md",
  "application/cover-letter.md",
  "application/stage3-rubric.md",
  "README.md",
  "APPLICATION_CHECKLIST.md",
  "application/STAGE-5-BROWSER.md",
  "application/model-calls.jsonl",
];

const clients = new Set();

const stageCalls = {
  1: [
    { stage: "1a", model: "google/gemini-2.5-pro-preview", title: "Read the job post" },
    { stage: "1b", model: "perplexity/sonar", title: "Choose the official apply path" },
  ],
  2: [{ stage: "2", model: "anthropic/claude-opus-4", title: "Map requirements to evidence" }],
  3: [
    { stage: "3a-resume", model: "openai/gpt-4o", title: "Draft the tailored resume" },
    { stage: "3a-letter", model: "anthropic/claude-opus-4", title: "Draft the cover letter" },
    { stage: "3b", model: "deepseek/deepseek-r1", title: "Critique the application package" },
    { stage: "3c", model: "anthropic/claude-opus-4", title: "Revise after critique" },
  ],
  4: [{ stage: "4", model: "openai/gpt-4o", title: "Inspect the repo package" }],
  5: [{ stage: "5-map", model: "openai/gpt-4o-mini", title: "Prepare Rippling field map" }],
  6: [{ stage: "6", model: "anthropic/claude-3.5-sonnet", title: "Record submission wrap-up" }],
};

function loadDotEnv() {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function providerFromModel(slug) {
  const provider = slug.split("/")[0];
  return {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    perplexity: "Perplexity",
    deepseek: "DeepSeek",
  }[provider] || provider;
}

function fileText(relPath) {
  const absPath = path.join(root, relPath);
  return fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf8") : "";
}

function promptForStage(stageId, call) {
  const context = [
    ["application/job-posting.md", fileText("application/job-posting.md")],
    ["application/credentials.md", fileText("application/credentials.md")],
    ["application/requirements-map.md", fileText("application/requirements-map.md")],
    ["application/resume.md", fileText("application/resume.md")],
    ["application/cover-letter.md", fileText("application/cover-letter.md")],
    ["README.md", fileText("README.md")],
  ]
    .filter(([, text]) => text.trim())
    .map(([name, text]) => `\n--- ${name} ---\n${text.slice(0, 8000)}`)
    .join("\n");
  const coverLetterRequirements =
    call.stage === "3a-letter"
      ? "\n\nCover letter hard requirement: include the public project repo URL from credentials.md prominently, and point reviewers to the README for exactly two Loom links (demo + application walkthrough)."
      : "";

  return `You are running Stage ${stageId} of an applicant's Opendoor AI Operations Engineer application pipeline.

Task: ${call.title}

Return concise, structured markdown that can be used as run evidence in the dashboard. Do not invent facts. If information is missing, say exactly what is missing.
${coverLetterRequirements}
${context}`;
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function appendModelCallRow(row) {
  fs.appendFileSync(logPath, JSON.stringify(row) + "\n");
  return row;
}

function stripMarkdownFence(value) {
  const trimmed = value.trim();
  const fence = trimmed.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```$/i);
  return fence ? fence[1].trim() : trimmed;
}

function extractMarkedFile(content, relPath) {
  const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`---\\s*${escaped}\\s*---\\s*\\n([\\s\\S]*)`, "i"));
  return match ? stripMarkdownFence(match[1]) : null;
}

function extractCoverLetter(content) {
  const codeBlock = content.match(/## Cover Letter Draft\s*```(?:markdown)?\s*\n([\s\S]*?)\n```/i);
  return codeBlock ? codeBlock[1].trim() : null;
}

function writeGeneratedArtifact(relPath, content) {
  const absPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${content.trim()}\n`);
}

function materializeStageArtifact(stage, content) {
  const artifacts = {
    "3a-resume": ["application/resume.md", extractMarkedFile(content, "application/resume.md")],
    "3a-letter": ["application/cover-letter.md", extractCoverLetter(content)],
    "3b": ["application/stage3-rubric.md", stripMarkdownFence(content)],
  };
  const artifact = artifacts[stage];
  if (!artifact || !artifact[1]) return;
  writeGeneratedArtifact(artifact[0], artifact[1]);
}

function buildLogRow(call, prompt, content, started, usage = {}) {
  return {
    ts: new Date().toISOString(),
    stage: call.stage,
    model: call.model,
    provider: providerFromModel(call.model),
    tokens_in: usage.prompt_tokens ?? usage.input_tokens ?? null,
    tokens_out: usage.completion_tokens ?? usage.output_tokens ?? null,
    latency_ms: Date.now() - started,
    prompt_chars: prompt.length,
    response_chars: content.length,
    response_preview: content.slice(0, 4000),
  };
}

/** Parse OpenAI-compatible SSE from OpenRouter; invoke onDelta for each content piece. */
async function consumeOpenRouterSse(res, onDelta) {
  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try {
      msg = JSON.parse(errText)?.error?.message || errText;
    } catch {
      /* keep errText */
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let carry = "";
  let full = "";
  let usage = {};
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    let nl;
    while ((nl = carry.indexOf("\n")) >= 0) {
      const line = carry.slice(0, nl).trimEnd();
      carry = carry.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5).trim();
      try {
        const json = JSON.parse(payload);
        const err = json?.error?.message;
        if (err) throw new Error(err);
        if (json.usage && typeof json.usage === "object") usage = json.usage;
        const d = json?.choices?.[0]?.delta || {};
        const piece = [d.content, d.reasoning, d.reasoning_content].filter(Boolean).join("");
        if (piece) {
          full += piece;
          onDelta(piece);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return { full, usage };
}

async function runOpenRouterCall(stageId, call) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY missing. Add it to .env, then restart npm run dev.");

  const prompt = promptForStage(stageId, call);
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/aaronte/ai-ops-engineer",
      "X-Title": "Opendoor AI Ops Application Pipeline",
    },
    body: JSON.stringify({
      model: call.model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || JSON.stringify(data));

  const content = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  materializeStageArtifact(call.stage, content);
  return appendModelCallRow(buildLogRow(call, prompt, content, started, usage));
}

async function runOpenRouterCallStream(stageId, call, onDelta) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY missing. Add it to .env, then restart npm run dev.");

  const prompt = promptForStage(stageId, call);
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/aaronte/ai-ops-engineer",
      "X-Title": "Opendoor AI Ops Application Pipeline",
    },
    body: JSON.stringify({
      model: call.model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  const { full: content, usage } = await consumeOpenRouterSse(res, onDelta);
  materializeStageArtifact(call.stage, content);
  const row = buildLogRow(call, prompt, content, started, usage);
  return appendModelCallRow(row);
}

async function handleRunStage(req, res) {
  try {
    const { stageId } = await readJsonBody(req);
    const numericStageId = Number(stageId);
    const calls = stageCalls[numericStageId];
    if (!calls) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: `Unknown stage: ${stageId}` }));
      return;
    }
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const rows = [];
    if (numericStageId === 3) {
      const draftRows = await Promise.all(calls.slice(0, 2).map((call) => runOpenRouterCall(numericStageId, call)));
      rows.push(...draftRows);
      for (const call of calls.slice(2)) {
        rows.push(await runOpenRouterCall(numericStageId, call));
      }
    } else {
      for (const call of calls) {
        rows.push(await runOpenRouterCall(numericStageId, call));
      }
    }
    build();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, rows }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  }
}

function writeNdjsonLine(res, obj) {
  res.write(`${JSON.stringify(obj)}\n`);
}

async function handleRunStageStream(req, res) {
  let wroteHead = false;
  const fail = (status, message) => {
    const body = JSON.stringify({ ok: false, error: message });
    if (!wroteHead) {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(body);
    } else {
      writeNdjsonLine(res, { type: "error", ok: false, message });
      res.end();
    }
  };
  try {
    const { stageId } = await readJsonBody(req);
    const calls = stageCalls[Number(stageId)];
    if (!calls) {
      fail(400, `Unknown stage: ${stageId}`);
      return;
    }
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    wroteHead = true;

    const rows = [];
    for (const call of calls) {
      writeNdjsonLine(res, {
        type: "call",
        stage: call.stage,
        title: call.title,
        model: call.model,
      });
      const row = await runOpenRouterCallStream(Number(stageId), call, (text) => {
        if (text) writeNdjsonLine(res, { type: "delta", text });
      });
      rows.push(row);
      writeNdjsonLine(res, { type: "row", row });
    }
    build();
    writeNdjsonLine(res, { type: "done", ok: true, rows });
    res.end();
  } catch (err) {
    if (!wroteHead) {
      fail(500, String(err?.message || err));
    } else {
      writeNdjsonLine(res, { type: "error", ok: false, message: String(err?.message || err) });
      res.end();
    }
  }
}

async function handleFinalizeSubmission(req, res) {
  try {
    const { confirmed } = await readJsonBody(req);
    if (confirmed !== true) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "Finalization requires explicit submitted confirmation." }));
      return;
    }

    const { stdout, stderr } = await execFileAsync("npm", ["run", "submit:finalize"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });

    let result = {};
    const lastJsonLine = stdout
      .trim()
      .split("\n")
      .reverse()
      .find((line) => line.trim().startsWith("{"));
    if (lastJsonLine) {
      try {
        result = JSON.parse(lastJsonLine);
      } catch {
        result = {};
      }
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, ...result, stdout, stderr }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: false,
        error: String(err?.stderr || err?.message || err),
      }),
    );
  }
}

function normalizeDashboardState(state) {
  const safeState = state && typeof state === "object" ? state : {};
  return {
    stage: Number.isFinite(Number(safeState.stage)) ? Number(safeState.stage) : 1,
    tab: safeState.tab === "lineup" ? "lineup" : "tracker",
    offerSubmitted: Boolean(safeState.offerSubmitted),
    playReveal: safeState.playReveal && typeof safeState.playReveal === "object" ? safeState.playReveal : {},
    handoffOpen: Boolean(safeState.handoffOpen),
    artifact: typeof safeState.artifact === "string" ? safeState.artifact : null,
    closing: safeState.closing && typeof safeState.closing === "object" ? safeState.closing : null,
    finalizeStatus:
      safeState.finalizeStatus && typeof safeState.finalizeStatus === "object" ? safeState.finalizeStatus : null,
  };
}

async function handleDashboardState(req, res) {
  if (req.method === "GET") {
    const state = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : "{}";
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(state);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  const state = normalizeDashboardState(await readJsonBody(req));
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  fs.mkdirSync(appDestDir, { recursive: true });
  fs.copyFileSync(statePath, path.join(appDestDir, "dashboard-state.json"));
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, state }));
}

function artifactPayload() {
  return Object.fromEntries(
    artifactPaths
      .map((relPath) => {
        const absPath = path.join(root, relPath);
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
        return [relPath, fs.readFileSync(absPath, "utf8")];
      })
      .filter(Boolean),
  );
}

function htmlWithArtifacts(html) {
  const payload = JSON.stringify(artifactPayload()).replace(/<\/script/gi, "<\\/script");
  return html.replace(
    "const EMBEDDED_ARTIFACTS = {};",
    `const EMBEDDED_ARTIFACTS = ${payload};`,
  );
}

function build() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(dest, htmlWithArtifacts(fs.readFileSync(src, "utf8")));
  console.log(`Copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
  fs.rmSync(appDestDir, { recursive: true, force: true });
  fs.cpSync(appSrcDir, appDestDir, { recursive: true });
  console.log(`Copied ${path.relative(root, appSrcDir)} -> ${path.relative(root, appDestDir)}`);
}

function htmlWithLiveReload() {
  return htmlWithArtifacts(fs.readFileSync(src, "utf8"));
}

function sendReload() {
  for (const res of clients) {
    res.write("event: reload\ndata: now\n\n");
  }
}

async function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (req.method === "POST" && urlPath === "/api/run-stage") {
    await handleRunStage(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/run-stage-stream") {
    await handleRunStageStream(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/finalize-submission") {
    await handleFinalizeSubmission(req, res);
    return;
  }

  if (urlPath === "/api/dashboard-state") {
    await handleDashboardState(req, res);
    return;
  }

  if (urlPath === "/__live-reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 500\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (urlPath === "/" || urlPath === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(htmlWithLiveReload());
    return;
  }

  const requested = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(outDir, requested);
  if (filePath.startsWith(outDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".md": "text/markdown; charset=utf-8",
      ".jsonl": "application/x-ndjson; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

loadDotEnv();
build();

let reloadTimer;
fs.watch(src, { persistent: true }, () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    try {
      build();
      sendReload();
      console.log("Reloaded dashboard");
    } catch (err) {
      console.error(err);
    }
  }, 80);
});

http
  .createServer((req, res) => {
    serveStatic(req, res).catch((err) => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(err?.message || err));
    });
  })
  .listen(port, () => {
  console.log(`Dashboard dev server: http://localhost:${port}`);
});
