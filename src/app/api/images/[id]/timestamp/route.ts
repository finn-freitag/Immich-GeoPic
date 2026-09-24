import { NextRequest, NextResponse } from "next/server";
import { updateAssetDateTime } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";
import { updatePhotosTimestampInInternalGpx } from "@/lib/internalGpx";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { timestamp } = body;

    if (!timestamp || typeof timestamp !== "string" || Number.isNaN(new Date(timestamp).getTime())) {
      return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 });
    }

    const isoTimestamp = new Date(timestamp).toISOString();
    await updateAssetDateTime(ctx.auth, id, isoTimestamp);
    await updatePhotosTimestampInInternalGpx(ctx.user?.id, [{ id, timestamp: isoTimestamp }]);

    return NextResponse.json({
      success: true,
      id,
      timestamp: isoTimestamp,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update timestamp";
    console.error("Timestamp update error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
