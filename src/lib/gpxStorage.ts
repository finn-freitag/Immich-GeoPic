import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getDataDir } from "./settings";
import { GpxPoint, GpxTrackMetadata, GpxTrackWithPoints } from "@/types/GpxTrack";
import { parseGpxXml } from "./gpx";

function getUserGpxDir(userId?: string): string {
  const userKey = userId || "default";
  return path.join(getDataDir(), "gpx", userKey);
}

function getUserTracksFilePath(userId?: string): string {
  return path.join(getUserGpxDir(userId), "tracks.json");
}

function getUserTrackGpxFilePath(userId: string | undefined, trackId: string): string {
  return path.join(getUserGpxDir(userId), `${trackId}.gpx`);
}

/**
 * Reads the list of track metadata for a user.
 */
export async function getUserTracks(userId?: string): Promise<GpxTrackMetadata[]> {
  const filePath = getUserTracksFilePath(userId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Atomically writes the user's tracks metadata to tracks.json.
 */
async function writeUserTracks(userId: string | undefined, tracks: GpxTrackMetadata[]): Promise<void> {
  const dir = getUserGpxDir(userId);
  const filePath = getUserTracksFilePath(userId);
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(tracks, null, 2), "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (err: unknown) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }

    if (err && typeof err === "object" && "code" in err && err.code === "EACCES") {
      console.error(
        `[GeoPic GPX] Permission denied writing to "${dir}". ` +
        `Ensure the Docker volume is writable by user UID 1001.`
      );
      throw new Error(`Permission denied writing to "${dir}". Please ensure the Docker volume is writable.`);
    }

    throw err;
  }
}

/**
 * Saves an uploaded GPX file for the user.
 * Writes the raw file to disk and adds metadata entry to tracks.json.
 */
export async function saveUserFileTrack(
  userId: string | undefined,
  filename: string,
  rawContent: string
): Promise<GpxTrackWithPoints> {
  const dir = getUserGpxDir(userId);
  await fs.mkdir(dir, { recursive: true });

  const defaultName = filename.replace(/\.gpx$/i, "");
  const parsed = parseGpxXml(rawContent, defaultName);

  const trackId = `gpx_${crypto.randomUUID().slice(0, 8)}`;
  const filePath = getUserTrackGpxFilePath(userId, trackId);

  // Write GPX file to user's volume directory
  await fs.writeFile(filePath, rawContent, "utf-8");

  const metadata: GpxTrackMetadata = {
    id: trackId,
    userId: userId || "default",
    type: "file",
    name: parsed.name || defaultName,
    filename,
    createdAt: new Date().toISOString(),
    fileSize: Buffer.byteLength(rawContent, "utf-8"),
    pointsCount: parsed.pointsCount,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    bounds: parsed.bounds,
    isVisible: true,
  };

  const tracks = await getUserTracks(userId);
  tracks.unshift(metadata);
  await writeUserTracks(userId, tracks);

  return {
    ...metadata,
    points: parsed.points,
  };
}

/**
 * Downloads and parses a remote GPX URL server-side.
 */
async function fetchRemoteGpx(url: string, timeoutMs = 12000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/gpx+xml, application/xml, text/xml, */*",
        "User-Agent": "ImmichGeoPic/1.0",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download remote GPX (${res.status} ${res.statusText})`);
    }

    return await res.text();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Download timed out after ${timeoutMs / 1000}s while fetching ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Saves a GPX track via URL.
 * Crucial: Only the URL and metadata are stored in tracks.json; no local .gpx file is saved to disk!
 */
export async function saveUserUrlTrack(
  userId: string | undefined,
  url: string,
  customName?: string
): Promise<GpxTrackWithPoints> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error("GPX URL cannot be empty");
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("URL must use HTTP or HTTPS protocol");
    }
  } catch {
    throw new Error("Invalid GPX URL format");
  }

  // Download server-side to verify and get initial metadata
  const gpxContent = await fetchRemoteGpx(trimmedUrl);
  const fallbackName = customName?.trim() || path.basename(parsedUrl.pathname) || "Remote GPX Track";
  const parsed = parseGpxXml(gpxContent, fallbackName);

  const trackId = `gpx_url_${crypto.randomUUID().slice(0, 8)}`;

  const metadata: GpxTrackMetadata = {
    id: trackId,
    userId: userId || "default",
    type: "url",
    name: customName?.trim() || parsed.name || fallbackName,
    url: trimmedUrl,
    createdAt: new Date().toISOString(),
    pointsCount: parsed.pointsCount,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    bounds: parsed.bounds,
    isVisible: true,
    lastFetchedAt: new Date().toISOString(),
  };

  const tracks = await getUserTracks(userId);
  tracks.unshift(metadata);
  await writeUserTracks(userId, tracks);

  return {
    ...metadata,
    points: parsed.points,
  };
}

/**
 * Toggles or updates visibility for a user's GPX track.
 */
export async function setUserTrackVisibility(
  userId: string | undefined,
  trackId: string,
  isVisible: boolean
): Promise<GpxTrackMetadata[]> {
  return updateUserTrack(userId, trackId, { isVisible });
}

/**
 * Updates properties (name, timeOffsetMs, startTime, endTime, isVisible) for a user's GPX track.
 */
