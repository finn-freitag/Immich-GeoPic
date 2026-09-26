'use client';

import React, { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import styles from "./page.module.scss";
import HeaderBar, { TimespanPreset } from "@/components/HeaderBar";
import LoginModal from "@/components/LoginModal";
import { ImageItem } from "@/types/ImageItem";
import { ImageOff } from "lucide-react";

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [authMode, setAuthMode] = useState<"apikey" | "login">("login");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [user, setUser] = useState<{
    id: string;
    name: string;
    email: string;
    profileImagePath?: string | null;
  } | null>(null);

  const [images, setImages] = useState<ImageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [timespanPreset, setTimespanPreset] = useState<TimespanPreset>("6m");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [zoomCategoryTarget, setZoomCategoryTarget] = useState<{
    category: "all" | "geotagged" | "unreferenced" | "removed";
    timestamp: number;
  } | null>(null);

  // Format dates as YYYY-MM-DD
  const formatDateInput = (date: Date) => date.toISOString().split("T")[0];

  const defaultDates = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 6);
    return {
      startDate: formatDateInput(start),
      endDate: formatDateInput(end),
    };
  }, []);

  const [startDate, setStartDate] = useState(defaultDates.startDate);
  const [endDate, setEndDate] = useState(defaultDates.endDate);

  // Authenticated fetch helper that sends Bearer token & handles credentials
  const authFetch = useCallback(
    async (input: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      const token =
        sessionToken ||
        (typeof window !== "undefined"
          ? localStorage.getItem("geopic_session_token")
          : null);

      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      return fetch(input, {
        ...init,
        headers,
      });
    },
    [sessionToken]
  );

  // Dynamic import for Leaflet map (client-only)
  const Map = useMemo(
    () =>
      dynamic(() => import("@/components/LeafletGeorefMap"), {
        ssr: false,
        loading: () => (
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Initializing Leaflet map...</p>
          </div>
        ),
      }),
    []
  );

  // Check auth on load
  const checkAuth = useCallback(async () => {
    try {
      const savedToken =
        typeof window !== "undefined"
          ? localStorage.getItem("geopic_session_token")
          : null;
      if (savedToken) {
        setSessionToken(savedToken);
      }

      const res = await authFetch("/api/auth/me");
      const data = await res.json();
      if (data.authenticated) {
        setIsAuthenticated(true);
        setAuthMode(data.mode);
        setUser(data.user);
      } else {
        if (savedToken) {
          localStorage.removeItem("geopic_session_token");
          setSessionToken(null);
        }
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      setIsAuthenticated(false);
    }
  }, [authFetch]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Fetch photos for the selected date range
  const loadImages = useCallback(
    async (start?: string, end?: string, isAll?: boolean) => {
      setIsLoading(true);
      try {
        const query = new URLSearchParams();
        if (isAll) {
          query.set("all", "true");
        } else {
          if (start) query.set("startDate", start);
          if (end) query.set("endDate", end);
        }

        const res = await authFetch(`/api/images?${query.toString()}`);
        if (!res.ok) {
          if (res.status === 401) {
            console.warn("[GeoPic] 401 received while fetching images. Session may be expired.");
            setIsAuthenticated(false);
            if (typeof window !== "undefined") {
              localStorage.removeItem("geopic_session_token");
            }
            setSessionToken(null);
            return;
          }
          throw new Error(`Failed to fetch images (${res.status})`);
        }

        const data = await res.json();
        setImages(data.images || []);
      } catch (err) {
        console.error("Failed to load images from Immich:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [authFetch]
  );

  // When authenticated, trigger initial image load
  useEffect(() => {
    if (isAuthenticated) {
      loadImages(startDate, endDate, timespanPreset === "all");
    }
  }, [isAuthenticated, loadImages]);

  const handleTimespanChange = (
    preset: TimespanPreset,
    customStart?: string,
    customEnd?: string
  ) => {
    setTimespanPreset(preset);
    const now = new Date();

    if (preset === "1m") {
      const s = new Date();
      s.setMonth(now.getMonth() - 1);
      const startStr = formatDateInput(s);
      const endStr = formatDateInput(now);
      setStartDate(startStr);
      setEndDate(endStr);
      loadImages(startStr, endStr, false);
    } else if (preset === "3m") {
      const s = new Date();
      s.setMonth(now.getMonth() - 3);
      const startStr = formatDateInput(s);
      const endStr = formatDateInput(now);
      setStartDate(startStr);
      setEndDate(endStr);
      loadImages(startStr, endStr, false);
    } else if (preset === "6m") {
      const s = new Date();
      s.setMonth(now.getMonth() - 6);
      const startStr = formatDateInput(s);
      const endStr = formatDateInput(now);
      setStartDate(startStr);
      setEndDate(endStr);
      loadImages(startStr, endStr, false);
    } else if (preset === "1y") {
      const s = new Date();
      s.setFullYear(now.getFullYear() - 1);
      const startStr = formatDateInput(s);
      const endStr = formatDateInput(now);
      setStartDate(startStr);
      setEndDate(endStr);
      loadImages(startStr, endStr, false);
    } else if (preset === "all") {
      setStartDate("");
      setEndDate("");
      loadImages("", "", true);
    } else if (preset === "custom") {
      const startStr = customStart ?? (startDate || defaultDates.startDate);
      const endStr = customEnd ?? (endDate || defaultDates.endDate);
      setStartDate(startStr);
      setEndDate(endStr);
      loadImages(startStr, endStr, false);
    }
  };

  const handleLogout = async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      if (typeof window !== "undefined") {
        localStorage.removeItem("geopic_session_token");
      }
      setSessionToken(null);
      setIsAuthenticated(false);
      setUser(null);
      setImages([]);
    }
  };

  const handleLoginSuccess = (
    loggedInUser: { id: string; name: string; email: string },
    token?: string
  ) => {
    if (token) {
      setSessionToken(token);
      if (typeof window !== "undefined") {
        localStorage.setItem("geopic_session_token", token);
      }
    }
    setUser(loggedInUser);
    setIsAuthenticated(true);
    setAuthMode("login");
  };

  const geotaggedCount = useMemo(
    () => images.filter((img) => !!img.coords).length,
    [images]
  );
  const removedCount = useMemo(
    () => images.filter((img) => !img.coords && img.isCleared).length,
    [images]
  );
  const estimatedCount = useMemo(
    () => images.filter((img) => !img.coords && !img.isCleared).length,
    [images]
  );

  // Show loading during initial auth check
  if (isAuthenticated === null) {
    return (
      <div className={styles.loadingBox}>
        <div className={styles.spinner} />
        <p className={styles.loadingText}>Connecting to Immich GeoPic...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header Bar */}
      <HeaderBar
        user={user}
        authMode={authMode}
        sessionToken={sessionToken}
        onLogout={handleLogout}
        timespanPreset={timespanPreset}
        startDate={startDate}
        endDate={endDate}
        onTimespanChange={handleTimespanChange}
        totalCount={images.length}
        geotaggedCount={geotaggedCount}
        estimatedCount={estimatedCount}
        removedCount={removedCount}
        isLoading={isLoading}
        onRefresh={() => loadImages(startDate, endDate, timespanPreset === "all")}
        onZoomCategory={(category) =>
          setZoomCategoryTarget({ category, timestamp: Date.now() })
        }
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Map Content */}
      <main className={styles.main}>
        {images.length === 0 && !isLoading && (
          <div className={styles.emptyOverlay}>
            <ImageOff size={16} />
            <span>No images found for the selected timespan. Try expanding the date range.</span>
          </div>
        )}

        <Map
          images={images}
          onImagesUpdate={setImages}
          sessionToken={sessionToken}
          zoomCategoryTarget={zoomCategoryTarget}
          topBarStartDate={startDate}
          topBarEndDate={endDate}
          isSettingsOpen={isSettingsOpen}
          onSettingsClose={() => setIsSettingsOpen(false)}
        />

        {isLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Fetching photos from Immich...</p>
          </div>
        )}
      </main>

      {/* Login Modal */}
      <LoginModal
        isOpen={isAuthenticated === false}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}
