# PLAN_REMOVE_INSULIN_MODE — full removal of insulin (preset / health) mode

Scope: remove the user-facing "Insulin mode" (UI label en "Insulin mode" / zh "血糖模式") — the
preset/free mode switch, the `mode: "preset"|"free"` wire plumbing, the `SYSTEM_PROMPT.md`
template persona, and everything that exists only to serve it (the `<CONCLUDE>` tail →
Conclude button/modal recording pipeline). After removal the app is free-chat-only
(`FREE_PROMPT` / `FREE_AGENT_PROMPT` become the only system prompts). Legacy saved records
(glucose/insulin/meals already in MongoDB + guest localStorage) stay viewable.

Line numbers are from the current checkout (2026-09-06); re-verify after any edit.

Search-term map (what was grepped and where it lives):

| Term | Result |
|---|---|
| `insulin` | prefs.ts, ChatApp.tsx, OpenCodeChat.tsx, Sidebar.tsx, i18n.ts, mealTime.ts, conclude.ts, ConcludeModal.tsx, SYSTEM_PROMPT.md (§2), README.md:13, app/layout.tsx:8, EXPERIENCES.md/PLAN.md (history — keep) |
| `inschat_insulin_mode` | lib/prefs.ts:5 (localStorage key) — only code occurrence |
| `preset` | lib/chatRequest.ts:9,83-86; ChatApp.tsx:394; OpenCodeChat.tsx:91 (the `mode: insulinMode ? "preset" : "free"` sends) |
| `freeMode` | app/api/chat/route.ts:26; app/api/opencode/route.ts:25; lib/agent.ts:115; lib/opencode.ts:545,553; lib/prompt.ts:57,64 |
| `SYSTEM_PROMPT` | SYSTEM_PROMPT.md (135 lines) + lib/prompt.ts:7 (`PROMPT_FILE`, read per request, preset branch only) |
| `Conclude` | lib/conclude.ts, app/api/conclude/route.ts, SYSTEM_PROMPT.md §6 `<CONCLUDE>` tail (120-135), ChatApp.tsx tail-parsing 439-531 + state/modal wiring, ConcludeButton.tsx, ConcludeModal.tsx, SummaryCard.tsx, lib/models.ts CONCLUDE chain, records/sessions storage |
| `????` | No literal matches in the repo. Closest placeholder strings: `单位未说明` at SYSTEM_PROMPT.md:80 (a "do NOT write" rule) and `未说明` at lib/conclude.ts:42 — both die with their files |

## 1. Where insulin mode lives

### 1.1 Toggle + persistence (client)
- `lib/prefs.ts:5-36` — `KEY = "inschat_insulin_mode"`, `EVENT = "inschat-insulin-mode"`,
  `getInsulinMode()` (:9), `setInsulinMode()` (:18), `useInsulinMode()` (:26).
  The compress-images (:38-71) and reasoning-effort (:73-115) prefs in the same file are unrelated — KEEP.
- `components/ChatApp.tsx` — import :25, hook :80, request body `mode:` :394,
  gate on `if (insulinMode)` for `<CONCLUDE>` tail parsing :474-531, useCallback dep :572,
  toggle buttons: welcome screen :793-802, bottom composer row :826-834.
- `components/OpenCodeChat.tsx` — import :11, hook :39, `mode:` :91, dep :188, toggle :219-228.
- `components/Sidebar.tsx` — import :12, hook :65, settings switch row :602-617 (`Activity` icon).
- `lib/i18n.ts` — `settings.insulinMode` :83/:189, `settings.insulinModeHint` :84/:190,
  `welcome.insulinOn` :106/:212 (already unused — verify then delete).

### 1.2 Mode plumbing (wire + server)
- `lib/chatRequest.ts` — `ChatRequest.mode?: "preset"|"free"` :9, validation :80-87, return :98.
- `app/api/chat/route.ts` — destructure `mode` :25, `freeMode = mode === "free"` :26,
  passed to `agentChat` :54 and `streamChat` :75, :91.
- `app/api/opencode/route.ts` — destructure `mode` :24, `freeMode` :25, passed to `agentChat` :51.
  Note: today a preset toggle on /opencode leaks the InsChat health persona into the coding agent; removal fixes this.

### 1.3 Prompt selection
- `lib/prompt.ts` — `FREE_PROMPT` :15-16, `FREE_AGENT_PROMPT` :18-21, `AGENT_WORKSPACE_TOOLS` :12-13
  (KEEP — used by free branch); `FALLBACK_PROMPT` :8-9, `PROMPT_FILE` (SYSTEM_PROMPT.md) :7,
  `currentTimeLabel()` :35-52 and the preset branch :72-81 of `getSystemPrompt(timeZone, language, freeMode, agentTools)` :54-84 — DELETE preset branch; the function collapses to `getSystemPrompt(language?, agentTools?)`. The 当前时间 line exists only for the templates → drop `currentTimeLabel` + `isValidTimeZone` export usage check (`isValidTimeZone` :23-33 is also used by `lib/chatRequest.ts:2,65` for the `timeZone` field — KEEP the function or retire `timeZone` too; see §3.5).
