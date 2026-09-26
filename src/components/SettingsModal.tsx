'use client';

import React, { useState, useEffect } from "react";
import styles from "./SettingsModal.module.scss";
import { AppSettings, DEFAULT_APP_SETTINGS } from "@/types/AppSettings";
import {
  Settings,
  X,
  Clock,
  Map,
  Sliders,
  Check,
  RotateCcw,
  Sparkles,
  Info,
  Layers,
  Save,
  Loader2,
} from "lucide-react";

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (updated: AppSettings) => Promise<void> | void;
  sessionToken?: string | null;
}

type TabType = "time" | "map" | "general";

const COMMON_TIMEZONES = [
  { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST - Germany, Austria, CH)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST - UK)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET/CEST - France)" },
  { value: "Europe/Rome", label: "Europe/Rome (CET/CEST - Italy)" },
  { value: "Europe/Madrid", label: "Europe/Madrid (CET/CEST - Spain)" },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (CET/CEST - Netherlands)" },
  { value: "Europe/Zurich", label: "Europe/Zurich (CET/CEST - Switzerland)" },
  { value: "Europe/Vienna", label: "Europe/Vienna (CET/CEST - Austria)" },
  { value: "Europe/Athens", label: "Europe/Athens (EET/EEST - Greece)" },
  { value: "America/New_York", label: "America/New_York (EST/EDT - US Eastern)" },
  { value: "America/Chicago", label: "America/Chicago (CST/CDT - US Central)" },
  { value: "America/Denver", label: "America/Denver (MST/MDT - US Mountain)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST/PDT - US Pacific)" },
  { value: "America/Toronto", label: "America/Toronto (Canada Eastern)" },
  { value: "America/Vancouver", label: "America/Vancouver (Canada Pacific)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST - Japan)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (CST - China)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT - Singapore)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT - Sydney)" },
  { value: "Australia/Melbourne", label: "Australia/Melbourne (AEST/AEDT - Melbourne)" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland (NZST/NZDT - New Zealand)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
];

