/**
 * Stage 5a — Generate print HTML from markdown, then render PDFs via headless
 * Chromium (Playwright). Outputs under application/generated/ (gitignored).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "application", "generated");
const jobs = [
  {
    sourceMarkdown: "application/resume.md",
    printHtml: "application/resume-print.html",
    pdf: "applicant-resume.pdf",
    title: "Applicant — Resume",
    kind: "resume",
  },
  {
    sourceMarkdown: "application/cover-letter.md",
    printHtml: "application/cover-letter-print.html",
    pdf: "applicant-cover-letter.pdf",
    title: "Cover Letter — Applicant",
    kind: "cover-letter",
  },
];

fs.mkdirSync(outDir, { recursive: true });

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
    return `<a href="${escapeHtml(href)}">${text}</a>`;
  });
  return html;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let list = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    out.push("<ul>");
    for (const item of list) out.push(`  <li>${inlineMarkdown(item)}</li>`);
    out.push("</ul>");
    list = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return out.join("\n");
}

function printStyles(kind) {
  const common = `
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; color: #111; line-height: ${kind === "resume" ? "1.45" : "1.55"}; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin-top: 18px; border-bottom: 1px solid #ccc; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.02em; }
    h3 { font-size: 13px; margin: 14px 0 4px; }
    ul { margin: 6px 0 0 18px; padding: 0; }
    li { margin: 4px 0; }
    p { margin: ${kind === "resume" ? "8px" : "14px"} 0; }
    a { color: inherit; text-decoration: none; }
    @media print { body { margin: 0; } }
  `;
  return common
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n  ");
}

function writePrintHtml(job) {
  const sourcePath = path.join(root, job.sourceMarkdown);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Missing source markdown: ${job.sourceMarkdown}\nRun the drafting stage to recreate it before running npm run apply:pdfs.`,
    );
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(job.title)}</title>
<style>
  ${printStyles(job.kind)}
</style>
</head>
<body>
${markdownToHtml(fs.readFileSync(sourcePath, "utf8"))}
</body>
</html>
`;
  const htmlPath = path.join(root, job.printHtml);
  fs.writeFileSync(htmlPath, html);
  console.log(`Wrote ${path.relative(root, htmlPath)}`);
}

for (const job of jobs) writePrintHtml(job);

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  for (const job of jobs) {
    const abs = path.join(root, job.printHtml);
    if (!fs.existsSync(abs)) {
      throw new Error(`Missing generated print HTML: ${job.printHtml}`);
    }
    const url = pathToFileURL(abs).href;
    await page.goto(url, { waitUntil: "load" });
    const outPath = path.join(outDir, job.pdf);
    await page.pdf({
      path: outPath,
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    });
    console.log(`Wrote ${path.relative(root, outPath)}`);
  }
} finally {
  await browser.close();
}
