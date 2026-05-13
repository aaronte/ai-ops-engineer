# Stage 5 — Rippling (browser + autonomous PDF attach)

## Sub-stages

| Stage | Command | What it does |
|-------|---------|----------------|
| **5a** | `npm run apply:pdfs` | Regenerates print HTML from `application/resume.md` + `application/cover-letter.md`, then renders PDFs under `application/generated/` (Playwright Chromium). |
| **5b** | `npm run apply:stage5` | macOS: copies the Cursor browser prompt to clipboard and opens the Rippling jobs board (human or agent can drive the embedded browser). |
| **5c** | `npm run apply:rippling` | Playwright opens the Rippling **apply** URL (see `scripts/rippling-playwright-apply.mjs` or `RIPPLING_APPLY_URL`), sets dropdown self-ID fields to match `application/credentials.md`, attaches the two PDFs via native file inputs. **Does not submit.** |
| **5d** | Human | Review Rippling, fix anything Rippling changed, click **Apply** when ready. |

One-shot (5a then 5c):

```bash
npm run apply:rippling:all
```

First-time Playwright browser install (once per machine):

```bash
npm install
npx playwright install chromium
```

### When the posting URL changes

Rippling job links rotate. Set **`RIPPLING_APPLY_URL`** to the full apply URL from **`application/credentials.md`** before running Playwright (required). Keep **`PROFILE`** / **`SELF_ID`** in **`scripts/rippling-playwright-apply.mjs`** in sync with **`application/credentials.md`**.

### Headless (CI / scripted only)

Default is a **visible** Chromium window so uploads and edits stay in that session until you press Enter in the terminal. For no window:

```bash
HEADLESS=1 npm run apply:rippling
```

### Cursor browser handoff (optional)

1. Click **Prepare Browser Handoff** on the dashboard (or run `npm run apply:stage5`).
2. Paste the prompt into Cursor so the embedded browser agent can fill remaining fields.
3. Stop on the review/final submit screen unless the applicant explicitly confirms submission in chat.
4. After Rippling confirms submission, save proof as `application/screenshots/rippling-confirmation.png`.
5. Mark Stage 6 submitted in the local dashboard; it commits generated artifacts and pushes via `npm run submit:finalize`.
