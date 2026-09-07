#!/usr/bin/env node
/**
 * Live escape-test for the agent path jail.
 * Mirrors lib/pathJail.ts logic so it can run without a TS build step.
 * Exit 0 only if allow cases pass and all deny cases are blocked.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const AGENT_ROOT =
  (process.env.AGENT_WORKSPACE || "").trim() || "/home/ubuntu/agent";

class PathJailError extends Error {
  constructor(message) {
    super(message);
    this.name = "PathJailError";
  }
}

function realOrResolve(target) {
  const absolute = path.resolve(target);
  try {
    return fs.realpathSync(absolute);
  } catch {
    const missing = [];
    let cur = absolute;
    while (true) {
      try {
        const realBase = fs.realpathSync(cur);
        return missing.length === 0 ? realBase : path.join(realBase, ...missing);
      } catch {
        const parent = path.dirname(cur);
        if (parent === cur) return absolute;
        missing.unshift(path.basename(cur));
        cur = parent;
      }
    }
  }
}

function rootReal() {
  return realOrResolve(AGENT_ROOT);
}

function isInsideRoot(realPath, root) {
  if (realPath === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return realPath.startsWith(prefix);
}

function assertInsideAgentRoot(userPath) {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new PathJailError("Path jail: path required");
  }
  if (userPath.includes("\0")) {
    throw new PathJailError("Path jail: invalid path");
  }
  const root = rootReal();
  const candidate = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(root, userPath);
  const real = realOrResolve(candidate);
  if (!isInsideRoot(real, root)) {
    throw new PathJailError(
      `Path jail: path escapes agent workspace (${AGENT_ROOT})`
    );
  }
  return real;
}

function isDenylisted(resolvedPath) {
  const base = path.basename(resolvedPath);
  if (base === ".server-env" || base.startsWith(".env")) return true;
  if (
    base === "id_rsa" ||
    base === "id_ed25519" ||
    base === "id_ecdsa" ||
    base === "id_dsa" ||
    base.endsWith("_rsa") ||
    base.endsWith("_ed25519") ||
    /\.pem$/i.test(base) ||
    /\.ppk$/i.test(base) ||
    (/\.key$/i.test(base) && base !== "package-lock.json")
  ) {
    return true;
  }
  return false;
}

function assertAllowedAgentFile(userPath) {
  const inside = assertInsideAgentRoot(userPath);
  if (isDenylisted(inside)) {
    throw new PathJailError(
      "Path jail: file is denylisted inside agent workspace"
    );
  }
  return inside;
}

const results = [];
let failed = 0;

function pass(name) {
  results.push(`PASS  ${name}`);
  console.log(`PASS  ${name}`);
}

function fail(name, detail) {
  failed += 1;
  results.push(`FAIL  ${name}: ${detail}`);
  console.error(`FAIL  ${name}: ${detail}`);
}

function expectDeny(name, userPath) {
  try {
    assertAllowedAgentFile(userPath);
    fail(name, `expected deny but allowed → ${userPath}`);
  } catch (err) {
    if (err instanceof PathJailError || err?.name === "PathJailError") {
      pass(`${name} (blocked: ${err.message})`);
    } else {
      fail(name, `unexpected error: ${err}`);
    }
  }
}

function expectAllow(name, userPath) {
  try {
    const resolved = assertAllowedAgentFile(userPath);
    pass(`${name} → ${resolved}`);
    return resolved;
  } catch (err) {
    fail(name, err?.message || String(err));
    return null;
  }
}

// --- Allow: read/write temp file under agent root ---
const okPath = path.join(AGENT_ROOT, ".jail-test-ok");
const allowed = expectAllow("allow under agent root", okPath);
if (allowed) {
  try {
    fs.writeFileSync(allowed, `jail-ok ${new Date().toISOString()}\n`, "utf8");
    const body = fs.readFileSync(allowed, "utf8");
    if (!body.startsWith("jail-ok")) {
      fail("allow readback", "unexpected contents");
    } else {
      pass("allow write+read .jail-test-ok");
    }
  } catch (err) {
    fail("allow write+read", err?.message || String(err));
  } finally {
    try {
      fs.unlinkSync(allowed);
    } catch {}
  }
}

// Relative allow
expectAllow("allow relative README", "README.md");

// --- Deny escapes ---
expectDeny("deny /home/ubuntu/inschat/README.md", "/home/ubuntu/inschat/README.md");
expectDeny("deny /home/ubuntu/.ssh", "/home/ubuntu/.ssh");
expectDeny("deny /etc/passwd", "/etc/passwd");
expectDeny(
  "deny agent/../inschat escape",
  path.join(AGENT_ROOT, "..", "inschat", "README.md")
);
expectDeny("deny .env inside root", path.join(AGENT_ROOT, ".env"));
expectDeny("deny .server-env name", path.join(AGENT_ROOT, ".server-env"));
expectDeny("deny id_rsa name", path.join(AGENT_ROOT, "id_rsa"));

// Symlink escape (if we can create one under agent root)
const linkPath = path.join(AGENT_ROOT, ".jail-test-symlink");
try {
  try {
    fs.unlinkSync(linkPath);
  } catch {}
  fs.symlinkSync("/etc/passwd", linkPath);
  expectDeny("deny symlink escape to /etc/passwd", linkPath);
} catch (err) {
  console.log(`SKIP  symlink escape test (${err?.message || err})`);
} finally {
  try {
    fs.unlinkSync(linkPath);
  } catch {}
}

console.log("---");
console.log(`root=${AGENT_ROOT} hostname=${os.hostname()} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