- `lib/agent.ts` — `agentChat(..., freeMode = false, agentTools)` :111-120; `system` computed :120,
  sent as per-request override in `session.prompt` body :231-236.
- `lib/opencode.ts` — `streamChat(..., freeMode = false, ...)` :541-547, `systemOverride` :553-555,
  `toOpenAiMessages` default `getSystemPrompt(timeZone, language)` :220 (this is the preset default for the
  direct path — becomes the free prompt).

### 1.4 The persona file
- `SYSTEM_PROMPT.md` (whole file) — §1 food-photo templates, **§2 Insulin reading :62-85**, §3 glucose
  two-line format + phase labels :87-110, §4/§5, §6 `<CONCLUDE>` machine tail :120-135. All mode-gated.
  Read per request via `lib/prompt.ts:7` — deleting the file only takes effect together with the code change
  (the `fs.readFileSync` is try/catch, but `PROMPT_FILE` is validated at module load via
  `assertAllowedAgentFile` — delete both in the same commit; `scripts/test-path-jail.mjs` must stay green).

### 1.5 Recording pipeline that exists only for the mode
- `<CONCLUDE>` tail handling in `components/ChatApp.tsx`: stripping :439-464, gated parse+persist
  :471-531, session conclusion restore :231, :246-260 (authed) and :296-307 (guest),
  `mergeConclusion` :100-141, state :87-98 (`concludeDraft`, `concludeResult`, `concludeSaved`, `recordIdRef`),
  `concludeReady` :782, button/modal wiring :835-843, :858-901.
- `components/ConcludeButton.tsx` (whole file), `components/ConcludeModal.tsx` (whole file; its
  insulin-specific logic: `insulins` state :411, pairing :492-535, `insulinBaseName` :564,
  save rebuild :614-628, ordering :779-800, render/commit branches :880-947),
  `components/SummaryCard.tsx` (already orphaned — no imports anywhere; delete).
- `app/api/conclude/route.ts` (whole file — dead: no frontend fetches `/api/conclude` anymore, only a
  comment at ChatApp.tsx:472) + `lib/conclude.ts` (`CONCLUDE_PROMPT` with insulin rules :12-44,
  `concludeMessage` :127-185).
- `lib/models.ts` — `CONCLUDE_CHAIN_FULL` :86-128, `getConcludeChain()` and `CONCLUDE_MODEL` env
  override :174 → delete; `app/api/models/route.ts:1,12` (`concludeModel` field) and
  `components/ModelsPanel.tsx:17,134-141` + `models.concludeDescription` i18n keys → delete field/row.
- `lib/mealTime.ts` — `refineInsulinName()` :217-232 is DEAD (zero callers — delete);
  `readingPhase()`/`pairTimeItems()`/`groupMeals()` are metric-agnostic and feed the legacy records
  view → KEEP; comments mentioning insulin (:197, :243) → reword.
- `components/RecordsPanel.tsx`, `app/records/page.tsx`, `app/api/records/route.ts`,
  `lib/types.ts` (`ConcludeItem`/`ConcludeMeal`/`SessionConclusion`), `lib/guestStore.ts`
  (`inschat_guest_records`, `setGuestConclusion`) — legacy storage/display, generic names → KEEP
  (read-only view of previously saved records; only the write path is removed).

### 1.6 Copy + styles + docs
- `app/globals.css` — `.composer-toggles` :3795-3809, `.composer-toggle` :3810-3830, mobile rule
  :3784, duplicate `.composer-toggle.active` :3907 → delete (only these buttons use the class).
  `.switch` :3433-3461 stays (compress-images switch uses it). `.conclude-*` blocks :429-942 → delete with
  the modal/button; keep `.conclusion-error` (used by 6 unrelated panels) and `.conclusion-items`
  (RecordsPanel:246) / `.conclusion-card` (check: only SummaryCard → delete with it).
- `app/layout.tsx:8` meta description "Record insulin levels…" → reword.
- `README.md:13` (Conclude feature), :89 (`SYSTEM_PROMPT.md` note), :24 (`CONCLUDE_MODEL`) → update.
- `EXPERIENCES.md` / `PLAN.md` → historical; do not edit, append a removal entry instead.
- `snapshot/artifacts.json`, `snapshot/trace.json` contain old bundles with the strings — generated
  snapshots, leave untouched.

