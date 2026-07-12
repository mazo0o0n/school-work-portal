# AGENTS.md

## Project Rules
- Work from this project root only unless the user gives a different absolute path.
- Do not rescan the whole project by default. Inspect only files directly related to the request.
- For the home page, start with `index.html`, `assets/css/index.css`, and `assets/js/index.js`.
- Do not touch the smart assistant unless the user explicitly asks for it.
- Protected files: `src/index.js`, `assets/js/ai-assistant.js`, `knowledge.md`, `wrangler.toml`, and any `/api/chat` logic.
- Do not edit deployment, Cloudflare, RAG, secrets, or environment settings without explicit approval.
- Never expose secrets, tokens, API keys, or full private contact values.
- Do not run `git commit`, `git push`, or deploy commands unless the user explicitly approves.
- Prefer small, targeted edits and report the exact files changed.
- Before changing links or routes, check whether the target local file exists.
- Keep the final design unchanged unless the user requests a visual redesign.
- If a link or feature is uncertain, report it instead of guessing a replacement.
- The project is Arabic and RTL; preserve both direction and Arabic usability.
- Never use `git add .`; stage only explicitly approved paths.
- Do not run `commit`, `push`, `deploy`, `upload`, or Vectorize upsert without explicit approval.
- Do not read, print, or expose secret files, credentials, or tokens.
- Do not edit `src/index.js`, `wrangler.toml`, RAG, `tools`, or knowledge files unless explicitly requested.
- Do not delete files.
- After changes, report changed files, checks run, and confirm that nothing was published.
- For knowledge changes, run the local check only; do not upsert unless explicitly requested.
- For UI changes, verify 390×844 plus desktop, and check both light and dark themes.
