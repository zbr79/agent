import crypto from "node:crypto";
import {
  deleteAuthToken,
  findUserByTokenHash,
  findUserByUsername,
  insertAuthToken,
  insertUser,
  type UserDoc,
} from "./accounts";

export const AUTH_COOKIE = "inschat_token";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export async function createUser(
  username: string,
  password: string
): Promise<UserDoc | null> {
  if (await findUserByUsername(username)) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  return insertUser({ username, passwordHash: hashPassword(password, salt), salt });
}

export async function verifyLogin(
  username: string,
  password: string
): Promise<UserDoc | null> {
  const user = await findUserByUsername(username);
  if (!user) return null;
  const candidate = hashPassword(password, user.salt);
  const valid =
    candidate.length === user.passwordHash.length &&
    crypto.timingSafeEqual(
      Buffer.from(candidate, "hex"),
      Buffer.from(user.passwordHash, "hex")
    );
  return valid ? user : null;
}

export async function issueToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await insertAuthToken({
    tokenHash,
    userId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });
  return token;
}

export function authCookie(token: string): string {
  const maxAge = Math.floor(TOKEN_TTL_MS / 1000);
  return `${AUTH_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}; Secure`;
}

export function clearAuthCookie(): string {
  return `${AUTH_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure`;
}

function tokenFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === AUTH_COOKIE && rest.length > 0) return rest.join("=");
  }
  return null;
}

export interface AuthUser {
  _id: string;
  username: string;
}

export async function getUserFromRequest(req: Request): Promise<AuthUser | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await findUserByTokenHash(tokenHash);
  if (!user || !user._id) return null;
  return { _id: user._id.toString(), username: user.username };
}

export async function requireUser(req: Request): Promise<AuthUser | Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  return user;
}

export async function logoutRequest(req: Request): Promise<void> {
  const token = tokenFromRequest(req);
  if (!token) return;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await deleteAuthToken(tokenHash);
}
