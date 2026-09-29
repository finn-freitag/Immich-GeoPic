import { NextRequest, NextResponse } from "next/server";
import { ImmichAuth, ImmichUser } from "./immich";
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "geopic_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type ServerSession = {
  id: string;
  immichToken: string;
  user: ImmichUser;
  immichUrl?: string;
  createdAt: number;
  expiresAt: number;
};

// Global session store to persist across Next.js re-evaluations
const globalSessions = globalThis as unknown as {
  _geopic_sessions?: Map<string, ServerSession>;
};

if (!globalSessions._geopic_sessions) {
  globalSessions._geopic_sessions = new Map<string, ServerSession>();
}

const sessionStore = globalSessions._geopic_sessions;

export function isApiKeyMode(): boolean {
  return !!process.env.IMMICH_API_KEY && process.env.IMMICH_API_KEY.trim().length > 0;
}

export function createSession(immichToken: string, user: ImmichUser, immichUrl?: string): string {
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  sessionStore.set(sessionId, {
    id: sessionId,
    immichToken,
    user,
    immichUrl,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });

  return sessionId;
}

export function getSession(sessionId: string): ServerSession | null {
  const session = sessionStore.get(sessionId);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
}

export function deleteSession(sessionId: string): { immichToken: string; immichUrl?: string } | null {
  const session = sessionStore.get(sessionId);
  if (session) {
    sessionStore.delete(sessionId);
    return { immichToken: session.immichToken, immichUrl: session.immichUrl };
  }
  return null;
}

export type AuthContext = {
  auth: ImmichAuth;
  user?: ImmichUser;
  mode: "apikey" | "login";
  sessionId?: string;
};

export async function resolveAuth(req: NextRequest): Promise<AuthContext | null> {
  // Mode 1: Zero-Auth Direct API Key Mode
  if (isApiKeyMode()) {
    return {
      auth: { apiKey: process.env.IMMICH_API_KEY!.trim() },
      mode: "apikey",
    };
  }

  // Mode 2: User Login Mode
  // 1. Try Authorization header (Bearer <sessionId>)
  const authHeader = req.headers.get("authorization");
  let sessionId: string | null = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    sessionId = authHeader.substring(7).trim();
  }

  // 2. Try cookie
  if (!sessionId) {
    sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  }

  // 3. Try query parameter (useful for <img> tags)
  if (!sessionId) {
    sessionId = req.nextUrl.searchParams.get("token") ?? null;
  }

  if (!sessionId) {
    return null;
  }

  const session = getSession(sessionId);
  if (!session) {
    return null;
  }

  return {
    auth: { token: session.immichToken, baseUrl: session.immichUrl },
    user: session.user,
    mode: "login",
    sessionId: session.id,
  };
}

export function attachSessionCookie(req: NextRequest, res: NextResponse, sessionId: string): void {
  const isHttps =
    req.headers.get("x-forwarded-proto") === "https" ||
    req.nextUrl.protocol === "https:" ||
    process.env.COOKIE_SECURE === "true";

  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(req: NextRequest, res: NextResponse): void {
  const isHttps =
    req.headers.get("x-forwarded-proto") === "https" ||
    req.nextUrl.protocol === "https:" ||
    process.env.COOKIE_SECURE === "true";

  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
