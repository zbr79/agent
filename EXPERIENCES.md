# EXPERIENCES.md

Append-only log. Record every solved problem / unresolved issue / disproved approach.

Format per entry:

```
## YYYY-MM-DD — Title

### Solved
- What fixed it.

### Unresolved
- What's still open.

### Disproved
- What was tried and didn't work (and why).
```

Companion file: `PLAN.md` (read-first decision log + roadmap).

---

## 2026-08-27 — v1 built: text chat + image upload + streaming

### Solved
- Next.js 16 App Router + React 19 + `@google/genai` SDK, `gemini-3.6-flash` on the free tier (configurable via `GEMINI_MODEL`).
- Streaming relay: `POST /api/chat` returns a `ReadableStream`; server validates payload (roles, image type/size) before calling Gemini; images travel as base64 `inlineData`.
- Multi-turn context: last 20 messages sent as full history.
- Free-tier 503s handled with 3× retry + backoff in `lib/gemini.ts`; the route streams the real error message.
- Renamed project to InsChat; added sidebar usage panel: PT-day request/error counters + rpm tracking persisted in `data/usage.json` (`lib/usage.ts`).

### Unresolved
- No auth/DB/persistence — conversations live in the browser only (deliberate v1 scope).
- Usage is tracked but not hard-blocked in-app — rate limits are enforced by nginx at the edge instead.

---

## 2026-08-27 — Public deployment (inschat.renstoolbox.com)

### Solved
- Live at https://inschat.renstoolbox.com via nginx → 127.0.0.1:3001; streaming preserved (`proxy_buffering off` etc.).
- PM2 app `inschat` runs `next start -p 3001` (ecosystem.config.js).
- Real `GEMINI_API_KEY` in `.env` (gitignored, never committed); text + image chat verified working.

### Unresolved
- In-app rate limiting stays at the edge (nginx) — see PLAN "Deliberately excluded".

---

## 2026-08-27 — Conclude: structured conclusion from an AI reply

### Solved
- User-facing problem: chat replies are free text ("your insulin is 130"), so nothing could be recorded. Solution: per-message **Conclude** button that makes a *separate* non-streaming Gemini call with `responseMimeType: "application/json"` + JSON schema (OBJECT: title/summary/items[]) — the streaming chat stays untouched.
- `responseSchema` (SDK Schema object) produced junk values ("130 navigator.deviceMemory…") on the free-tier model. Fixed by switching to `responseJsonSchema` (plain JSON-Schema object, Gemini strict mode) + prompt rules (value = ONLY the value, one item per metric). Verified clean on 3 scenarios: insulin / meal / no-data.
- `lib/conclude.ts` reuses `getApiKey` (now exported from `lib/gemini.ts`) and the same 3× 503-retry pattern; `sanitize()` defends against malformed model JSON before it reaches the client.
- `POST /api/conclude` validates `text`/`context` (length caps), returns JSON or 400/502; counted in the usage panel via `recordRequest/recordError`.
- UI: `components/ConclusionCard.tsx` (own state) rendered under model bubbles via a new `.message-body` wrapper in `MessageBubble.tsx`; context = the preceding user message (needed for "in the morning" time hints).
- Live-site 405 on `POST /api/conclude`: nginx `location /` only allows GET/HEAD/OPTIONS (exploit-block pattern). Fixed by adding a dedicated `/api/conclude` location (POST|OPTIONS, no buffering) in `/etc/nginx/conf.d/inschat.renstoolbox.com.conf`.
- Usage-panel limits were wrong: `GEMINI_LIMITS.rpd` was a hard-coded v1 assumption (1500/day). The API's real 429 payload showed the free-tier daily cap for `gemini-3.6-flash` is **20 requests/day per model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue: "20"`). Updated `lib/usage.ts` + `UsagePanel.tsx` to 20; each chat or Conclude call = 1 request.

### Unresolved
- Conclusion is display-only — no DB save yet. Next step: Save button on the conclusion card → MongoDB (new db `inschat`, same Atlas as baizhan-v2).
- No time resolution logic yet (AI may put "time" as an item; server-side "today + inferred time" parsing is planned for the save step).
- Free tier is tight: ~20 req/day/model means ~10 chats + 10 Concludes, or 20 chats with no Concludes — enough for personal use, thin for heavy testing.

---

## 2026-08-27 — Model switching + per-model quota tracking

