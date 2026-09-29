import { NextRequest, NextResponse } from "next/server";
import { getImmichUrl, loginToImmich } from "@/lib/immich";
import { attachSessionCookie, createSession, isApiKeyMode } from "@/lib/session";

export async function GET() {
  return NextResponse.json({
    defaultServerUrl: getImmichUrl(),
    isApiKeyMode: isApiKeyMode(),
  });
}

export async function POST(req: NextRequest) {
  try {
    if (isApiKeyMode()) {
      return NextResponse.json({
        success: true,
        message: "Instance is operating in API key mode; login is not required.",
      });
    }

    const body = await req.json();
    const { email, password, serverUrl } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const { accessToken, user, immichUrl } = await loginToImmich(email, password, serverUrl);
    const sessionId = createSession(accessToken, user, immichUrl);

    console.log(
      `[GeoPic Auth] Login successful for user: ${user.email} (session: ${sessionId.substring(0, 8)}..., url: ${immichUrl})`
    );

    const res = NextResponse.json({
      success: true,
      user,
      token: sessionId,
      immichUrl,
    });

    attachSessionCookie(req, res, sessionId);
    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    console.error("[GeoPic Auth] Login failed:", message);
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
