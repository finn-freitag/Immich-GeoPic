'use client';

import React, { useState, useEffect, useMemo, useCallback } from "react";
import styles from "./TimestampModal.module.scss";
import { ImageItem } from "@/types/ImageItem";
import {
  Clock,
  Calendar,
  X,
  Sliders,
  Sparkles,
  ArrowRight,
  ArrowRightLeft,
  Check,
  CalendarClock,
  Loader2,
  AlertCircle,
  RotateCcw,
  FastForward,
  Rewind,
  Info,
} from "lucide-react";

export type TimestampMode = "shift" | "calculate" | "exact";

export interface TimestampModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: ImageItem[];
  sessionToken?: string | null;
  onTimestampsUpdated: (updates: Array<{ id: string; timestamp: string }>) => Promise<void> | void;
}

/**
 * Formats a Date/timestamp into HTML datetime-local format: YYYY-MM-DDTHH:mm:ss
 */
function toDateTimeLocalValue(val: Date | number | string): string {
  const d = typeof val === "object" ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${m}-${day}T${h}:${min}:${s}`;
}

/**
 * Formats a timestamp into human readable localized date and time
 */
function formatHumanDateTime(val: Date | number | string): string {
  const d = typeof val === "object" ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Formats millisecond difference into a detailed human-readable string
 */
function formatHumanDuration(diffMs: number): string {
  if (diffMs === 0) return "No difference (±0 sec)";
  const sign = diffMs > 0 ? "+" : "-";
  const absMs = Math.abs(diffMs);
  const totalSec = Math.floor(absMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? "s" : ""}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds > 1 ? "s" : ""}`);

  return `${sign} ${parts.join(", ")} (${diffMs > 0 ? "into the future" : "into the past"})`;
}

/**
 * Formats millisecond difference into a short badge string (e.g. +2d 5h 13m)
 */
function formatShortOffset(diffMs: number): string {
  if (diffMs === 0) return "±0s";
  const sign = diffMs > 0 ? "+" : "-";
  const absMs = Math.abs(diffMs);
  const totalSec = Math.floor(absMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && parts.length === 0) parts.push(`${seconds}s`);
  return `${sign}${parts.join(" ") || "0s"}`;
}

