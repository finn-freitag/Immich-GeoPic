import { GpxBounds, GpxPoint } from "@/types/GpxTrack";

/**
 * Robustly parse GPX timestamp strings into UTC millisecond epochs.
 * Supports:
 * - 2026-06-06T13:44:53Z / 2026-06-06T13:44:53.000Z
 * - 2026-06-06T15:44:53+02:00 / 2026-06-06T15:44:53+0200 / +02
 * - 2026-06-06T15:44:53-05:00 / 2026-06-06T15:44:53-0500
 * - 2026-06-06 13:44:53 (spaces instead of T)
 * - Timestamps with or without fractional seconds
 */
export function parseGpxTime(rawTime: string): number {
  if (!rawTime) return 0;
  const trimmed = rawTime.trim();
  if (!trimmed) return 0;

  // Replace space between date and time with 'T' if present
  let normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/, "$1T$2");

  // Fix timezone offset without colon, e.g. +0200 -> +02:00
  normalized = normalized.replace(/([+-])(\d{2})(\d{2})$/, "$1$2:$3");
  // Fix timezone offset with only hour, e.g. +02 -> +02:00
  normalized = normalized.replace(/([+-])(\d{2})$/, "$1$2:00");

  // Only use Date.parse directly if string contains an explicit UTC 'Z' or offset indicator.
  // Otherwise, strings like "2024-06-06T13:44:53" would be parsed by Date.parse in the
  // local browser timezone instead of the GPX-mandated UTC standard!
  if (/([Zz]|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    const parsed = Date.parse(normalized);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Fallback explicit regex parsing for non-standard formats
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:(Z)|([+-])(\d{2}):?(\d{2})?)?$/i
  );
  if (!match) {
    return 0;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);
  const msStr = match[7] ? match[7].padEnd(3, "0").slice(0, 3) : "0";
  const millisecond = parseInt(msStr, 10);

  const utcMs = Date.UTC(year, month, day, hour, minute, second, millisecond);

  const isUtc = !!match[8];
  const tzSign = match[9];
  const tzHour = match[10] ? parseInt(match[10], 10) : 0;
  const tzMin = match[11] ? parseInt(match[11], 10) : 0;

  if (isUtc) {
    return utcMs;
  } else if (tzSign) {
    const offsetMs = (tzHour * 60 + tzMin) * 60 * 1000;
    return tzSign === "+" ? utcMs - offsetMs : utcMs + offsetMs;
  }

  // If no timezone is specified at all, assume UTC for GPS trackpoints
  return utcMs;
}

export interface ParsedGpxData {
  name: string;
  points: GpxPoint[];
  pointsCount: number;
  bounds?: GpxBounds;
  startTime?: string;
  endTime?: string;
}

/**
 * Parses raw GPX XML string into structured track metadata and points.
 * Handles <trkpt>, <rtept>, and <wpt> elements.
 */
export function parseGpxXml(gpxXml: string, defaultName = "Unnamed Track"): ParsedGpxData {
  if (!gpxXml || typeof gpxXml !== "string") {
    throw new Error("Invalid GPX data: content is empty or not a string");
  }

  // Extract track name: try <trk><name> first, then top-level <name>
  let name = defaultName;
  const trkNameMatch = gpxXml.match(/<trk>[\s\S]*?<name>([\s\S]*?)<\/name>/i);
  if (trkNameMatch && trkNameMatch[1].trim()) {
    name = trkNameMatch[1].trim().replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1");
  } else {
    const topNameMatch = gpxXml.match(/<name>([\s\S]*?)<\/name>/i);
    if (topNameMatch && topNameMatch[1].trim()) {
      name = topNameMatch[1].trim().replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1");
    }
  }

  // Fast regex matching for point tags: trkpt, rtept, or wpt
  // Handles attributes in any order: lat="..." lon="..." or lon="..." lat="..."
  const pointRegex = /<(?:trkpt|rtept|wpt)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept|wpt)>/gi;
  const points: GpxPoint[] = [];

  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;

  let match: RegExpExecArray | null;
  while ((match = pointRegex.exec(gpxXml)) !== null) {
    const attrs = match[1];
    const body = match[2];

    const latMatch = attrs.match(/lat=["']([0-9.-]+)["']/i);
    const lonMatch = attrs.match(/lon(?:g)?=["']([0-9.-]+)["']/i);

    if (!latMatch || !lonMatch) continue;

    const lat = parseFloat(latMatch[1]);
    const lng = parseFloat(lonMatch[1]);

    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const timeMatch = body.match(/<time>([\s\S]*?)<\/time>/i);
    if (!timeMatch) continue;

    const timeMs = parseGpxTime(timeMatch[1]);
    if (timeMs <= 0) continue;

    let ele: number | undefined;
    const eleMatch = body.match(/<ele>([\s\S]*?)<\/ele>/i);
    if (eleMatch) {
      const parsedEle = parseFloat(eleMatch[1]);
      if (!Number.isNaN(parsedEle)) {
        ele = parsedEle;
      }
    }

    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;

    points.push({
      lat,
      lng,
      time: timeMs,
      ele,
    });
  }

  if (points.length === 0) {
    throw new Error("No valid trackpoints with timestamps found in the GPX file");
  }

  // Ensure points are sorted chronologically
  points.sort((a, b) => a.time - b.time);

  const startTime = new Date(points[0].time).toISOString();
  const endTime = new Date(points[points.length - 1].time).toISOString();

  const bounds: GpxBounds = {
    minLat,
    maxLat,
    minLng,
    maxLng,
  };

  return {
    name,
    points,
    pointsCount: points.length,
    bounds,
    startTime,
    endTime,
  };
}