## 2. Files/symbols to change — checklist

Phase 1 (kill the UI + make the server mode-blind, compat-safe):
1. `components/ChatApp.tsx` — remove imports/hook/toggles (:25,80,394,572,793-802,826-834); send no `mode`;
   replace `if (insulinMode)` tail-parse (:474) with unconditional tail-strip defense (models mid-rollout may
   still emit `<CONCLUDE>…</CONCLUDE>` from long-lived sessions — keep the :439-464 stripping for one release).
2. `components/OpenCodeChat.tsx` — remove :11,39,91,188,219-228.
3. `components/Sidebar.tsx` — remove :12 (import `useInsulinMode` part), :65, :602-617.
4. `app/api/chat/route.ts` + `app/api/opencode/route.ts` — ignore `mode` entirely: call
   `agentChat(messages, timeZone, language, true, …)` / `streamChat(…, true, …)` (freeMode hardcoded true).
5. `lib/chatRequest.ts` — KEEP parsing `mode` (accept `"preset"|"free"` without 400) but stop exposing it
   (or keep the field, unused). Prevents stale-tab 400s.
6. `lib/prefs.ts` — delete :5-36. `lib/i18n.ts` — delete insulinMode/Hint keys; verify `welcome.insulinOn`
   has no usages, then delete.
7. `app/globals.css` — delete `.composer-toggle*` rules.

Phase 2 (purge the mode machinery — after Phase 1 is live ≥ 1 day):
8. `lib/prompt.ts` — collapse `getSystemPrompt` to free-only; delete `PROMPT_FILE`/`FALLBACK_PROMPT`/
   `currentTimeLabel` preset branch; delete `SYSTEM_PROMPT.md` file.
9. `lib/agent.ts` — drop `freeMode` param (:115) and thread removal (:120).
10. `lib/opencode.ts` — drop `freeMode` param (:545), `systemOverride` (:553-555) → always free prompt
    in `toOpenAiMessages` (:220 call sites).
11. `lib/chatRequest.ts` — remove `mode` from `ChatRequest` + routes; `app/api/chat` decides vision by
    `hasImage` only (unchanged :30-31).