export async function updateUserTrack(
  userId: string | undefined,
  trackId: string,
  updates: {
    name?: string;
    timeOffsetMs?: number;
    startTime?: string;
    endTime?: string;
    isVisible?: boolean;
  }
): Promise<GpxTrackMetadata[]> {
  const tracks = await getUserTracks(userId);
  const track = tracks.find((t) => t.id === trackId);
  if (!track) {
    throw new Error(`GPX track with id "${trackId}" not found`);
  }

  if (typeof updates.name === "string" && updates.name.trim()) {
    track.name = updates.name.trim();
  }
  if (typeof updates.isVisible === "boolean") {
    track.isVisible = updates.isVisible;
  }
  if (typeof updates.timeOffsetMs === "number") {
    track.timeOffsetMs = updates.timeOffsetMs;
  }
  if (typeof updates.startTime === "string") {
    track.startTime = updates.startTime;
  }
  if (typeof updates.endTime === "string") {
    track.endTime = updates.endTime;
  }

  await writeUserTracks(userId, tracks);
  return tracks;
}

/**
 * Deletes a GPX track for a user (deletes file if type === "file").
 */
export async function deleteUserTrack(userId: string | undefined, trackId: string): Promise<GpxTrackMetadata[]> {
  const tracks = await getUserTracks(userId);
  const trackToDelete = tracks.find((t) => t.id === trackId);
  if (!trackToDelete) {
    throw new Error(`GPX track with id "${trackId}" not found`);
  }

  const updatedTracks = tracks.filter((t) => t.id !== trackId);

  // If it was a file-based track, remove the stored GPX file
  if (trackToDelete.type === "file") {
    const filePath = getUserTrackGpxFilePath(userId, trackId);
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore if file already missing
    }
  }

  await writeUserTracks(userId, updatedTracks);
  return updatedTracks;
}

/**
 * Retrieves parsed points for a single track.
 * If type === "url", downloads live from URL server-side.
 * Applies timeOffsetMs if present.
 */
export async function getUserTrackPoints(userId: string | undefined, trackId: string): Promise<GpxPoint[]> {
  const tracks = await getUserTracks(userId);
  const track = tracks.find((t) => t.id === trackId);
  if (!track) {
    throw new Error(`GPX track with id "${trackId}" not found`);
  }

  let points: GpxPoint[] = [];
  if (track.type === "file") {
    const filePath = getUserTrackGpxFilePath(userId, trackId);
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = parseGpxXml(content, track.name);
    points = parsed.points;
  } else if (track.type === "url" && track.url) {
    const content = await fetchRemoteGpx(track.url);
    const parsed = parseGpxXml(content, track.name);
    points = parsed.points;
  }

  if (track.timeOffsetMs) {
    points = points.map((p) => ({ ...p, time: p.time + track.timeOffsetMs! }));
  }

  return points;
}

import { getInternalGpxTrack } from "./internalGpx";

/**
 * Returns all visible tracks for the user with their parsed points.
 * For URL tracks, downloads fresh from remote URL server-side on every call (providing live updates).
 * Also appends internal_estimated.gpx (with isInternal: true) for photo position estimation.
 */
export async function getVisibleUserTracksWithPoints(userId?: string): Promise<GpxTrackWithPoints[]> {
  const tracks = await getUserTracks(userId);
  const visibleTracks = tracks.filter((t) => t.isVisible);

  const results: GpxTrackWithPoints[] = [];
  let tracksUpdated = false;

  for (const track of visibleTracks) {
    if (track.type === "file") {
      try {
        const filePath = getUserTrackGpxFilePath(userId, track.id);
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = parseGpxXml(content, track.name);
        let points = parsed.points;
        if (track.timeOffsetMs) {
          points = points.map((p) => ({ ...p, time: p.time + track.timeOffsetMs! }));
        }
        results.push({
          ...track,
          points,
        });
      } catch (err) {
        console.error(`[GeoPic GPX] Failed to read local GPX track ${track.id}:`, err);
      }
    } else if (track.type === "url" && track.url) {
      try {
        // Download fresh from URL server-side
        const content = await fetchRemoteGpx(track.url);
        const parsed = parseGpxXml(content, track.name);
        let points = parsed.points;
        const offset = track.timeOffsetMs || 0;
        if (offset) {
          points = points.map((p) => ({ ...p, time: p.time + offset }));
        }

        track.pointsCount = parsed.pointsCount;
        track.bounds = parsed.bounds;
        track.startTime = parsed.startTime
          ? new Date(new Date(parsed.startTime).getTime() + offset).toISOString()
          : undefined;
        track.endTime = parsed.endTime
          ? new Date(new Date(parsed.endTime).getTime() + offset).toISOString()
          : undefined;
        track.lastFetchedAt = new Date().toISOString();
        track.fetchError = undefined;
        tracksUpdated = true;

        results.push({
          ...track,
          points,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[GeoPic GPX] Failed to download live GPX URL for ${track.name} (${track.url}): ${msg}`);
        track.fetchError = msg;
        tracksUpdated = true;
      }
    }
  }

  if (tracksUpdated) {
    // Persist updated metadata in background without blocking
    writeUserTracks(userId, tracks).catch((e) =>
      console.error("[GeoPic GPX] Error updating URL track metadata:", e)
    );
  }

  // Load hidden internal estimated GPX track for automatic photo alignment
  try {
    const internalTrack = await getInternalGpxTrack(userId);
    if (internalTrack && internalTrack.points.length > 0) {
      internalTrack.isInternal = true;
      results.push(internalTrack);
    }
  } catch (err) {
    console.error("[GeoPic GPX] Failed to read internal estimated GPX:", err);
  }

  return results;
}

