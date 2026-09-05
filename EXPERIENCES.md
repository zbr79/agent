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

---

## 2026-08-29 — Insulin reading strict template

### Solved
- New SYSTEM_PROMPT section 2: insulin readings (text or device photo) get a strict template — time line (same format as food, 12-hour + period word) then `胰岛素 {数值} {单位}` then one-line 解读. Only insulin; other metrics stay free-form (section 3).
- TIME RULE extended: typed time wins → visible time on the image wins → else 当前时间 (and the 解读 line says so). Unreadable value → say so and ask; missing unit → 单位未说明 + ask. Never invent.
- Conclude prompt: insulin replies must produce 胰岛素 + 时间 items so the reading lands in the timeline report.
- Verified: "胰岛素 130 早上7点" → strict template with 单位未说明 + ask; "胰岛素 130" → uses 当前时间 (7:03) + asks for unit; conclude extracts {时间, 胰岛素 130 U}.
- Not yet verified: real insulin-device photos (no sample image) — needs a photo of a pen/meter display to confirm vision extraction.

---

## 2026-08-29 — Bare numbers default to insulin

### Solved
- SYSTEM_PROMPT section 2: a bare number with no metric/unit is now an insulin reading by default (that number = 数值; time = 当前时间 with a note; unit flagged + asked).
- Conclude prompt: bare numeric readings extract as 胰岛素 items; units marked missing (单位未说明/unknown) now OMIT the unit field instead of storing junk like "单位".
- Verified: "140" → insulin template `胰岛素 140 单位未说明` with 当前时间; conclude → {胰岛素: 140} + {时间: …} with no unit field.

---

## 2026-08-29 — Glucose unit inference by magnitude

### Solved
- User rule: the model should understand the number, not "dead translate". Prompt section 3 now: 血糖 without unit → ≥40 mg/dL, <20 mmol/L, 20–40 ask; show the other unit in parentheses (mg/dL = mmol/L × 18.02); never change the stated number.
- Bare number default stays insulin, but with a judgment escape: if it clearly reads as a glucose value, state the inference and ask to confirm.
- Verified: 血糖 6.1 → mmol/L（约 110 mg/dL）; 血糖 110 → mg/dL（约 6.1 mmol/L）; 血糖 30 → asks which unit with both conversions shown.

---

## 2026-08-29 — Usage tab rework (no model checks, per-model table)

### Solved
- Usage tab was hidden for guests (the DB has no accounts — the user runs guest mode): `/api/usage` is now public and `guestItems` includes Usage.
- UsagePanel no longer calls /api/health — no live model checks on the page. New per-model table from the catalog + own-call counters: model label/name, sent today, status badge (retired / ran out / in use / available).
- `getUsage()` now exposes `models[]` merged from CHAT_MODELS with `used` and `exhaustedAt` (PT-day state, rolls over at Pacific midnight).
- Verified: 14 rows with counts (3.6-flash=25 ran out, …), no health section, works logged-out, no horizontal overflow at 375px.

---

## 2026-08-29 — Health check, EN/中文 mode, responsive pass

### Solved
- System check: PM2 online, no current errors (stale build-race errors only), all endpoints return expected codes (405 on POST-only, 401 on authed), disk 45%, RAM fine. Healthy.
- Language mode: `lib/i18n.ts` — `useUiLang()` (localStorage + custom event, default 中文), dictionary for nav/records/usage/thinking strings. Header toggle (EN/中文 pill, right side). `/api/chat` accepts `language: zh|en`; `getSystemPrompt` appends the mode line. SYSTEM_PROMPT.md rewritten with parallel templates: food (Chinese template + English template), insulin, glucose two-line format, time formats (`2025年4月2日 下午 5:20` vs `April 2, 2025 5:20 PM`).
- Verified: zh mode → Chinese reply, en mode → English reply; UI nav 聊天→Chat on toggle, persists after reload.
- Responsive: 320/375/768/1024/1280 widths — no horizontal overflow on /, /records, /usage; composer/header/toggle fine on chat page.
- Usage tab: public API + guest nav item (DB has no users — the operator is a guest), per-model table verified 14 rows.

---

## 2026-08-29 — Timeline merge, meta persistence, IndexedDB images, transparent photo bubble

### Solved
- Timeline entries now merge readings + meals: non-meal items (胰岛素/血糖…) render as small pills above the meal blocks in the same entry — a food+insulin session shows `胰岛素 120` + the meal under one dot. Verified via a mixed conversation E2E.
- Model name + elapsed now persist with messages (Mongo `messages.model/elapsed` + guest localStorage), so the `21s · gemini-3.6-flash` meta survives refresh. Messages route validates the new optional fields.
- Guest photos now live in IndexedDB (`lib/guestImages.ts`, key = `sessionId:messageId`); localStorage messages keep only `imageKey`, with inline-image fallback when IDB fails. Verified: 3 MB food photo survives reload.
- Sent photos no longer sit on the dark bubble: `.message.user .bubble:has(img)` → transparent + no padding.
- Also fixed earlier in this batch: bare-number insulin replies are now exactly two lines (time + 胰岛素 数值), no unit question, no uncertainty — the "looks like glucose" escape clause that caused the "120" interrogation was removed.

---

## 2026-08-29 — Terminology: 血糖 vs 胰岛素, bare numbers now glucose

### Solved
- Naming clarified with user: 胰岛素 = insulin (dose, U/IU), 血糖 = blood glucose (mg/dL or mmol/L); English names: insulin / blood glucose (blood sugar).
- Bare numbers now default to 血糖 (blood glucose) with the magnitude unit rule — a bare "140" is a glucose reading, not an insulin dose. Insulin template only triggers on explicit insulin context (胰岛素/insulin/注射/units/pen photo).
- Conclude prompt updated: bare numeric readings extract as 血糖/glucose items; insulin only for explicit insulin replies.
- Verified: "140" → 血糖: 140 mg/dL + time; "6.1" → 血糖: 6.1 mmol/L; "胰岛素 10 U 早上7点" → insulin template; conclude → {血糖: 140 mg/dL} + 时间.

## 2026-08-29 — OpenCode page: DeepSeek V4 Pro via opencode-go subscription

### Solved
- opencode-go API verified usable outside the TUI: key from `~/.local/share/opencode/auth.json` (`opencode-go.key`), base `https://opencode.ai/zen/go/v1` (models.dev), OpenAI-compatible `/chat/completions` with SSE streaming; 33 models listed; unknown model → `ModelError ... is not supported` (HTTP 401).
- New page `/opencode` (`app/opencode/page.tsx` + `components/OpenCodeChat.tsx`): in-memory text-only chat pinned to `deepseek-v4-pro`. Reuses MessageBubble/ModelMarkerParser/CSS classes; emits `MODEL:deepseek-v4-pro` marker so model-meta renders. No persistence, no images, no Conclude.
- New `lib/opencode.ts`: fetch-based client (no SDK) — OpenAI message format (system prompt reuses `getSystemPrompt`, now exported from lib/gemini.ts), SSE parser (yields `delta.content`, ignores `reasoning_content`), logs calls via existing `insertCall` (appears on /calls page). Key from `OPENCODE_API_KEY` env.
- Request parsing extracted from `app/api/chat/route.ts` into `lib/chatRequest.ts` (parseChatBody: roles/text/image/timezone/language validation); `/api/chat` behavior unchanged (verified markers+response after refactor).
- nginx: POST to the new route fell through `location /` (GET/HEAD/OPTIONS only → 405). Added a `location /api/opencode` block mirroring `/api/chat` (POST|OPTIONS, proxy_buffering off, 300s timeouts) to /etc/nginx/conf.d/inschat.renstoolbox.com.conf (backup `.bak-20260829`). Verified public POST reaches the app (400 on empty body = app-level).
- E2E verified on the public site (headless chromium): nav link + active state, empty hint, send → user bubble + "hello from opencode" + `2s · deepseek-v4-pro` meta; layout geometry OK (no overflow).

### Unresolved
- Vision support for deepseek-v4-pro untested; page is text-only by design. `deepseek-v4-flash-vision-exp` exists on the catalog if images are ever needed.
- Subscription rate limits unknown; single attempt, error streamed into the bubble (no fallback chain on this page).

