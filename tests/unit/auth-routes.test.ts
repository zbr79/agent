import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "inschat_token",
  DISPLAY_NAME_MAX: 64,
  PASSWORD_MAX: 128,
  PASSWORD_MIN: 8,
  USERNAME_PATTERN: /^[a-zA-Z0-9_]{3,32}$/,
  authCookie: vi.fn((token: string) => `auth=${token}`),
  changeUserPassword: vi.fn(),
  clearAuthCookie: vi.fn(() => "auth=; Max-Age=0"),
  createUser: vi.fn(),
  getUserFromRequest: vi.fn(),
  issueToken: vi.fn(),
  logoutRequest: vi.fn(),
  requireUser: vi.fn(),
  verifyLogin: vi.fn(),
}));

vi.mock("@/lib/accounts", () => ({
  updateUserDisplayName: vi.fn(),
}));

import { PATCH as profilePatch } from "@/app/api/auth/profile/route";
import { POST as changePasswordPost } from "@/app/api/auth/change-password/route";
import { GET as meGet } from "@/app/api/auth/me/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import {
  changeUserPassword,
  createUser,
  getUserFromRequest,
  issueToken,
  requireUser,
  verifyLogin,
} from "@/lib/auth";
import { updateUserDisplayName } from "@/lib/accounts";

const user = {
  _id: "507f1f77bcf86cd799439011",
  username: "alice",
  displayName: "Alice",
};

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(user);
  vi.mocked(getUserFromRequest).mockResolvedValue(user);
  vi.mocked(createUser).mockResolvedValue(user as never);
  vi.mocked(issueToken).mockResolvedValue("token");
  vi.mocked(verifyLogin).mockResolvedValue(user as never);
  vi.mocked(updateUserDisplayName).mockResolvedValue(true);
  vi.mocked(changeUserPassword).mockResolvedValue(true);
});

describe("authentication route success paths", () => {
  it("registers an account and returns a session cookie", async () => {
    const response = await registerPost(
      jsonRequest("http://test/api/auth/register", {
        username: "alice",
        password: "correct horse battery staple",
      })
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBe("auth=token");
    expect(await response.json()).toEqual({
      user: { username: "alice", displayName: "Alice" },
    });
    expect(createUser).toHaveBeenCalledWith("alice", "correct horse battery staple");
    expect(issueToken).toHaveBeenCalledWith(user._id);
  });

  it("rejects duplicate usernames and accepts valid login", async () => {
    vi.mocked(createUser).mockResolvedValueOnce(null);
    const duplicate = await registerPost(
      jsonRequest("http://test/api/auth/register", {
        username: "alice",
        password: "password123",
      })
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).errorCode).toBe("usernameTaken");

    const login = await loginPost(
      jsonRequest("http://test/api/auth/login", {
        username: "alice",
        password: "password123",
      })
    );
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toBe("auth=token");
    expect((await login.json()).user.username).toBe("alice");
  });

  it("returns a user, clears the cookie on logout, and updates account settings", async () => {
    const me = await meGet(new Request("http://test/api/auth/me"));
    expect(me.status).toBe(200);
    expect((await me.json()).user).toEqual(user);

    const logout = await logoutPost(new Request("http://test/api/auth/logout", {
      method: "POST",
      headers: { cookie: "inschat_token=token" },
    }));
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toBe("auth=; Max-Age=0");

    const profile = await profilePatch(
      jsonRequest("http://test/api/auth/profile", { displayName: "  New Alice  " }, "PATCH")
    );
    expect(profile.status).toBe(200);
    expect((await profile.json()).user.displayName).toBe("New Alice");
    expect(updateUserDisplayName).toHaveBeenCalledWith(user._id, "New Alice");

    const password = await changePasswordPost(
      jsonRequest("http://test/api/auth/change-password", {
        currentPassword: "old-password",
        newPassword: "new-password",
        confirmPassword: "new-password",
      })
    );
    expect(password.status).toBe(200);
    expect(changeUserPassword).toHaveBeenCalledWith(
      user._id,
      "old-password",
      "new-password"
    );
  });
});

describe("account validation boundaries", () => {
  it("rejects mismatched passwords and oversized display names", async () => {
    const password = await changePasswordPost(
      jsonRequest("http://test/api/auth/change-password", {
        currentPassword: "old-password",
        newPassword: "new-password",
        confirmPassword: "different-password",
      })
    );
    expect(password.status).toBe(400);
    expect((await password.json()).errorCode).toBe("passwordMismatch");

    const profile = await profilePatch(
      jsonRequest("http://test/api/auth/profile", {
        displayName: "x".repeat(65),
      }, "PATCH")
    );
    expect(profile.status).toBe(400);
    expect((await profile.json()).errorCode).toBe("displayNameLength");
  });
});
