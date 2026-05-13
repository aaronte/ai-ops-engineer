import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "application", "dashboard.html");
const appSrcDir = path.join(root, "application");
const outDir = path.join(root, "public");
const dest = path.join(outDir, "index.html");
const appDestDir = path.join(outDir, "application");
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

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(dest, htmlWithArtifacts(fs.readFileSync(src, "utf8")));
console.log(`Copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);

fs.rmSync(appDestDir, { recursive: true, force: true });
fs.cpSync(appSrcDir, appDestDir, { recursive: true });
console.log(`Copied ${path.relative(root, appSrcDir)} -> ${path.relative(root, appDestDir)}`);
