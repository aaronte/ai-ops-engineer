import fs from "fs";
import { spawnSync } from "child_process";

const ripplingUrl = "https://ats.rippling.com/en-CA/opendoor/jobs";

const prompt = `Use Cursor browser automation to complete Stage 5 for the Opendoor application.

Navigate to:
${ripplingUrl}

Use these repo files as source of truth:
- application/credentials.md
- application/resume.md
- application/cover-letter.md
- README.md

Automation rules:
1. Inspect the Rippling page before acting.
2. Fill the application fields from application/credentials.md and the Stage 5 dashboard values (self-ID labels match `scripts/rippling-playwright-apply.mjs` if you use Playwright).
3. Use the public repo URL where a portfolio, website, or additional context link is useful.
4. PDFs: run \`npm run apply:pdfs\` then \`npm run apply:rippling\` (or \`npm run apply:rippling:all\`) so Playwright attaches \`application/generated/*.pdf\` via native file inputs—no manual file picker.
5. Stop on the final review or submit screen. Do not click the final irreversible submit button unless the applicant explicitly confirms in chat.
6. After submission is confirmed, capture or ask for a screenshot and save it as application/screenshots/rippling-confirmation.png.`;

console.log("\nStage 5 Cursor browser handoff prompt:\n");
console.log(prompt);

if (process.platform === "darwin") {
  const copied = spawnSync("pbcopy", { input: prompt });
  if (copied.status === 0) {
    console.log("\nCopied prompt to clipboard.");
  }

  if (fs.existsSync("/usr/bin/open")) {
    spawnSync("open", [ripplingUrl]);
    console.log(`Opened ${ripplingUrl}`);
  }
}
