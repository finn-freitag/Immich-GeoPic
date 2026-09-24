'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import styles from "./TrackEditMenu.module.scss";
import { GpxTrackMetadata } from "@/types/GpxTrack";
import {
  Route,
  X,
  Maximize2,
  Check,
  Loader2,
  Sliders,
  Calendar,
  Clock,
  RotateCcw,
  CheckCircle2,
  Layers,
  Sparkles,
} from "lucide-react";

export interface TrackEditMenuProps {
  track: GpxTrackMetadata;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    id: string,
    updates: {
      name: string;
      timeOffsetMs: number;
      startTime: string;
      endTime: string;
    }
  ) => Promise<void>;
  onPreviewTimeOffset: (trackId: string, previewOffsetMs: number) => void;
  onRevertPreview: (trackId: string) => void;
  onZoomToTrack?: () => void;
  onOpenAllTracks?: () => void;
}

function toLocalDateStr(ms: number): string {
  if (!ms || Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalTimeStr(ms: number): string {
  if (!ms || Number.isNaN(ms)) return "00:00:00";
  const d = new Date(ms);
  const hr = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${hr}:${min}:${sec}`;
}

function parseLocalInputsToMs(dateStr: string, timeStr: string, fallbackMs: number): number {
  if (!dateStr) return fallbackMs;
  const [y, m, d] = dateStr.split("-").map(Number);
  const timeParts = (timeStr || "00:00:00").split(":").map(Number);
  const hr = timeParts[0] || 0;
  const min = timeParts[1] || 0;
  const sec = timeParts[2] || 0;
  const dt = new Date(y, m - 1, d, hr, min, sec);
  const t = dt.getTime();
  return Number.isNaN(t) ? fallbackMs : t;
}

function formatOffsetHuman(offsetMs: number): string {
  if (offsetMs === 0) return "0 min";
  const sign = offsetMs > 0 ? "+" : "-";
  const absMs = Math.abs(offsetMs);
  const totalSeconds = Math.round(absMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hr${hours > 1 ? "s" : ""}`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds} sec`);
  return `${sign}${parts.join(" ") || "0 min"}`;
}

function formatMinutesBadge(minutes: number): string {
  if (minutes === 0) return "±0 min";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

export default function TrackEditMenu({
  track,
  isOpen,
  onClose,
  onSave,
  onPreviewTimeOffset,
  onRevertPreview,
  onZoomToTrack,
  onOpenAllTracks,
}: TrackEditMenuProps) {
  // Track original raw file start time
  const currentStartMs = useMemo(() => {
    return track.startTime ? new Date(track.startTime).getTime() : Date.now();
  }, [track.startTime]);

  const currentSavedOffsetMs = useMemo(() => {
    return track.timeOffsetMs || 0;
  }, [track.timeOffsetMs]);

  // Original unshifted raw timestamp
  const rawStartMs = useMemo(() => {
    return currentStartMs - currentSavedOffsetMs;
  }, [currentStartMs, currentSavedOffsetMs]);

  const durationMs = useMemo(() => {
    if (track.startTime && track.endTime) {
      const s = new Date(track.startTime).getTime();
      const e = new Date(track.endTime).getTime();
      return Math.max(0, e - s);
    }
    return 0;
  }, [track.startTime, track.endTime]);

  // Form State
  const [name, setName] = useState(track.name || "");
  const [basePickedMs, setBasePickedMs] = useState<number>(currentStartMs);
  const [sliderMinutes, setSliderMinutes] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live Debounce State
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [isLiveSynced, setIsLiveSynced] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstRender = useRef(true);

  // Effective start time = base picked time + slider fine-tune
  const effectiveStartMs = useMemo(() => {
    return basePickedMs + sliderMinutes * 60 * 1000;
  }, [basePickedMs, sliderMinutes]);

  // Total offset from raw file
  const totalOffsetMs = useMemo(() => {
    return effectiveStartMs - rawStartMs;
  }, [effectiveStartMs, rawStartMs]);

  // Derived date & time string for inputs
  const displayDateStr = useMemo(() => toLocalDateStr(effectiveStartMs), [effectiveStartMs]);
  const displayTimeStr = useMemo(() => toLocalTimeStr(effectiveStartMs), [effectiveStartMs]);

  // Re-sync when track changes
  useEffect(() => {
    setName(track.name || "");
    const initStart = track.startTime ? new Date(track.startTime).getTime() : Date.now();
    setBasePickedMs(initStart);
    setSliderMinutes(0);
    setError(null);
    setIsLiveSynced(false);
    setIsDebouncing(false);
    isFirstRender.current = true;
  }, [track.id, track.name, track.startTime]);

  // Debounced live update to map markers (500ms debounce)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setIsDebouncing(true);
    setIsLiveSynced(false);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onPreviewTimeOffset(track.id, totalOffsetMs);
      setIsDebouncing(false);
      setIsLiveSynced(true);
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [totalOffsetMs, track.id, onPreviewTimeOffset]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  // Handle manual date picker change
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDateStr = e.target.value;
    const newMs = parseLocalInputsToMs(newDateStr, displayTimeStr, effectiveStartMs);
    setBasePickedMs(newMs);
    setSliderMinutes(0); // Re-center slider around chosen date
  };

  // Handle manual time picker change (can exceed ±3 hours)
  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTimeStr = e.target.value;
    const newMs = parseLocalInputsToMs(displayDateStr, newTimeStr, effectiveStartMs);
    setBasePickedMs(newMs);
    setSliderMinutes(0); // Re-center slider around chosen time
  };

  // Handle fine adjustment slider change (-180 to +180 minutes)
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSliderMinutes(Number.isNaN(val) ? 0 : val);
  };

  // Quick preset button click
  const handleApplyPresetMinutes = (deltaMin: number) => {
    if (deltaMin === 0) {
      setSliderMinutes(0);
      return;
    }
    setSliderMinutes((prev) => {
      const next = prev + deltaMin;
      return Math.max(-180, Math.min(180, next));
    });
  };

  // Reset to original raw GPX timestamp
  const handleResetToRawOriginal = () => {
    setBasePickedMs(rawStartMs);
    setSliderMinutes(0);
  };

  // Re-center slider around current time
  const handleRecenterSlider = () => {
    setBasePickedMs(effectiveStartMs);
    setSliderMinutes(0);
  };

  // Cancel and discard all live changes
  const handleCancel = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    onRevertPreview(track.id);
    onClose();
  };

  // Save changes to backend
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please provide a track name.");
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setIsSubmitting(true);
    try {
      const newStartTimeIso = new Date(effectiveStartMs).toISOString();
      const newEndTimeIso = new Date(effectiveStartMs + durationMs).toISOString();

      await onSave(track.id, {
        name: trimmedName,
        timeOffsetMs: totalOffsetMs,
        startTime: newStartTimeIso,
        endTime: newEndTimeIso,
      });

      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save track changes";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const originalDateDisplay = new Date(rawStartMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });

  return (
    <div className={styles.menuContainer}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <Route size={18} />
          </div>
          <div className={styles.headerTitles}>
            <span className={styles.title} title={track.name}>
              Edit Track: {track.name}
            </span>
            <span className={styles.subtitle}>
              <span>{track.pointsCount.toLocaleString()} points</span>
              <span>·</span>
              <span>{track.type === "url" ? "Live URL" : "GPX File"}</span>
            </span>
          </div>
        </div>

        <div className={styles.headerActions}>
          {onOpenAllTracks && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onOpenAllTracks}
              title="All Tracks & Layers"
            >
              <Layers size={16} />
            </button>
          )}

          {track.bounds && onZoomToTrack && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onZoomToTrack}
              title="Zoom to track bounds"
            >
              <Maximize2 size={16} />
            </button>
          )}

          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleCancel}
            title="Close editor (Cancel)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body Form */}
      <form onSubmit={handleSave} className={styles.body}>
        {error && (
          <div className={styles.hint} style={{ color: "var(--danger)", fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* Track Name */}
        <div className={styles.field}>
          <label className={styles.label}>Track Name</label>
          <input
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Track name"
            required
          />
        </div>

        {/* Date and Time Picker Section */}
        <div className={styles.field}>
          <div className={styles.label}>
            <span>Track Start Date & Time</span>
            <span style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)", textTransform: "none" }}>
              Exceeds ±3h
            </span>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <input
                type="date"
                className={styles.input}
                value={displayDateStr}
                onChange={handleDateChange}
                required
              />
            </div>
            <div className={styles.field}>
              <input
                type="time"
                step="1"
                className={styles.input}
                value={displayTimeStr}
                onChange={handleTimeChange}
                required
              />
            </div>
          </div>
          <span className={styles.hint}>
            Original start: {originalDateDisplay}
          </span>
        </div>

        {/* Fine Adjustment Slider (-3 hours to +3 hours) */}
        <div className={styles.sliderBox}>
          <div className={styles.sliderHeader}>
            <div className={styles.sliderTitle}>
              <Sliders size={14} />
              <span>Fine Adjustment Slider</span>
            </div>

            <span
              className={`${styles.offsetBadge} ${
                sliderMinutes === 0
                  ? styles.neutral
                  : sliderMinutes > 0
                  ? styles.positive
                  : styles.negative
              }`}
            >
              {formatMinutesBadge(sliderMinutes)}
            </span>
          </div>

          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={sliderMinutes}
            onChange={handleSliderChange}
            className={styles.rangeInput}
          />

          <div className={styles.ticksRow}>
            <span>-3h</span>
            <span>-2h</span>
            <span>-1h</span>
            <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>0</span>
            <span>+1h</span>
            <span>+2h</span>
            <span>+3h</span>
          </div>

          {/* Quick jump presets */}
          <div className={styles.chipGroup}>
            <button
              type="button"
              className={styles.chip}
              onClick={() => handleApplyPresetMinutes(-60)}
              title="Shift -1 hour"
            >
              -1h
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => handleApplyPresetMinutes(-15)}
              title="Shift -15 minutes"
            >
              -15m
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => handleApplyPresetMinutes(-1)}
              title="Shift -1 minute"
            >
              -1m
            </button>
            <button
              type="button"
              className={`${styles.chip} ${styles.resetChip}`}
              onClick={() => handleApplyPresetMinutes(0)}
              title="Reset slider offset to 0"
            >
              Slider 0
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => handleApplyPresetMinutes(1)}
              title="Shift +1 minute"
            >
              +1m
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => handleApplyPresetMinutes(15)}
              title="Shift +15 minutes"
            >
              +15m
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => handleApplyPresetMinutes(60)}
              title="Shift +1 hour"
            >
              +1h
            </button>
          </div>
        </div>

        {/* Live Debounce Indicator */}
        <div
          className={`${styles.statusIndicator} ${
            isDebouncing
              ? styles.debouncing
              : isLiveSynced
              ? styles.synced
              : styles.idle
          }`}
        >
          {isDebouncing ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>Updating map markers (0.5s debounce)...</span>
            </>
          ) : isLiveSynced ? (
            <>
              <CheckCircle2 size={13} />
              <span>Map markers live updated</span>
            </>
          ) : (
            <>
              <Clock size={13} />
              <span>Move slider or adjust time to reposition markers</span>
            </>
          )}
        </div>

        {/* Total Shift Summary */}
        <div className={styles.summaryBox}>
          <div className={styles.summaryRow}>
            <span>Total shift applied:</span>
            <strong>{formatOffsetHuman(totalOffsetMs)}</strong>
          </div>
          <div className={styles.summaryRow}>
            <span>New start time:</span>
            <span>{new Date(effectiveStartMs).toLocaleTimeString()}</span>
          </div>
        </div>

        {/* Action button to re-center slider or reset */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {sliderMinutes !== 0 && (
            <button
              type="button"
              className={`${styles.btn} ${styles.secondary}`}
              style={{ fontSize: 11, padding: "4px 8px" }}
              onClick={handleRecenterSlider}
              title="Bake slider into base time and re-center at 0"
            >
              <RotateCcw size={12} />
              <span>Re-center Slider</span>
            </button>
          )}

          {totalOffsetMs !== 0 && (
            <button
              type="button"
              className={`${styles.btn} ${styles.secondary}`}
              style={{ fontSize: 11, padding: "4px 8px" }}
              onClick={handleResetToRawOriginal}
              title="Reset completely to original GPX file timestamps"
            >
              <span>Reset to Original</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer} style={{ margin: "4px -16px -16px -16px" }}>
          <button
            type="button"
            className={`${styles.btn} ${styles.secondary}`}
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>

          <button
            type="submit"
            className={`${styles.btn} ${styles.primary}`}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span>Save Track</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
