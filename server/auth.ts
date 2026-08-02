import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export type Editor = { id: number; email: string; name: string | null; role: string };

const COOKIE_NAME = "pa_session";
const SECRET = process.env.SESSION_SECRET;
if (!SECRET) throw new Error("SESSION_SECRET must be set.");

type Claims = { sub: number; email: string; name: string | null; role: string };

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export function issueSession(res: Response, user: Editor) {
  const claims: Claims = { sub: user.id, email: user.email, name: user.name, role: user.role };
  const token = jwt.sign(claims, SECRET!, { expiresIn: "30d" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function readClaims(req: Request): Claims | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET!) as unknown as Claims;
  } catch {
    return null;
  }
}

/** Identify the caller for read-only purposes; null when signed out. */
export function currentUser(req: Request): Editor | null {
  const claims = readClaims(req);
  if (!claims) return null;
  return { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
}

/**
 * Authorise a write. Two independent conditions must both hold: a valid
 * session, and an "editor" or "admin" role on that session — mirrors the old
 * Netlify Identity check so a stray account with no role still cannot write.
 * "admin" is a superset of "editor", so it passes this check too.
 *
 * Returns the editor, or sends the terminal response itself and returns null.
 * Callers must treat a null return as terminal — never fall through to the
 * mutation.
 */
export function requireEditor(req: Request, res: Response): Editor | null {
  const claims = readClaims(req);
  if (!claims) {
    res.status(401).json({ error: "Please sign in." });
    return null;
  }
  if (claims.role !== "editor" && claims.role !== "admin") {
    res.status(403).json({
      error: "Your account does not have edit access. Ask an admin to grant a role.",
    });
    return null;
  }
  return { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
}

/** Authorise user/invite management. Stricter than requireEditor: admin only. */
export function requireAdmin(req: Request, res: Response): Editor | null {
  const claims = readClaims(req);
  if (!claims) {
    res.status(401).json({ error: "Please sign in." });
    return null;
  }
  if (claims.role !== "admin") {
    res.status(403).json({ error: "Only an admin can manage users and invitations." });
    return null;
  }
  return { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
}
