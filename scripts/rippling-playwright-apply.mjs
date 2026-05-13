/**
 * Stage 5c — Playwright: open Rippling apply flow, set voluntary self-ID dropdowns,
 * attach generated PDFs. Does not click final Apply/submit (human gate).
 *
 * Run `npm run apply:pdfs` first (or `npm run apply:rippling:all`).
 *
 * Env:
 *   HEADLESS=1 — fully headless (closes immediately; draft may not carry over to other browsers).
 *   KEEP_OPEN=1 — keep the headed browser open for final human review.
 *   SUBMIT_CONFIRMED=1 — click the final Apply button and save the confirmation screenshot.
 *   RIPPLING_APPLY_URL — **required**: full Rippling apply URL from credentials.md (Rippling rotates links).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/** Keep in sync with `application/credentials.md` (Rippling / voluntary self-ID) and the live posting URL. */
const APPLY_URL = process.env.RIPPLING_APPLY_URL;

const RESUME_PDF = path.join(root, "application", "generated", "applicant-resume.pdf");
const COVER_PDF = path.join(root, "application", "generated", "applicant-cover-letter.pdf");
const CONFIRMATION_SCREENSHOT = path.join(root, "application", "screenshots", "rippling-confirmation.png");

const PROFILE = {
  firstName: "[REPLACE_ME]",
  lastName: "[REPLACE_ME]",
  email: "[REPLACE_ME]",
  currentCompany: "[REPLACE_ME]",
  phoneNumber: "[REPLACE_ME]",
  location: "[REPLACE_ME]",
  linkedIn: "[REPLACE_ME]",
};

const SELF_ID = {
  gender: "[REPLACE_ME]",
  race: "[REPLACE_ME]",
  hispanicLatino: "[REPLACE_ME]",
  veteranStatus: "[REPLACE_ME]",
  disabilityStatus: "[REPLACE_ME]",
};

/**
 * Rippling uses aria comboboxes; open by role name then pick option by exact name.
 */
async function pickComboboxOption(page, comboboxName, optionLabel) {
  const box = page.getByRole("combobox", { name: comboboxName });
  await box.waitFor({ state: "visible", timeout: 60_000 });
  await box.click();
  const opt = page.getByRole("option", { name: optionLabel, exact: true });
  await opt.waitFor({ state: "visible", timeout: 15_000 });
  await opt.click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Tab").catch(() => {});
}

async function fillTextbox(page, name, value) {
  const field = page.getByRole("textbox", { name });
  await field.waitFor({ state: "visible", timeout: 60_000 });
  await field.fill(value);
}

async function logFormDiagnostics(page) {
  const diagnostics = await page.evaluate(() => {
    const summarize = (element) => ({
      tag: element.tagName,
      role: element.getAttribute("role"),
      type: element.getAttribute("type"),
      name: element.getAttribute("name"),
      ariaLabel: element.getAttribute("aria-label"),
      ariaInvalid: element.getAttribute("aria-invalid"),
      required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      placeholder: element.getAttribute("placeholder"),
      value: "value" in element ? element.value : element.textContent?.trim().slice(0, 120),
      text: element.textContent?.trim().slice(0, 120),
      valid: "validity" in element ? element.validity.valid : null,
    });
    const apply = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Apply");
    const controls = [...document.querySelectorAll("input, textarea, [role='combobox'], [aria-invalid='true']")]
      .map(summarize)
      .filter((item) => item.required || item.ariaInvalid === "true" || !item.value);
    return {
      apply: apply ? summarize(apply) : null,
      controls,
    };
  });
  console.log(`Form diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`);
}

