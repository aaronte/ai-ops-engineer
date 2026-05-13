#!/usr/bin/env node
/**
 * Regenerate Stage 3 application materials, then let `apply:pdfs` convert them.
 * Runs the resume and cover letter calls in parallel for a faster Stage 5 handoff.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const logPath = path.join(root, "application", "model-calls.jsonl");

const jobs = [
  {
    stage: "3a-resume",
    title: "Draft the tailored resume",
    model: process.env.OPENROUTER_RESUME_MODEL || process.env.OPENROUTER_MATERIALS_MODEL || "openai/gpt-4o-mini",
    output: "application/resume.md",
    instructions: `Write a concise, ATS-friendly markdown resume for the applicant described in the source context.

Requirements:
- Output ONLY the markdown file contents, no wrapper, no code fence, no commentary.
- Include contact details, professional summary, experience, skills, and education.
- Use only facts supported by the source context.
- Make the role alignment explicit for Opendoor's Operations AI Engineer role.
- Include the public repo URL from credentials.md where useful.`,
  },
  {
    stage: "3a-letter",
    title: "Draft the cover letter",
    model: process.env.OPENROUTER_COVER_LETTER_MODEL || process.env.OPENROUTER_MATERIALS_MODEL || "openai/gpt-4o-mini",
    output: "application/cover-letter.md",
    instructions: `Write a concise markdown cover letter for the applicant described in the source context applying to Opendoor's Operations AI Engineer role.

Requirements:
- Output ONLY the markdown file contents, no wrapper, no code fence, no commentary.
- Include the public repo URL from credentials.md prominently.
- Point reviewers to the README for exactly two Loom links: a demo of the pipeline and an application walkthrough.
- Use only facts supported by the source context.
- Keep it polished and submission-ready.`,
  },
];

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
    deepseek: "DeepSeek",
    google: "Google",
    openai: "OpenAI",
    perplexity: "Perplexity",
  }[provider] || provider;
}

function fileText(relPath) {
  const absPath = path.join(root, relPath);
  return fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf8") : "";
}

function sourceContext() {
  return [
    ["application/credentials.md", fileText("application/credentials.md")],
    ["application/job-posting.md", fileText("application/job-posting.md")],
    ["application/requirements-map.md", fileText("application/requirements-map.md")],
    ["README.md", fileText("README.md")],
  ]
    .filter(([, text]) => text.trim())
    .map(([name, text]) => `\n--- ${name} ---\n${text.slice(0, 8000)}`)
    .join("\n");
}

function stripMarkdownFence(value) {
  const trimmed = value.trim();
  const fence = trimmed.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```$/i);
  return fence ? fence[1].trim() : trimmed;
}

function appendLog(row) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`);
}

async function runJob(job, context) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY missing. Add it to .env before regenerating materials.");

  const prompt = `You are running Stage 3 of an applicant's Opendoor AI Operations Engineer application pipeline.

Task: ${job.title}

${job.instructions}

Source context:
${context}`;
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
      model: job.model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || JSON.stringify(data));

  const content = stripMarkdownFence(data?.choices?.[0]?.message?.content || "");
  const outPath = path.join(root, job.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${content}\n`);

  const usage = data?.usage || {};
  appendLog({
    ts: new Date().toISOString(),
    stage: job.stage,
    model: job.model,
    provider: providerFromModel(job.model),
    tokens_in: usage.prompt_tokens ?? usage.input_tokens ?? null,
    tokens_out: usage.completion_tokens ?? usage.output_tokens ?? null,
    latency_ms: Date.now() - started,
    prompt_chars: prompt.length,
    response_chars: content.length,
    response_preview: content.slice(0, 4000),
    wrote: job.output,
  });

  return job.output;
}

loadDotEnv();
const context = sourceContext();
const outputs = await Promise.all(jobs.map((job) => runJob(job, context)));
for (const output of outputs) console.log(`Wrote ${output}`);
