'use client';

import React, { useState, useEffect, useRef } from "react";
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
  Settings,
  Check,
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
  onOpenSettings?: () => void;
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
  onOpenSettings,
}: HeaderBarProps) {
  const [profileImgError, setProfileImgError] = useState(false);
  const [localStartDate, setLocalStartDate] = useState(startDate);
  const [localEndDate, setLocalEndDate] = useState(endDate);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setProfileImgError(false);
  }, [user?.id, user?.profileImagePath, sessionToken]);

  useEffect(() => {
    setLocalStartDate(startDate);
    setLocalEndDate(endDate);
  }, [startDate, endDate, timespanPreset]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const isValidDate = (d: string) => {
    return Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)));
  };

  const triggerCustomChange = (start: string, end: string, immediate = false) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!isValidDate(start) || !isValidDate(end)) {
      return;
    }

    if (immediate) {
      onTimespanChange("custom", start, end);
    } else {
      debounceTimerRef.current = setTimeout(() => {
        onTimespanChange("custom", start, end);
      }, 500);
    }
  };

  const handleStartDateChange = (val: string) => {
    setLocalStartDate(val);
    if (!isValidDate(val)) return;

    let endVal = localEndDate;
    if (isValidDate(localEndDate) && val > localEndDate) {
      endVal = val;
      setLocalEndDate(val);
    }
    if (isValidDate(endVal)) {
      triggerCustomChange(val, endVal, false);
    }
  };

  const handleEndDateChange = (val: string) => {
    setLocalEndDate(val);
    if (!isValidDate(val)) return;

    let startVal = localStartDate;
    if (isValidDate(localStartDate) && val < localStartDate) {
      startVal = val;
      setLocalStartDate(val);
    }
    if (isValidDate(startVal)) {
      triggerCustomChange(startVal, val, false);
    }
  };

  const handleApply = () => {
    if (isValidDate(localStartDate) && isValidDate(localEndDate)) {
      let s = localStartDate;
      let e = localEndDate;
      if (s > e) {
        const tmp = s;
        s = e;
        e = tmp;
        setLocalStartDate(s);
        setLocalEndDate(e);
      }
      triggerCustomChange(s, e, true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    }
  };

  const handleBlurContainer = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (!isValidDate(localStartDate)) {
        setLocalStartDate(startDate);
      }
      if (!isValidDate(localEndDate)) {
        setLocalEndDate(endDate);
      }
    }
  };

  const presets: { id: TimespanPreset; label: string }[] = [
    { id: "1m", label: "1M" },
    { id: "3m", label: "3M" },
    { id: "6m", label: "6M" },
    { id: "1y", label: "1Y" },
    { id: "all", label: "All" },
    { id: "custom", label: "Custom" },
  ];

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
          <div
            className={styles.customDateInputs}
            onBlur={handleBlurContainer}
            tabIndex={-1}
          >
            <Calendar size={14} color="var(--text-muted)" />
            <input
              type="date"
              className={styles.dateInput}
              value={localStartDate}
              onChange={(e) => handleStartDateChange(e.target.value)}
              onKeyDown={handleKeyDown}
              title="Start Date"
            />
            <span className={styles.dateSeparator}>to</span>
            <input
              type="date"
              className={styles.dateInput}
              value={localEndDate}
              onChange={(e) => handleEndDateChange(e.target.value)}
              onKeyDown={handleKeyDown}
              title="End Date"
            />
            <button
              type="button"
              className={styles.applyDateBtn}
              onClick={handleApply}
              title="Apply date range"
            >
              <Check size={13} />
            </button>
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
        {onOpenSettings && (
          <button
            type="button"
            className={styles.settingsBtn}
            onClick={onOpenSettings}
            title="Settings & Timezone Preferences"
          >
            <Settings size={16} />
          </button>
        )}
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
