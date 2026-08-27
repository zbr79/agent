# GemChat — Plan

## Decision log

- **Chosen from roadmap §4 candidates:** chatbot (user decision 2026-08-27, overrides "no chatbot wrapper" rule). Differentiation: image upload (vision) + streaming, real deployment, clean UX — done fast, not a bare wrapper.
- **Stack:** Next.js 16 + React 19 (matches Rencipe; Node 22 on VM OK). Express rejected — one less process.
- **Model:** `gemini-2.5-flash` on Gemini free tier (no credit card, ~15–60 req/min, supports images). Configurable via `GEMINI_MODEL`.
- **v1 scope:** text chat + image upload + streaming + multi-turn context (last 20 msgs). No auth, no DB, no persistence — conversations live in the browser.

## Deliberately excluded (future ideas)

- Conversation persistence / share links
- System prompt picker / personas
- Streaming with markdown code syntax highlighting
- Rate limiting in app (nginx handles it at the VM level)
- i18n (en/zh like Rencipe)
- Public subdomain + TLS (needs DNS change by owner; app runs via PM2 on :3001)

## Status

- [x] Repo created: github.com/zbr79/gemini-chat
- [x] v1 built (chat + image upload + streaming)
- [x] Deployed on VM via PM2 (port 3001)
- [ ] Owner adds real `GEMINI_API_KEY` to `.env` (then `pm2 restart gemini-chat`)
- [ ] DNS record for public URL (owner action; then nginx + certbot)
