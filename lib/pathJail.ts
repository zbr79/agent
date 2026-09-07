import fs from "node:fs";
import path from "node:path";

/** Absolute workspace root for this agent. Override with AGENT_WORKSPACE. */
export const AGENT_ROOT =
  (process.env.AGENT_WORKSPACE || "").trim() || "/home/ubuntu/agent";

export class PathJailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathJailError";
  }
}

/** Resolve existing path via realpath; for missing paths, realpath the deepest existing ancestor. */
function realOrResolve(target: string): string {
  const absolute = path.resolve(target);
  try {
    return fs.realpathSync(/*turbopackIgnore: true*/ absolute);
  } catch {
    const missing: string[] = [];
    let cur = absolute;
    while (true) {
      try {
        const realBase = fs.realpathSync(/*turbopackIgnore: true*/ cur);
        return missing.length === 0
          ? realBase
          : path.join(realBase, ...missing);
      } catch {
        const parent = path.dirname(cur);
        if (parent === cur) {
          return absolute;
        }
        missing.unshift(path.basename(cur));
        cur = parent;
      }
    }
  }
}

function rootReal(): string {
  return realOrResolve(AGENT_ROOT);
}

function isInsideRoot(realPath: string, root: string): boolean {
  if (realPath === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return realPath.startsWith(prefix);
}

/**
 * Resolve userPath and ensure it stays inside AGENT_ROOT after symlink resolution.
 * Rejects `..` escapes, absolute paths outside the root, and symlink escapes.
 * Returns the canonical absolute path.
 */
export function assertInsideAgentRoot(userPath: string): string {
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

function isDenylisted(resolvedPath: string): boolean {
  const base = path.basename(resolvedPath);
  // **/.env* (including .env, .env.local, .env.example) and .server-env
  if (base === ".server-env" || base.startsWith(".env")) {
    return true;
  }
  // Private keys / PEM material
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

/**
 * Inside AGENT_ROOT AND not on the inner denylist (.env*, .server-env, private keys).
 */
export function assertAllowedAgentFile(userPath: string): string {
  const inside = assertInsideAgentRoot(userPath);
  if (isDenylisted(inside)) {
    throw new PathJailError(
      "Path jail: file is denylisted inside agent workspace"
    );
  }
  return inside;
}

/** Lightweight startup / health check: root must exist and be a directory. */
export function assertAgentWorkspaceReady(): string {
  const root = rootReal();
  let st: fs.Stats;
  try {
    st = fs.statSync(/*turbopackIgnore: true*/ root);
  } catch {
    throw new PathJailError(`Path jail: AGENT_WORKSPACE missing (${AGENT_ROOT})`);
  }
  if (!st.isDirectory()) {
    throw new PathJailError(`Path jail: AGENT_WORKSPACE is not a directory (${AGENT_ROOT})`);
  }
  return root;
}
