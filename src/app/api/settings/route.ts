import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/session";
import { getAppSettings, updateAppSettings } from "@/lib/settings";

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    const userId = ctx?.user?.id || (ctx?.mode === "apikey" ? "default" : undefined);
    const settings = await getAppSettings(userId);
    return NextResponse.json({ success: true, settings });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load settings";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = ctx.user?.id || (ctx.mode === "apikey" ? "default" : undefined);

    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
    }

    const updated = await updateAppSettings(userId, body);
    return NextResponse.json({ success: true, settings: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update settings";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