### Solved
- Quota is **per model** (429 payload: `GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue: "20"`): when `gemini-3.6-flash` was exhausted, the same key still worked on `gemini-3.5-flash`, `gemini-flash-lite-latest`, `gemini-3-flash-preview`. Capacity math: 14 non-retired chat models × 20 = **280 calls/day max**, of which 6 with confirmed image support = **120 image uploads/day**, 9 flash/lite = **180 text-only/day**.
- Built `lib/models.ts`: static catalog of the 19 models returned by `models.list` (2026-08-27 probe), tagged `vision: yes/unverified` + `retired` from the image-probe; active model persisted in `data/model.json` (env `GEMINI_MODEL` is the fallback default).
- `lib/usage.ts` now tracks per-model daily counters (fresh field `models`, old state migrates cleanly); global day limit is dynamic (usable models × 20).
- `GET/POST /api/models` + Models tab (`/models`): switch button, grayed-out "Ran out" (used ≥ 20) and "Retired" rows, per-model progress bars, capacity summary. New nginx location `/api/models` (GET|POST) — same 405 trap as `/api/conclude` had.
- Chat and Conclude both call `getActiveModel()` per request, so switching takes effect immediately without restart.

### Unresolved
- "Ran out" gray-out relies on this app's own counters (quota rejections aren't counted by Google); first requests after midnight PT reset the file state.
- Vision flags for pro/omni/3.5/3.7 models are unverified (probe was quota-blocked) — user re-testing will confirm.
- **No public Google usage API**: the `ai.dev/rate-limit` link in 429 payloads redirects to the logged-in AI Studio dashboard (browser session only). Mitigation built: `isQuotaError()` in `lib/gemini.ts` detects `RESOURCE_EXHAUSTED`/429 and `recordQuotaExhausted(model)` marks the model in `data/usage.json`; the Models tab then shows a real-API "Ran out (API)" tag (grayed + unswitchable). Progress bars remain app-tracked approximations — Google never reports remaining quota.

---

## 2026-08-27 — MongoDB storage: Save conclusion → db `inschat`

### Solved
- Reused the baizhan-v2 MongoDB Atlas cluster (its `MONGO_URI`), separate database `inschat` — added to inschat `.env` as `MONGODB_URI`/`MONGODB_DB` (never logged). Atlas creates the db + `records` collection on first write; verified connectivity with the `mongodb` driver (no mongoose — lighter).
- `lib/db.ts`: lazy singleton client (connect retried per call on failure), `insertRecord/listRecords/deleteRecord` on `records` collection; docs serialized to `SavedRecord` (string `_id`, ISO `savedAt`).
- `GET/POST/DELETE /api/records` with full payload validation (length caps, items ≤ 20) and 400/404/500 handling; new nginx `/api/records` location (GET|POST|DELETE) — same 405 trap pattern as the other API routes.
- Save button on the conclusion card (`ConclusionCard.tsx`): POSTs `{title, summary, items, sourceText}` → button flips to "Saved" (disabled); save errors shown inline, chat never affected.
- `/records` page (`RecordsPanel.tsx` + sidebar link): newest-first list of saved records with delete; verified end-to-end with playwright (Conclude mocked, Save/Delete real): Save → appears on Records page → Delete → empty state.

### Unresolved
- No datetime inference yet: records store `savedAt` only; the "time" item stays a free string. Next: parse time items into a real `datetime` field (today + inferred time, `RECORD_TIMEZONE`) so records can be charted/queried by time.
- No per-user separation (single-user app, no auth) — fine for now.

---

## 2026-08-27 — API call log in MongoDB (`calls` collection)

### Solved
- Since Google has no usage API, every Gemini call is now logged app-side: `insertCall({kind, model, ok, error})` in `lib/db.ts` → `calls` collection in db `inschat`. Chat logs in the stream's `finally` (fire-and-forget, `.catch(()=>{})` — DB failure can never break the chat); Conclude logs success or the truncated (≤500 chars) error.
- `GET /api/calls` returns last 100 calls + totals (`total`/`failed` via `countDocuments`); nginx `/api/calls` location (GET only).
- `/calls` page (`CallsPanel.tsx`, sidebar link): summary card, per-call rows (kind, model, ok/error, local time, error text on failure), auto-refresh every 10s.
- Verified with seeded docs via playwright (summary 2, failed row + error text rendered), then cleaned up — DB left empty for real calls. Write path will produce its first real row on the user's next chat/Conclude.

---

## 2026-08-27 — Conclude on lower-tier model + record translation on save

