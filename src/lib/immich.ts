export type ImmichAuth = {
  token?: string;
  apiKey?: string;
};

export type ImmichUser = {
  id: string;
  email: string;
  name: string;
  profileImagePath?: string | null;
  isAdmin?: boolean;
};

export type ImmichAsset = {
  id: string;
  originalFileName: string;
  fileCreatedAt: string;
  dateTimeOriginal?: string | null;
  localDateTime?: string | null;
  exifInfo?: {
    dateTimeOriginal?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    city?: string | null;
    country?: string | null;
    timeZone?: string | null;
  } | null;
};

export function getImmichUrl(): string {
  let url = process.env.IMMICH_URL || "http://localhost:2283";
  url = url.trim().replace(/\/+$/, "");
  if (url.endsWith("/api")) {
    url = url.slice(0, -4).replace(/\/+$/, "");
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `http://${url}`;
  }
  return url;
}

export function getAuthHeaders(auth: ImmichAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (auth.apiKey) {
    headers["x-api-key"] = auth.apiKey;
  } else if (auth.token) {
    headers["Authorization"] = `Bearer ${auth.token}`;
  }
  return headers;
}

export async function loginToImmich(email: string, password: string): Promise<{
  accessToken: string;
  user: ImmichUser;
}> {
  const baseUrl = getImmichUrl();
  let res: Response;
  const targetUrl = `${baseUrl}/api/auth/login`;

  try {
    res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Immich API] Connection to ${targetUrl} failed:`, msg);
    throw new Error(
      `Unable to reach Immich at ${baseUrl}. Ensure IMMICH_URL is accessible from the container: ${msg}`
    );
  }

  if (!res.ok) {
    const errorText = await res.text();
    let parsedMessage = "";
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.message) {
        parsedMessage = Array.isArray(errorJson.message)
          ? errorJson.message.join(", ")
          : String(errorJson.message);
      }
    } catch {
      if (
        errorText.includes("<html") ||
        errorText.includes("<!DOCTYPE") ||
        errorText.includes("<body")
      ) {
        const titleMatch = errorText.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : `${res.status} Not Found`;
        parsedMessage = `Immich endpoint (${targetUrl}) returned an HTML error page ("${title}"). Please check that IMMICH_URL points directly to your Immich server instance (e.g. http://immich-server:2283 or your Immich subdomain).`;
      } else {
        parsedMessage = errorText.slice(0, 250);
      }
    }
    throw new Error(parsedMessage || `Immich login failed with status ${res.status}`);
  }

  const data = await res.json();
  return {
    accessToken: data.accessToken,
    user: {
      id: data.userId || data.id,
      email: data.userEmail || email,
      name: data.name || email.split("@")[0],
      profileImagePath: data.profileImagePath,
      isAdmin: !!data.isAdmin,
    },
  };
}

export async function logoutFromImmich(token: string): Promise<void> {
  try {
    const baseUrl = getImmichUrl();
    await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    console.error("Immich logout error:", err);
  }
}

