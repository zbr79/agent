import { describe, expect, it } from "vitest";
import {
  EXCLUDED_SEGMENTS,
  hashBuffer,
  hashPath,
  isExcluded,
} from "@/lib/checkpointSnapshot";

describe("checkpoint snapshot safety filters", () => {
  it("hashes content and paths deterministically", () => {
    expect(hashBuffer(Buffer.from("hello"))).toBe(hashBuffer(Buffer.from("hello")));
    expect(hashBuffer(Buffer.from("hello"))).not.toBe(hashBuffer(Buffer.from("goodbye")));
    expect(hashPath("src/index.ts")).not.toBe(hashPath("src/other.ts"));
  });

  it("excludes build output, VCS data, and credential-like files", () => {
    expect(EXCLUDED_SEGMENTS.has("node_modules")).toBe(true);
    expect(isExcluded(".next/server/app.js")).toBe(true);
    expect(isExcluded("node_modules/package/index.js")).toBe(true);
    expect(isExcluded(".env")).toBe(true);
    expect(isExcluded("cert.pem")).toBe(true);
    expect(isExcluded("src/index.ts")).toBe(false);
  });
});