### Solved
- Conclude decoupled from chat: `getConcludeModel()` in `lib/models.ts` resolves `CONCLUDE_MODEL` (default `gemini-flash-lite-latest`, a fixed lower-tier model — Conclude is pure text). `/api/conclude` usage counting, call log and quota-exhaustion marking all use the Conclude model; chat keeps the switchable model. `/api/models` exposes `concludeModel` and the Models tab says so.
- Record translation (`lib/translate.ts`): on Save, the raw conclusion is transformed before insert — `time`-named items become a real `datetime` (today's date + inferred time in `RECORD_TIMEZONE`, default Asia/Shanghai; "morning"→07:00, "7 am"/"07:00" parsed; timezone offset via `Intl.formatToParts` trick); numeric values get a `number` field (130 from "130" or "98 mg/dL"; food lists left untouched).
- Record docs now store `{title, summary, items[{name,value,unit,number}], datetime, sourceText, savedAt}`; Records page shows a "Reading time" line when a datetime exists. Verified: morning → 23:00Z (=07:00 +08:00), 7 am → 23:00Z, food list → datetime null, numbers 130/98 parsed. Test records cleaned; user's own record untouched.

### Unresolved
- Inferred time-of-day uses today's date even if the inferred time is earlier than now (no date-rollover logic yet).
- The "time" item stays in `items` alongside `datetime` — harmless duplication for display.

---

## 2026-08-27 — ChatGPT-style chat sessions (persisted conversations)

### Solved
- New collections in db `inschat`: `sessions` (`title`, `createdAt`, `updatedAt`) + `messages` (`sessionId`, `role`, `text`, `image` — base64 image stored as-is, ≤5MB each). `lib/db.ts`: insertSession/listSessions/getSessionWithMessages/appendMessage (bumps `updatedAt`)/deleteSession (cascades messages).
- API: `GET/POST /api/sessions` (auto-title from first message, ≤120 chars), `GET/DELETE /api/sessions/[id]`, `POST /api/sessions/[id]/messages` (validates role/text/image). nginx `/api/sessions` location (GET|POST|DELETE).
- `ChatApp.tsx`: reads `?session=` param (Suspense-wrapped — `useSearchParams` needs it in Next 16 static pages); loads messages on mount; creates the session lazily on first send (title = first message text, then `router.replace("?session=id")`); persists the user message immediately and the model message after the stream finishes (failed/aborted replies are not saved). Persistence is fire-and-forget — DB failure never breaks chat.
- Sidebar shows a scrollable session list (only on the home route, hidden on mobile) with + New chat and hover-to-delete; deleting the open session redirects to `/`.
- Bug found by the browser test and fixed: navigating to `/` from `/?session=X` didn't clear the in-memory messages (same mounted component) — the session effect now resets `messages` on every param change.
- Verified end-to-end with playwright (no Gemini calls): load session → bubbles + image render; New chat → empty; sidebar delete → list empty + redirect. Test data cleaned up.

### Unresolved
- No rename UI (auto-title only) — `PATCH` rename is trivial to add later.
- Mid-stream page close loses the in-flight model reply (user message is already saved).

---

## 2026-08-27 — Full model health check (text probe of all 19 catalog models)

### Solved
- Ran a one-message probe against every catalog model (`/home/ubuntu/opencode-tmp/inschat-healthcheck.js`): 9 healthy, 6 quota-blocked (429: pro×3, omni×2, `gemini-3.6-flash`), 5 retired (404), 0 hard failures.
- **Gotcha found:** Gemini 3.x "flash" models return HTTP 200 with **empty text** when `maxOutputTokens` is tiny (16) — the budget goes to thinking. Re-probing with `thinkingConfig: { thinkingBudget: 0 }` + 64 tokens: `gemini-3.5-flash` (0.8s), `gemini-3.7-flash` (38s), `gemini-flash-latest` (49s), `gemini-3-flash-preview` (0.7s) all replied "ok". InsChat is unaffected (no maxOutputTokens set), but future code must never cap output tokens low on thinking models.
- Latency: flash-lite family ~0.5–2.4s; `gemini-3.7-flash` and `gemini-flash-latest` are very slow (38–49s) — bad streaming UX, avoid as primary.
- 429 payloads confirm per-model daily quota again (pro/omni buckets were consumed by earlier probes + user testing; rejected calls consume nothing).
- **Pro/omni 429s are not "used up":** since late 2025 Google removed free-tier access for Pro models entirely (2026: paid-only; `gemini-3.1 Pro` has no free lane). Paid tier: link billing + prepay min $10 → Tier 1 ($250/mo cap), auto-upgrades to Tier 2/3 by cumulative spend; Flash pricing ~$0.25–0.50 input / $1.50–3.00 output per 1M tokens — InsChat volume would cost cents per day.

---

## 2026-08-28 — Live model availability checks on page load

### Solved
- `lib/health.ts`: probes every non-retired model with one tiny text request (parallel, 90s timeout each, 5-min in-memory cache, `force=1` re-check). Each probe is logged to the `calls` collection (`kind: "health"`), successful probes count into per-model usage, 429 probes mark `recordQuotaExhausted`.
- `GET /api/health` (+ nginx block) returns live statuses: `ok` / `quota` / `busy` / `retired` / `empty` / `error`.
- Models tab now runs the check on entry: **retired models are hidden entirely**, quota models grayed with "Ran out", healthy ones get a green "Available" tag, busy get orange; summary card shows `N available · M ran out · K busy` + "Re-check" button. Usage page shows the same availability counts.
- **Probe gotcha fixed:** `thinkingConfig` in the request causes HTTP 400 on non-thinking models (lite variants, `gemini-3.6-flash`). Probe now uses only `maxOutputTokens: 256` (no thinkingConfig) — thinking models still answer (3.5-flash 13–25s, flash-latest/3.7-flash time out at 90s and are marked "busy").
- Live snapshot (2026-08-28): 5 available (3.5-flash, 3.5-flash-lite, flash-lite-latest, 3-flash-preview, 3.1-flash-lite), 6 quota (3.6-flash + pro/omni), 3 busy (3.7-flash, flash-latest, 3.1-flash-lite-preview), 5 retired hidden.
- **Speed fix (2026-08-28):** cold check went 90s+ → ~20s. Three changes: (1) adaptive probe — `thinkingConfig: {thinkingBudget: 0}` makes thinking models answer in <1s (3-flash-preview 13.9s→0.7s); models that reject thinkingConfig with 400 fall back to a plain request; (2) per-model timeout 20s → slow models (flash-latest ~50s) are marked "busy (slow)" instead of blocking the page; (3) stale-while-revalidate — `/api/health` returns the last cached results instantly (34ms) and refreshes in the background when >5min old; UI re-polls once after 30s to pick up fresh results.
- **Marker consistency fix:** `recordQuotaExhausted` marks came from ANY 429 (incl. transient RPM bursts) and stuck all day. Now a successful health probe calls `recordQuotaCleared(model)`; the Models panel also lets live status win over stale markers (`live.status === "ok"` → available even if a marker/counter disagrees).
- **Retired models removed from catalog (2026-08-28):** the 5 models that return 404 (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`, `gemini-3.1-flash-live-preview`, `gemini-3.5-live-translate-preview`) were deleted from `CHAT_MODELS` — the app now knows 14 models. No free way to detect quota exhaustion exists (`models.get()` always 200; `countTokens()` only 404s for retired models — free but can't see quota). The health probe still classifies any live 404 as "retired" so the UI auto-hides models Google retires later.

---

## 2026-08-28 — Auto fallback mode: chat never dies on one model's quota

### Solved
- **Auto mode (default):** `model.json` now stores `"auto"` (or a pinned model name). Chat uses `getChatChain()` — best tier first (pro → omni → flash → lite), and on a 429/404 each model is marked exhausted (free — rejected calls cost nothing) and the chain moves down one tier. Chat only fails if EVERY model in the chain fails. Manually picking a model in the Models tab pins it (no fallback); an "Auto — best available" row in the Models tab re-enables auto.
- **Conclude goes upward:** `getConcludeChain()` starts at the lowest tier (starts with `CONCLUDE_MODEL` = `gemini-flash-lite-latest`) and only moves up when one is exhausted/unavailable/returns malformed JSON.
- Accounting moved into the libs: `streamChat`/`concludeMessage` now call `recordRequest` (for the model that actually answered), `recordQuotaExhausted` (per failed model), and `insertCall` (one row per chain attempt) — the Calls page shows the full fallback trail. Routes no longer duplicate usage/call accounting.
- Verified end-to-end: chat request logged 6 free 429s (pro×3, omni×2, 3.6-flash) then succeeded on `gemini-3.5-flash` (26s total — the model itself is slow, thinking on); Conclude answered on `gemini-flash-lite-latest` in 0.9s; Models tab shows the Auto row Active.

### Unresolved
- Best-first ordering means the first *available* model can be a slow thinking model (~20s first token) — acceptable for now; could reorder the flash tier by speed or disable thinking for simple prompts later.

---

## 2026-08-28 — No auto health checks + account system

### Solved
- **Health checks no longer run on page load** (they were burning quota): plain `GET /api/health` only reads the last cached results (0.17s, 0 requests — verified against the calls count); only an explicit Re-check (`force=1`) probes models. Models/Usage pages show "not run yet" until then. CACHE_TTL/background-refresh logic removed.
- **Accounts (`lib/auth.ts` + `lib/accounts.ts`):** username/password with `crypto.scryptSync` + `timingSafeEqual` (no new deps); login tokens = random 32B, sha256-stored in `auth_tokens` (30-day expiry), delivered as httpOnly/Secure/SameSite=Lax cookie. Routes: `POST /api/auth/register|login|logout`, `GET /api/auth/me`.
- All app API routes (chat, conclude, sessions, records, models, health, usage, calls) now require the cookie via `requireUser` (401 otherwise). Sessions/messages/records are scoped by `userId` (ownership checks on read/write/delete).
- **Data migration:** the first registered account claims all pre-auth data (`userId` missing OR dangling to a deleted user) — the existing "Greeting" record + 2 sessions were preserved through a test-user create/delete cycle and re-orphaned correctly. Verified full flow in playwright: unauthenticated → /login; register/sign in → sidebar shows username + sessions + composer; sign out → /login; protected pages redirect.
- `/login` page (login/register toggle, inline errors), sidebar user chip + Sign out, nginx `/api/auth` block.

### Unresolved
- No password reset / no email — acceptable for a personal app; note it if a second real user ever appears.
- Usage counters (`data/usage.json`) and the `calls` collection stay global (they describe the shared API key, not a user).

---

## 2026-08-28 — Guest mode (localStorage, no login)

### Solved
- Recruiter-friendly demo: no account needed. Guests get chat + Conclude (both APIs dropped `requireUser`); the whole guest experience persists in localStorage — `lib/guestStore.ts` holds sessions (uuid, title, messages incl. images) and saved conclusions/records. Quota-overflow fallback: if localStorage fills, images are dropped (text kept), sessions trimmed to the newest 10.
- `ChatApp` is auth-aware: guest → local session store (no server calls); signed-in → server flow unchanged. Guest header hint "chats and records stay on this device"; guest Save on the conclusion card writes a local record; Records page shows local records for guests with its own sub-text.
- Sidebar: no forced /login redirect anymore; guests see only Chat + Records (owner tabs Calls/Models/Usage hidden — they switch the global model / expose quota); guest session list + delete; "Sign in" link. Signed-in users see the full tab set + username + Sign out.
- **Race bug found & fixed:** `router.replace("?session=id")` inside `send()` re-ran the session-load effect, which reset the live conversation to the (empty) stored copy — chat answered with 200 but the UI stayed blank. Fix: the load effect now skips refetching when `sessionParam === sessionIdRef.current` (fixes a latent race for the server flow too).
- Verified (playwright, fresh context): no redirect; send → URL gets session; **refresh restores 2 bubbles**; Conclude → Save → "Saved"; Records page lists the local record; Models page doesn't crash for guests; session delete works. Owner flow re-verified (register → 5 tabs + username → sign out), test account deleted and data re-orphaned.

### Unresolved
- Guest data never migrates to an account on sign-in (stays in localStorage) — acceptable for demos.
- Guests burn the shared API quota; nginx per-IP rate limit (20 req/min) is the only guard.

---

## 2026-08-28 — Fixed response format (no chat memory needed)

### Solved
- User insight: instead of chat memory, bake the expected response format into the system prompt so users can skip questions entirely — send a photo/reading and get the right shape back.
- `SYSTEM_PROMPT` in `lib/gemini.ts` is now the InsChat glucose-assistant persona: reply in the user's language (labels included); food photos → per-item analysis (成分/营养特点/升糖影响 + overall GI summary + tips); readings → value/unit/time restated, missing unit flagged instead of guessed; never invent numbers.
- UI hints updated to match: empty state ("Send a food photo… or a reading like 'insulin 130 at 7 am'") and composer placeholder ("Ask about a meal, or record a reading…").
- Verified with real calls: Chinese food question → Chinese per-item format exactly as the user's example; English reading → structured restatement + "unit missing" flag.
- Persona moved to a file: `SYSTEM_PROMPT.md` (project root) is read per request by `getSystemPrompt()` in `lib/gemini.ts` (fallback constant if missing) — editing the md takes effect with no rebuild/restart. (Naming note: AGENTS.md already exists for opencode's own repo instructions, so the chatbot persona uses SYSTEM_PROMPT.md instead.)

---

## 2026-08-28 — Exact food-photo response format (Chinese, template)

### Solved
- User defined a strict template for food photos (Chinese only, image-with-food condition): `{M月D日 上午/中午/下午/晚上X点}` → `基于时间：{早餐/午餐/晚餐/加餐}` (mapped from clock time: 5–10 / 11–14 / 17–21 / else) → one line per item `{食物} - {高升糖|中升糖|低升糖}` with a one-sentence reason ONLY for 高升糖 (低升糖 no reason) → `--------------` → `总结{≤2 sentences}` — nothing outside the template.
- Current time injected per request: `getSystemPrompt()` appends `当前时间（Asia/Shanghai）: …` formatted via `Intl.DateTimeFormat("zh-CN", { timeZone: RECORD_TIMEZONE })` — the model no longer needs to guess the date/meal.
- Verified with a real food image (wikimedia): reply began "8月28日 下午12点 / 基于时间：午餐 / 面包 - 高升糖 / 高升糖的理由：… / 意面 - 中升糖 / … / 总结：…" — template followed exactly. Template tweaked afterwards to add 中午 for 12点 (file edit, no rebuild — it's read per request).
- **Round 2 (user feedback):** (1) "big sentence" output — caused by markdown collapsing single newlines; fixed in `MessageBubble` with `preserveLineBreaks()` (converts each line to a hard break `"  \n"`) — verified: 3-line reply renders with 2 `<br>`s. (2) Time must be the user's local time — `/api/chat` now accepts `timeZone` (validated via `Intl`), `ChatApp` sends the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`, and the injected 当前时间 uses it (fallback `RECORD_TIMEZONE`); verified with `America/New_York` → "8月28日 上午0点". (3) Template then: bold food lines, only 高升糖 listed, picture's visible time wins, 凌晨 for 0点.
- **Round 3 (user feedback):** template simplified — first line is just the meal name (no date/time, no 基于时间 prefix); every food gets a color dot (🟢 low / 🟡 medium / 🔴 high) ordered green→yellow→**red last**; only 🔴 items get a reason prefixed with just "理由：" (no 高升糖理由); divider before 总结 is explicitly mandatory. Verified with a real image: "午餐 / 芦笋 🟢 / 西兰花 🟢 / 红豆 🟢 / 鱼肉 🟢 / 燕麦 🟡 / 面包 🔴 / 理由：… / 总结…" — divider was missed once, so the prompt now states it MUST appear.

---

## 2026-08-28 — Model display + thinking indicator

### Solved
- Plan: sentinel chunks in the plain-text chat stream so the client can show which model answered + a thinking indicator while waiting for the first token. User choices: only the FINAL model (no TRYING walk), bilingual label "Thinking… / 思考中…".
- `lib/markers.ts` (new module): `encodeModelMarker(model)` emits `␀MODEL:<name>␀` (U+2400 delimiter — never occurs in real text); `ModelMarkerParser` strips markers from arbitrarily split chunks (handles markers split across chunks, incl. the prefix itself, and buffers partial markers).
- `lib/gemini.ts` `streamChat`: yields the marker right after `recordRequest(model)` — i.e. when a model actually connects, before its first token. Route unchanged (plain passthrough).
- `ChatApp`: `ModelMarkerParser` in the read loop; `UiMessage.model` set when marker parsed; marker text never appended to the bubble. Finished replies keep `model` so the chip persists in-session.
- `MessageBubble`: streaming && no text → pulsing "Thinking… / 思考中…" + 3 animated dots; model chip under the bubble — model name (monospace) while live, muted "answered by X" once finished (hidden on failed).
- `globals.css`: `.thinking*`, `@keyframes thinking-pulse`, `.model-chip` (+`.live`) using existing `--text-muted` var.
- Verified: curl shows raw stream `␀MODEL:gemini-3.6-flash␀ok`; parser unit-tested via compiled tsc output (split-marker cases all pass); playwright probe on localhost: thinking indicator seen, chip "answered by gemini-3-flash-preview", no sentinel leaked, reply text intact.

### Notes
- The "live chip while streaming" probe line showed "answered by …" because the answer finished before the selector poll caught it (fast flash model); the code path `streaming ? name : "answered by name"` is correct.
- Marker is emitted before iterating the stream — if the stream later fails mid-way, the bubble shows the chip plus the route's appended error text (accepted tradeoff, chip hidden only on `failed`).
- Model name is not persisted to the DB — chip shows for the live session only, not after reload.

---

## 2026-08-28 — Food-photo format: time line back + red-item highlights

### Solved
- User feedback: dinner reply lost the date/time line and the highlight formatting — got "晚餐 / items / 总结" with no time and no divider.
- User's target time format (Chinese style): `2025年4月2日 下午 5:20` — 年/月/日, space before time, 12-hour no leading zeros. Highlights = only 🔴 foods bolded (`**食物 🔴**`) with a 理由 line.
- `SYSTEM_PROMPT.md` section 1 rewritten: line 1 meal name, line 2 full Chinese date-time, dot-ordered food lines (red last), bold-red + 理由, mandatory `--------------` divider before 总结. Period-word rule by hour: 凌晨 0–5 / 上午 6–11 / 中午 12 / 下午 13–18 / 晚上 19–23.
- `lib/gemini.ts` `currentTimeLabel` now emits the injected 当前时间 directly in that target format via `Intl.DateTimeFormat("zh-CN", { hour12: true }).formatToParts()` — the model can copy it verbatim instead of converting.
- Verified with a real food image (food.jpg): "加餐 / 2026年8月28日 下午 2:25 / …🟢🟢🟢…🟡…**通心粉 🔴** / 理由：… / -------------- / 总结…" — time line and bold-red highlight present, divider present, no marker leak.
- Minor drift noted: 14:25 was called 午餐 on one run and 加餐 on another (rule boundary 11–14); cosmetic, left as-is.

---

## 2026-08-28 — Walk display, picture-time rule, chip styling, image lightbox

### Solved
- **Model walk before finish:** `encodeTryingMarker` added; `streamChat` yields `␀TRYING:<model>␀` at each attempt start, so the client shows "Trying gemini-3.1-pro-preview…" while the chain walks (pro 429s take ~0.3s each), then the live chip once a model connects. User reversed the earlier "only final model" choice.
- **One-language label:** thinking label is now just "Thinking…" (dropped / 思考中). Label switches: Trying X… → Thinking… → chip + text.
- **Parser:** `ModelMarkerParser` generalized for MODEL + TRYING markers. Subtle bug class: in-marker buffer includes the leading ␀, so `inner` must be `slice(1, close)` (hit it in both branches; caught by unit tests before shipping).
- **Chip font:** `.model-chip` restyled as a pill (border-radius 999px, `var(--font)` instead of monospace, border + soft bg); `.live` gets a pulsing green dot.
- **Image lightbox:** `components/ImageViewer.tsx` (new) — full-screen overlay, click/Escape closes; bubble images get `cursor: zoom-in` and open it via local state in `MessageBubble`.
- **Picture-time rule:** SYSTEM_PROMPT.md now leads with a "TIME RULE": any visible time on the photo (clock, watch, phone, timestamp, receipt) wins for both the meal name and line 2 (date from 当前时间); 当前时间 is only a fallback.
- Verified: parser unit tests (split TRYING/MODEL markers), raw curl stream shows the full walk `␀TRYING:…␀` ×N then `␀MODEL:…␀`, playwright: "Trying …" label seen, live chip `gemini-3-flash-preview` while streaming, finished "answered by …", image viewer opens/closes, no sentinel leak.
- Not verifiable locally: picture-time rule needs a photo with a visible clock — left for the user to confirm.

---

## 2026-08-28 — Dot-first food format + minimal UI text

### Solved
- Food lines now put the color dot BEFORE the food name (`🟢 酱牛肉`, bold `**🔴 意面**`); order green→yellow→red unchanged. Verified with a real image call.
- Trying phase shows ONLY the animated dots (no "Trying X…" text); "Thinking…" label appears only after a model connects (model set, no text yet), together with the live model chip. Finished chip shows just the model name (dropped "answered by").
- Bug: when TRYING and MODEL markers arrive in the same chunk, the `trying` state overwrote `model` and hid "Thinking…" — fixed by making `model` take precedence in ChatApp's marker handling.
- Removed useless text: empty-state blurb, header subtitle ("Powered by Google Gemini…"), composer hint ("Enter to send…"), textarea placeholder. Composer hint now renders only for image errors.
- Playwright timeline: 0.0s dots-only → 4.6s chip+text. On fast flash models the MODEL→first-token window is <100ms so "Thinking…" barely renders; it exists for the slow-model 10–25s wait.
- Probe note: the "done" condition `!bubble.querySelector('.cursor')` is true during the thinking phase (no cursor when no text) — must also require text present; caught by a state-transition debug probe.

---

## 2026-08-28 — "Frozen app" diagnosis + visible dots + server-side progress logs

### Solved
- User reported a picture send with no response ("app frozen", "not even seeing dots"). Diagnosis: server was healthy (replayed image through production nginx in ~19s); the user's two POST /api/chat (19:13, 19:27) left no rows in the Mongo `calls` collection and no stuck sockets — they were cancelled client-side before the first Gemini attempt logged. Root UX causes: (1) dots were 5px at 25% opacity — effectively invisible; (2) the walk + image re-upload + first-token wait is 15–30s+ of total silence; (3) no way to see where a request is.
- User decisions: keep dots (no text), and instead of timeouts, make it diagnosable ("we should know why it is stuck rather than let it timeout").
- Dots made visible: 8px, opacity 0.2→1, 1s pulse. Verified via playwright (3 dots, 8px).
- `lib/gemini.ts` now logs every step with a per-request id: `[chat:xxxxxx] start (image b64 KB, chain length) / trying <model> / quota exhausted / unavailable / overloaded retry / connected <model> waiting for first token / done / stream error / failed`. `app/api/chat/route.ts` logs client aborts (`client disconnected mid-stream`). Next "frozen" report can be diagnosed from `pm2 logs inschat`.
- Client hardening: `ChatApp`'s `/api/auth/me` probe now aborts after 4s and falls back to guest — `send()` can no longer silently no-op while `isAuthed === null` (a plausible "no dots at all" path).
- Verified: image request logs show full walk → connected → done; app serves 200.

---

## 2026-08-28 — Elapsed timer + chip moved to right of bubble

### Solved
- Per-message elapsed counter: `modelMessage` starts with `elapsed: 0`; a 1s `setInterval` in `send()` increments only that message; cleared in `finally`. Survives stream end so finished replies keep the final time (in-memory only).
- Chip format: `54s · gemini-3.6-flash` (elapsed first, middle-dot separator, model name) — matches the user's "54s dot model name" spec. During the walk (no model yet) it shows just `Ns` with the pulsing green dot, giving the "not frozen" feedback without model-name text.
- Chip moved from below the bubble to the right: new `.bubble-row` flex wrapper (align-items: flex-end, gap 8px) inside `.message-body`; `.bubble` gets `min-width: 0; flex-shrink: 1` so long replies wrap instead of pushing the chip off-screen; chip `flex-shrink: 0; white-space: nowrap`. ConclusionCard still sits below the row.
- Verified via playwright: chip appears immediately with `0s`, ends `2s · gemini-3.6-flash`, geometry check confirms chip is right of bubble on the same row.

---

## 2026-08-28 — Meta line: plain text below-right, time only after finish

### Solved
- Time hidden while streaming — meta shows only the model name (`gemini-3.6-flash`, with pulsing green dot); elapsed appears only after finish (`3s · gemini-3.6-flash`).
- Meta is no longer a pill: `.model-chip` replaced by `.model-meta` — plain 11px muted text, `align-self: flex-end` inside `.message-body` so it sits below the bubble on the right; `.bubble-row` wrapper removed.
- Verified via playwright: streaming meta = model name only; finished = `3s · …` matching /^\d+s · .+$/; geometry: below bubble, right-aligned to the message column, computed styles show no pill (transparent bg, 0 radius, 0 border).

---

## 2026-08-28 — Global Conclude button (whole-conversation summary)

### Solved
- Removed per-message `ConclusionCard` (component deleted). New global flow: one round icon button docked above the composer, right side — chosen per research (setproduct.com: avoid FABs overlapping streaming content; top/bottom dock zones only) and user preference over header placement.
- `components/ConcludeButton.tsx` (new): 44px round icon button (file-text SVG), pulse animation while summarizing, disabled when no replies or while a message is streaming. `components/SummaryCard.tsx` (new): the card UI + save-to-records logic extracted from the old ConclusionCard.
- `ChatApp.concludeAll`: joins ALL non-failed model replies (up to 16k chars) and POSTs to /api/conclude; result renders as an in-chat card at the bottom of the message list (dismissible), per user's "in-chat summary card" choice.
- Verified via playwright: disabled when empty; enabled after replies; 44px button above composer on the right; click → card whose summary mentions BOTH test replies (insulin reading + breakfast); dismiss works; no per-message conclude buttons remain.

---

## 2026-08-28 — Conclude report follows source language

### Solved
- First rule of report formalization: the conclusion must be in the language of the original chat. `lib/conclude.ts` now detects the source language (CJK ratio ≥ 25% of non-space chars → Chinese, else English) and appends a per-language rule to the system prompt (Chinese: title/summary/item names fully Chinese, time item named "时间", units kept as stated; English mirror rule).
- `sanitize()` fallbacks localized too (总结 / 未找到可记录的具体数据。).
- Verified with two real calls: Chinese food reply → {"title":"午餐记录","summary":"记录了午餐食用…","items":[{"name":"时间",…},{"name":"食物",…}]}; English → "Insulin reading" with "insulin"/"time" names.
- Next: user indicated more report-format rules will follow ("first should follow language…").

---

## 2026-08-28 — Report: meal grouping + session persistence

### Solved
- Problem: report showed flat rows (晚餐/时间/午餐/时间 = 4 rows) that read as 4 meals, and the report vanished on refresh.
- Formalized the schema: `ConcludeResult`/`SessionConclusion` gain a `meals` array (`{name, foods, time}`); CONCLUDE_PROMPT + responseJsonSchema instruct one entry per meal, never split/merge meals. API test with the user's exact 2-meal example returns exactly 2 structured meals.
- `SummaryCard` renders `result.meals` as visual meal blocks (name/foods/time together); when `meals` is missing (old data), `lib/groupMeals.ts` falls back to grouping meal/time/food items; meal-related items are filtered from the extras list so nothing duplicates.
- Session persistence: authed → `setSessionConclusion` (Mongo `sessions.conclusion`) via new `PUT /api/sessions/[id]` (validated); guest → `setGuestConclusion` (localStorage). ChatApp restores the card on load and clears it on dismiss (persisting null).
- Verified: 1-meal E2E → 1 block, no flat rows, persists after refresh, gone after dismiss+refresh. Unit tests for groupMeals pass.
- Gotcha during verification: playwright fresh contexts have empty localStorage, so a "missing session" was a probe artifact, not an app bug.

---

## 2026-08-28 — Report title fixed to 报告, summary kept

### Solved
- Card header is now a fixed label — 报告 for Chinese reports, "Report" for English (detected from the conclusion text) — instead of the model's generated title.
- The summary comment stays untouched as the report's description line (verified present after the redesign).
- Records saved from the card now use the same fixed title (报告/Report) so saved entries match what the user sees.
- Verified: E2E food flow → card title "报告", summary comment rendered.

---

## 2026-08-28 — Timeline records + card cleanup

### Solved
- Card: summary line removed, × removed, Save moved to the header right (报告 … 保存), save labels localized (保存/保存中…/已保存 for Chinese reports). Dismiss path deleted (conclude replaces the card).
- Timeline: /records reworked into a day-grouped vertical timeline (Today / Yesterday / date), newest first, each entry = dot + time + meal name + foods (fallback to items for old records), Delete kept, summary not shown.
- Data: records now carry `meals[]` (Mongo `records.meals` + guest localStorage). Authed `datetime` derived server-side from the first meal's time via new `lib/mealTime.ts` `parseMealDateTime` ("2026年8月26日 下午 6:17" → zoned Date); guest timeline sorts/groups client-side from the same parser.
- `parseMealDateTime` handles 凌晨/早上/上午/中午/下午/晚上 shifts (下午6:17 → 18:17, 下午12:xx stays noon, 晚上11:05 → 23:05).
- Verified: unit tests (parser cases), E2E food flow → 已保存 → /records timeline shows 1 day group "Today", entry 加餐 / 晚上 10:35 / foods, no summary.