async function main() {
  if (!APPLY_URL) {
    console.error(
      "Missing RIPPLING_APPLY_URL. Set it to the full Rippling apply URL from application/credentials.md (the jobs listing URL does not open the application form).",
    );
    process.exit(1);
  }

  for (const f of [RESUME_PDF, COVER_PDF]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing PDF: ${f}\nRun: npm run apply:pdfs`);
      process.exit(1);
    }
  }

  const headless = process.env.HEADLESS === "1";
  const keepOpen = process.env.KEEP_OPEN === "1" && !headless;
  const submitConfirmed = process.env.SUBMIT_CONFIRMED === "1";
  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 40 });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto(APPLY_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByRole("textbox", { name: "First name" }).waitFor({ state: "visible", timeout: 60_000 });

    await fillTextbox(page, "First name", PROFILE.firstName);
    await fillTextbox(page, "Last name", PROFILE.lastName);
    await fillTextbox(page, "Email", PROFILE.email);
    await fillTextbox(page, "Current company", PROFILE.currentCompany);
    await fillTextbox(page, "Phone number", PROFILE.phoneNumber);
    await fillTextbox(page, "Location", PROFILE.location);
    await fillTextbox(page, "LinkedIn Link", PROFILE.linkedIn);

    await pickComboboxOption(page, "Gender", SELF_ID.gender);
    await pickComboboxOption(page, "Please identify your race", SELF_ID.race);
    await pickComboboxOption(page, "Are you Hispanic/Latino?", SELF_ID.hispanicLatino);
    await pickComboboxOption(page, "Veteran Status", SELF_ID.veteranStatus);
    await pickComboboxOption(page, "Disability Status", SELF_ID.disabilityStatus);
    await pickComboboxOption(page, "Please identify your race", SELF_ID.race);

    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    if (count < 2) {
      throw new Error(`Expected at least 2 file inputs (résumé + cover letter), found ${count}`);
    }
    await fileInputs.nth(0).setInputFiles(RESUME_PDF);
    await fileInputs.nth(1).setInputFiles(COVER_PDF);
    console.log(`Attached:\n  ${RESUME_PDF}\n  ${COVER_PDF}`);
    await page.waitForTimeout(6_000);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    await page.getByRole("radio", { name: "No – I do not consent to receiving text messages" }).check();

    if (submitConfirmed) {
      console.log("\nSUBMIT_CONFIRMED=1: clicking final Apply button.");
      const applyButton = page.getByRole("button", { name: "Apply", exact: true });
      await applyButton.waitFor({ state: "visible", timeout: 60_000 });
      await applyButton.waitFor({ state: "attached", timeout: 60_000 });
      await logFormDiagnostics(page);
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll("button")];
        const apply = buttons.find((button) => button.textContent?.trim() === "Apply");
        return apply && !apply.disabled && apply.getAttribute("aria-disabled") !== "true";
      }, { timeout: 60_000 });
      await applyButton.scrollIntoViewIfNeeded();
      await applyButton.click({ force: true });
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(8_000);
      fs.mkdirSync(path.dirname(CONFIRMATION_SCREENSHOT), { recursive: true });
      await page.screenshot({ path: CONFIRMATION_SCREENSHOT, fullPage: true });
      console.log(`Saved confirmation screenshot: ${path.relative(root, CONFIRMATION_SCREENSHOT)}`);
      console.log(`Final URL: ${page.url()}`);
      return;
    }

    console.log("\nDone. Review the Rippling form in the browser; submit manually unless you have an explicit submit automation gate.");
    if (keepOpen) {
      console.log("\nKEEP_OPEN=1: leaving Chromium open at the final Apply gate. Stop this process after review/submission.");
      await new Promise(() => {});
    } else if (!headless && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      await new Promise((resolve) => {
        rl.question("\nPress Enter to close the Chromium window... ", () => {
          rl.close();
          resolve();
        });
      });
    } else if (!headless && !process.stdin.isTTY) {
      console.log("\n(Non-interactive terminal: closing browser in 5s — use a real terminal or HEADLESS=1 for immediate exit.)");
      await new Promise((r) => setTimeout(r, 5000));
    }
  } finally {
    await browser.close();
  }
}

await main();
