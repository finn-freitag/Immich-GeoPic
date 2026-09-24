'use client';

import React, { useState, useEffect } from "react";
import styles from "./HeaderBar.module.scss";
import {
  MapPin,
  Calendar,
  RotateCw,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Layers,
} from "lucide-react";

export type TimespanPreset = "1m" | "3m" | "6m" | "1y" | "all" | "custom";

export type HeaderBarProps = {
  user: {
    id: string;
    name: string;
    email: string;
    profileImagePath?: string | null;
  } | null;
  authMode: "apikey" | "login";
  sessionToken?: string | null;
  onLogout: () => void;
  timespanPreset: TimespanPreset;
  startDate: string;
  endDate: string;
  onTimespanChange: (preset: TimespanPreset, start?: string, end?: string) => void;
  totalCount: number;
  geotaggedCount: number;
  estimatedCount: number;
  removedCount: number;
  isLoading: boolean;
  onRefresh: () => void;
  onZoomCategory?: (category: "all" | "geotagged" | "unreferenced" | "removed") => void;
};

export default function HeaderBar({
  user,
  authMode,
  sessionToken,
  onLogout,
  timespanPreset,
  startDate,
  endDate,
  onTimespanChange,
  totalCount,
  geotaggedCount,
  estimatedCount,
  removedCount,
  isLoading,
  onRefresh,
  onZoomCategory,
}: HeaderBarProps) {
  const [profileImgError, setProfileImgError] = useState(false);

  useEffect(() => {
    setProfileImgError(false);
  }, [user?.id, user?.profileImagePath, sessionToken]);

  const presets: { id: TimespanPreset; label: string }[] = [
    { id: "1m", label: "1M" },
    { id: "3m", label: "3M" },
    { id: "6m", label: "6M" },
    { id: "1y", label: "1Y" },
    { id: "all", label: "All" },
    { id: "custom", label: "Custom" },
  ];

  const handleCustomDateChange = (type: "start" | "end", val: string) => {
    if (type === "start") {
      onTimespanChange("custom", val, endDate);
    } else {
      onTimespanChange("custom", startDate, val);
    }
  };

  const userInitial = user?.name ? user.name[0].toUpperCase() : "U";

  return (
    <header className={styles.header}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.logoIcon}>
          <MapPin size={20} />
        </div>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Immich GeoPic</h1>
          <span className={styles.subtitle}>Georeferencing Studio</span>
        </div>
      </div>

      {/* Center Controls: Timespan & Counters */}
      <div className={styles.centerControls}>
        {/* Preset Selector */}
        <div className={styles.presetGroup}>
          {presets.map((p) => (
            <button
              key={p.id}
              className={`${styles.presetBtn} ${timespanPreset === p.id ? styles.active : ""}`}
              onClick={() => onTimespanChange(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom Range Picker */}
        {timespanPreset === "custom" && (
          <div className={styles.customDateInputs}>
            <Calendar size={14} color="var(--text-muted)" />
            <input
              type="date"
              className={styles.dateInput}
              value={startDate}
              onChange={(e) => handleCustomDateChange("start", e.target.value)}
            />
            <span className={styles.dateSeparator}>to</span>
            <input
              type="date"
              className={styles.dateInput}
              value={endDate}
              onChange={(e) => handleCustomDateChange("end", e.target.value)}
            />
          </div>
        )}

        {/* Counter Badges */}
        <div className={styles.counters}>
          <button
            type="button"
            className={`${styles.badge} ${styles.total}`}
            onClick={() => onZoomCategory?.("all")}
            title="Zoom map to all loaded photos"
            disabled={totalCount === 0}
          >
            <Layers size={13} />
            <span>{totalCount.toLocaleString()}</span>
          </button>
          <button
            type="button"
            className={`${styles.badge} ${styles.geotagged}`}
            onClick={() => onZoomCategory?.("geotagged")}
            title="Zoom map to photos with verified GPS"
            disabled={geotaggedCount === 0}
          >
            <CheckCircle2 size={13} />
            <span>{geotaggedCount.toLocaleString()}</span>
          </button>
          <button
            type="button"
            className={`${styles.badge} ${styles.estimated}`}
            onClick={() => onZoomCategory?.("unreferenced")}
            title="Zoom map to photos with no GPS position (estimated)"
            disabled={estimatedCount === 0}
          >
            <AlertCircle size={13} />
            <span>{estimatedCount.toLocaleString()}</span>
          </button>
          <button
            type="button"
            className={`${styles.badge} ${styles.removed}`}
            onClick={() => onZoomCategory?.("removed")}
            title="Zoom map to photos with removed GPS coordinates (estimated position)"
            disabled={removedCount === 0}
          >
            <XCircle size={13} />
            <span>{removedCount.toLocaleString()}</span>
          </button>
        </div>

        {/* Refresh Button */}
        <button
          className={`${styles.refreshBtn} ${isLoading ? styles.spinning : ""}`}
          onClick={onRefresh}
          title="Reload photos"
          disabled={isLoading}
        >
          <RotateCw size={15} />
        </button>
      </div>

      {/* Right Section: User & Logout */}
      <div className={styles.rightSection}>
        <div className={styles.userCard}>
          {user && !profileImgError ? (
            <img
              src={`/api/auth/profile-image?${[
                user.id ? `userId=${encodeURIComponent(user.id)}` : "",
                sessionToken ? `token=${encodeURIComponent(sessionToken)}` : "",
              ]
                .filter(Boolean)
                .join("&")}`}
              alt={user.name}
              className={styles.avatar}
              onError={() => setProfileImgError(true)}
            />
          ) : (
            <div className={styles.avatar}>{userInitial}</div>
          )}
          <div className={styles.userInfo}>
            <span className={styles.userName}>{user?.name || "Immich User"}</span>
            <span className={styles.userMode}>
              {authMode === "apikey" ? "API Key Mode" : "Connected"}
            </span>
          </div>
          {authMode === "login" && (
            <button
              className={styles.logoutBtn}
              onClick={onLogout}
              title="Log out of Immich GeoPic"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
