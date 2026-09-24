import { NextRequest, NextResponse } from "next/server";
import { updateAssetLocation } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";
import { addClearedLocation, removeClearedLocation } from "@/lib/clearedStorage";
import { removePhotosFromInternalGpx } from "@/lib/internalGpx";

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
    const { coords } = body;

    // Remove coordinates: clear within GeoPic and remove from internal GPX if present
    if (coords === null || coords === undefined) {
      await addClearedLocation(ctx.user?.id, id);
      await removePhotosFromInternalGpx(ctx.user?.id, [id]);
      return NextResponse.json({ success: true });
    }

    if (
      typeof coords.lat !== "number" ||
      typeof coords.lng !== "number" ||
      Number.isNaN(coords.lat) ||
      Number.isNaN(coords.lng)
    ) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    }

    await updateAssetLocation(ctx.auth, id, coords);
    await removeClearedLocation(ctx.user?.id, id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update location";
    console.error("Location update error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
