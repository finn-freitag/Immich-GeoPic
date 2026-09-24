import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/session";
import { getGroupById } from "@/lib/groupStorage";
import { updateAssetLocation } from "@/lib/immich";
import {
  assignPhotosToInternalGpx,
  removePhotosFromInternalGpx,
  InternalGpxEntry,
} from "@/lib/internalGpx";
import { AssignToGroupRequest, AssignToGroupResponse } from "@/types/VirtualGroup";
import { addClearedLocation, removeClearedLocation } from "@/lib/clearedStorage";

/**
 * Returns a random geographic point uniformly distributed inside a circle of radius meters.
 */
function getRandomPointInCircle(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): { lat: number; lng: number } {
  if (radiusMeters <= 0) {
    return { lat: centerLat, lng: centerLng };
  }

  // Uniform sampling over disk: r = R * sqrt(u), theta = 2 * PI * v
  const r = radiusMeters * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;

  const latRad = (centerLat * Math.PI) / 180;
  const metersPerLat = 111320;
  const metersPerLng = Math.max(1, 111320 * Math.cos(latRad));

  const deltaLat = (r * Math.cos(theta)) / metersPerLat;
  const deltaLng = (r * Math.sin(theta)) / metersPerLng;

  let lat = centerLat + deltaLat;
  let lng = centerLng + deltaLng;

  // Clamp latitude to [-90, 90] and wrap longitude to [-180, 180]
  lat = Math.max(-90, Math.min(90, lat));
  lng = ((lng + 180) % 360 + 360) % 360 - 180;

  return { lat, lng };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = ctx.user?.id || (ctx.mode === "apikey" ? "default" : undefined);

    const body: AssignToGroupRequest = await req.json();
    const { groupId, photos, applyTo } = body;

    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }
    if (!Array.isArray(photos) || photos.length === 0) {
      return NextResponse.json({ error: "photos array is required" }, { status: 400 });
    }

    const group = await getGroupById(groupId, userId);
    if (!group) {
      return NextResponse.json({ error: `Group with id "${groupId}" not found` }, { status: 404 });
    }

    // Filter photos based on applyTo option
    const targetPhotos =
      applyTo === "estimatedOnly"
        ? photos.filter((p) => !p.hasCoords)
        : photos;

    if (targetPhotos.length === 0) {
      const emptyResponse: AssignToGroupResponse = {
        success: true,
        directFix: group.directFix,
        updatedPhotos: [],
      };
      return NextResponse.json(emptyResponse);
    }

    const photoIds = targetPhotos.map((p) => p.id);

    if (group.directFix) {
      // 1. DIRECT FIX: Save coordinates directly to Immich for each photo
      const updatedPhotos: AssignToGroupResponse["updatedPhotos"] = [];

      // Concurrently update Immich in batches
      const batchSize = 5;
      for (let i = 0; i < targetPhotos.length; i += batchSize) {
        const batch = targetPhotos.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (photo) => {
            const coords = getRandomPointInCircle(group.lat, group.lng, group.radius);
            try {
              await updateAssetLocation(ctx.auth, photo.id, coords);
              updatedPhotos.push({
                id: photo.id,
                coords,
              });
            } catch (err) {
              console.error(`[AssignGroup] Failed to update location for ${photo.id}:`, err);
            }
          })
        );
      }

      // Remove these photos from internal_estimated.gpx if they were previously there
      await removePhotosFromInternalGpx(userId, photoIds);
      await removeClearedLocation(userId, photoIds);

      const response: AssignToGroupResponse = {
        success: true,
        directFix: true,
        updatedPhotos,
      };
      return NextResponse.json(response);
    } else {
      // 2. ESTIMATED POSITION: Align via internal GPX track
      // If any photo already has GPS coordinates in Immich, clear them in GeoPic
      const photosWithCoords = targetPhotos.filter((p) => p.hasCoords);
      if (photosWithCoords.length > 0) {
        await addClearedLocation(userId, photosWithCoords.map((p) => p.id));
      }

      // Generate entries for internal GPX
      const gpxEntries: InternalGpxEntry[] = [];
      const updatedPhotos: AssignToGroupResponse["updatedPhotos"] = [];

      for (const photo of targetPhotos) {
        const coords = getRandomPointInCircle(group.lat, group.lng, group.radius);
        gpxEntries.push({
          photoId: photo.id,
          timestamp: photo.timestamp,
          lat: coords.lat,
          lng: coords.lng,
          groupId: group.id,
          groupName: group.name,
        });
        updatedPhotos.push({
          id: photo.id,
          coords: null,
          estCoords: coords,
        });
      }

      // Add to internal GPX track
      await assignPhotosToInternalGpx(userId, gpxEntries);

      const response: AssignToGroupResponse = {
        success: true,
        directFix: false,
        updatedPhotos,
      };
      return NextResponse.json(response);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to assign photos to group";
    console.error("Groups Assign error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
