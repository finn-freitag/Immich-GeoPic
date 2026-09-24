'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import styles from "./SelectionBuilderModal.module.scss";
import {
  X,
  Filter,
  Camera,
  Calendar,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Check,
  Search,
} from "lucide-react";
import type { MapDisplayItem } from "./LeafletGeorefMap";
import type L from "leaflet";

export interface SelectionBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selectedItemIds: string[]) => void;
  images: MapDisplayItem[];
  initialBounds: L.LatLngBounds | null;
  topBarStartDate?: string;
  topBarEndDate?: string;
}

function hasValidCoords(img: MapDisplayItem): boolean {
  return Boolean(
    img.coords &&
      typeof img.coords.lat === "number" &&
      typeof img.coords.lng === "number" &&
      !Number.isNaN(img.coords.lat) &&
      !Number.isNaN(img.coords.lng)
  );
}

function toDateTimeLocalString(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

function fromDateTimeLocalString(str: string, fallbackMs: number): number {
  if (!str) return fallbackMs;
  const d = new Date(str);
  const t = d.getTime();
  return Number.isNaN(t) ? fallbackMs : t;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0 min";
  const minutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days} days`;
  }
  if (hours > 0) {
    const remMins = minutes % 60;
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours} hours`;
  }
  return `${minutes} mins`;
}

function formatReadableDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SelectionBuilderModal({
  isOpen,
  onClose,
  onApply,
  images,
  initialBounds,
  topBarStartDate,
  topBarEndDate,
}: SelectionBuilderModalProps) {
  // 1. Geographic Bounds Filter (if initialBounds exists)
  const [limitToPreviousBounds, setLimitToPreviousBounds] = useState(true);

  // When opening, reset default state if bounds exists
  useEffect(() => {
    if (isOpen) {
      setLimitToPreviousBounds(Boolean(initialBounds));
    }
  }, [isOpen, initialBounds]);

  // Photos inside previous rectangle
  const photosInInitialBounds = useMemo(() => {
    if (!initialBounds) return [];
    return images.filter((img) => {
      const c = img.coords || img.estCoords;
      if (!c || Number.isNaN(c.lat) || Number.isNaN(c.lng)) return false;
      return initialBounds.contains([c.lat, c.lng]);
    });
  }, [images, initialBounds]);

  // Eligible candidate photos before builder criteria
  const eligiblePhotos = useMemo(() => {
    if (initialBounds && limitToPreviousBounds) {
      return photosInInitialBounds;
    }
    return images;
  }, [images, initialBounds, limitToPreviousBounds, photosInInitialBounds]);

  // 2. Status Checkboxes (Verified / Estimated)
  const [includeVerified, setIncludeVerified] = useState(true);
  const [includeEstimated, setIncludeEstimated] = useState(true);

  // Count available in candidate pool
  const verifiedInPool = useMemo(
    () => eligiblePhotos.filter((p) => hasValidCoords(p)).length,
    [eligiblePhotos]
  );
  const estimatedInPool = eligiblePhotos.length - verifiedInPool;

  // 3. Timespan range boundaries [barMinMs, barMaxMs]
  const { barMinMs, barMaxMs } = useMemo(() => {
    let minMs: number | null = null;
    let maxMs: number | null = null;

    if (topBarStartDate && topBarStartDate.trim() !== "") {
      const s = new Date(`${topBarStartDate}T00:00:00`).getTime();
      if (!Number.isNaN(s)) minMs = s;
    }
    if (topBarEndDate && topBarEndDate.trim() !== "") {
      const e = new Date(`${topBarEndDate}T23:59:59.999`).getTime();
      if (!Number.isNaN(e)) maxMs = e;
    }

    // Fallback to min/max timestamp of candidate photos if top bar dates are not set (e.g. preset 'all')
    if (minMs == null || maxMs == null) {
      for (const img of images) {
        const t = new Date(img.timestamp).getTime();
        if (!Number.isNaN(t)) {
          if (minMs == null || t < minMs) minMs = t;
          if (maxMs == null || t > maxMs) maxMs = t;
        }
      }
    }

    const now = Date.now();
    const fallbackMin = now - 180 * 24 * 3600 * 1000;
    const resolvedMin = minMs ?? fallbackMin;
    let resolvedMax = maxMs ?? now;

    if (resolvedMax <= resolvedMin) {
      resolvedMax = resolvedMin + 24 * 3600 * 1000;
    }

    return { barMinMs: resolvedMin, barMaxMs: resolvedMax };
  }, [topBarStartDate, topBarEndDate, images]);

  // Sliders state
  const [sliderStart, setSliderStart] = useState<number>(barMinMs);
  const [sliderEnd, setSliderEnd] = useState<number>(barMaxMs);
  const [activeThumb, setActiveThumb] = useState<"start" | "end">("start");

  // Sync sliders when bounds change or dialog opens
  useEffect(() => {
    if (isOpen) {
      setSliderStart(barMinMs);
      setSliderEnd(barMaxMs);
    }
  }, [isOpen, barMinMs, barMaxMs]);

  // 4. Camera extraction & selection
  const availableCameras = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();

    for (const img of eligiblePhotos) {
      const cam = img.camera?.trim();
      const id = cam || "__unknown__";
      const name = cam || "No Camera / Unknown EXIF";
      const current = counts.get(id);
      if (current) {
        current.count++;
      } else {
        counts.set(id, { name, count: 1 });
      }
    }

    return Array.from(counts.entries())
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => b.count - a.count);
  }, [eligiblePhotos]);

  const [selectedCameras, setSelectedCameras] = useState<Set<string>>(new Set());
  const [cameraSearch, setCameraSearch] = useState("");

  // Initialize selectedCameras to include all cameras whenever availableCameras changes
  const prevCamerasRef = useRef<string>("");
  useEffect(() => {
    const key = availableCameras.map((c) => c.id).sort().join(",");
    if (key !== prevCamerasRef.current) {
      prevCamerasRef.current = key;
      setSelectedCameras(new Set(availableCameras.map((c) => c.id)));
    }
  }, [availableCameras]);

  const toggleCamera = (id: string) => {
    setSelectedCameras((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllCameras = () => {
    setSelectedCameras(new Set(availableCameras.map((c) => c.id)));
  };

  const handleDeselectAllCameras = () => {
    setSelectedCameras(new Set());
  };

  // Filter camera search list
  const filteredCameraList = useMemo(() => {
    if (!cameraSearch.trim()) return availableCameras;
    const q = cameraSearch.toLowerCase();
    return availableCameras.filter((c) => c.name.toLowerCase().includes(q));
  }, [availableCameras, cameraSearch]);

  // 5. Compute matching photos live
  const matchingPhotos = useMemo(() => {
    return eligiblePhotos.filter((img) => {
      // Status filter
      const isVerified = hasValidCoords(img);
      if (isVerified && !includeVerified) return false;
      if (!isVerified && !includeEstimated) return false;

      // Timespan filter
      const t = new Date(img.timestamp).getTime();
      if (!Number.isNaN(t)) {
        if (t < sliderStart || t > sliderEnd) return false;
      }

      // Camera filter
      const camId = img.camera?.trim() || "__unknown__";
      if (!selectedCameras.has(camId)) return false;

      return true;
    });
  }, [
    eligiblePhotos,
    includeVerified,
    includeEstimated,
    sliderStart,
    sliderEnd,
    selectedCameras,
  ]);

  const verifiedMatching = useMemo(
    () => matchingPhotos.filter((p) => hasValidCoords(p)).length,
    [matchingPhotos]
  );
  const estimatedMatching = matchingPhotos.length - verifiedMatching;

  // Keydown ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Percentage calculations for dual range track fill
  const totalRange = Math.max(barMaxMs - barMinMs, 1);
  const startPercent = Math.min(
    Math.max(((sliderStart - barMinMs) / totalRange) * 100, 0),
    100
  );
  const endPercent = Math.min(
    Math.max(((sliderEnd - barMinMs) / totalRange) * 100, 0),
    100
  );

  const handleApply = () => {
    if (matchingPhotos.length === 0) return;
    onApply(matchingPhotos.map((p) => p.id));
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="selection-builder-title"
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Filter size={20} />
            </div>
            <div>
              <h2 id="selection-builder-title" className={styles.title}>
                Build a Selection
              </h2>
              <p className={styles.subtitle}>
                Filter photos by map rectangle, time span, camera, and verification status
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Previous Rectangle Spatial Filter */}
          {initialBounds ? (
            <div className={styles.boundsFilterCard}>
              <div className={styles.boundsFilterLeft}>
                <div className={styles.boundsFilterIcon}>
                  <MapPin size={18} />
                </div>
                <div className={styles.boundsFilterText}>
                  <span className={styles.boundsFilterTitle}>
                    Map Rectangle Filter ({photosInInitialBounds.length} photos)
                  </span>
                  <span className={styles.boundsFilterDesc}>
                    Restricting selection to the rectangular area previously drawn on the map
                  </span>
                </div>
              </div>
              <label className={styles.boundsToggle}>
                <input
                  type="checkbox"
                  checked={limitToPreviousBounds}
                  onChange={(e) => setLimitToPreviousBounds(e.target.checked)}
                />
                <span>Active</span>
              </label>
            </div>
          ) : (
            <div className={styles.boundsFilterCard} style={{ background: "var(--surface-hover)" }}>
              <div className={styles.boundsFilterLeft}>
                <div className={styles.boundsFilterIcon} style={{ color: "var(--text-muted)" }}>
                  <MapPin size={18} />
                </div>
                <div className={styles.boundsFilterText}>
                  <span className={styles.boundsFilterTitle}>Map Area: Whole Map</span>
                  <span className={styles.boundsFilterDesc}>
                    No previous rectangle active; searching across all {images.length} photos
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Status Checkboxes (Verified / Estimated) */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                <CheckCircle2 size={14} /> Photo Status
              </span>
            </div>
            <div className={styles.statusGrid}>
              {/* Verified Checkbox */}
              <div
                className={`${styles.statusCard} ${includeVerified ? styles.active : ""}`}
                onClick={() => setIncludeVerified((prev) => !prev)}
              >
                <div className={styles.statusCardLeft}>
                  <input
                    type="checkbox"
                    className={styles.statusCheckbox}
                    checked={includeVerified}
                    onChange={(e) => setIncludeVerified(e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className={styles.statusLabel}>
                    <CheckCircle2 size={14} color="var(--success)" />
                    Verified GPS
                  </span>
                </div>
                <span className={`${styles.statusBadge} ${styles.verified}`}>
                  {verifiedInPool} photos
                </span>
              </div>

              {/* Estimated Checkbox */}
              <div
                className={`${styles.statusCard} ${includeEstimated ? styles.active : ""}`}
                onClick={() => setIncludeEstimated((prev) => !prev)}
              >
                <div className={styles.statusCardLeft}>
                  <input
                    type="checkbox"
                    className={styles.statusCheckbox}
                    checked={includeEstimated}
                    onChange={(e) => setIncludeEstimated(e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className={styles.statusLabel}>
                    <AlertCircle size={14} color="var(--warning)" />
                    Estimated
                  </span>
                </div>
                <span className={`${styles.statusBadge} ${styles.estimated}`}>
                  {estimatedInPool} photos
                </span>
              </div>
            </div>
          </div>

          {/* Timespan Selector */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                <Calendar size={14} /> Timespan Range
              </span>
              <span className={styles.rangeDurationBadge}>
                Selected: {formatDuration(sliderEnd - sliderStart)}
              </span>
            </div>

            <div className={styles.sliderCard}>
              <div className={styles.sliderLabelsRow}>
                <span>{formatReadableDate(barMinMs)}</span>
                <span>{formatReadableDate(barMaxMs)}</span>
              </div>

              {/* Dual Range Slider Bar */}
              <div className={styles.sliderBarTrack}>
                <div className={styles.trackBase} />
                <div
                  className={styles.trackFill}
                  style={{
                    left: `${startPercent}%`,
                    width: `${Math.max(endPercent - startPercent, 0)}%`,
                  }}
                />

                {/* Left Thumb */}
                <input
                  type="range"
                  min={barMinMs}
                  max={barMaxMs}
                  step={60000}
                  value={sliderStart}
                  onMouseDown={() => setActiveThumb("start")}
                  onTouchStart={() => setActiveThumb("start")}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setSliderStart(Math.min(val, sliderEnd));
                  }}
                  className={`${styles.rangeInput} ${
                    activeThumb === "start" ? styles.activeThumb : ""
                  }`}
                  aria-label="Start time slider"
                />

                {/* Right Thumb */}
                <input
                  type="range"
                  min={barMinMs}
                  max={barMaxMs}
                  step={60000}
                  value={sliderEnd}
                  onMouseDown={() => setActiveThumb("end")}
                  onTouchStart={() => setActiveThumb("end")}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setSliderEnd(Math.max(val, sliderStart));
                  }}
                  className={`${styles.rangeInput} ${
                    activeThumb === "end" ? styles.activeThumb : ""
                  }`}
                  aria-label="End time slider"
                />
              </div>

              {/* Precise Time Inputs (Left and Right below) */}
              <div className={styles.timeInputsRow}>
                <div className={styles.timeInputCol}>
                  <label className={styles.timeInputLabel}>Start Time</label>
                  <input
                    type="datetime-local"
                    className={styles.timeInputField}
                    value={toDateTimeLocalString(sliderStart)}
                    min={toDateTimeLocalString(barMinMs)}
                    max={toDateTimeLocalString(sliderEnd)}
                    onChange={(e) => {
                      const val = fromDateTimeLocalString(e.target.value, sliderStart);
                      setSliderStart(Math.max(barMinMs, Math.min(val, sliderEnd)));
                    }}
                  />
                </div>

                <div className={styles.timeArrow}>➔</div>

                <div className={`${styles.timeInputCol} ${styles.timeInputColRight}`}>
                  <label className={styles.timeInputLabel}>End Time</label>
                  <input
                    type="datetime-local"
                    className={styles.timeInputField}
                    value={toDateTimeLocalString(sliderEnd)}
                    min={toDateTimeLocalString(sliderStart)}
                    max={toDateTimeLocalString(barMaxMs)}
                    onChange={(e) => {
                      const val = fromDateTimeLocalString(e.target.value, sliderEnd);
                      setSliderEnd(Math.min(barMaxMs, Math.max(val, sliderStart)));
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Camera Filter */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                <Camera size={14} /> Cameras ({selectedCameras.size}/{availableCameras.length})
              </span>
              <div className={styles.cameraActions}>
                <button
                  type="button"
                  className={styles.cameraActionBtn}
                  onClick={handleSelectAllCameras}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className={styles.cameraActionBtn}
                  onClick={handleDeselectAllCameras}
                >
                  Deselect All
                </button>
              </div>
            </div>

            {availableCameras.length > 5 && (
              <div className={styles.cameraSearchWrapper}>
                <input
                  type="text"
                  placeholder="Search cameras..."
                  className={styles.cameraSearchInput}
                  value={cameraSearch}
                  onChange={(e) => setCameraSearch(e.target.value)}
                />
              </div>
            )}

            <div className={styles.cameraList}>
              {filteredCameraList.length === 0 ? (
                <div className={styles.emptyCameras}>No cameras match your search.</div>
              ) : (
                filteredCameraList.map((cam) => {
                  const isChecked = selectedCameras.has(cam.id);
                  return (
                    <div
                      key={cam.id}
                      className={`${styles.cameraItem} ${isChecked ? styles.selected : ""}`}
                      onClick={() => toggleCamera(cam.id)}
                    >
                      <div className={styles.cameraItemLeft}>
                        <input
                          type="checkbox"
                          className={styles.statusCheckbox}
                          checked={isChecked}
                          onChange={() => toggleCamera(cam.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Camera size={14} color="var(--text-muted)" />
                        <span className={styles.cameraName} title={cam.name}>
                          {cam.name}
                        </span>
                      </div>
                      <span className={styles.cameraCountBadge}>{cam.count}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.summaryText}>
            <span>
              {matchingPhotos.length} photos selected
            </span>
            <span className={styles.summarySubtext}>
              ({verifiedMatching} verified, {estimatedMatching} estimated)
            </span>
          </div>

          <div className={styles.footerActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.applyBtn}
              onClick={handleApply}
              disabled={matchingPhotos.length === 0}
            >
              <Check size={16} />
              <span>Apply Selection</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
