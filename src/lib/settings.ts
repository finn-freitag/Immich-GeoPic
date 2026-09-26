import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { BaseMap, BaseMapPreset, DEFAULT_BASEMAP, BASEMAP_PRESETS } from "@/types/BaseMap";

import { AppSettings, DEFAULT_APP_SETTINGS } from "@/types/AppSettings";

export { DEFAULT_BASEMAP, BASEMAP_PRESETS };

interface UserSettingEntry {
  selectedBaseMapId?: string;
  appSettings?: Partial<AppSettings>;
}

interface SettingsData {
  baseMaps: BaseMap[];
  userSettings: Record<string, UserSettingEntry>;
  defaultSelectedBaseMapId: string;
  defaultAppSettings?: Partial<AppSettings>;
}

export function getDataDir(): string {
  return process.env.GEOPIC_DATA_DIR || path.join(process.cwd(), "data");
}

function getSettingsFilePath(): string {
  return path.join(getDataDir(), "settings.json");
}

async function readSettings(): Promise<SettingsData> {
  const filePath = getSettingsFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as SettingsData;

    // Validate structure
    const baseMaps = Array.isArray(parsed.baseMaps) ? parsed.baseMaps : [];
    // Ensure default OSM is present at the beginning
    const hasDefault = baseMaps.some((b) => b.id === DEFAULT_BASEMAP.id);
    if (!hasDefault) {
      baseMaps.unshift(DEFAULT_BASEMAP);
    }

    return {
      baseMaps,
      userSettings: parsed.userSettings && typeof parsed.userSettings === "object" ? parsed.userSettings : {},
      defaultSelectedBaseMapId: parsed.defaultSelectedBaseMapId || DEFAULT_BASEMAP.id,
      defaultAppSettings: parsed.defaultAppSettings && typeof parsed.defaultAppSettings === "object" ? parsed.defaultAppSettings : {},
    };
  } catch {
    // If file doesn't exist or is invalid, return default state
    return {
      baseMaps: [DEFAULT_BASEMAP],
      userSettings: {},
      defaultSelectedBaseMapId: DEFAULT_BASEMAP.id,
      defaultAppSettings: {},
    };
  }
}

async function writeSettings(data: SettingsData): Promise<void> {
  const dir = getDataDir();
  const filePath = getSettingsFilePath();
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (err: unknown) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }

    if (err && typeof err === "object" && "code" in err && err.code === "EACCES") {
      console.error(
        `[GeoPic Settings] Permission denied writing to data directory "${dir}". ` +
        `Use a Docker named volume (e.g. "geopic-data:/app/data") or ensure the host mount is writable by UID 1001.`
      );
      throw new Error(
        `Permission denied writing to "${dir}". Please ensure the volume is writable (e.g. use a Docker named volume "geopic-data:/app/data" in docker-compose.yml).`
      );
    }

    throw err;
  }
}

export async function getUserBaseMaps(userId?: string): Promise<{
  selectedId: string;
  baseMaps: BaseMap[];
  presets: BaseMapPreset[];
}> {
  const settings = await readSettings();
  const userKey = userId || "default";
  let selectedId = settings.userSettings[userKey]?.selectedBaseMapId || settings.defaultSelectedBaseMapId;

  // Fallback if selectedId does not exist in baseMaps
  const exists = settings.baseMaps.some((b) => b.id === selectedId);
  if (!exists) {
    selectedId = DEFAULT_BASEMAP.id;
  }

  return {
    selectedId,
    baseMaps: settings.baseMaps,
    presets: BASEMAP_PRESETS,
  };
}

export async function setUserSelectedBaseMap(userId: string | undefined, selectedId: string): Promise<void> {
  const settings = await readSettings();
  const userKey = userId || "default";

  // Ensure selectedId exists
  const exists = settings.baseMaps.some((b) => b.id === selectedId);
  if (!exists) {
    throw new Error(`Base-map with id "${selectedId}" not found`);
  }

  if (!settings.userSettings[userKey]) {
    settings.userSettings[userKey] = { selectedBaseMapId: selectedId };
  } else {
    settings.userSettings[userKey].selectedBaseMapId = selectedId;
  }

  if (!userId || userKey === "default") {
    settings.defaultSelectedBaseMapId = selectedId;
  }

  await writeSettings(settings);
}

