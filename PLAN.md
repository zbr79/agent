# InsChat — Plan

## Decision log

- **Chosen from roadmap §4 candidates:** chatbot (user decision 2026-08-27, overrides "no chatbot wrapper" rule). Differentiation: image upload (vision) + streaming, real deployment, clean UX — done fast, not a bare wrapper.
- **Stack:** Next.js 16 + React 19 (matches Rencipe; Node 22 on VM OK). Express rejected — one less process.
- **Model:** `gemini-3.6-flash` on Gemini free tier (no credit card, ~60 req/min, supports images). `gemini-2.5-flash` retired for new users (2026); free tier intermittently 503s on some models — server retries 3× with backoff. Configurable via `GEMINI_MODEL`.
- **v1 scope:** text chat + image upload + streaming + multi-turn context (last 20 msgs). No auth, no DB, no persistence — conversations live in the browser.
- **Conclude (2026-08-27):** structured capture happens via a separate non-streaming Gemini call (`responseMimeType: application/json` + `responseSchema`), triggered by a per-message "Conclude" button — the streaming chat reply stays free text. Storage (MongoDB `inschat` db) is the next step, attached to the conclusion card as a Save button.
- **Models (2026-08-27):** free-tier quota is per model (20 req/day/model). Active model is switchable from a Models tab (`data/model.json` override, env `GEMINI_MODEL` as default); per-model usage counters gray out exhausted models.
- **Storage (2026-08-27):** MongoDB Atlas, same cluster as baizhan-v2, separate database `inschat` (`MONGODB_URI`/`MONGODB_DB` in `.env`). Save button on the conclusion card → `records` collection; `/records` page lists and deletes. Official `mongodb` driver, not mongoose. `savedAt` only for now — datetime inference from "time" items is the next step.
- **Call log (2026-08-27):** Google has no usage API, so every Gemini call is logged app-side into a `calls` collection (`kind` chat/conclude, `model`, `ok`, `error`), viewed on the `/calls` page.
- **Conclude model + translation (2026-08-27):** Conclude runs on a fixed lower-tier model (`CONCLUDE_MODEL`, default `gemini-flash-lite-latest`) — pure text, separate quota from chat. On Save, the conclusion is translated (`lib/translate.ts`): time items → real `datetime` (today + inferred time in `RECORD_TIMEZONE`), numeric values → `number` fields.
- **Sessions (2026-08-27):** ChatGPT-style persisted conversations — `sessions` + `messages` collections; sidebar session list with New chat/delete; `?session=` deep link; auto-title from first message.
- **Live health checks (2026-08-28):** Models/Usage pages run a live per-model probe on entry (`/api/health`, 5-min cache): available / ran out / busy; retired models are hidden from the list entirely.
- **Catalog pruning (2026-08-28):** the 5 retired models (404) removed from `CHAT_MODELS` entirely — 14 models remain; future retirements are auto-hidden by the live 404 classification.
- **Auto fallback (2026-08-28):** chat defaults to auto mode — best tier first, falls back down the chain on 429/404 until one works (fails only if all are out); pinned model = no fallback. Conclude runs lowest tier first, moving up. Every chain attempt is logged in `calls`.
- **No auto checks (2026-08-28):** health probes run only on explicit Re-check (`force=1`); page loads read cache only — zero quota burn.
- **Accounts (2026-08-28):** username/password auth (scrypt, cookie token in `auth_tokens`); all API routes protected; sessions/messages/records scoped per user; first account claims pre-auth data. `/login` page with register toggle.
- **Guest mode (2026-08-28):** no login needed — chat + Conclude public; guests persist sessions/conclusions in localStorage (quota-overflow drops images); owner tabs (Calls/Models/Usage) hidden for guests.
- **Response format (2026-08-28):** `SYSTEM_PROMPT.md` (read per request, edit without restart) defines an exact Chinese-only food-photo template — first line = meal name (mapped from browser-local time; picture's visible time wins), then one line per food with color dots (🟢/🟡/🔴, red always last), "理由：" one-liner only for 🔴 items, mandatory divider, ≤2-sentence 总结. Model line breaks preserved in the UI via markdown hard breaks.

## Deliberately excluded (future ideas)

- Conversation persistence / share links
- System prompt picker / personas
- Streaming with markdown code syntax highlighting
- Rate limiting in app (nginx handles it at the VM level)
- i18n (en/zh like Rencipe)
- Public subdomain + TLS (needs DNS change by owner; app runs via PM2 on :3001)
- Time inference on records (parse "time" items into a real datetime field) — planned next
- Charts/trends over saved records

## Status

- [x] Repo created: github.com/zbr79/inschat
- [x] v1 built (chat + image upload + streaming)
- [x] Deployed on VM via PM2 (port 3001)
- [x] Real `GEMINI_API_KEY` added; text + image chat verified working
- [x] Live: https://inschat.renstoolbox.com (nginx proxy + Let's Encrypt, streaming enabled, rate limits + exploit blocks like profile site)
- [x] Conclude button: `/api/conclude` turns an AI reply into a structured JSON conclusion (title/summary/items) shown as a card
- [x] Models tab: switch active model, per-model usage progress, grayed-out exhausted/retired models
- [x] MongoDB storage: Save button → db `inschat` `records` collection; `/records` list + delete
- [x] API call log: every Gemini call saved to `calls` collection; `/calls` page with totals + error text
- [x] Conclude on fixed lower-tier model (`CONCLUDE_MODEL`); Save translates time→datetime, values→numbers
- [x] Chat sessions: persisted conversations, sidebar list, New chat/delete, `?session=` links
- [x] Live model availability checks (Models + Usage pages), retired models hidden
- [x] Health checks manual-only (Re-check), zero probes on page load
- [x] Accounts: register/login/logout, per-user sessions/records, first user claims old data
- [x] Guest mode: localStorage sessions + conclusions, owner tabs hidden, no login for demo
- [x] Fixed response format in system prompt (food analysis / reading restatement, user-language)
