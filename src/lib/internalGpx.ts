import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getDataDir } from "./settings";
import { GpxTrackWithPoints } from "@/types/GpxTrack";
import { parseGpxXml } from "./gpx";

export interface InternalGpxEntry {
  photoId: string;
  timestamp: string; // ISO 8601
  lat: number;
  lng: number;
  groupId: string;
  groupName: string;
}

function getUserGpxDir(userId?: string): string {
  const userKey = userId || "default";
  return path.join(getDataDir(), "gpx", userKey);
}

export function getInternalGpxFilePath(userId?: string): string {
  return path.join(getUserGpxDir(userId), "internal_estimated.gpx");
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(safe: string): string {
  return safe
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Parses existing internal_estimated.gpx into structured InternalGpxEntry items.
 */
export async function readInternalGpxEntries(userId?: string): Promise<InternalGpxEntry[]> {
  const filePath = getInternalGpxFilePath(userId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const entries: InternalGpxEntry[] = [];

    const pointRegex = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
    let match: RegExpExecArray | null;

    while ((match = pointRegex.exec(raw)) !== null) {
      const attrs = match[1];
      const body = match[2];

      const latMatch = attrs.match(/lat=["']([0-9.-]+)["']/i);
      const lonMatch = attrs.match(/lon(?:g)?=["']([0-9.-]+)["']/i);
      if (!latMatch || !lonMatch) continue;

      const lat = parseFloat(latMatch[1]);
      const lng = parseFloat(lonMatch[1]);

      const timeMatch = body.match(/<time>([\s\S]*?)<\/time>/i);
      if (!timeMatch) continue;
      const timestamp = timeMatch[1].trim();

      const nameMatch = body.match(/<name>([\s\S]*?)<\/name>/i);
      const photoId = nameMatch ? nameMatch[1].trim() : "";
      if (!photoId) continue;

      let groupId = "";
      let groupName = "";

      const cmtMatch = body.match(/<cmt>([\s\S]*?)<\/cmt>/i);
      if (cmtMatch) {
        try {
          const rawCmt = unescapeXml(cmtMatch[1].trim());
          const parsedMeta = JSON.parse(rawCmt);
          groupId = parsedMeta.groupId || "";
          groupName = parsedMeta.groupName || "";
        } catch {
          // ignore
        }
      }

      if (!groupId) {
        const descMatch = body.match(/<desc>([\s\S]*?)<\/desc>/i);
        if (descMatch) {
          const rawDesc = unescapeXml(descMatch[1].trim());
          const parts = rawDesc.split(":");
          if (parts.length >= 3 && parts[0] === "group") {
            groupId = parts[1];
            groupName = parts.slice(2).join(":");
          }
        }
      }

      entries.push({
        photoId,
        timestamp,
        lat,
        lng,
        groupId,
        groupName,
      });
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Serializes entries to GPX 1.1 XML string.
 */
function serializeEntriesToGpx(entries: InternalGpxEntry[]): string {
  // Sort chronologically by timestamp
  const sorted = [...entries].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const trkpts = sorted
    .map((e) => {
      const metaJson = JSON.stringify({
        photoId: e.photoId,
        groupId: e.groupId,
        groupName: e.groupName,
      });
      return `      <trkpt lat="${e.lat.toFixed(7)}" lon="${e.lng.toFixed(7)}">
        <time>${e.timestamp}</time>
        <name>${escapeXml(e.photoId)}</name>
        <cmt>${escapeXml(metaJson)}</cmt>
        <desc>group:${escapeXml(e.groupId)}:${escapeXml(e.groupName)}</desc>
      </trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ImmichGeoPic" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Internal Estimated Positions</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Returns the internal GPX track as a GpxTrackWithPoints object, or null if no points exist.
 */
export async function getInternalGpxTrack(userId?: string): Promise<GpxTrackWithPoints | null> {
  const filePath = getInternalGpxFilePath(userId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = parseGpxXml(raw, "Internal Estimated Positions");
    if (parsed.points.length === 0) return null;

    return {
      id: "internal_estimated",
      userId: userId || "default",
      type: "file",
      name: "Internal Estimated Positions",
      filename: "internal_estimated.gpx",
      createdAt: new Date().toISOString(),
      fileSize: Buffer.byteLength(raw, "utf-8"),
      pointsCount: parsed.pointsCount,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      bounds: parsed.bounds,
      isVisible: true,
      points: parsed.points,
    };
  } catch {
    return null;
  }
}

/**
 * Adds or updates photo entries in internal_estimated.gpx.
 */
export async function assignPhotosToInternalGpx(
  userId: string | undefined,
  newEntries: InternalGpxEntry[]
): Promise<GpxTrackWithPoints | null> {
  const dir = getUserGpxDir(userId);
  await fs.mkdir(dir, { recursive: true });

  const existingEntries = await readInternalGpxEntries(userId);
  const entryMap = new Map<string, InternalGpxEntry>();

  for (const entry of existingEntries) {
    entryMap.set(entry.photoId, entry);
  }

  for (const entry of newEntries) {
    entryMap.set(entry.photoId, entry);
  }

  const allEntries = Array.from(entryMap.values());
  const gpxXml = serializeEntriesToGpx(allEntries);

  const filePath = getInternalGpxFilePath(userId);
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(tempPath, gpxXml, "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (err: unknown) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }

  return getInternalGpxTrack(userId);
}

/**
 * Removes photo entries from internal_estimated.gpx.
 */
export async function removePhotosFromInternalGpx(
  userId: string | undefined,
  photoIds: string[]
): Promise<GpxTrackWithPoints | null> {
  const idsToRemove = new Set(photoIds);
  const existingEntries = await readInternalGpxEntries(userId);
  const remaining = existingEntries.filter((e) => !idsToRemove.has(e.photoId));

  const filePath = getInternalGpxFilePath(userId);

  if (remaining.length === 0) {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
    return null;
  }

  const gpxXml = serializeEntriesToGpx(remaining);
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(tempPath, gpxXml, "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (err: unknown) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }

  return getInternalGpxTrack(userId);
}

/**
 * Updates the timestamps of specific photos in internal_estimated.gpx.
 */
export async function updatePhotosTimestampInInternalGpx(
  userId: string | undefined,
  updates: Array<{ id: string; timestamp: string }>
): Promise<void> {
  if (!updates || updates.length === 0) return;

  const updateMap = new Map<string, string>();
  for (const u of updates) {
    updateMap.set(u.id, u.timestamp);
  }

  const existingEntries = await readInternalGpxEntries(userId);
  let changed = false;
  const updatedEntries = existingEntries.map((e) => {
    if (updateMap.has(e.photoId)) {
      changed = true;
      return { ...e, timestamp: updateMap.get(e.photoId)! };
    }
    return e;
  });

  if (!changed) return;

  const gpxXml = serializeEntriesToGpx(updatedEntries);
  const filePath = getInternalGpxFilePath(userId);
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(tempPath, gpxXml, "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (err: unknown) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }
  }
}