### Disproved
- Assumed the Go API base was `https://api.opencode.ai/v1` — returns "Not Found". Correct base is `https://opencode.ai/zen/go/v1` (models.dev provider registry).

## 2026-08-29 — OpenCode calls/usage page (usage count)

### Solved
- New page `/opencode-calls` + API `/api/opencode-calls`: counts of this app's opencode-go calls from MongoDB (`calls` collection, new kind "opencode" — added to `ApiCall`/`CallDoc`/`insertCall` unions; `lib/opencode.ts` now logs with kind "opencode").
- `lib/db.ts:getOpenCodeUsage()`: total, 5h/7d/30d window counts, failed-30d, per-model 30d counts, 50 most recent calls (aggregate + countDocuments in parallel).
- UI (`components/OpenCodeCallsPanel.tsx`): 3 progress cards vs. DeepSeek V4 Pro request estimates from the Go docs (1,050 / 2,600 / 5,200), total+failed card, per-model table, recent calls list, note card (dollar-based limits, console at opencode.ai/auth). i18n zh/en strings + sidebar nav item for both roles.
- nginx gotcha: `location /api/opencode` is a PREFIX match and also swallowed `/api/opencode-calls` (GET → 405 because the block allows POST|OPTIONS only). Fixed with an exact match: `location = /api/opencode` (nginx -t + reload, both routes verified).

### Unresolved
- Go subscription has no usage API — the page tracks only this app's own calls; the authoritative counter is the opencode.ai/auth console.

### Disproved
- Assumed GET /api/opencode-calls would fall through nginx `location /` (GET allowed) — but nginx prefix matching routed it into the /api/opencode block first.

## 2026-08-29 — Official Go quota API found, wired into /opencode-calls

