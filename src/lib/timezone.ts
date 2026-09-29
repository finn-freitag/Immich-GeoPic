import tzlookup from "@photostructure/tz-lookup";
import { parseGpxTime } from "./gpx";
import { AppSettings, DEFAULT_APP_SETTINGS } from "@/types/AppSettings";

const dtfCache = new Map<string, Intl.DateTimeFormat | null>();

export function getCachedDateTimeFormat(
  locale: string | undefined,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat | null {
  const loc = locale || "default";
  const key = `${loc}_${timeZone}_${options ? JSON.stringify(options) : ""}`;
  if (dtfCache.has(key)) {
    return dtfCache.get(key)!;
  }
  try {
    const fmt = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    dtfCache.set(key, fmt);
    return fmt;
  } catch {
    dtfCache.set(key, null);
    return null;
  }
}

const tzCache = new Map<string, string | null>();

/**
 * Returns the IANA timezone string for a given coordinate pair (lat, lng).
 * Example: (50.9693, 8.9672) -> "Europe/Berlin"
 */
export function getTimezoneForCoords(lat: number, lng: number): string | null {
  try {
    if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
      return null;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    // Quantize coordinates to 3 decimals (~110m) for fast cache lookups
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (tzCache.has(key)) {
      return tzCache.get(key)!;
    }
    const result = tzlookup(lat, lng);
    tzCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Parses numeric offset string like "+01:00", "+02", or "-05:00" into milliseconds.
 * Returns null if not a simple offset string (e.g. for IANA names like "Europe/Berlin").
 */
export function parseOffsetMs(tzStr: string | null | undefined): number | null {
  if (!tzStr) return null;
  const m = tzStr.trim().match(/^([+-])(\d{2}):?(\d{2})?$/);
  if (!m) return null;
  const sign = m[1] === "+" ? 1 : -1;
  const h = parseInt(m[2], 10);
  const min = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (h * 60 + min) * 60 * 1000;
}

/**
 * Returns the offset in milliseconds between UTC and local time for a given instant in an IANA timezone.
 */
export function getTimezoneOffsetForInstant(instantMs: number, timeZone: string): number {
  try {
    const formatter = getCachedDateTimeFormat("en-US", timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    if (!formatter) return 0;
    const parts = formatter.formatToParts(new Date(instantMs));
    const p: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        p[part.type] = parseInt(part.value, 10);
      }
    }
    const hr = p.hour === 24 ? 0 : p.hour || 0;
    const tzAsUtc = Date.UTC(p.year, (p.month || 1) - 1, p.day || 1, hr, p.minute || 0, p.second || 0);
    return tzAsUtc - Math.floor(instantMs / 1000) * 1000;
  } catch {
    return 0;
  }
}

const yearDstCache = new Map<string, { standardOffset: number; daylightOffset: number; hasDst: boolean }>();

/**
 * Evaluates whether Daylight Saving Time (DST) is active at a given instant in an IANA timezone,
 * and returns the standard and daylight offset amounts.
 */
export function getDstInfo(instantMs: number, timeZone: string) {
  const d = new Date(instantMs);
  const y = d.getUTCFullYear();
  const yearKey = `${y}_${timeZone}`;
  let yearInfo = yearDstCache.get(yearKey);
  if (!yearInfo) {
    const offsetJan = getTimezoneOffsetForInstant(Date.UTC(y, 0, 15, 12, 0, 0), timeZone);
    const offsetJul = getTimezoneOffsetForInstant(Date.UTC(y, 6, 15, 12, 0, 0), timeZone);
    const standardOffset = Math.min(offsetJan, offsetJul);
    const daylightOffset = Math.max(offsetJan, offsetJul);
    const hasDst = standardOffset !== daylightOffset;
    yearInfo = { standardOffset, daylightOffset, hasDst };
    yearDstCache.set(yearKey, yearInfo);
  }
  const offsetNow = getTimezoneOffsetForInstant(instantMs, timeZone);
  const isDstActive = yearInfo.hasDst && offsetNow === yearInfo.daylightOffset;
  return { offsetNow, ...yearInfo, isDstActive };
}

/**
 * Converts a local wall-clock date-time string (e.g. "2026-06-06 15:44:53" or "2026-06-06T15:44:53")
 * within a specific IANA timezone (e.g. "Europe/Berlin") to true UTC epoch milliseconds.
 */
export function parseLocalDateInTzToUtcMs(localDateTimeStr: string, timeZone: string): number {
  if (!localDateTimeStr) return 0;
  const trimmed = localDateTimeStr.trim();

  // Check if string already contains an explicit offset like +02:00 or -05:00
  if (/[+-]\d{2}:?\d{2}$/i.test(trimmed)) {
    return parseGpxTime(trimmed);
  }

  // Match YYYY-MM-DD HH:MM:SS or YYYY:MM:DD HH:MM:SS (EXIF format)
  const match = trimmed.match(/^(\d{4})[-:/](\d{2})[-:/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!match) {
    return Date.parse(trimmed) || 0;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);
  const msStr = match[7] ? match[7].padEnd(3, "0").slice(0, 3) : "0";
  const millisecond = parseInt(msStr, 10);

  const guessUtc = Date.UTC(year, month, day, hour, minute, second, millisecond);

  // Handle offset strings directly like "+02:00" or "-05:00"
  if (timeZone.startsWith("+") || timeZone.startsWith("-")) {
    const rawDigits = localDateTimeStr.replace(/[Zz]$/, "").replace(/[+-]\d{2}:?\d{2}$/, "");
    return parseGpxTime(`${rawDigits}${timeZone}`);
  }

  const formatter = getCachedDateTimeFormat("en-US", timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  if (!formatter) {
    // If timezone is invalid, fallback to UTC or standard parse
    return guessUtc;
  }

  const getTzInstant = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const p: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        p[part.type] = parseInt(part.value, 10);
      }
    }
    const hr = p.hour === 24 ? 0 : p.hour || 0;
    return Date.UTC(p.year, (p.month || 1) - 1, p.day || 1, hr, p.minute || 0, p.second || 0, millisecond);
  };

  const local1 = getTzInstant(guessUtc);
  const offset1 = local1 - guessUtc;
  const candidateUtc = guessUtc - offset1;

  // Refine for Daylight Saving Time boundaries
  const local2 = getTzInstant(candidateUtc);
  const offset2 = local2 - candidateUtc;
  return guessUtc - offset2;
}

export interface PhotoTimeParams {
  timestamp: string;
  coords?: { lat: number; lng: number };
  timeZone?: string | null;
  localDateTime?: string | null;
}

/**
 * Resolves the true UTC epoch milliseconds for a photo.
 * Fully DST-aware and configurable via AppSettings.
 */
export function resolvePhotoTimeMs(
  photo: PhotoTimeParams,
  fallbackTimezone?: string | null,
  settings?: Partial<AppSettings>
): number {
  if (!photo.timestamp) return 0;
  const cfg = { ...DEFAULT_APP_SETTINGS, ...settings };
  const trimmed = photo.timestamp.trim();
  const rawLocal = photo.localDateTime || photo.timestamp;

  // Determine the best candidate IANA timezone for the photo location:
  // 1. Photo's own GPS coordinates
  let candidateIanaTz: string | null = null;
  if (photo.coords && typeof photo.coords.lat === "number" && typeof photo.coords.lng === "number") {
    candidateIanaTz = getTimezoneForCoords(photo.coords.lat, photo.coords.lng);
  }
  // 2. Fallback timezone from active GPX track or nearby geotagged photos
  if (!candidateIanaTz && fallbackTimezone) {
    candidateIanaTz = fallbackTimezone;
  }
  // 3. User default fallback timezone from settings
  if (!candidateIanaTz && cfg.fallbackTimezone) {
    candidateIanaTz = cfg.fallbackTimezone;
  }

  // 1. Check for explicit offset directly in timestamp string (e.g. +02:00, -05:00)
  const hasStringOffset = /[+-]\d{2}:?\d{2}$/.test(trimmed);

  // 2. DST Mismatch Auto-Detection
  // Many cameras shoot at local summer time, but lack DST toggles and write standard-time offset (e.g. +01:00).
  if (cfg.autoDetectDstMismatch && candidateIanaTz) {
    // Parse approximate instant from raw local date to evaluate DST status
    const approxMs = Date.parse(trimmed) || Date.now();
    const dstInfo = getDstInfo(approxMs, candidateIanaTz);

    if (dstInfo.isDstActive) {
      const photoOffsetMs = parseOffsetMs(photo.timeZone);

      // Condition for camera DST omission:
      // a) photo has a static offset that equals standard winter offset (e.g. +01:00 instead of +02:00)
      // b) or photo has no timezone metadata or ended with Z from Immich which used standard offset
      const isOffsetMismatch =
        photoOffsetMs !== null && photoOffsetMs === dstInfo.standardOffset;

      const shouldFixDst =
        isOffsetMismatch ||
        (!photo.timeZone && (!photo.coords || cfg.preferGpxTimezone)) ||
        (cfg.preferGpxTimezone && photoOffsetMs !== null && photoOffsetMs !== dstInfo.offsetNow);

      if (shouldFixDst) {
        return parseLocalDateInTzToUtcMs(rawLocal, candidateIanaTz);
      }
    }
  }

  // 3. Explicit offset in timestamp string itself
  if (hasStringOffset) {
    return parseGpxTime(trimmed);
  }

  // 4. Explicit timezone specified in metadata (newer EXIF)
  if (photo.timeZone && photo.timeZone.trim()) {
    const tz = photo.timeZone.trim();
    if (!cfg.preferGpxTimezone || !candidateIanaTz) {
      if (trimmed.endsWith("Z") || trimmed.endsWith("z")) {
        const t = Date.parse(trimmed);
        if (!Number.isNaN(t)) return t;
      }
      return parseLocalDateInTzToUtcMs(rawLocal, tz);
    }
  }

  // 5. Candidate IANA timezone from coordinates or GPX track
  if (candidateIanaTz) {
    return parseLocalDateInTzToUtcMs(rawLocal, candidateIanaTz);
  }

  // 6. Fallback standard parse
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export interface PhotoDisplayTimeParams {
  timestamp: string;
  localDateTime?: string | null;
  timeZone?: string | null;
  coords?: { lat: number; lng: number } | null;
  estCoords?: { lat: number; lng: number } | null;
  resolvedTime?: number | null;
}

/**
 * Formats a photo's capture date and time for display in the UI.
 *
 * Rules:
 * 1. The photo must always display in the local capture time (wall-clock time)
 *    where the photo was taken (e.g. 08:20 if taken at 08:20), matching what
 *    the camera and Immich UI display.
 * 2. If the photo has a naive localDateTime string (e.g. "2026-06-26 08:20:16"
 *    or "2026-06-26T08:20:16"), that represents the local wall-clock time directly.
 *    We format these date components without browser timezone shifts.
 * 3. If localDateTime is not available, but the photo has a resolvedTime (or timestamp)
 *    and a known timezone (from coords, EXIF timezone, or fallback/GPX timezone):
 *    Format the UTC instant in that target timezone.
 * 4. Fallback: Parse the timestamp and format using toLocaleString.
 */
export function formatPhotoDisplayDate(
  photo: PhotoDisplayTimeParams,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
  fallbackTimezone?: string | null,
  locale?: string
): string {
  if (!photo) return "";

  // 1. If photo has a localDateTime string, it is the authoritative wall-clock time from EXIF / Immich
  if (photo.localDateTime && typeof photo.localDateTime === "string") {
    const trimmed = photo.localDateTime.trim();
    const match = trimmed.match(/^(\d{4})[-:/](\d{2})[-:/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const hour = parseInt(match[4], 10);
      const minute = parseInt(match[5], 10);
      const second = parseInt(match[6], 10);
      // Construct a Date with local components matching the wall-clock time
      const localDate = new Date(year, month, day, hour, minute, second);
      if (!Number.isNaN(localDate.getTime())) {
        return localDate.toLocaleString(locale, options);
      }
    }
  }

  // 2. If resolvedTime is available and we know the target timezone (coords, exif, or fallback)
  const coords = photo.coords || photo.estCoords;
  let targetTz: string | null = null;
  if (photo.timeZone && !photo.timeZone.startsWith("+") && !photo.timeZone.startsWith("-")) {
    targetTz = photo.timeZone;
  } else if (coords && typeof coords.lat === "number" && typeof coords.lng === "number") {
    targetTz = getTimezoneForCoords(coords.lat, coords.lng);
  } else if (fallbackTimezone) {
    targetTz = fallbackTimezone;
  }

  if (targetTz) {
    const instantMs =
      typeof photo.resolvedTime === "number" && !Number.isNaN(photo.resolvedTime)
        ? photo.resolvedTime
        : Date.parse(photo.timestamp);
    if (!Number.isNaN(instantMs)) {
      const fmt = getCachedDateTimeFormat(locale, targetTz, options);
      if (fmt) {
        return fmt.format(new Date(instantMs));
      }
    }
  }

  // 3. Fallback: Parse timestamp directly
  if (photo.timestamp) {
    const d = new Date(photo.timestamp);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(locale, options);
    }
    return photo.timestamp;
  }

  return "";
}
