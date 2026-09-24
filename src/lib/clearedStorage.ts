import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getDataDir } from "./settings";

function getClearedDir(userId?: string): string {
  const userKey = userId || "default";
  return path.join(getDataDir(), "cleared", userKey);
}

function getClearedFilePath(userId?: string): string {
  return path.join(getClearedDir(userId), "cleared_locations.json");
}

export async function getClearedLocations(userId?: string): Promise<Set<string>> {
  const filePath = getClearedFilePath(userId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const ids: string[] = [];
      for (const item of parsed) {
        if (typeof item === "string" && item.trim()) {
          ids.push(item);
        } else if (item && typeof item === "object" && typeof item.assetId === "string") {
          ids.push(item.assetId);
        }
      }
      return new Set(ids);
    }
    return new Set();
  } catch {
    return new Set();
  }
}

async function writeClearedLocationIds(userId: string | undefined, ids: string[]): Promise<void> {
  const dir = getClearedDir(userId);
  const filePath = getClearedFilePath(userId);
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(ids, null, 2), "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (err: unknown) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }
    if (err && typeof err === "object" && "code" in err && err.code === "EACCES") {
      console.error(
        `[GeoPic Cleared] Permission denied writing to "${dir}". Ensure the data volume is writable.`
      );
    }
    throw err;
  }
}

export async function addClearedLocation(
  userId: string | undefined,
  assetIdOrIds: string | string[]
): Promise<void> {
  const set = await getClearedLocations(userId);
  const ids = Array.isArray(assetIdOrIds) ? assetIdOrIds : [assetIdOrIds];
  let changed = false;
  for (const id of ids) {
    if (id && !set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (changed) {
    await writeClearedLocationIds(userId, Array.from(set));
  }
}

export async function removeClearedLocation(
  userId: string | undefined,
  assetIdOrIds: string | string[]
): Promise<void> {
  const set = await getClearedLocations(userId);
  const ids = Array.isArray(assetIdOrIds) ? assetIdOrIds : [assetIdOrIds];
  let changed = false;
  for (const id of ids) {
    if (id && set.delete(id)) {
      changed = true;
    }
  }
  if (changed) {
    await writeClearedLocationIds(userId, Array.from(set));
  }
}
