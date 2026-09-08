const fs = require("fs");
const path = require("path");

// Load .env into process.env so pm2 env block can reference secrets
// without hardcoding them in this file.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

module.exports = {
  apps: [
    {
      name: "agent",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3002",
      cwd: __dirname,
      // Grace window for the SIGINT flush in app/api/chat/route.ts to write
      // live runs to "done" before pm2 escalates to SIGKILL.
      kill_timeout: 8000,
      env: {
        NODE_ENV: "production",
        OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || "",
        OPENCODE_API_KEY: process.env.OPENCODE_API_KEY || "",
        OPENCODE_API_KEY_FORCE: process.env.OPENCODE_API_KEY_FORCE || "",
        MONGODB_URI: process.env.MONGODB_URI || "",
        MONGODB_DB: process.env.MONGODB_DB || "",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
        GEMINI_MODEL: process.env.GEMINI_MODEL || "",
        CONCLUDE_MODEL: process.env.CONCLUDE_MODEL || "",
        RECORD_TIMEZONE: process.env.RECORD_TIMEZONE || "",
      },
    },
  ],
};
