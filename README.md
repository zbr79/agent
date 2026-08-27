# InsChat

Minimalist AI chatbot — text chat + image upload, streaming responses. Powered by the **Google Gemini API free tier** (no credit card).

**Live:** https://inschat.renstoolbox.com

## Features

- Text chat with streaming responses
- Image upload (JPEG/PNG/WebP) — Gemini vision analyzes or describes your photo
- Multi-turn conversation (last 20 messages kept as context)
- Apple-style black & white UI, mobile-friendly
- Server-side API key (never exposed to the client)

## Stack

Next.js 16 (App Router, React 19) + `@google/genai` SDK. Model: `gemini-3.6-flash` (configurable via `GEMINI_MODEL`).

Note: Google retires model names over time (e.g. `gemini-2.5-flash` now 404s for new users). If a request says the model is unavailable, change `GEMINI_MODEL` — `gemini-flash-latest` tracks the current Flash, and `gemini-3-flash-preview` / `gemma-4-26b-a4b-it` also work with images on the free tier.

## Get an API key (free, ~2 minutes)

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key** → **Create API key in new project**.
3. Copy the key (starts with `AIza...`).

## Setup

```bash
npm install
cp .env.example .env
# edit .env: GEMINI_API_KEY=AIza... (your key)
npm run dev        # development
# or production:
npm run build
npm run start      # serves on port 3000 by default
```

## Deploy with PM2

```bash
npm run build
pm2 start ecosystem.config.js   # serves on port 3001
```

Put nginx (or any reverse proxy) in front and proxy `/` to `127.0.0.1:3001`. If proxying, keep `proxy_buffering off;` so responses stream.

## How it works

1. Browser sends `POST /api/chat` with `{ messages: [{ role, text, image? }] }`.
2. Server validates the payload (roles, image type/size) and calls Gemini with full history.
3. Gemini streams tokens back; the server relays them chunk-by-chunk to the browser.
4. Images travel as base64 `inlineData` parts.

Free-tier limits (Gemini): ~60 req/min on Flash models — fine for demos and small teams. The free tier occasionally returns transient **503 "high demand"** errors; the server retries up to 3 times with backoff, and the UI shows the error if all retries fail.

## Project structure

```
app/
  api/chat/route.ts   # POST endpoint: validation + streaming relay
  page.tsx            # server component entry
  layout.tsx          # metadata
  globals.css         # Apple-style black & white theme
components/
  ChatApp.tsx         # client state: messages, streaming, abort
  MessageBubble.tsx   # message list + markdown rendering
  Composer.tsx        # text input + image upload + preview
lib/
  gemini.ts           # Gemini SDK wrapper + payload conversion
  types.ts            # shared types + limits
```