export default function TimestampModal({
  isOpen,
  onClose,
  photos,
  sessionToken,
  onTimestampsUpdated,
}: TimestampModalProps) {
  const [activeTab, setActiveTab] = useState<TimestampMode>("shift");

  // Mode 1: Relative Shift State
  const [shiftDirection, setShiftDirection] = useState<"future" | "past">("future");
  const [shiftDays, setShiftDays] = useState<number>(0);
  const [shiftHours, setShiftHours] = useState<number>(0);
  const [shiftMinutes, setShiftMinutes] = useState<number>(0);
  const [shiftSeconds, setShiftSeconds] = useState<number>(0);

  // Mode 2: Auto-calculate difference from Reference Photo
  const [referencePhotoId, setReferencePhotoId] = useState<string>("");
  const [refTargetDateTimeStr, setRefTargetDateTimeStr] = useState<string>("");

  // Mode 3: Set Specific Exact Timestamp
  const [exactDateTimeStr, setExactDateTimeStr] = useState<string>("");

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize or reset state when modal opens or photos change
  useEffect(() => {
    if (isOpen && photos.length > 0) {
      setError(null);
      setIsSubmitting(false);

      // Default reference photo to first in list
      const firstPhoto = photos[0];
      setReferencePhotoId(firstPhoto.id);

      const firstPhotoLocalStr = toDateTimeLocalValue(firstPhoto.timestamp);
      setRefTargetDateTimeStr(firstPhotoLocalStr);
      setExactDateTimeStr(firstPhotoLocalStr);

      // Reset relative shift inputs
      setShiftDirection("future");
      setShiftDays(0);
      setShiftHours(0);
      setShiftMinutes(0);
      setShiftSeconds(0);
    }
  }, [isOpen, photos]);

  // When reference photo selection changes, sync its target input string
  const referencePhoto = useMemo(() => {
    return photos.find((p) => p.id === referencePhotoId) || photos[0];
  }, [photos, referencePhotoId]);

  const handleReferencePhotoChange = (newId: string) => {
    setReferencePhotoId(newId);
    const target = photos.find((p) => p.id === newId);
    if (target) {
      setRefTargetDateTimeStr(toDateTimeLocalValue(target.timestamp));
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // Mode 1: Calculate offset in milliseconds from shift inputs
  const shiftOffsetMs = useMemo(() => {
    const totalSec =
      Math.max(0, shiftDays) * 86400 +
      Math.max(0, shiftHours) * 3600 +
      Math.max(0, shiftMinutes) * 60 +
      Math.max(0, shiftSeconds);
    const ms = totalSec * 1000;
    return shiftDirection === "past" ? -ms : ms;
  }, [shiftDirection, shiftDays, shiftHours, shiftMinutes, shiftSeconds]);

  // Quick preset helper for Shift mode
  const applyQuickOffsetDelta = (deltaSeconds: number) => {
    if (deltaSeconds === 0) {
      setShiftDirection("future");
      setShiftDays(0);
      setShiftHours(0);
      setShiftMinutes(0);
      setShiftSeconds(0);
      return;
    }

    const currentSec =
      (shiftDays * 86400 + shiftHours * 3600 + shiftMinutes * 60 + shiftSeconds) *
      (shiftDirection === "past" ? -1 : 1);
    const newTotalSec = currentSec + deltaSeconds;

    const newDir = newTotalSec < 0 ? "past" : "future";
    const absSec = Math.abs(newTotalSec);
    const d = Math.floor(absSec / 86400);
    const h = Math.floor((absSec % 86400) / 3600);
    const m = Math.floor((absSec % 3600) / 60);
    const s = absSec % 60;

    setShiftDirection(newDir);
    setShiftDays(d);
    setShiftHours(h);
    setShiftMinutes(m);
    setShiftSeconds(s);
  };

  // Mode 2: Calculate difference between target and original timestamp of reference photo
  const { calculatedDiffMs, isCalcValid } = useMemo(() => {
    if (!referencePhoto || !refTargetDateTimeStr) {
      return { calculatedDiffMs: 0, isCalcValid: false };
    }
    const origMs = new Date(referencePhoto.timestamp).getTime();
    const targetMs = new Date(refTargetDateTimeStr).getTime();
    if (Number.isNaN(origMs) || Number.isNaN(targetMs)) {
      return { calculatedDiffMs: 0, isCalcValid: false };
    }
    return { calculatedDiffMs: targetMs - origMs, isCalcValid: true };
  }, [referencePhoto, refTargetDateTimeStr]);

  // Mode 3: Validate exact timestamp
  const isExactValid = useMemo(() => {
    if (!exactDateTimeStr) return false;
    const ms = new Date(exactDateTimeStr).getTime();
    return !Number.isNaN(ms);
  }, [exactDateTimeStr]);

  // Compute live preview of all changes for each photo
  const previewItems = useMemo(() => {
    if (!photos || photos.length === 0) return [];

    return photos.map((p) => {
      const origMs = new Date(p.timestamp).getTime();
      let newMs = origMs;
      let effectiveOffsetMs = 0;

      if (activeTab === "shift") {
        effectiveOffsetMs = shiftOffsetMs;
        newMs = origMs + effectiveOffsetMs;
      } else if (activeTab === "calculate") {
        effectiveOffsetMs = calculatedDiffMs;
        newMs = origMs + effectiveOffsetMs;
      } else if (activeTab === "exact") {
        const parsedExact = new Date(exactDateTimeStr).getTime();
        newMs = Number.isNaN(parsedExact) ? origMs : parsedExact;
        effectiveOffsetMs = newMs - origMs;
      }

      const newTimestamp = Number.isNaN(newMs)
        ? p.timestamp
        : new Date(newMs).toISOString();

      return {
        id: p.id,
        name: p.name,
        oldTimestamp: p.timestamp,
        newTimestamp,
        diffMs: effectiveOffsetMs,
        isReference: p.id === referencePhotoId,
      };
    });
  }, [
    photos,
    activeTab,
    shiftOffsetMs,
    calculatedDiffMs,
    exactDateTimeStr,
    referencePhotoId,
  ]);

  // Handle Apply Submission
  const handleApply = async () => {
    if (photos.length === 0) return;

    if (activeTab === "calculate" && !isCalcValid) {
      setError("Please provide a valid target date & time for the reference photo.");
      return;
    }
    if (activeTab === "exact" && !isExactValid) {
      setError("Please provide a valid date & time.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const updates = previewItems.map((item) => ({
      id: item.id,
      timestamp: item.newTimestamp,
    }));

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token =
        sessionToken ||
        (typeof window !== "undefined"
          ? localStorage.getItem("geopic_session_token")
          : null);
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/images/bulk-timestamp", {
        method: "POST",
        headers,
        body: JSON.stringify({ updates }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Failed to update timestamps (${res.status})`);
      }

      await onTimestampsUpdated(updates);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to apply timestamp changes";
      console.error("Timestamp modification error:", msg);
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const isApplyDisabled =
    isSubmitting ||
    (activeTab === "calculate" && !isCalcValid) ||
    (activeTab === "exact" && !isExactValid);

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true">
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <CalendarClock size={22} />
            </div>
            <div>
              <h2 className={styles.title}>
                {photos.length === 1
                  ? "Modify Photo Timestamp"
                  : `Modify Timestamps (${photos.length} photos)`}
              </h2>
              <p className={styles.subtitle}>
                {photos.length === 1
                  ? photos[0].name
                  : `Adjust timestamps for ${photos.length} selected photos in Immich`}
              </p>
            </div>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isSubmitting}
            title="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className={styles.content}>
          {/* Mode Selector Tabs */}
          <div className={styles.tabsContainer}>
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === "shift" ? styles.activeTab : ""}`}
              onClick={() => setActiveTab("shift")}
            >
              <Sliders size={14} />
              <span>Shift Time</span>
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === "calculate" ? styles.activeTab : ""}`}
              onClick={() => setActiveTab("calculate")}
            >
              <Sparkles size={14} />
              <span>Auto-Calculate</span>
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === "exact" ? styles.activeTab : ""}`}
              onClick={() => setActiveTab("exact")}
            >
              <Calendar size={14} />
              <span>Exact Time</span>
            </button>
          </div>

          {/* TAB 1: SHIFT TIME (RELATIVE) */}
          {activeTab === "shift" && (
            <div className={styles.modeCard}>
              <div className={styles.modeHeader}>
                <span className={styles.modeTitle}>
                  <Sliders size={15} />
                  Add or Subtract Time Offset
                </span>
                <span className={styles.diffTitle} style={{ fontSize: 12 }}>
                  {formatShortOffset(shiftOffsetMs)}
                </span>
              </div>
              <p className={styles.modeDesc}>
                Move timestamps by a specific amount into the future or past (e.g. 2 days, 5 hours,
                and 13 minutes).
              </p>

              {/* Direction selector */}
              <div className={styles.directionToggle}>
                <button
                  type="button"
                  className={`${styles.directionBtn} ${
                    shiftDirection === "future" ? styles.activeFuture : ""
                  }`}
                  onClick={() => setShiftDirection("future")}
                >
                  <FastForward size={14} />
                  <span>Forward / Future (+)</span>
                </button>
                <button
                  type="button"
                  className={`${styles.directionBtn} ${
                    shiftDirection === "past" ? styles.activePast : ""
                  }`}
                  onClick={() => setShiftDirection("past")}
                >
                  <Rewind size={14} />
                  <span>Backward / Past (-)</span>
                </button>
              </div>

              {/* Days, Hours, Minutes, Seconds Grid */}
              <div className={styles.timeInputGrid}>
                <div className={styles.inputField}>
                  <label htmlFor="shift-days">Days</label>
                  <input
                    id="shift-days"
                    type="number"
                    min="0"
                    value={shiftDays}
                    onChange={(e) => setShiftDays(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
                <div className={styles.inputField}>
                  <label htmlFor="shift-hours">Hours</label>
                  <input
                    id="shift-hours"
                    type="number"
                    min="0"
                    max="23"
                    value={shiftHours}
                    onChange={(e) => setShiftHours(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
                <div className={styles.inputField}>
                  <label htmlFor="shift-minutes">Minutes</label>
                  <input
                    id="shift-minutes"
                    type="number"
                    min="0"
                    max="59"
                    value={shiftMinutes}
                    onChange={(e) => setShiftMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
                <div className={styles.inputField}>
                  <label htmlFor="shift-seconds">Seconds</label>
                  <input
                    id="shift-seconds"
                    type="number"
                    min="0"
                    max="59"
                    value={shiftSeconds}
                    onChange={(e) => setShiftSeconds(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
              </div>

              {/* Quick Offset Presets */}
              <div className={styles.presetChips}>
                <span className={styles.presetLabel}>Quick Presets:</span>
                <button
                  type="button"
                  className={styles.chipBtn}
                  onClick={() => applyQuickOffsetDelta(3600)}
                  title="Advance 1 hour (compensate for unadjusted Daylight Saving Summer Time)"
                >
                  +1 Hour (DST Summer)
                </button>
                <button
                  type="button"
                  className={styles.chipBtn}
                  onClick={() => applyQuickOffsetDelta(-3600)}
                  title="Retard 1 hour (compensate for unadjusted Standard Winter Time)"
                >
                  -1 Hour (DST Winter)
                </button>
                <button
                  type="button"
                  className={styles.chipBtn}
                  onClick={() => applyQuickOffsetDelta(86400)}
                >
                  +1 Day
                </button>
                <button
                  type="button"
                  className={styles.chipBtn}
                  onClick={() => applyQuickOffsetDelta(-86400)}
                >
                  -1 Day
                </button>
                <button
                  type="button"
                  className={styles.chipBtn}
                  onClick={() => applyQuickOffsetDelta(43200)}
                >
                  +12 Hours
                </button>
                <button
                  type="button"
                  className={`${styles.chipBtn} ${styles.resetChip}`}
                  onClick={() => applyQuickOffsetDelta(0)}
                >
                  <RotateCcw size={11} style={{ marginRight: 3, verticalAlign: "middle" }} />
                  Reset (0)
                </button>
              </div>

              {/* Offset Summary Box */}
              <div className={styles.differenceHighlight}>
                <Info size={16} className={styles.diffIcon} />
                <div className={styles.diffBody}>
                  <span className={styles.diffTitle}>
                    {shiftOffsetMs === 0
                      ? "No offset applied"
                      : `Offset: ${formatHumanDuration(shiftOffsetMs)}`}
                  </span>
                  <span className={styles.diffSubtitle}>
                    All {photos.length} selected photos will be shifted by this duration.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AUTO-CALCULATE DIFFERENCE FROM REFERENCE PHOTO */}
          {activeTab === "calculate" && (
            <div className={styles.modeCard}>
              <div className={styles.modeHeader}>
                <span className={styles.modeTitle}>
                  <Sparkles size={15} />
                  Calculate Difference from Reference Photo
                </span>
                <span className={styles.diffTitle} style={{ fontSize: 12 }}>
                  {formatShortOffset(calculatedDiffMs)}
                </span>
              </div>
              <p className={styles.modeDesc}>
                Set the correct target time for one reference photo. The exact time difference
                will be automatically calculated and applied to all {photos.length} selected photos.
              </p>

              {/* Reference Photo Selector (if multiple photos) */}
              {photos.length > 1 && (
                <div className={styles.referenceSelector}>
                  <label htmlFor="ref-photo-select">Reference Photo</label>
                  <select
                    id="ref-photo-select"
                    value={referencePhotoId}
                    onChange={(e) => handleReferencePhotoChange(e.target.value)}
                  >
                    {photos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatHumanDateTime(p.timestamp)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Comparison Box: Original vs Target */}
              <div className={styles.calcComparison}>
                <div className={styles.calcBox}>
                  <span className={styles.calcBoxLabel}>Original Timestamp</span>
                  <span className={styles.calcBoxValue}>
                    {referencePhoto ? formatHumanDateTime(referencePhoto.timestamp) : "—"}
                  </span>
                </div>

                <div className={styles.calcArrow}>
                  <ArrowRight size={18} />
                </div>

                <div className={styles.calcBox}>
                  <span className={styles.calcBoxLabel}>Target Timestamp</span>
                  <input
                    type="datetime-local"
                    step="1"
                    className={styles.calcBoxInput}
                    value={refTargetDateTimeStr}
                    onChange={(e) => setRefTargetDateTimeStr(e.target.value)}
                  />
                </div>
              </div>

              {/* Prominently Highlighted Calculated Difference */}
              <div className={styles.differenceHighlight}>
                <ArrowRightLeft size={16} className={styles.diffIcon} />
                <div className={styles.diffBody}>
                  <span className={styles.diffTitle}>
                    Calculated Difference: {formatHumanDuration(calculatedDiffMs)}
                  </span>
                  <span className={styles.diffSubtitle}>
                    {photos.length === 1
                      ? "The photo timestamp will be adjusted by this difference."
                      : `All ${photos.length} selected photos will be shifted by this exact difference.`}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SET SPECIFIC EXACT TIMESTAMP */}
          {activeTab === "exact" && (
            <div className={styles.modeCard}>
              <div className={styles.modeHeader}>
                <span className={styles.modeTitle}>
                  <Calendar size={15} />
                  Set Exact Timestamp
                </span>
              </div>
              <p className={styles.modeDesc}>
                Assign an identical fixed timestamp directly to all {photos.length} selected
                photo(s).
              </p>

              <div className={styles.exactInputGroup}>
                <label htmlFor="exact-datetime">New Exact Timestamp</label>
                <input
                  id="exact-datetime"
                  type="datetime-local"
                  step="1"
                  value={exactDateTimeStr}
                  onChange={(e) => setExactDateTimeStr(e.target.value)}
                />
              </div>

              <div className={styles.exactActions}>
                <button
                  type="button"
                  className={styles.chipBtn}
                  onClick={() => setExactDateTimeStr(toDateTimeLocalValue(new Date()))}
                >
                  Set to Current Time
                </button>
                {photos.length > 0 && (
                  <button
                    type="button"
                    className={styles.chipBtn}
                    onClick={() =>
                      setExactDateTimeStr(toDateTimeLocalValue(photos[0].timestamp))
                    }
                  >
                    Reset to First Photo&apos;s Time
                  </button>
                )}
              </div>

              <div className={styles.differenceHighlight}>
                <Info size={16} className={styles.diffIcon} />
                <div className={styles.diffBody}>
                  <span className={styles.diffTitle}>
                    {exactDateTimeStr
                      ? `Exact Time: ${formatHumanDateTime(exactDateTimeStr)}`
                      : "Select a valid date & time"}
                  </span>
                  <span className={styles.diffSubtitle}>
                    {photos.length === 1
                      ? "The photo will receive this exact timestamp."
                      : `All ${photos.length} selected photos will receive this exact identical timestamp.`}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Live Preview List */}
          <div className={styles.previewSection}>
            <div className={styles.previewHeader}>
              <span className={styles.previewTitle}>Preview Changes</span>
              <span className={styles.previewCount}>
                {photos.length} photo{photos.length > 1 ? "s" : ""}
              </span>
            </div>

            <div className={styles.previewList}>
              {previewItems.slice(0, 20).map((item) => (
                <div
                  key={item.id}
                  className={`${styles.previewRow} ${
                    item.isReference && activeTab === "calculate" ? styles.refHighlight : ""
                  }`}
                >
                  <span className={styles.previewName} title={item.name}>
                    {item.isReference && activeTab === "calculate" && (
                      <span className={styles.refTag}>REF</span>
                    )}
                    {item.name}
                  </span>
                  <span className={styles.previewOld}>
                    {formatHumanDateTime(item.oldTimestamp)}
                  </span>
                  <span className={styles.previewArrow}>
                    <ArrowRight size={12} />
                  </span>
                  <span className={styles.previewNew}>
                    {formatHumanDateTime(item.newTimestamp)}
                  </span>
                </div>
              ))}

              {previewItems.length > 20 && (
                <div className={styles.moreItemsNotice}>
                  ...and {previewItems.length - 20} more photo(s)
                </div>
              )}
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className={styles.errorBanner}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.applyBtn}
            onClick={handleApply}
            disabled={isApplyDisabled}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={15} className={styles.spinner} />
                <span>Updating in Immich...</span>
              </>
            ) : (
              <>
                <Check size={15} />
                <span>
                  {photos.length === 1
                    ? "Apply Timestamp"
                    : `Apply to ${photos.length} Photos`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
