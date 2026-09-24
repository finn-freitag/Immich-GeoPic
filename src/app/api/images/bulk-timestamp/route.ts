import { NextRequest, NextResponse } from "next/server";
import { bulkUpdateDateTimes } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";
import { updatePhotosTimestampInInternalGpx } from "@/lib/internalGpx";

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

    // Validate and format updates
    const validatedUpdates: Array<{ id: string; dateTimeOriginal: string }> = [];
    const internalGpxUpdates: Array<{ id: string; timestamp: string }> = [];

    for (const u of updates) {
      if (!u.id || !u.timestamp || Number.isNaN(new Date(u.timestamp).getTime())) {
        continue;
      }
      const iso = new Date(u.timestamp).toISOString();
      validatedUpdates.push({ id: u.id, dateTimeOriginal: iso });
      internalGpxUpdates.push({ id: u.id, timestamp: iso });
    }

    if (validatedUpdates.length === 0) {
      return NextResponse.json({ error: "No valid timestamp updates found" }, { status: 400 });
    }

    const result = await bulkUpdateDateTimes(ctx.auth, validatedUpdates);
    if (result.success > 0) {
      await updatePhotosTimestampInInternalGpx(ctx.user?.id, internalGpxUpdates);
    }

    return NextResponse.json({
      success: true,
      updated: result.success,
      failed: result.failed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Bulk timestamp update failed";
    console.error("Bulk timestamp update error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
