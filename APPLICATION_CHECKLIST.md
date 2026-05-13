# Application checklist (human gate — Stage 5 → 6)

- [ ] Replace all `[REPLACE_ME]` values in `application/credentials.md`
- [ ] Add `OPENROUTER_API_KEY` to `.env`, restart `npm run dev`, and run `npm run smoke`
- [ ] Regenerate `resume.md` / `cover-letter.md` with your specifics
- [ ] Regenerate PDFs with `npm run apply:pdfs` after Stage 3 recreates `resume.md` / `cover-letter.md`
- [ ] Run each dashboard stage so `application/model-calls.jsonl` contains live OpenRouter calls
- [ ] Run `npm run apply:rippling:all` (or `apply:pdfs` then `apply:rippling`) after `npx playwright install chromium` once
- [ ] Complete Rippling flow per `application/STAGE-5-BROWSER.md`
- [ ] Click **Sign & Close** in the dashboard → open Rippling tab → verify fields → **submit**
- [ ] Confirm in hiring thread / email that submission succeeded
- [ ] Capture confirmation screenshot for Stage 6 embed
- [ ] Mark Stage 6 submitted in the local dashboard; it runs `npm run submit:finalize` to commit generated artifacts and push

This checklist completes the **`user-submit`** pipeline todo.
