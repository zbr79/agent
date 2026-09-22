import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertAllowedAgentFile,
  assertInsideAgentRoot,
  PathJailError,
} from "@/lib/pathJail";

describe("path jail", () => {
  it("allows paths inside a supplied workspace and denies traversal/secrets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-jail-"));
    try {
      expect(assertAllowedAgentFile("README.md", root)).toBe(path.join(root, "README.md"));
      expect(() => assertInsideAgentRoot("../outside.txt", root)).toThrow(PathJailError);
      expect(() => assertAllowedAgentFile(".env", root)).toThrow(PathJailError);
      expect(() => assertAllowedAgentFile("private.pem", root)).toThrow(PathJailError);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("blocks symlink escapes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-jail-link-"));
    const link = path.join(root, "escape");
    try {
      await fs.symlink("/etc/passwd", link);
      expect(() => assertAllowedAgentFile("escape", root)).toThrow(PathJailError);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