const PRESET_POLYLINE_COLORS = [
  { value: "#4250af", label: "Indigo" },
  { value: "#0d9488", label: "Teal" },
  { value: "#059669", label: "Emerald" },
  { value: "#d97706", label: "Amber" },
  { value: "#e11d48", label: "Rose" },
  { value: "#7c3aed", label: "Purple" },
  { value: "#2563eb", label: "Blue" },
  { value: "#ea580c", label: "Orange" },
];

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("time");
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
      setSaveSuccess(false);
      setIsSaving(false);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleToggle = (key: keyof AppSettings) => {
    setDraft((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSelectChange = (key: keyof AppSettings, val: string | number) => {
    setDraft((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  const handleResetDefaults = () => {
    setDraft(DEFAULT_APP_SETTINGS);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveSettings(draft);
      setSaveSuccess(true);
      setTimeout(() => {
        onClose();
      }, 350);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Settings size={20} />
            </div>
            <div>
              <h2 className={styles.title}>Application Settings</h2>
              <span className={styles.subtitle}>
                Configure timezone handling, map visualization & defaults
              </span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabNav}>
          <button
            className={`${styles.tabBtn} ${activeTab === "time" ? styles.active : ""}`}
            onClick={() => setActiveTab("time")}
          >
            <Clock size={16} />
            <span>Time & Timezones</span>
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === "map" ? styles.active : ""}`}
            onClick={() => setActiveTab("map")}
          >
            <Map size={16} />
            <span>Map & Routing</span>
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === "general" ? styles.active : ""}`}
            onClick={() => setActiveTab("general")}
          >
            <Sliders size={16} />
            <span>General & Defaults</span>
          </button>
        </div>

        {/* Content Body */}
        <div className={styles.content}>
          {activeTab === "time" && (
            <div className={styles.settingGroup}>
              {/* Callout explaining the camera DST trap */}
              <div className={styles.callout}>
                <Sparkles size={18} />
                <div>
                  <strong>Camera Daylight Saving (DST) Compensation:</strong> Most standalone
                  cameras lack automatic DST toggles. If you adjusted your camera clock for summer
                  time without enabling the camera's DST menu setting, photos will carry a standard winter
                  offset (e.g. +01:00). GeoPic automatically detects and fixes this mismatch.
                </div>
              </div>

              {/* Setting: Auto-detect DST Mismatch */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel} htmlFor="dst-toggle">
                    Auto-detect Camera DST Mismatch
                    <span className={styles.badge}>Recommended</span>
                  </label>
                  <span className={styles.settingDesc}>
                    When photos shot in summer carry a standard-time winter offset (+01:00) or no offset,
                    automatically calculate using true summer time (UTC+2) to match GPS satellites.
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    id="dst-toggle"
                    type="checkbox"
                    checked={draft.autoDetectDstMismatch}
                    onChange={() => handleToggle("autoDetectDstMismatch")}
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              {/* Setting: Prefer GPX Track Timezone */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel} htmlFor="prefer-gpx-tz">
                    Prefer GPX Track Timezone
                  </label>
                  <span className={styles.settingDesc}>
                    Use the location coordinates of the active GPX track to resolve the local IANA
                    timezone for unlocated photos, rather than relying on camera EXIF tags that may be misconfigured.
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    id="prefer-gpx-tz"
                    type="checkbox"
                    checked={draft.preferGpxTimezone}
                    onChange={() => handleToggle("preferGpxTimezone")}
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              {/* Setting: Strict GPX UTC */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel} htmlFor="strict-gpx-utc">
                    Strict GPX UTC Parsing
                  </label>
                  <span className={styles.settingDesc}>
                    According to the GPX standard, trackpoint timestamps are always UTC. Prevent
                    the browser from interpreting timestamps lacking a &apos;Z&apos; as local browser time.
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    id="strict-gpx-utc"
                    type="checkbox"
                    checked={draft.strictGpxUtc}
                    onChange={() => handleToggle("strictGpxUtc")}
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              {/* Setting: Fallback Timezone */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel}>
                    Default Fallback Timezone
                  </label>
                  <span className={styles.settingDesc}>
                    Timezone to assume for photos when no GPS track is loaded and the image has no location metadata.
                  </span>
                </div>
                <select
                  className={styles.selectInput}
                  value={draft.fallbackTimezone}
                  onChange={(e) => handleSelectChange("fallbackTimezone", e.target.value)}
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {activeTab === "map" && (
            <div className={styles.settingGroup}>
              {/* Setting: Show Continuous Polyline */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel} htmlFor="polyline-toggle">
                    Continuous Route Polyline
                  </label>
                  <span className={styles.settingDesc}>
                    Draw a continuous line connecting photo markers and GPX track points along the chronological sequence.
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    id="polyline-toggle"
                    type="checkbox"
                    checked={draft.showContinuousPolyline}
                    onChange={() => handleToggle("showContinuousPolyline")}
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              {/* Setting: Route Line Color */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel}>
                    Route Line Color
                  </label>
                  <span className={styles.settingDesc}>
                    Color used for the connected route polyline on the map.
                  </span>
                </div>
                <div className={styles.colorPickerGroup}>
                  {PRESET_POLYLINE_COLORS.map((col) => (
                    <button
                      key={col.value}
                      type="button"
                      className={`${styles.colorBtn} ${draft.polylineColor === col.value ? styles.active : ""}`}
                      style={{ backgroundColor: col.value }}
                      onClick={() => handleSelectChange("polylineColor", col.value)}
                      title={col.label}
                    />
                  ))}
                </div>
              </div>

              {/* Setting: Marker Tooltip Threshold */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel}>
                    Marker Tooltip Clutter Threshold
                  </label>
                  <span className={styles.settingDesc}>
                    When total loaded photos exceed this count, filename tooltips are hidden to preserve map performance.
                  </span>
                </div>
                <input
                  type="number"
                  className={styles.numberInput}
                  min={100}
                  max={10000}
                  step={100}
                  value={draft.markerTooltipThreshold}
                  onChange={(e) =>
                    handleSelectChange("markerTooltipThreshold", Number(e.target.value) || 1500)
                  }
                />
              </div>
            </div>
          )}

          {activeTab === "general" && (
            <div className={styles.settingGroup}>
              {/* Setting: Default Timespan Preset */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel}>
                    Default Launch Timespan Filter
                  </label>
                  <span className={styles.settingDesc}>
                    The date range automatically queried when opening Immich GeoPic.
                  </span>
                </div>
                <select
                  className={styles.selectInput}
                  value={draft.defaultTimespanPreset}
                  onChange={(e) =>
                    handleSelectChange(
                      "defaultTimespanPreset",
                      e.target.value as "1m" | "3m" | "6m" | "1y" | "all"
                    )
                  }
                >
                  <option value="1m">Past 1 Month (1M)</option>
                  <option value="3m">Past 3 Months (3M)</option>
                  <option value="6m">Past 6 Months (6M - Default)</option>
                  <option value="1y">Past 1 Year (1Y)</option>
                  <option value="all">All Photos (May take longer)</option>
                </select>
              </div>

              {/* Setting: Confirm Bulk Location Writes */}
              <div className={styles.settingItem}>
                <div className={styles.settingText}>
                  <label className={styles.settingLabel} htmlFor="confirm-bulk">
                    Confirm Bulk Location Updates
                  </label>
                  <span className={styles.settingDesc}>
                    Show a confirmation summary before syncing relocated markers to Immich.
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    id="confirm-bulk"
                    type="checkbox"
                    checked={draft.confirmBulkLocationUpdates}
                    onChange={() => handleToggle("confirmBulkLocationUpdates")}
                  />
                  <span className={styles.slider} />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={handleResetDefaults}
            title="Reset to default settings"
          >
            <RotateCcw size={14} />
            <span>Reset Defaults</span>
          </button>
          <div className={styles.footerActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className={styles.spinning} />
                  <span>Saving...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check size={16} />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save size={16} />
                  <span>Save Settings</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
