import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/session";
import {
  getUserTracks,
  saveUserFileTrack,
  saveUserUrlTrack,
  setUserTrackVisibility,
  updateUserTrack,
  deleteUserTrack,
  getVisibleUserTracksWithPoints,
  getUserTrackPoints,
} from "@/lib/gpxStorage";

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    const userId = ctx?.user?.id || (ctx?.mode === "apikey" ? "default" : undefined);

    const { searchParams } = new URL(req.url);
    const includePoints = searchParams.get("includePoints") === "true";
    const visibleOnly = searchParams.get("visibleOnly") === "true";
    const trackId = searchParams.get("id");

    if (trackId) {
      const points = await getUserTrackPoints(userId, trackId);
      return NextResponse.json({ points });
    }

    if (includePoints && visibleOnly) {
      const tracksWithPoints = await getVisibleUserTracksWithPoints(userId);
      return NextResponse.json({ tracks: tracksWithPoints });
    }

    const tracks = await getUserTracks(userId);
    return NextResponse.json({ tracks });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load GPX tracks";
    console.error("GPX GET error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = ctx.user?.id || (ctx.mode === "apikey" ? "default" : undefined);

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ error: "No GPX file uploaded" }, { status: 400 });
      }

      const filename = file instanceof File ? file.name : "track.gpx";
      const rawText = await file.text();

      const track = await saveUserFileTrack(userId, filename, rawText);
      return NextResponse.json({ success: true, track });
    } else {
      const body = await req.json();

      if (body.url) {
        // Add track via URL (server-side downloaded, link persisted in Docker volume)
        const track = await saveUserUrlTrack(userId, body.url, body.name);
        return NextResponse.json({ success: true, track });
      } else if (body.content && body.filename) {
        // Raw content upload via JSON
        const track = await saveUserFileTrack(userId, body.filename, body.content);
        return NextResponse.json({ success: true, track });
      } else {
        return NextResponse.json(
          { error: "Provide either a GPX file upload, a URL, or raw GPX content" },
          { status: 400 }
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to save GPX track";
    console.error("GPX POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
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
    const { id, isVisible, name, timeOffsetMs, startTime, endTime } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Track ID is required" }, { status: 400 });
    }

    const updates: {
      isVisible?: boolean;
      name?: string;
      timeOffsetMs?: number;
      startTime?: string;
      endTime?: string;
    } = {};

    if (typeof isVisible === "boolean") updates.isVisible = isVisible;
    if (typeof name === "string") updates.name = name;
    if (typeof timeOffsetMs === "number") updates.timeOffsetMs = timeOffsetMs;
    if (typeof startTime === "string") updates.startTime = startTime;
    if (typeof endTime === "string") updates.endTime = endTime;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid update operation provided" }, { status: 400 });
    }

    const tracks = await updateUserTrack(userId, id, updates);
    return NextResponse.json({ success: true, tracks });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update GPX track";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = ctx.user?.id || (ctx.mode === "apikey" ? "default" : undefined);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id parameter is required" }, { status: 400 });
    }

    const tracks = await deleteUserTrack(userId, id);
    return NextResponse.json({ success: true, tracks });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete GPX track";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