export async function addCustomBaseMap(
  baseMap: Omit<BaseMap, "id" | "isDefault">,
  userId?: string
): Promise<{ selectedId: string; baseMaps: BaseMap[]; presets: BaseMapPreset[] }> {
  const trimmedName = (baseMap.name || "").trim();
  const trimmedUrl = (baseMap.url || "").trim();

  if (!trimmedName) {
    throw new Error("Base map name is required");
  }
  if (!trimmedUrl) {
    throw new Error("Base map URL is required");
  }

  // URL must contain {z}, {x}, and {y}
  if (!trimmedUrl.includes("{z}") || !trimmedUrl.includes("{x}") || !trimmedUrl.includes("{y}")) {
    throw new Error("Base map URL must contain tile coordinate placeholders: {z}, {x}, and {y}");
  }

  const settings = await readSettings();
  const id = `custom_${crypto.randomUUID().slice(0, 8)}`;

  const newBaseMap: BaseMap = {
    id,
    name: trimmedName,
    url: trimmedUrl,
    attribution: (baseMap.attribution || "").trim(),
    maxZoom: typeof baseMap.maxZoom === "number" && baseMap.maxZoom > 0 ? baseMap.maxZoom : 19,
    subdomains: (baseMap.subdomains || "abc").trim(),
    isDefault: false,
  };

  settings.baseMaps.push(newBaseMap);

  // Set the newly created base map as the selected one for this user
  const userKey = userId || "default";
  if (!settings.userSettings[userKey]) {
    settings.userSettings[userKey] = { selectedBaseMapId: id };
  } else {
    settings.userSettings[userKey].selectedBaseMapId = id;
  }

  await writeSettings(settings);

  return {
    selectedId: id,
    baseMaps: settings.baseMaps,
    presets: BASEMAP_PRESETS,
  };
}

export async function deleteCustomBaseMap(
  id: string,
  userId?: string
): Promise<{ selectedId: string; baseMaps: BaseMap[]; presets: BaseMapPreset[] }> {
  if (id === DEFAULT_BASEMAP.id) {
    throw new Error("Cannot delete default OpenStreetMap base-map");
  }

  const settings = await readSettings();
  const initialLength = settings.baseMaps.length;
  settings.baseMaps = settings.baseMaps.filter((b) => b.id !== id);

  if (settings.baseMaps.length === initialLength) {
    throw new Error(`Base map with id "${id}" not found`);
  }

  // If deleted base map was selected by any user, fallback to DEFAULT_BASEMAP.id
  for (const userKey of Object.keys(settings.userSettings)) {
    if (settings.userSettings[userKey].selectedBaseMapId === id) {
      settings.userSettings[userKey].selectedBaseMapId = DEFAULT_BASEMAP.id;
    }
  }

  if (settings.defaultSelectedBaseMapId === id) {
    settings.defaultSelectedBaseMapId = DEFAULT_BASEMAP.id;
  }

  await writeSettings(settings);

  return getUserBaseMaps(userId);
}

export async function getAppSettings(userId?: string): Promise<AppSettings> {
  const settings = await readSettings();
  const userKey = userId || "default";
  const userApp = settings.userSettings[userKey]?.appSettings || {};
  const defaultApp = settings.defaultAppSettings || {};

  return {
    ...DEFAULT_APP_SETTINGS,
    ...defaultApp,
    ...userApp,
  };
}

export async function updateAppSettings(
  userId: string | undefined,
  partialSettings: Partial<AppSettings>
): Promise<AppSettings> {
  const settings = await readSettings();
  const userKey = userId || "default";

  if (!settings.userSettings[userKey]) {
    settings.userSettings[userKey] = {};
  }

  const current = settings.userSettings[userKey].appSettings || {};
  const updated = {
    ...current,
    ...partialSettings,
  };

  settings.userSettings[userKey].appSettings = updated;

  if (!userId || userKey === "default") {
    settings.defaultAppSettings = {
      ...(settings.defaultAppSettings || {}),
      ...partialSettings,
    };
  }

  await writeSettings(settings);

  return getAppSettings(userId);
}