### Solved
- Previous claim "opencode has no usage API" was WRONG. Official endpoint exists: `GET https://opencode.ai/zen/go/v1/usage` (Bearer = the Go API key) → `{usage:{rolling,weekly,monthly}}` each with `status/percent/resetsAt`. Verified live: rolling 36%, weekly 54%, monthly 77% (dollar-based windows: $12/5h, $30/wk, $60/mo). Sources: GitHub PR #16513 (feat(console): add go usage endpoint), issue #16017, docs guide opencode.ai/console/guides/usage (console CSV export for history; `/zen/go/v1/usage/history` is still only a feature request #43983).
- `lib/opencode.ts:getOpenCodeOfficialUsage()` — fetches the endpoint, validates the three windows, 60s in-memory cache (page polls every 5s; don't hammer the endpoint), returns null on failure.
- `/api/opencode-calls` now returns app counts (MongoDB) + `official` windows; panel shows an official-quota card (percent bars + reset times) above the app's own counts. i18n zh/en strings added; about-note updated.

### Unresolved
- No per-request usage history via the API key yet (only the aggregate windows); history exists only in the console UI / CSV export (service-account keys only).

### Disproved
- `GET /zen/v1/usage`, `opencode.ai/api/usage`, `api.opencode.ai/v1/usage` — all 404; the working path is `/zen/go/v1/usage`.

## 2026-08-29 — Vision-exp on /opencode: auto-route images + speed test

### Solved
- `lib/opencode.ts` now sends images (OpenAI content arrays: text + image_url data-URL) and auto-routes: any image in history → `deepseek-v4-flash-vision-exp`, otherwise `deepseek-v4-pro`. Marker + call log use the actual model. Server logs TTFB + total duration per request.
- `/opencode` page now uses the real `Composer` (image attach + preview) instead of the inline text-only one; images persist into history for multi-turn vision.
- Speed test (live): 34 KB screenshot → vision-exp answered in **3.2s total, 2.4s first token** (server-side, incl. upload). Browser E2E on the public site: image preview → send → `2s · deepseek-v4-flash-vision-exp` meta, and the reply correctly described the screenshot content (zh mode answered in Chinese).
- vision-exp reads text inside images accurately (identified the exact UI + messages in the screenshot).

### Unresolved
- Auto-routing is by request, not per-message: once an image enters history, subsequent text turns also hit vision-exp (multi-turn context needs the image for earlier messages anyway). Only relevant if mixing long text-only sessions with one photo.

### Disproved
- n/a (no failed approaches this round).

## 2026-08-29 — Complete switch: Gemini replaced by opencode-go everywhere

### Solved
- Main chat now streams from opencode-go: text → `deepseek-v4-pro` with `deepseek-v4-flash` fallback; images auto-route to `deepseek-v4-flash-vision-exp`. Verified live: text reply + `2s · deepseek-v4-pro` meta; image reply correctly described the test screenshot in zh.
- Conclude runs on `deepseek-v4-flash` → `deepseek-v4-pro` with `response_format: json_object` (system prompt = CONCLUDE_PROMPT + language rule via new `systemPrompt` option on `completeOpenCode`). Verified: 血糖 140 mg/dL + 时间 + 早餐 meal extracted exactly like the Gemini version.
- `/models` rebuilt on the opencode-go catalog (24 chat/completions-capable models, vision flags from vendor-doc research); `/usage` rebuilt (official quota windows from `/zen/go/v1/usage` + per-model 30d call counts + official percent bars). Health probe rewritten (`completeOpenCode` max_tokens 16, 20s timeout; "not supported/ModelError" → retired).
- Gemini code fully removed: `lib/gemini.ts` + `lib/usage.ts` deleted, `@google/genai` uninstalled; `getSystemPrompt` moved to `lib/prompt.ts`, `ChatValidationError` to `lib/errors.ts`; README/.env.example/PLAN.md updated; CallsPanel text de-Gemini'd. Chains/retries/markers (TRYING/MODEL) behave exactly like the old Gemini engine, so the client needed zero changes.

### Unresolved
- `/api/models` + `/api/health` remain owner-only (auth) — guest can't pin models or run probes (unchanged behavior).
- qwen3.8-* / minimax-* (served via `/messages` on Go) and grok/gpt/muse (via `/responses`) are excluded from the catalog — chat/completions-only.

### Disproved
- n/a (clean swap, verified end-to-end).

## 2026-08-29 — web_fetch tool: the app researches instead of refusing

### Solved
- User comparison showed the opencode agent (with WebFetch) did real research while the app model replied "我无法实时抓取网页…没有实时联网能力". Root cause: plain chat had no tools; the model honestly refused rather than inventing.
- Added OpenAI-style function calling to `lib/opencode.ts:streamChat`: `web_fetch` tool + agent loop (up to 6 rounds). Streaming parser accumulates `delta.tool_calls` (index/id/name/arguments fragments) and returns them via the generator return value; tool results appended as `role: "tool"` messages; the model that answered a round stays first in the chain for the next round. Text-only requests get tools; image requests don't (vision-exp tool support unverified).
- New `lib/webfetch.ts`: dep-free server-side fetcher (browserish UA, 15s timeout, 512 KB cap, HTML→text strip, 8 KB return) used by the tool executor.
- SYSTEM_PROMPT.md §5 rewritten: use web_fetch instead of refusing; depth matched to question. README feature list updated.
- Verified live: "DeepSeek V4 Pro price?" → model fetched official pricing pages (retried URLs, incl. zh-cn) and answered with the ¥ table; the user's exact prompt ("real time website pulling price, two years ago") → full researched answer (Yahoo/Stooq/CoinGecko/Alpha Vantage/Twelve Data comparison with live-fetched prices). Browser E2E: zh reply with pricing table, no failure badge.
- Gotchas fixed along the way: MAX_TOOL_ROUNDS 4→6 (DeepSeek docs is a JS SPA — fetches return thin text, model retries other URLs); exhaustion error now a gentle "research stopped" message instead of a hard failure.

### Unresolved
- SPA-only pages (JS-rendered) still return little text — no headless browser in the fetcher (could add later if needed).
- tool rounds don't stream narration during fetches (only between them) — acceptable.

### Disproved
- n/a

## 2026-08-30 — opencode server integration: the app now uses the full agent

### Solved
- Path A done: `opencode serve --port 4096` runs under pm2 (`inschat-agent`, script /home/ubuntu/opencode-tmp/agent/start-server.sh, basic auth via OPENCODE_SERVER_PASSWORD, cwd = scratch dir with opencode.jsonc `permission: {"*":"deny","webfetch":"allow","websearch":"allow"}` — web-only tools, no bash/edit/read).
- `lib/agent.ts`: SDK client (auth via wrapped fetch), per-request flow — create session → prompt (system = InsChat persona, one part = full-history transcript) → parse the raw /event SSE stream (SDK's event.subscribe() silently returns nothing — likely EventSource without auth headers; raw fetch SSE works) → map to markers: text deltas from `text` parts only (`message.part.delta` filtered by part type from `message.part.updated` — this also fixed reasoning narration leaking into the reply), tool parts → TRYING markers, `session.idle` → done; session deleted after.
- `/api/chat` routing: images → direct vision-exp path; text → agent, with fallback to the direct engine when the server is down (verified: pm2 stop inschat-agent → direct path answers).
- SDK probe facts: default model = opencode-go/deepseek-v4-pro; event types: server.connected, session.updated, message.updated (info.model.modelID), message.part.updated (part.type text/reasoning/tool + state.status), message.part.delta (partID, field "text", delta), session.status, session.idle.
- **Key mismatch bug:** app's `.env` OPENCODE_API_KEY had diverged from `~/.local/share/opencode/auth.json` — text requests worked but vision-exp image requests returned 401 CreditsError "Insufficient balance". Synced .env to the auth.json key; images work again. (Two different Go keys/workspaces existed.)
- E2E (public site): research question → agent used websearch+webfetch, answered with correct pricing table (11s · deepseek-v4-pro); persona (bare "140" → 血糖 140 mg/dL); image chat; agent-down fallback. websearch works without an extra API key.

### Unresolved
- One persona test returned a wrong current time (凌晨 1:10 vs 上午 9:10) — occasional time-slip in the agent's template replies; consider making the 当前时间 line more prominent in the prompt.
- Agent answers are slower (10-25s) and burn more tokens (reasoning + tool rounds); the $12/5h window drains faster — keep an eye on /usage.

### Disproved
- SDK `event.subscribe()` → no events under basic auth; raw `fetch(/event)` + manual SSE parse works.

## 2026-08-30 — Mobile drawer navigation

### Solved
- Phone UI now collapses the nav into a hamburger drawer: a slim top bar (☰ + InsChat brand) is always visible; the sidebar slides in from the left as an overlay with a dark backdrop, closes on nav click / backdrop tap / route change. Desktop (>640px) unchanged.
- `Sidebar.tsx` renders mobile-bar + backdrop + aside with `open` state (auto-close on pathname/session change); CSS: sidebar off-canvas via translateX(-105%) + transition, fixed 250px/85vw drawer, backdrop z-order under the drawer.
- Verified headless at 375×812 and 320×700: no horizontal overflow on /, /usage, /records; drawer open/close geometry correct; chat works on mobile; nav click navigates and closes the drawer.

### Unresolved
- n/a

### Disproved
- n/a

## 2026-08-30 — Response rules: user language first, free chat for off-topic

### Solved
- SYSTEM_PROMPT.md rewritten: new §0 language rule — user's written language wins over the UI mode; UI mode only for no-language-cue inputs (photo alone / bare number); template variant follows the reply language. §5 "Everything else" now instructs normal general-assistant chat for anything not blood-sugar/insulin/food — no health framing, no redirecting (previously off-topic questions got steered/refused).
- lib/prompt.ts mode line updated to match ("use UI language only when the user's message has no language cues").
- Verified: UI=en + Chinese text → Chinese reply; UI=en + bare "140" → English glucose template; "how do I make pour-over coffee?" → normal detailed coffee guide; Chinese insulin text with UI=en → Chinese insulin template.

### Unresolved
- n/a

### Disproved
- n/a

## 2026-08-30 — Mobile: single top bar, lang toggle in sidebar, Safari zoom fixes

### Solved
- Removed the redundant page header (h1 InsChat/OpenCode + lang pill) from ChatApp/OpenCodeChat — phone now has exactly one top bar (☰ + brand). Language toggle moved into the sidebar foot (desktop sidebar + mobile drawer; CSS: static variant of .lang-toggle, the old rule was absolute-positioned for the removed header).
- Safari zoom: textarea was 15px → iOS auto-zooms on focus; now 16px on phones. NOTE: the media block sits before the base textarea rule in the cascade, so the fix must come AFTER it — appended a trailing media block at the end of globals.css.
- Bottom cut off: .app was height:100dvh while sitting under the 49px mobile bar → composer fell outside the viewport; now height:100% inside the flex .main. Verified composer bottom == viewport bottom (667/667).
- Viewport meta via Next `export const viewport`: maximum-scale=1, user-scalable=no, viewport-fit=cover; plus -webkit-text-size-adjust:100%.
- Verified: 375×667 chat page (single bar, composer in view, 16px input), drawer lang toggle works (EN→中文), /usage no overflow, desktop sidebar intact.

### Unresolved
- n/a

### Disproved
- Placing the 16px textarea rule inside the existing early media block did nothing — cascade order beat the media query.

## 2026-08-30 — Real per-call cost/token logging

### Solved
- `insertCall` now stores `cost` + `tokens` (input/output/reasoning/cacheRead/cacheWrite); `ApiCall`/`CallDoc` extended; `getOpenCodeUsage` aggregates cost30d + tokens30d (30d window).
- Agent path (`lib/agent.ts`) logs the prompt result's `info.cost` + `info.tokens` (from the SDK prompt response) on success and failure; direct streaming path (`lib/opencode.ts`) captures the gateway's trailing `{"choices":[],"cost":...}` chunk + final `usage`.
- /opencode-calls panel shows cost30d + tokens30d in the totals card and `$0.0015`-style cost per call row (new .call-cost style; i18n zh/en).
- Real numbers (agent, deepseek-v4-pro): simple health message ≈ $0.0015–0.005; research turn with cache reads ≈ $0.0015 (1,457 in / 156 out / 25 reasoning / 9,984 cached).

### Unresolved
- Older calls (before this change) have no cost — aggregated cost counts only new calls.

### Disproved
- n/a

## 2026-08-30 — Rich markdown responses (ChatGPT-style)

### Solved
- Root cause of "plain text" replies: react-markdown v10 without remark-gfm does NOT parse GFM tables — pipe tables rendered as literal text. Added remark-gfm + rehype-highlight + highlight.js (github theme) in MessageBubble.
- New bubble CSS: styled tables (borders, header bg, zebra rows, horizontal scroll on overflow), code blocks, inline code pills, blockquotes, headings, hr. Syntax highlighting via hljs classes.
- External images from markdown now render: nginx CSP img-src extended to https: (12 blocks updated, reloaded). Verified a Wikimedia banana image loads inside the bubble.
- Verified in browser: table with 3 headers renders; python snippet highlighted (hljs); blockquote; image loaded. Mobile-safe via table overflow-x scroll.

### Unresolved
- Generated charts/mermaid still not supported (would need client-side renderers) — not requested.

### Disproved
- n/a

## 2026-08-30 — User bubbles: light background, image/text split

### Solved
- Sent messages no longer black: `--bubble-user` changed to light gray (#e8e8ed) with dark text; model bubbles stay #f5f5f7 (alignment still distinguishes sides).
- Image+text user messages now render as TWO bubbles: a transparent image-only bubble (`.bubble.image-only`) above a separate text bubble — no more photo+text in one box. Model messages unchanged; persistence/storage untouched (display-level split in MessageBubble).
- Verified headless: 2 user bubbles, image first, image bubble bg transparent, text bubble bg rgb(232,232,237).

### Unresolved
- n/a

### Disproved
- n/a

## 2026-08-30 — Conversation revert (opencode-style)

### Solved
- Added "↩ revert to this message": every message except the last gets a hover-reveal circular button (always faintly visible on touch devices). Clicking truncates the conversation to that message — locally, and persisted.
- Persistence: authed → new `DELETE /api/sessions/[id]/messages` with `{ keep: n }` (`lib/db.ts:truncateMessages` deletes messages after the first n and clears the session conclusion); guests → `truncateGuestSession` (localStorage). `keep` counts only persisted messages (user messages always persist; model messages only when not failed) so local state and server state stay in sync.
- Revert also clears the stored conclusion on both paths.
- Verified E2E (guest): 3 turns → revert to message 2 → bubbles truncated to 2, survives page reload (localStorage).

### Unresolved
- Authed path verified by code review only (no test login credentials); DELETE route returns { removed }.

### Disproved
- Absolute-positioned hover button overflowed the 4px message padding — moved to in-flow inside message-body instead.

## 2026-08-30 — ChatGPT-style message actions: copy, edit, regenerate, share

### Solved
- Researched ChatGPT's pattern: hover action bar under messages, inline edit of your own messages (save & resubmit regenerates the reply), regenerate on assistant replies, share as public links (chat-level + per-message).
- MessageBubble now renders a hover-reveal action bar (faint on touch): Copy (✓ feedback 1.6s), Edit (user msgs), Regenerate (model msgs), Share, plus the existing ↩ Revert. Inline edit: textarea replaces the bubble with Save & submit / Cancel.
- ChatApp refactor: `streamReply(base)` is the single streaming engine; send/edit/regenerate all build a `base` list and truncate persisted state first (`DELETE /api/sessions/:id/messages` or guestStore truncate), then stream — so edit/regenerate behave like ChatGPT (old reply discarded).
- Share: POST /api/shares stores a snapshot (kind chat|message) in Mongo `shares` with a 9-byte base64url token; public read-only page /share/[token] (client viewer with markdown/highlight/images); link copied to clipboard; chat-level Share button next to Conclude. nginx: new location /api/shares (POST only) — same fall-through-405 gotcha as before.
- buildTranscript: single first user message now sent directly (no "conversation so far" wrapper) — fixes the agent answering "there's no prior question…" on fresh chats.
- E2E verified: copy→clipboard+checkmark; edit→resubmit→new reply; regenerate; message share page (1 msg); chat share page (2 msgs).

### Unresolved
- Shares never expire (Mongo grows); no delete/share-management UI.
- Regenerate keeps no variant carousel (old reply is discarded, like revert).

### Disproved
- Test race: waiting on the streaming cursor misses replies that haven't started (thinking phase) — wait on the send button returning to ↑ instead.

## 2026-08-30 — Trim actions: copy + edit + regenerate only

### Solved
- Revert feature commented out (edit/regenerate cover the same workflow); share feature commented out (UI + handlers; /api/shares backend left dormant).
- Action bars now: user messages [复制, 编辑]; assistant replies [复制, 重新生成] — and the assistant bar is always visible (opacity 0.7, ChatGPT-style) instead of hover-only.
- Verified on the public site: correct button sets per role; copy works.

### Unresolved
- Share API/pages still deployed but unused (commented) — can be revived or deleted later.

### Disproved
- Python string surgery on ChatApp scrambled comment blocks (stop/persistConclusion got swallowed) — repaired by replacing the whole region with a clean version.

## 2026-08-30 — Real icons (lucide-react) instead of text glyphs

### Solved
- Replaced hand-rolled glyphs with lucide-react (ChatGPT-style stroke icons): action bar Copy→Copy/Check (copied state), Edit→Pencil, Regenerate→RefreshCw; composer attach→Plus, send→ArrowUp, stop→Square, image remove→X; sidebar mobile hamburger→Menu, session delete→X. CSS: svg display block inside icon buttons.
- Verified live: both action bars render SVG icons, composer/menu icons present, copy still works.

### Unresolved
- n/a

### Disproved
- n/a

## 2026-08-31 — Food template v2: markdown table (Template A)

### Solved
- Food-photo reply format upgraded from dots+lines to a rich markdown table: `## 餐名` heading, bold time line, 食物/升糖 table (🟢低/🟡中/🔴高, red rows fully bold), ⚠️ quote line for red-item reasons, 💡 bold summary. Chinese + English variants in SYSTEM_PROMPT.md §1.
- Conclude prompt updated: foods may come from markdown table rows — extract names only, drop dots/labels/⚠️.
- Verified: demo request returned the exact table format (午餐 / time / table with 酱牛肉+米饭+可乐 / ⚠️ line / 💡 总结), rendered as styled markdown by the existing pipeline.

### Unresolved
- Full end-to-end still needs a real food photo (none available in test assets) — text demo confirmed the format compliance.

### Disproved
- n/a

## 2026-08-31 — Login circle, insulin-mode default-off, pin on the right

### Solved
- Login is now a circular bordered icon button (User icon, no text), matching common account-affordance patterns.
- Mode semantics inverted per request: "胰岛素模式" (insulin/preset templates) is now OFF by default; the settings modal has a switch + hint, persisted to localStorage (`inschat_insulin_mode`), threaded as `mode: "preset"|"free"` through /api/chat + /api/opencode → agent and direct paths. Free chat (generic assistant + web_fetch) is the default.
- Session rows reordered: title, then pin, then delete — pin now sits on the RIGHT of the row and only appears on hover (opacity 0, revealed on row hover; faint on touch). Verified order + hover opacity.
- Verified: login circle (50% radius, icon only), switch default off → on persists "1", pin right-of-title.

### Unresolved
- Account-level persistence of insulin mode (vs localStorage) not wired yet — revisit when the account system grows.

### Disproved
- n/a

## 2026-08-31 — Key divergence #2: monthly cap hit on the app key

### Solved
- User reported 100% usage but app still working. Diagnosis: the Go plan hard-gates on the rolling 5h window (was 0% — freshly reset), while the app's .env key showed monthly 100% "rate-limited" (soft state). Root cause: the app's OPENCODE_API_KEY had diverged AGAIN from ~/.local/share/opencode/auth.json (two different subscriptions). Synced .env to the session key (52/21/62), restarted, verified chat works; /usage now shows the healthy meter.

### Unresolved
- Why the keys keep diverging — likely the user reconnects/rotates the key in the TUI/console; recommend re-syncing whenever usage looks wrong. A config-time mismatch warning (compare usage of both keys) could be added later.

### Disproved
- n/a

## 2026-08-31 — Multi-image uploads (max 3) + vision monthly cap error

### Solved
- ChatMessage/StoredMessage/GuestMessage switched from single `image` to `images: ChatImage[]` (MAX_IMAGES = 3) across: types, chatRequest (array validation), opencode content parts (multiple image_url blocks), chat route hasImage, sessions messages POST, shares POST, db appendMessage, Composer (multi-select file input, preview grid, per-image remove, attach disabled at 3, hint on overflow), ChatApp/OpenCodeChat (send(text, images[]), guest IDB keys per image `${session}:${msgId}:${i}`), MessageBubble (per-image bubbles), ShareViewer.
- Verified: 3 images attach → 3 previews; 4th rejected with hint "最多只能添加 3 张图片"; sent → 3 user image bubbles; API accepted all images.
- New error found live: deepseek-v4-flash-vision-exp hit its own monthly usage cap ("Monthly usage limit reached. Resets in 20 days…") — the vision model has a separate $15 monthly allowance on Go. isBalanceError regex extended to catch "usage limit|limit reached" so users get the friendly quota message instead of the raw API text.

### Unresolved
- vision-exp monthly cap is exhausted (resets ~Sep 20); images will keep failing with the friendly quota message until then — or switch image routing to another vision model (e.g. qwen3.8-flash via chat/completions? it's served via /messages on Go — unverified) once requested.

### Disproved
- n/a

## 2026-09-01 — Usage-limit reached: on-screen banner + test switch

### Solved
- Researched platform behavior: Claude = hard stop with on-screen line "You've hit your session limit · resets 3:45pm" (blocks sending until reset); Gemini = "You've reached your limit" banner + Flash-Lite fallback; ChatGPT = silent downgrade / inline "You've reached our limits of messages". Adopted the Claude pattern.
- New LIMIT stream marker: `encodeLimitMarker(resetAt)` + parser support. On balance/limit errors, /api/chat and /api/opencode emit the marker (with the official rolling reset time) plus the friendly text in the bubble.
- Client: amber banner above the composer (⚠️ 额度已用完 · 预计 HH:MM 重置), composer disabled + placeholder swap, auto-clears when the reset time passes (10s interval). Wired into both ChatApp and OpenCodeChat.
- Test switch: `OPENCODE_TEST_LIMIT=1` in .env makes streamOpenCodeOnce/agentChat throw a synthetic "Monthly usage limit reached" error — verified the full flow E2E (marker → banner + disabled send + bubble text), then removed the flag and confirmed normal chat.
- Also this batch: server now prefers the live key from ~/.local/share/opencode/auth.json (fallback .env) — ends the recurring key-divergence failures; new key deployed (rolling 60/24/12).

### Unresolved
- Exhausted monthly window blocks ALL chat/completions models (account-level 429) — no free fallback model found on Go.

### Disproved
- n/a

## 2026-09-01 — Live ran-out test with the real exhausted key + agent-hang fix

### Solved
- Live-tested the exhausted key (monthly 100% rate-limited, 429 "Monthly usage limit reached. Resets in 18 days."). Full flow verified in the browser: ⚠️ banner "额度已用完 · 预计 04:20 AM 重置", composer disabled, placeholder swap, bubble carries the detailed message.
- Two real bugs found and fixed:
  1. The opencode AGENT SERVER hangs (no response, no error) when the subscription is exhausted — agentChat waited forever. Fixes: (a) app-level pre-flight quota check (skip the agent when monthly status is "rate-limited" or rolling ≥ 100%) → direct path fails fast with the 429; (b) 180s hard timeout on the agent prompt as a safety net.
  2. Error wording blamed the 5h window when the monthly window was the exhausted one. New `quotaResetInfo()` picks the correct window (monthly rate-limited vs rolling) for both the friendly text and the LIMIT marker reset time.
- Key restoration flow verified afterwards: good key back in auth.json + .env, both processes restarted, chat works.

### Unresolved
- n/a

### Disproved
- "Older key" from opencode.log was revoked (401), not exhausted — rotation invalidates previous keys.

## 2026-09-02 — Free-model gateway expansion
### Solved
- Enumerated `GET /models` on both gateways: the free gateway (`https://opencode.ai/zen/v1`) exposes 9 free models, not the 4 the catalog knew.
- Added working free models to catalog + chains: `nemotron-3.5-lightning-free`, `ling-3.0-flash-fin-free`, `laguna-s-2.1-free` (all respond in <3s).
- `isFreeModel` suffix rule (`-free`) covers every new model; `big-pickle` needs its own case.
### Unresolved
- `muse-spark-1.3-contributor-free` and `muse-spark-1.2-contributor-free` return HTTP 500 "Internal server error" on the free gateway (both stream and non-stream, minimal body) — excluded from the catalog until they work.
- Free models all report `vision: false`; no free vision model exists, images stay on paid `deepseek-v4-flash-vision-exp`.
### Disproved
- n/a

## 2026-09-02 — Free model 400 error killed the whole chat chain
### Solved
- Free gateway returns HTTP 400 `Error from provider (Console): Upstream request failed: Model is unavailable.` for `deepseek-v4-flash-free` (provider-side down).
- `isUnavailableError` (lib/opencode.ts) did NOT match that message → the chain loop rethrew it and the entire chat failed instead of moving to the next free model. Added `unavailable|upstream request failed` patterns.
- health.ts `classify` now uses `isUnavailableError` first with detail "unavailable or retired", so down models are auto-hidden in the Models panel (same path as 404s).
### Unresolved
- `deepseek-v4-flash-free` still 400s provider-side (as of 2026-09-02); kept in chain — failure is fast (~300ms) and now non-fatal.
- `mimo-v2.5-free` / `big-pickle` intermittently 429 `FreeUsageLimitError` (shared free-tier rate limit) — classified as quota, chain moves on.
### Disproved
- n/a

## 2026-09-02 — Free-model notice after exhausted fallback
### Solved
- New `FREE` stream marker (`␀FREE:␀`, value-less) emitted by `streamChat` only when a paid model failed with quota/balance errors in the same request AND a free model delivered the final answer (lib/opencode.ts `paidExhausted` flag).
- `ModelMarkerParser` extended for the FREE marker (both split branches); verified with 4 standalone parser scenarios (one-chunk, split mid-marker, marker-then-text, model+free combined) — all pass.
- Client (ChatApp.tsx) shows a gray centered pill "当前正在使用免费模型 / Now using a free model" after the reply finishes; auto-hides after 6s, click to dismiss, resets on next send. i18n keys `free.notice` added (zh/en); CSS `.free-notice` in globals.css.
### Unresolved
- The agent path (lib/agent.ts) answers when the Go plan is NOT exhausted, so no notice appears there — correct by design.
### Disproved
- n/a

## 2026-09-02 — Free-model notice moved under the reply (UX fix)
### Solved
- The floating pill was wrong placement — the notice is now a gray text line (`free-note`) rendered directly below the model reply that was answered by a free model (MessageBubble.tsx).
- `freeFallback` flag lives on the UiMessage (set when the FREE marker is parsed, ChatApp.tsx); the transient popup state/timer/CSS were removed.
- In-session only: the flag is not persisted, so reloads don't re-show it (the model chip still identifies the free model).
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-02 — Banner removed; notice centered; image-exhaustion reply text
### Solved
- Red usage-limit banner removed entirely (type-1 "usage done" warning): LIMIT marker emission deleted from app/api/chat/route.ts; ChatApp no longer parses it, disables the composer, or renders the banner. Text chats just fall back to free models; the composer stays enabled.
- Free-model notice text changed to "Usage exhausted, now using free model" / "额度已用完，正在使用免费模型" (i18n `free.notice`) and is now horizontally centered below the reply (`.free-note` width:100% + `.message.model:has(.free-note) .message-body` max-width 100%; :has already used in this codebase for img bubbles).
- Image sends with exhausted usage: `imageExhaustedText()` (lib/opencode.ts) — the reply itself becomes "No image model usage available. It will reset around <time>." (zh/en), no banner, bubble not removed.
### Unresolved
- Text chats where EVERY model (paid + free) fails still append the generic `\n\n[...]` error into the reply — accepted fallback.
### Disproved
- n/a

## 2026-09-02 — Usage-access summary for multi-account toolbox handoff

Context: user wants a separate private app (proposed: local, 127.0.0.1) to manage 6 opencode-go accounts — view usage per account, copy API keys, optionally switch the active account. This entry documents how the existing app accesses usage so the next agent can reuse it.

### How inschat accesses opencode-go usage (summary for handoff)

1. **Key source** — `getOpenCodeKey()` in `lib/opencode.ts:39`: prefers `~/.local/share/opencode/auth.json` → `opencode-go.key` (what the CLI writes; changes on reconnect), falls back to `OPENCODE_API_KEY` from `.env`. `OPENCODE_API_KEY_FORCE=1` pins to the .env key for testing.
2. **Official usage** — `getOpenCodeOfficialUsage()` in `lib/opencode.ts:157`: GET `https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>`; expects `usage.rolling / weekly / monthly`, each `{ status, percent, resetsAt }` (interface `OpenCodeOfficialUsage` at `lib/opencode.ts:149`). 60s in-memory cache (`officialCache`). Returns null on any failure — never throws.
3. **API route** — `app/api/usage/route.ts`: `GET /api/usage` returns `{ model, total, last5h, last7d, last30d, failed30d, official, models[] }`; combines official usage with local call counters (`getOpenCodeUsage()` from `lib/db.ts:183` — Mongo-backed call log). `Cache-Control: no-store`.
4. **UI display** — `components/UsagePanel.tsx` polls `/api/usage` every 5s; renders rolling/weekly/monthly percent bars + `resetsAt` relative countdown (`relativeResets`). `components/OpenCodeCallsPanel.tsx` shows local call counts vs hardcoded `LIMITS` (h5/w7/m30) and per-model/`byModel` table. `components/ModelsPanel.tsx` is the model catalog + live health/quota statuses (data from `/api/models`, health probe in `lib/health.ts`).
5. **Error-side detection** — `lib/opencode.ts:56-76`: `isQuotaError` (429/RESOURCE_EXHAUSTED), `isUnavailableError` (404), `isOverloadedError` (503), `isBalanceError` ("insufficient balance"/"Monthly usage limit reached"). `quotaResetInfo()` (`lib/opencode.ts:79`) picks the exhausted window for the user-facing banner.
6. **Chat flow** — `streamChat()` (`lib/opencode.ts:521`): paid models → free fallback chain (`getChatChain` in `lib/models.ts:125`), with `encodeFreeMarker()`/`encodeLimitMarker()` markers parsed client-side in `components/OpenCodeChat.tsx:113`.

### Notes for the new app
- The `/usage` endpoint requires only the Bearer key — a multi-account app is just N calls to the same endpoint with N keys. No session/other endpoint involved.
- For "switch active account": rewriting `~/.local/share/opencode/auth.json` (`{ "opencode-go": { "key": "..." } }`) is picked up by inschat automatically on next request (no restart).
- Reusable auth pattern for gating: `lib/auth.ts` (scrypt + 30-day token cookie), `lib/accounts.ts` (Mongo users), `app/api/auth/{register,login,logout,me}`.
- Decision from 2026-09-02 session: local app is recommended over public domain (no attack surface for 6 API keys, no cert/login needed); domain only if phone access required. Unresolved: user's "123" answer on key-management (UI-managed encrypted vs .env) — still open; ask before building.

### Unresolved
- Key management choice (encrypted-at-rest store vs .env) not yet confirmed by user.
- Whether "set active account" (auth.json rewrite) is wanted — inschat integration confirmed feasible.
- Port/process naming for the new app (must not touch inschat PM2 app on :3001).

## 2026-09-02 — Full i18n audit & fix (zh/en mixed-language pass)
### Solved
- New `lib/i18nExtra.ts` (104 keys per language) merged into `STR`; `formatUiText()` helper for `{key}` interpolation; `useUiLang()` now syncs `<html lang>` (zh-CN/en); root layout defaults to zh-CN.
- zh dict fixed: `opencodeCalls.rolling/weekly/monthly/resets` were English ("5 hour usage"/"Resets in"); also `tokens30d` → 令牌数, `records.empty` → 总结.
- Login/register page fully localized with a lang toggle button (CSS `.auth-card-head`/`.auth-lang-toggle`); auth routes now return `errorCode` (invalidCredentials/usernameTaken/usernameInvalid/passwordLength/usernameRequired/passwordRequired/invalidBody/server) and the page maps codes to localized text; `language` sent to API (unused by server, fine).
- Composer: placeholder, aria/title labels, image errors (max images/type/size/read) localized; ChatApp/OpenCodeChat pass placeholders and use `chat.requestFailed`.
- SummaryCard uses UI language instead of content heuristic (报告/保存/已保存).
- ModelsPanel fully localized (description, health counts, catalog, auto row, states, tier labels 专业/快速, detail labels, probe ms); CallsPanel + OpenCodeCallsPanel localized (titles, counts, statuses, kinds, dates via locale); RecordsPanel/SearchModal fallback errors localized; Sidebar aria "More options"/"Open menu" localized; ShareViewer localized (missing page, meta, image alt); ConcludeButton aria/title localized; UsagePanel countdown uses localized units (天/小时/分钟).
- All visible fallback strings ("Could not...", "Search failed.", "Conclude failed.", "Save failed.", "Chat request failed.") replaced with localized `t[...]`; session title fallback uses `nav.newChat` per language.
- Verified with headless smoke tests in zh+en: login toggle + localized wrong-password error, html lang sync, composer placeholder, page headings, no English leaks in zh usage/models/calls/records (raw provider error strings inside `.call-error` are diagnostic data and stay English).
### Unresolved
- Raw provider/API error strings (e.g. "Upstream request failed: Model is unavailable.") shown as call details stay in English — they are upstream diagnostics, not UI copy.
### Disproved
- The assumption that all three major apps AI-generate chat titles (they truncate the first user message).

## 2026-09-03 — Debug: free models "Internal server error" (500)
### Root cause
- The free gateway (`opencode.ai/zen/v1`) wraps upstream provider failures as HTTP 500 `{"type":"error","error":{"type":"error","message":"Internal server error"}}` — the exact shape `muse-spark-*-free` models return 100% of the time (verified 5/5 + 5/5). They are not served upstream at all.
- For otherwise-working models the 500 is intermittent and quota-correlated: `mimo-v2.5-free`/`big-pickle` now return a clean 429 `FreeUsageLimitError` (free-tier shared quota exhausted) but earlier returned 500 — a race in the free-tier gate: requests slip past the quota check and the provider call then fails server-side, wrapped as a generic 500 instead of a clean 429.
- Request params are NOT the cause: tested minimal / +reasoning_effort / +tools / full body on all 6 free models — no 500 triggered by params (laguna-s-2.1-free does 503 when `reasoning_effort` is sent — 5/5 vs 0/5 without).
- Other failure modes: `deepseek-v4-flash-free` consistent 400 "Model is unavailable" (provider down); `nemotron-3-ultra-free`/`nemotron-3.5-lightning-free` slow (sometimes >20–25s, timeouts).
### Fix
- `isServerError()` (lib/opencode.ts) matches `500|internal server error`; the chat chain now treats it as "unavailable → next model" instead of rethrowing and killing the whole chat.
- health.ts `classify` checks it BEFORE `isUnavailableError` so a transient 500 shows as "busy" (selectable), not "retired" (hidden).
### Disproved
- The 500 is not caused by our body/tools/reasoning params, not by concurrency (28-parallel test), not a rate-limit mislabel on our side.

## 2026-09-03 — Insulin-mode text sends wrongly returned image-exhausted reply
### Root cause
- `hasImage` was computed as `messages.some(m => m.images...)` over the ENTIRE history (app/api/chat/route.ts + lib/opencode.ts streamChat). In insulin mode a chat that once had a food/glucose photo made every later text-only send route to the paid-only vision chain → "暂无可用图像模型额度" reply.
- Second layer: text models reject image parts in history — reproduced 400 `[404] No endpoints for image` on all free models when the payload contained an image_url from earlier messages.
### Fix
- `hasImage` now uses only the LAST message in both route.ts and streamChat.
- For text-only sends, streamChat strips images from history and replaces them with the same `[photo attached]` marker the agent transcript uses, so free text models never receive image parts.
### Verified
- Headless test, insulin mode ON: "120" text → runs text chain (pro 429 → flash 429 → flash-free 400 → mimo 429 → nemotron connected), NO image-exhausted reply.
- Image send → still routes to deepseek-v4-flash-vision-exp → image-exhausted reply (unchanged).
- Free models are currently slow/overloaded (Nvidia 502, 20-40s first token) — replies may take a while.
### Disproved
- n/a

## 2026-09-03 — Mobile UI audit (phone pass)
### Fixed
- Full-width search bar (ChatGPT-style, added earlier) had been LOST from Sidebar.tsx — only the brand-row search icon remained. Restored: `.sidebar-search` button with icon + "搜索/Search" text above the nav tabs (components/Sidebar.tsx).
- Escape key did not close the mobile drawer — the backdrop stayed and blocked all pointer events. Added a window Escape handler that closes the drawer, row menu, and rename input (components/Sidebar.tsx).
### Verified (headless, 375px + 320px)
- No horizontal overflow on /, /models, /calls, /usage, /records, /opencode, /opencode-calls, /login at both widths.
- Drawer: 250px, closes/opens via transform (matrix x -262 → 0), search bar + new chat 219px inside, content scrolls.
- Search modal 294px and settings modal 294px fit in 320px viewport.
- Login card 272px at 320px.
- Chat: toggles row (血糖模式 84px + Conclude 30px) fits; user bubble 230px; composer 343px at 375 / 311px at 320.
- Models rows fit with Use buttons (327px at 375); usage table 291px < 375.
- Image preview grid: 3 previews (56px each), no overflow.
### Unresolved
- Free models still slow/overloaded upstream (Nvidia 502s) — model replies take 20-40s, unrelated to UI.
### Disproved
- n/a

## 2026-09-03 — Free-model notice moved to centered chat overlay
### Solved
- The notice was rendered below the responding message (`.free-note`); user wants a middle warning instead. It is now a fixed, horizontally+vertically centered gray text overlay in the chat column (`.free-note-overlay`, top/left 50%, translate(-50%,-50%), 14px, no background).
- MessageBubble no longer renders it; ChatApp holds `freeNotice` state (set on FREE marker), clears on next send, auto-dismisses after 6s, click to dismiss.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-03 — Login reworked from page into AuthModal
### Solved
- New `components/AuthModal.tsx`: login/register dialog (localized, lang toggle, error-code mapping, backdrop click + X close) rendered over the app instead of navigating to /login.
- Sidebar guest footer's sign-in circle is now a button that opens the modal (desktop + mobile drawer); on success it refetches the user (authNonce), closes, and stays on the chat.
- `app/login/page.tsx` is now a server redirect to `/?auth=1`; Sidebar watches the param and auto-opens the modal (old deep links keep working).
- CSS: `.auth-backdrop`/`.auth-modal` overlay reusing `.auth-card`; close button.
### Verified (headless, 1440 + 375)
- Modal opens from guest footer (and drawer), 380px desktop / 343px mobile, no overflow; localized wrong-password error shown inline; backdrop closes it; login success closes modal, shows username + owner tabs; /login redirects and auto-opens the modal.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-03 — Text chain swapped to qwen3.8-flash with peak-hour routing
### Why
- DeepSeek peak pricing (Mon-Fri 01:00-04:00 & 06:00-10:00 UTC = 09:00-12:00 / 14:00-18:00 Beijing) doubles deepseek-v4-flash ($1.32 vs $0.66 output). Qwen3.8 Flash is flat $0.15/$0.47, wins 9/11 benchmarks vs DS V4 Flash (incl. CoWorkBench 73.9 vs 45.1, Toolathlon 73.5 vs 70.3), and is 4-6x faster on the gateway (1-1.8s vs 6.9s).
- MiMo-V2.5 rejected: hard 500 on `reasoning_effort` (app always sends it) and 7-16s latency.
### Change
- `qwen3.8-flash` added to CHAT_MODELS + modelLabels (vision:false — gateway 400s images via chat/completions).
- TEXT/CONCLUDE chains: `qwen3.8-flash` → `deepseek-v4-flash` (only OFF-PEAK) → free models. `isDeepSeekPeak()` (lib/models.ts) drops deepseek-v4-flash during peak hours; verified against window boundaries (Mon 02:00/08:00 UTC peak, 05:00/12:00 off, Sat off).
- UI copy (zh/en): models description + auto row name mention Qwen primary + off-peak DS fallback.
### Verified
- Models page lists qwen3.8-flash (32 models); auto row "文字：qwen3.8-flash → deepseek-v4-flash（非高峰）→ 免费模型".
### Unresolved
- Vision chain still on deepseek-v4-flash-vision-exp (peak-priced); replacement candidates (qwen3.7-plus, kimi-k2.6) not yet probed with the app body.
### Disproved
- MiMo-V2.5 as a drop-in text replacement (reasoning_effort 500).

## 2026-09-03 — Model routing tree on the usage page
### Solved
- New `components/ModelRoutingTree.tsx` rendered at the bottom of /usage: a tree-format visualisation of the auto-model logic — text chat (peak: qwen3.8-flash only, DeepSeek skipped; off-peak: qwen3.8-flash → deepseek-v4-flash; free models nested under both), images (vision-exp), conclude chain, pinned override, free fallback with notice.
- i18n keys `routing.*` (zh/en); parens are language-aware（/） vs (/); `.routing-tree` CSS with branch borders, model chips, arrows.
### Verified
- Both languages render, all model codes present, no horizontal overflow at 1440/375.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-03 — Vision chain: qwen3.5-plus peak-aware fallback
### Findings
- Vision candidates tested with real images + app body (reasoning_effort max + stream): deepseek-v4-flash-vision-exp OK, kimi-k3/k2.6 OK (3-23x more expensive), mimo-v2.5/v2.5-pro 500 upstream, qwen3.7/3.6/3.5-plus only work WITHOUT reasoning_effort (gateway 400s reasoning+image combos on Qwen; the 1x1 test-image 400 was "must be larger than 10px", a red herring).
- qwen3.5-plus is flat $0.20/$1.20 — slightly cheaper than vision-exp's PEAK $1.32 output — verified OK with images (1.7-2.7s).
### Change
- IMAGE_CHAIN now time-aware (lib/models.ts `visionChain()`): peak → [qwen3.5-plus, vision-exp]; off-peak → [vision-exp, qwen3.5-plus].
- `streamOpenCodeOnce` skips `reasoning_effort` when the request has image parts and the model is in `NO_REASONING_WITH_IMAGES` (qwen3.5-plus) — Qwen 400s otherwise.
- Routing tree + i18n show the vision fallback ("高峰优先 Qwen3.5（平价）").
### Verified
- Live image send: vision-exp 429 → qwen3.5-plus tried next (both 429 on exhausted Go quota, correct fallback order).
### Unresolved
- Real end-to-end qwen3.5-plus image answer untestable while the Go plan is quota-exhausted; the earlier direct probe proved the request shape works.
### Disproved
- "Qwen models reject images" (was my corrupt/too-small test PNG); mimo-v2.5-pro is genuinely broken upstream (500).

## 2026-09-03 — Image compression setting (default ON)
### Solved
- New `useCompressImages()` pref (lib/prefs.ts, localStorage `inschat_compress_images`, default ON).
- `lib/imageCompress.ts`: canvas downscale to max 1600px + JPEG q85; skips images already small enough.
- Composer compresses attached photos when the pref is on (before preview/send/storage).
- Settings modal row "图片压缩 / Image compression" with hint + switch (ImageDown icon, `.settings-row-text` CSS); i18n keys added.
### Verified
- E2E: 3000x3000 PNG → 1600x1600 JPEG when ON; untouched PNG when OFF; switch default on, toggles + persists.
### Unresolved
- User will compare reading accuracy with compression on/off on real meter/food photos.
### Disproved
- n/a

## 2026-09-03 — Conclude records its own time (not photo/meal time)
### Problem
- `translateRecord` derived the record's `datetime` from the concluded content — the "时间" item (which the model may infer from the photo/chat context) or the first meal's time. The records timeline then grouped entries by THAT time, not by when the user actually concluded/saved.
### Fix
- translate.ts: datetime derivation removed (dead time helpers deleted; parseLeadingNumber kept).
- db.ts insertRecord: `datetime = new Date()` at insert — the record always carries its own conclusion/save time.
- RecordsPanel entryFor: timeline position always uses `datetime ?? savedAt` (own time); meal-time-based grouping and the timeLabel display removed (meal times still visible inside entry content).
### Unresolved
- Old records stored before the fix keep their content-derived datetime — they still appear at their old timeline position.
### Disproved
- n/a

## 2026-09-03 — Conclude confirm/edit modal
### Solved
- After clicking Conclude, `components/ConcludeModal.tsx` pops up with the results for confirmation and editing:
  - Title editable; every item editable (name + value + unit); values matching 低/中/高 (or low/medium/high) render as a ranking select (升糖等级); meals editable (name/foods/time) — so the insulin number and its time can be changed freely.
- Save writes the EDITED record (POST /api/records or addGuestRecord for guests) with the edited title (instead of the generic "报告"); the summary card then shows the edited result in saved state (`summarySaved` prop threaded ChatApp → MessageBubble → SummaryCard).
- i18n `concludeModal.*` keys (zh/en); `.conclude-modal` CSS (scrollable card, input rows).
### Verified
- E2E: reply → Conclude → modal opens (确认总结), no overflow; edit + save paths reuse the proven records API.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-03 — Record redesign: dish boxes, date+time anchor, no title
### Solved
- ConcludeMeal gains `dishes: {name, rank}[]`; the conclude prompt now extracts per-dish blood-sugar ranks (低/中/高) from the chat's food table instead of discarding them; sanitize/API validation/translate pass dishes through.
- ConcludeModal: title field REMOVED (records are anchored by date+time); each meal edits as name + time + dish boxes (dish name input + rank select 低/中/高/—, add/remove dish). Save auto-titles the record with the first meal name (or 报告/Report).
- SummaryCard + RecordsPanel render dishes as colored rank boxes (green/yellow/red via rankClass: 低/low, 中/medium, 高/high); foods string kept as fallback for legacy records.
### Verified
- Build passes; flow wired through modal → records API → timeline.
### Unresolved
- Old records without dishes still render foods-string fallback.
### Disproved
- n/a

## 2026-09-03 — Conclude modal: native date/time pickers, better view
### Solved
- `lib/mealTime.ts` gains `parseFlexibleDateTime` (handles "2026年9月3日 下午 6:17", "2026-08-26 18:17", "8/26/2026 6:17 PM", time-only → today; date stripped before time regex so date digits never leak into the time) and `formatDateTimeDisplay` (zh "2026年9月3日 下午 6:17" / en "2026-09-03 6:17 PM").
- ConcludeModal reworked: no free-text date editing — meals get native `<input type="date">` + `<input type="time">` pickers (parsed from the model's text, formatted back on change); 时间/time items use the same pickers; dish boxes keep name + rank select; meal name on top.
### Verified
- Parser unit-checked across 8 formats (all correct, incl. 3:17 AM, 9:30, 下午 6:17); build passes; app restarted.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-03 — Chat now stores replies + model (two real bugs)
### Bug 1: login via AuthModal left ChatApp in guest mode
- ChatApp checked /api/auth/me only on mount; login via the sidebar modal navigates without remounting, so `isAuthed` stayed false — every chat silently went to the localStorage guest store and never reached the DB.
- Fix: `inschat-auth` CustomEvent dispatched by Sidebar on login/logout; ChatApp listens (plus re-checks on URL changes) and refreshes isAuthed.
### Bug 2: model name never persisted
- The agent path emitted the MODEL marker with the fallback label at first token, but `modelName` often stayed null (message.updated arrives late), so the persisted message had `model: null`.
- Fix: lib/agent.ts emits a corrected MODEL marker with the real model id once `promptResult.info.modelID` is known — the client keeps the last marker (chip + persistence).
### Verified
- Net trace: login → POST /api/sessions (real Mongo id) → POST messages → reply persisted with `model: "qwen3.8-flash"`.
### Unresolved
- n/a
### Disproved
- The messages API was fine; the loss happened client-side.

## 2026-09-03 — Health mode: auto-conclude per reply + ready-glow button
### Solved
- In 血糖模式 (health mode), when a model reply finishes streaming, conclude runs AUTOMATICALLY (no Conclude click): streamReply's finally triggers `autoConcludeRef` (guarded by insulinMode, not aborted, no existing 查看总结 bubble). The thinking bubble → 查看总结 flow still applies.
- The Conclude button now takes `ready`: when a conclusion is ready it gets the SAME gradient border + breathing glow as the active health toggle (`.conclude-button.ready` reuses healthGlow), signalling "ready to view". Clicking it then OPENS the confirm modal instead of running conclude again; without a ready result it runs conclude normally (free mode unchanged).
### Verified
- E2E: health mode → "血糖 130" → reply → auto-conclude → button glows ready → click opens the modal.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-03 — Old conclude process deleted (bubble flow removed)
### Removed
- 思考中 thinking bubble + 查看总结 bubble entirely: `concluding`/`concludeReady` message flags (ChatApp + MessageBubble), the clickable bubble render + `onOpenConclude` prop, `concludeBubbleIdRef` machinery, the `.conclude-ready` CSS, i18n keys `conclude.inProgress/view/viewHint`.
- Health-mode /api/conclude fallback (`autoConcludeRef`) — health mode now relies 100% on the reply tail; if the tail is missing the button stays unlit and the user can trigger one manual /api/conclude via the button.
- `concludeAll` no longer creates bubbles — it fetches /api/conclude → merges → sets the ready state (used only by the manual Conclude click, e.g. free mode).
### Verified
- E2E health flow still works: reply → tail parsed (0 /api/conclude calls) → button glows → modal opens; no bubble remnants anywhere in the code.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-03 — Session conclusion storage removed (stale 保存 card after refresh)
### Problem
- `persistConclusion` wrote the conclusion into the session doc; on refresh ChatApp re-loaded it as `summary` → the old SummaryCard ("报告 / 保存 …") reappeared with 保存 (concludeSaved resets to false) — and clicking 保存 would POST a NEW record (recordIdRef lost) → duplicate records.
### Fix
- Removed the session-conclusion path entirely: `persistConclusion` callback + all calls (single-call path, concludeAll, truncatePersisted), session-conclusion loading on refresh (authed + guest), the `conclusion: null` PUT, `setGuestConclusion` import, and the `SessionConclusion` type usage.
- After refresh the chat shows only messages; the conclusion lives in the records list (sidebar 记录 / timeline). The in-session SummaryCard still shows right after a modal save (已保存).
### Verified
- Refresh on a session that had a stored conclusion: no summary card, no save button (bubbles only).
### Unresolved
- Old sessions keep their stored conclusion docs server-side (harmless, unused).
### Disproved
- n/a

## 2026-09-04 — Restore saved conclusion after refresh (record linked to session)
### Problem
- After refresh the in-memory conclusion was gone (concludeReady false) → clicking the Conclude button re-ran /api/conclude instead of opening the stored report.
### Fix
- The SAVED record is now linked to its session: on modal save, ChatApp stores `conclusion` + `recordId` in the session (authed: two PUTs — conclusion + recordId; guest: setGuestConclusion with recordId). The sessions PUT route accepts recordId (new `setSessionRecordId`); `parseConclusion` now also keeps meal dishes; `getSessionWithMessages` returns recordId; GuestSession gains recordId.
- On session load (authed + guest): if conclusion && recordId exist → restore recordIdRef + concludeSaved + concludeResult → the button glows and opens the STORED report; no /api/conclude call.
### Verified
- E2E: save a reading → refresh → button already ready (0 /api/conclude calls) → click opens the modal with the stored 130 reading.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-04 — Conclude button: view-only, static highlight, no API
### Problem
- After refresh the restored conclusion kept the button glowing forever (healthGlow animation pulsing) — "stuck flashing". The button could also still fire /api/conclude when no conclusion existed.
### Fix
- Button is now view-only: onClick opens the modal ONLY when a conclusion is ready; `concludeAll`/`concluding` state removed entirely (no /api/conclude from the button). Disabled when no stored report.
- `.conclude-button.ready` keeps the gradient border but the breathing animation was removed — static highlight.
### Verified
- E2E: save → refresh → button ready (static), 0 /api/conclude calls, click opens the stored report.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-04 — Conclude modal modern redesign
### Solved
- Raw form rows → modern card design: rounded 20px modal with soft shadow, title + summary subtitle; readings as cards with a big 34px value input, unit pill select (mg/dL, mmol/L, U, IU, g, kg), calendar/clock chip time pickers, trash-to-remove; meals as cards with inline name, time chips and dish rows (name input + color-coded rank badge that CYCLES 低→中→高→— on tap); dashed add-card buttons; gradient save button + ghost cancel; uppercase section labels.
- Meal trash now actually removes the meal entry (removeMeal).
### Verified
- E2E: modal opens with title/summary/big value/unit/save, no overflow (screenshot saved).
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-04 — Lighthouse audit (PC) + viewport a11y fix
### Scores (headless Chrome, Lighthouse 13.4.1)
- Home (guest): Performance 82, **Accessibility 100** (was 94), Best Practices 96, SEO 100
- Login: Performance 83, Accessibility 92, Best Practices 96, SEO 100
### Fixes applied
- Removed `maximumScale=1` + `userScalable=false` from the viewport meta (app/layout.tsx) — was flagged as an accessibility violation (blocks pinch-zoom). Kept `viewportFit: cover`. Home a11y 94 → 100.
### Remaining (informational)
- Guest 401s from /api/auth/me fire twice (ChatApp + Sidebar auth checks) → counted as console errors; harmless expected behavior.
- TBT ~400-480ms and ~68KB unused JS chunk — Next.js framework overhead, not actionable without bundler surgery.
### Unresolved
- n/a
### Disproved
- n/a

## 2026-09-04 — Conclusion modal manual audit (a11y + mobile)
### Found & fixed
- No focus management: modal opened with focus staying on the trigger → now focus moves into the modal (first content control, skipping the close button) and is trapped (Tab wraps first/last) while open (ConcludeModal focus effect).
- Escape did nothing → now closes the modal (with stopPropagation so the sidebar drawer handler doesn't double-fire).
- Generic aria-labels "date"/"time" → localized 日期/时间 (new concludeModal.date key).
- Subtitle contrast: #55555a on white ≈ 7.3:1 (AA pass; the probe's 2.83 reading was its transparent-background bug, not real).
### Verified
- Contrast: reading value 15.5:1, save button 21:1; tab order close→value→unit→remove→date→time→add→cancel→save; mobile 320px: modal 288px, no overflow, 34px value fits; focus lands on the reading value.
### Unresolved
- Add-card buttons rely on visible text for their name (no aria-label) — acceptable for screen readers.
### Disproved
- The modal cannot be audited by Lighthouse directly (it audits page navigations, not client-side state) — Playwright probing is the correct tool.