12. Recording stack — delete `components/ConcludeButton.tsx`, `ConcludeModal.tsx`, `SummaryCard.tsx`,
    `app/api/conclude/route.ts`, `lib/conclude.ts`; strip ChatApp conclusion state/restore/persist
    (§1.5 lines); `lib/models.ts` CONCLUDE chain + `CONCLUDE_MODEL`; `app/api/models/route.ts` +
    `ModelsPanel` conclude rows; `lib/mealTime.ts` `refineInsulinName`; related i18n
    (`concludeModal.*`, `summary.*`, `actions.summarize*` — verify RecordsPanel doesn't use them).
13. Copy — `app/layout.tsx:8`, `README.md:13,24,73,89,91`.

Do NOT delete: `lib/mealTime.ts` (rest), `lib/types.ts`, `lib/groupMeals.ts`, `lib/guestStore.ts`,
`app/api/records/route.ts`, `components/RecordsPanel.tsx`, `app/records/page.tsx`, `.switch`/
`.conclusion-error` CSS — legacy records must still render.

## 3. Migration / compat notes

1. **localStorage `inschat_insulin_mode`** becomes orphan data in every user's browser. In Phase 1,
   add a one-shot cleanup in `lib/prefs.ts` or a client bootstrap:
   `localStorage.removeItem("inschat_insulin_mode")` + drop the `inschat-insulin-mode` event listener usage.
   Harmless if left, but remove the key so a future feature can't collide with it.
2. **Stale tabs / in-flight requests**: old clients still POST `mode:"preset"`. Phase 1 keeps
   `parseChatBody` accepting the field and ignoring it → no 400s. Only in Phase 2 may the field
   validation be dropped (unknown extra JSON keys are ignored by the parser anyway).
3. **In-flight `<CONCLUDE>` tails**: any session whose context was built from SYSTEM_PROMPT.md can keep
   echoing the tail for a few messages. Keep the unconditional `<CONCLUDE>` stripping in ChatApp
   (§2.1) and remove it in a later housekeeping commit.
4. **Saved data**: MongoDB `records`/`sessions.conclusion` and guest `inschat_guest_records` may contain
   items named 胰岛素/Insulin. They're plain name/value/unit strings — the kept display path
   (`pairTimeItems` → name-agnostic; phase labels come from `时间` items) renders them unchanged.
   No DB migration. Do not purge.
5. **`timeZone` field**: only meaningful for template time lines (`currentTimeLabel`, `getSystemPrompt`
   zone). `RECORD_TIMEZONE` env is still used by record translation if any survives — decide: keep
   `timeZone` validation in `lib/chatRequest.ts` (harmless, one line) but stop sending from ChatApp
   (:392) in Phase 2; keep `isValidTimeZone` until then (imported at :2 of chatRequest).
6. **`CONCLUDE_MODEL` env var** (`lib/models.ts:174`) becomes dead — tell the admin to drop it from
   `.server-env`/env later (don't read secrets here); code just stops reading it.
7. **nginx**: per EXPERIENCES, `inschat.renstoolbox.com.conf` has a dedicated `location /api/conclude`.
   After the route is deleted it 404s behind an unused location — flag for the admin to clean up; no
   urgency.
8. **opencode serve (`inschat-agent`, :4096)**: the system prompt is sent per-request via
   `session.prompt` body (`lib/agent.ts:234`) — no server restart needed for prompt changes; only the
   Next `agent` process restart matters (§5).
9. **Rollback**: tag before Phase 1 (`pre-remove-insulin-mode`); every step is a git revert;
   SYSTEM_PROMPT.md returns via git. No destructive migrations, so rollback is safe at any point.

## 4. Test checklist

Build/tests:
- [ ] `npm run build` — zero TS errors (no unused-import failures for deleted hooks/state).
- [ ] `node scripts/test-path-jail.mjs` — still green (prompt.ts path-jail usage removed in Phase 2;
      re-check `lib/pathJail.ts` allowlist if it references SYSTEM_PROMPT.md).
- [ ] Grep sweep in `app/ components/ lib/` for `insulin|inschat_insulin_mode|"preset"|freeMode|CONCLUDE`
      — expected remaining hits after Phase 2: none in code except legacy display names
      (胰岛素 appears only in `lib/mealTime.ts` comments/`refineInsulinName` — deleted in Phase 2 —
      and docs/snapshots).

Manual (both zh + en UI):
- [ ] Welcome screen and bottom composer: no mode pill; sidebar settings: no 血糖模式/Insulin row
      (language + compress-images switches still work).
- [ ] Send "140" → normal conversational reply, NO two-line template, no `<CONCLUDE>` visible in the
      bubble or DOM.
- [ ] Send food photo → vision chain answers naturally (no 🟢🟡🔴 table requirement); model routing
      (`hasImage` logic at `app/api/chat/route.ts:30-31`) unchanged.
- [ ] `/opencode` page → coding agent answers with workspace tools; no insulin persona (regression:
      previously a preset toggle leaked it).
- [ ] DevTools: `/api/chat` + `/api/opencode` request bodies contain no `mode` field (Phase 2).
- [ ] Back-compat: `curl -X POST /api/chat -d '{"messages":[{"role":"user","text":"hi"}],"mode":"preset"}'`
      → 200, free behavior (Phase 1 + 2), no 400.
- [ ] Legacy view: account + guest with previously saved 胰岛素/血糖/meal records → `/records`
      (RecordsPanel) still lists them; timeline entries show saved values unchanged; deleting a record
      still works (API kept).
- [ ] Sessions with a stored `conclusion` load without console errors after the restore code is removed
      (extra DB field must be tolerated by `app/api/sessions` consumers).
- [ ] Models page: no "Conclude model" description row (Phase 2); `POST /api/models` pinning still works.
- [ ] Guest flow: localStorage `inschat_insulin_mode` gone after visiting the site (cleanup ran);
      `inschat_guest_sessions`/`inschat_guest_records` intact.
- [ ] Mobile viewport (≤768px): removed `.composer-toggles` leaves no layout gap.

## 5. Rollout order

1. Pre-tag `pre-remove-insulin-mode`; branch `remove-insulin-mode`.
2. **Phase 1 PR** (UI off + server ignores mode + tail-strip + localStorage cleanup; `mode` still
   accepted). Merge, `npm run build`, then **ask Grok/an admin to restart the pm2 `agent` process**
   (AGENTS.md: never restart the Next app via tools). Smoke-test on https://agent.renstoolbox.com.
   Keep for ≥ 1 day (covers stale tabs + streaming sessions).
3. **Phase 2 PR** (dead-code purge: prompt.ts/SYSTEM_PROMPT.md/mode plumbing/recording stack/
   conclude chain/CSS/copy). Same build → admin-restart → run full §4 checklist.
4. **Phase 3 housekeeping** (no deploy risk): README/PLAN.md copy, layout meta description,
   admin notes (nginx `/api/conclude` location, `CONCLUDE_MODEL` env), append EXPERIENCES.md entry,
   drop the leftover `<CONCLUDE>` stripper once no tail has been seen in logs for a week.
5. Rollback plan: revert the phase PR + ask for another restart; data untouched at every step.