export async function getCurrentUser(auth: ImmichAuth): Promise<ImmichUser> {
  const baseUrl = getImmichUrl();
  const res = await fetch(`${baseUrl}/api/users/me`, {
    headers: getAuthHeaders(auth),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch current user (${res.status})`);
  }

  const data = await res.json();
  return {
    id: data.id,
    email: data.email,
    name: data.name || data.email,
    profileImagePath: data.profileImagePath,
    isAdmin: !!data.isAdmin,
  };
}

export async function getProfileImageStream(
  auth: ImmichAuth,
  userId?: string
): Promise<{
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
} | null> {
  const baseUrl = getImmichUrl();

  let targetUserId = userId;
  if (!targetUserId || targetUserId === "apikey-user") {
    try {
      const user = await getCurrentUser(auth);
      if (!user?.id) {
        return null;
      }
      targetUserId = user.id;
    } catch (err) {
      console.warn("[getProfileImageStream] Failed to resolve current user:", err);
      return null;
    }
  }

  try {
    const res = await fetch(`${baseUrl}/api/users/${targetUserId}/profile-image`, {
      headers: getAuthHeaders(auth),
    });

    if (res.ok && res.body) {
      return {
        body: res.body,
        contentType: res.headers.get("content-type") || "image/jpeg",
      };
    }
  } catch (err) {
    console.error(`[getProfileImageStream] Error fetching profile image for ${targetUserId}:`, err);
  }

  // Fallback in case a specific Immich deployment uses /api/users/me/profile-image
  if (targetUserId !== "me") {
    try {
      const fallbackRes = await fetch(`${baseUrl}/api/users/me/profile-image`, {
        headers: getAuthHeaders(auth),
      });
      if (fallbackRes.ok && fallbackRes.body) {
        return {
          body: fallbackRes.body,
          contentType: fallbackRes.headers.get("content-type") || "image/jpeg",
        };
      }
    } catch {
      // Ignore fallback error
    }
  }

  return null;
}

export async function searchAssets(
  auth: ImmichAuth,
  params: {
    startDate?: string;
    endDate?: string;
    page?: number;
    size?: number;
  }
): Promise<{ items: ImmichAsset[]; total: number }> {
  const baseUrl = getImmichUrl();
  const pageSize = Math.min(params.size || 1000, 1000);
  const bodyPayload: Record<string, unknown> = {
    type: "IMAGE",
    withExif: true,
    size: pageSize,
    page: params.page || 1,
  };

  if (params.startDate) {
    const isoString = params.startDate.includes("T")
      ? new Date(params.startDate).toISOString()
      : new Date(`${params.startDate}T00:00:00.000Z`).toISOString();
    bodyPayload.takenAfter = isoString;
  }
  if (params.endDate) {
    const isoString = params.endDate.includes("T")
      ? new Date(params.endDate).toISOString()
      : new Date(`${params.endDate}T23:59:59.999Z`).toISOString();
    bodyPayload.takenBefore = isoString;
  }

  const res = await fetch(`${baseUrl}/api/search/metadata`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(auth),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to search Immich assets (${res.status}): ${errorText}`);
  }

  const data = await res.json();

  // Immich can return { assets: { items: [...], total: N } } or { items: [...], total: N } or array directly
  let items: ImmichAsset[] = [];
  let total = 0;

  if (data?.assets?.items && Array.isArray(data.assets.items)) {
    items = data.assets.items;
    total = data.assets.total ?? items.length;
  } else if (data?.items && Array.isArray(data.items)) {
    items = data.items;
    total = data.total ?? items.length;
  } else if (Array.isArray(data)) {
    items = data;
    total = data.length;
  }

  // If no explicit page was requested and page 1 was full (or nextPage is indicated),
  // paginate to fetch all remaining pages until all assets are retrieved (up to 50,000)
  const maxAssets = 50000;
  if (!params.page) {
    let currentPage = 1;
    const nextPageIndicator = data?.assets?.nextPage ?? data?.nextPage ?? null;
    let hasMore = nextPageIndicator != null || items.length === pageSize;

    while (hasMore && items.length < maxAssets) {
      currentPage++;
      try {
        const nextRes = await fetch(`${baseUrl}/api/search/metadata`, {
          method: "POST",
          headers: {
            ...getAuthHeaders(auth),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...bodyPayload, page: currentPage }),
        });

        if (!nextRes.ok) {
          console.warn(`[searchAssets] Page ${currentPage} returned status ${nextRes.status}`);
          break;
        }

        const nextData = await nextRes.json();
        let nextItems: ImmichAsset[] = [];
        if (nextData?.assets?.items && Array.isArray(nextData.assets.items)) {
          nextItems = nextData.assets.items;
        } else if (nextData?.items && Array.isArray(nextData.items)) {
          nextItems = nextData.items;
        } else if (Array.isArray(nextData)) {
          nextItems = nextData;
        }

        if (nextItems.length === 0) {
          break;
        }

        items.push(...nextItems);

        // Determine if another page exists:
        // 1. Explicit nextPage property returned by Immich
        // 2. Or exactly a full page (1,000 items) returned, indicating more may follow
        const next = nextData?.assets?.nextPage ?? nextData?.nextPage ?? null;
        if (next != null) {
          hasMore = true;
        } else if (nextItems.length === pageSize) {
          hasMore = true;
        } else {
          hasMore = false;
        }
      } catch (err) {
        console.warn(`[searchAssets] Failed to fetch page ${currentPage}:`, err);
        break;
      }
    }
  }

  return { items, total: items.length };
}

export async function getAssetThumbnailStream(
  auth: ImmichAuth,
  assetId: string,
  size: "thumbnail" | "preview" = "thumbnail"
): Promise<{
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
} | null> {
  const baseUrl = getImmichUrl();
  const res = await fetch(`${baseUrl}/api/assets/${assetId}/thumbnail?size=${size}`, {
    headers: getAuthHeaders(auth),
  });

  if (!res.ok || !res.body) {
    return null;
  }

  return {
    body: res.body,
    contentType: res.headers.get("content-type") || "image/webp",
  };
}

export async function updateAssetLocation(
  auth: ImmichAuth,
  assetId: string,
  coords: { lat: number; lng: number } | null
): Promise<void> {
  // Immich API rejects null coordinates with 400 Bad Request.
  // Clearing coordinates is handled inside GeoPic.
  if (!coords) {
    return;
  }

  const baseUrl = getImmichUrl();
  const latitude = coords.lat;
  const longitude = coords.lng;

  // Try bulk update endpoint PUT /api/assets first
  const bulkRes = await fetch(`${baseUrl}/api/assets`, {
    method: "PUT",
    headers: {
      ...getAuthHeaders(auth),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ids: [assetId],
      latitude,
      longitude,
    }),
  });

  if (bulkRes.ok) return;

  // Fallback to single asset endpoint PUT /api/assets/:id
  const singleRes = await fetch(`${baseUrl}/api/assets/${assetId}`, {
    method: "PUT",
    headers: {
      ...getAuthHeaders(auth),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      latitude,
      longitude,
    }),
  });

  if (!singleRes.ok) {
    const errorText = await singleRes.text();
    throw new Error(`Failed to update asset location (${singleRes.status}): ${errorText}`);
  }
}

export async function bulkUpdateLocations(
  auth: ImmichAuth,
  updates: Array<{ id: string; coords: { lat: number; lng: number } }>
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Concurrently update with small batches
  const batchSize = 5;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (u) => {
        try {
          await updateAssetLocation(auth, u.id, u.coords);
          success++;
        } catch (err) {
          console.error(`Failed to update asset ${u.id}:`, err);
          failed++;
        }
      })
    );
  }

  return { success, failed };
}
