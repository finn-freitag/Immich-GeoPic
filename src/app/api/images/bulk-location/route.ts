import { NextRequest, NextResponse } from "next/server";
import { bulkUpdateLocations } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";
import { removeClearedLocation } from "@/lib/clearedStorage";

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { updates } = body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const result = await bulkUpdateLocations(ctx.auth, updates);
    const updatedIds = updates.map((u: { id: string }) => u.id).filter(Boolean);
    if (updatedIds.length > 0) {
      await removeClearedLocation(ctx.user?.id, updatedIds);
    }

    return NextResponse.json({
      success: true,
      updated: result.success,
      failed: result.failed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Bulk update failed";
    console.error("Bulk update error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
