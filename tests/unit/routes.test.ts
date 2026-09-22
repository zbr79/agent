import { describe, expect, it } from "vitest";
import { GET as concludeGet, POST as concludePost } from "@/app/api/conclude/route";
import {
  GET as recordsGet,
  POST as recordsPost,
} from "@/app/api/records/route";
import { GET as opencodeGet } from "@/app/api/opencode/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as documentsPost } from "@/app/api/documents/route";

describe("compatibility routes", () => {
  it("returns explicit gone responses for retired APIs", async () => {
    expect((await concludeGet()).status).toBe(410);
    expect((await concludePost()).status).toBe(410);
    expect((await recordsGet()).status).toBe(410);
    expect((await recordsPost()).status).toBe(410);
    expect((await opencodeGet()).status).toBe(410);
  });
});

describe("authentication route validation", () => {
  it("rejects malformed registration before touching the database", async () => {
    const response = await registerPost(
      new Request("http://test/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: "x", password: "short" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "usernameInvalid" });
  });

  it("rejects missing login fields", async () => {
    const response = await loginPost(
      new Request("http://test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "alice" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "passwordRequired" });
  });
});

describe("document upload route", () => {
  it("validates multipart input and supported file types", async () => {
    const empty = await documentsPost(
      new Request("http://test/api/documents", { method: "POST" })
    );
    expect(empty.status).toBe(400);

    const form = new FormData();
    form.append("files", new File(["hello"], "photo.png", { type: "image/png" }));
    const unsupported = await documentsPost(
      new Request("http://test/api/documents", { method: "POST", body: form })
    );
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toContain("supported");
  });

  it("extracts text files and rejects duplicate names", async () => {
    const form = new FormData();
    form.append("files", new File(["hello"], "notes.txt", { type: "text/plain" }));
    form.append("files", new File(["again"], " NOTES.TXT ", { type: "text/plain" }));
    const response = await documentsPost(
      new Request("http://test/api/documents", { method: "POST", body: form })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].text).toContain("hello");
    expect(body.errors[0]).toContain("duplicate");
  });
});
