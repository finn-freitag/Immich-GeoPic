import { NextRequest, NextResponse } from "next/server";
import { searchAssets } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";
import { ImageItem } from "@/types/ImageItem";
import { getClearedLocations } from "@/lib/clearedStorage";

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const isAll = searchParams.get("all") === "true";
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;

    if (!isAll) {
      if (startDateParam || endDateParam) {
        startDate = startDateParam || undefined;
        endDate = endDateParam || undefined;
      } else if (startDateParam === null && endDateParam === null) {
        // Default to past 6 months only if completely unspecified
        const now = new Date();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(now.getMonth() - 6);
        startDate = sixMonthsAgo.toISOString();
        endDate = now.toISOString();
      }
    }

    const { items, total } = await searchAssets(ctx.auth, {
      startDate,
      endDate,
      size: 1000,
    });

    const clearedSet = await getClearedLocations(ctx.user?.id);

    const images: ImageItem[] = items.map((asset) => {
      const timestamp =
        asset.exifInfo?.dateTimeOriginal ||
        asset.dateTimeOriginal ||
        asset.fileCreatedAt ||
        new Date().toISOString();

      let coords: { lat: number; lng: number } | undefined;
      const isCleared = clearedSet.has(asset.id);
      if (!isCleared) {
        const lat = asset.exifInfo?.latitude;
        const lng = asset.exifInfo?.longitude;
        if (lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
          coords = { lat: Number(lat), lng: Number(lng) };
        }
      }

      const make = asset.exifInfo?.make?.trim() || "";
      const model = asset.exifInfo?.model?.trim() || "";
      let camera = "";
      if (make && model) {
        if (model.toLowerCase().includes(make.toLowerCase())) {
          camera = model;
        } else {
          camera = `${make} ${model}`;
        }
      } else {
        camera = model || make || "";
      }

      return {
        id: asset.id,
        name: asset.originalFileName || "Untitled",
        timestamp,
        coords,
        city: isCleared ? undefined : (asset.exifInfo?.city || undefined),
        country: isCleared ? undefined : (asset.exifInfo?.country || undefined),
        thumbUrl: `/api/images/${asset.id}/thumbnail`,
        timeZone: asset.exifInfo?.timeZone || undefined,
        localDateTime: asset.localDateTime || asset.exifInfo?.dateTimeOriginal || undefined,
        camera: camera || undefined,
        cameraMake: make || undefined,
        cameraModel: model || undefined,
      };
    });

    return NextResponse.json({
      success: true,
      images,
      total,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load images";
    console.error("Images API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
