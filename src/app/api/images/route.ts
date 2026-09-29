import { NextRequest, NextResponse } from "next/server";
import { searchAssets, ImmichAsset } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";
import { ImageItem } from "@/types/ImageItem";
import { getClearedLocations } from "@/lib/clearedStorage";
import { getTimezoneForCoords, getCachedDateTimeFormat } from "@/lib/timezone";

function getAssetLocalDateString(asset: ImmichAsset): string | null {
  // 1. Authoritative wall-clock time string from Immich / EXIF
  const local = asset.localDateTime || asset.exifInfo?.dateTimeOriginal;
  if (local && typeof local === "string") {
    const match = local.trim().match(/^(\d{4})[-:/](\d{2})[-:/](\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }

  // 2. dateTimeOriginal or fileCreatedAt
  const raw = asset.dateTimeOriginal || asset.fileCreatedAt;
  if (!raw || typeof raw !== "string") return null;

  const match = raw.trim().match(/^(\d{4})[-:/](\d{2})[-:/](\d{2})/);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  }

  // Check if we can determine timezone
  let tz = asset.exifInfo?.timeZone;
  if (!tz && asset.exifInfo?.latitude != null && asset.exifInfo?.longitude != null) {
    tz = getTimezoneForCoords(Number(asset.exifInfo.latitude), Number(asset.exifInfo.longitude)) || undefined;
  }

  if (tz && !tz.startsWith("+") && !tz.startsWith("-")) {
    const fmt = getCachedDateTimeFormat("en-CA", tz, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (fmt) {
      try {
        return fmt.format(d);
      } catch {
        // Fallback below
      }
    }
  }

  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return d.toISOString().split("T")[0];
}

function isAssetInDateRange(
  asset: ImmichAsset,
  startDate?: string,
  endDate?: string
): boolean {
  if (!startDate && !endDate) return true;
  const photoDate = getAssetLocalDateString(asset);
  if (!photoDate) return false;

  if (startDate && photoDate < startDate) return false;
  if (endDate && photoDate > endDate) return false;
  return true;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const isAll = searchParams.get("all") === "true";
    const startDateParam = searchParams.get("startDate")?.trim();
    const endDateParam = searchParams.get("endDate")?.trim();

    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;

    if (!isAll) {
      if (startDateParam || endDateParam) {
        startDate = startDateParam || endDateParam;
        endDate = endDateParam || startDateParam;
        if (startDate && endDate && startDate > endDate) {
          const temp = startDate;
          startDate = endDate;
          endDate = temp;
        }
      } else {
        // Default to past 6 months only if completely unspecified
        const now = new Date();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(now.getMonth() - 6);
        const yStart = sixMonthsAgo.getFullYear();
        const mStart = String(sixMonthsAgo.getMonth() + 1).padStart(2, "0");
        const dStart = String(sixMonthsAgo.getDate()).padStart(2, "0");
        startDate = `${yStart}-${mStart}-${dStart}`;

        const yEnd = now.getFullYear();
        const mEnd = String(now.getMonth() + 1).padStart(2, "0");
        const dEnd = String(now.getDate()).padStart(2, "0");
        endDate = `${yEnd}-${mEnd}-${dEnd}`;
      }
    }

    const { items, total } = await searchAssets(ctx.auth, {
      startDate,
      endDate,
      size: 1000,
    });

    const filteredItems = isAll
      ? items
      : items.filter((asset) => isAssetInDateRange(asset, startDate, endDate));

    const clearedSet = await getClearedLocations(ctx.user?.id);

    const images: ImageItem[] = filteredItems.map((asset) => {
      const timestamp =
        asset.exifInfo?.dateTimeOriginal ||
        asset.dateTimeOriginal ||
        asset.fileCreatedAt ||
        new Date().toISOString();

      let coords: { lat: number; lng: number } | undefined;
      const isCleared = clearedSet.has(asset.id);
      const rawLat = asset.exifInfo?.latitude;
      const rawLng = asset.exifInfo?.longitude;
      const hasImmichCoords =
        rawLat != null &&
        rawLng != null &&
        !Number.isNaN(Number(rawLat)) &&
        !Number.isNaN(Number(rawLng));

      if (!isCleared && hasImmichCoords) {
        coords = { lat: Number(rawLat), lng: Number(rawLng) };
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
        isCleared: Boolean(isCleared && hasImmichCoords),
        hasImmichCoords: Boolean(hasImmichCoords),
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
      total: isAll ? total : filteredItems.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load images";
    console.error("Images API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
