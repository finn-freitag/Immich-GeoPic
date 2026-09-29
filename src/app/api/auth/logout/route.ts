import { NextRequest, NextResponse } from "next/server";
import { logoutFromImmich } from "@/lib/immich";
import { clearSessionCookie, deleteSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST(req: NextRequest) {
  let sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      sessionId = authHeader.substring(7).trim();
    }
  }

  if (sessionId) {
    const sessionData = deleteSession(sessionId);
    if (sessionData?.immichToken) {
      await logoutFromImmich(sessionData.immichToken, sessionData.immichUrl);
    }
  }

  const res = NextResponse.json({ success: true });
  clearSessionCookie(req, res);
  return res;
}
