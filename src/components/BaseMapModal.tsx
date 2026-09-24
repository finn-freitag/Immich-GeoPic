'use client';

import React, { useState, useEffect, useRef } from "react";
import styles from "./BaseMapModal.module.scss";
import { BaseMap, BaseMapPreset } from "@/types/BaseMap";
import { GpxTrackMetadata } from "@/types/GpxTrack";
import {
  Layers,
  X,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  Sparkles,
  UploadCloud,
  Globe,
  FileText,
  Eye,
  EyeOff,
  Maximize2,
  Route,
  Link,
  Pencil,
} from "lucide-react";

export type BaseMapModalProps = {
  isOpen: boolean;
  onClose: () => void;
  baseMaps: BaseMap[];
  selectedId: string;
  presets: BaseMapPreset[];
  onSelectBaseMap: (id: string) => void;
  onAddBaseMap: (map: Omit<BaseMap, "id" | "isDefault">) => Promise<void>;
  onDeleteBaseMap: (id: string) => Promise<void>;

  // GPX Track Props
  gpxTracks?: GpxTrackMetadata[];
  onToggleGpxVisibility?: (id: string, isVisible: boolean) => Promise<void>;
  onUploadGpxFile?: (file: File) => Promise<void>;
  onAddGpxUrl?: (url: string, name?: string) => Promise<void>;
  onDeleteGpxTrack?: (id: string) => Promise<void>;
  onZoomToGpxTrack?: (track: GpxTrackMetadata) => void;
  onEditGpxTrack?: (track: GpxTrackMetadata) => void;
  initialTab?: "basemaps" | "gpx";
};

function formatTrackTime(startIso?: string, endIso?: string): string | null {
  if (!startIso) return null;
  const s = new Date(startIso);
  if (Number.isNaN(s.getTime())) return null;

  const dateStr = s.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const startTimeStr = s.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (!endIso) return `${dateStr} · ${startTimeStr}`;
  const e = new Date(endIso);
  if (Number.isNaN(e.getTime())) return `${dateStr} · ${startTimeStr}`;

  const endTimeStr = e.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} · ${startTimeStr} – ${endTimeStr}`;
}

export default function BaseMapModal({
  isOpen,
  onClose,
  baseMaps,
  selectedId,
  presets,
  onSelectBaseMap,
  onAddBaseMap,
  onDeleteBaseMap,
  gpxTracks = [],
  onToggleGpxVisibility,
  onUploadGpxFile,
  onAddGpxUrl,
  onDeleteGpxTrack,
  onZoomToGpxTrack,
  onEditGpxTrack,
  initialTab = "basemaps",
}: BaseMapModalProps) {
  const [activeTab, setActiveTab] = useState<"basemaps" | "gpx">(initialTab);

  // Base map form state
  const [isAddingBaseMap, setIsAddingBaseMap] = useState(false);
  const [bmName, setBmName] = useState("");
  const [bmUrl, setBmUrl] = useState("");
  const [bmAttribution, setBmAttribution] = useState("");
  const [bmMaxZoom, setBmMaxZoom] = useState(19);
  const [bmSubdomains, setBmSubdomains] = useState("abc");
  const [isSubmittingBaseMap, setIsSubmittingBaseMap] = useState(false);
  const [deletingBmId, setDeletingBmId] = useState<string | null>(null);

  // GPX track form state
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [gpxUrlInput, setGpxUrlInput] = useState("");
  const [gpxNameInput, setGpxNameInput] = useState("");
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);
  const [isUploadingGpx, setIsUploadingGpx] = useState(false);
  const [deletingGpxId, setDeletingGpxId] = useState<string | null>(null);
  const [isDraggingModal, setIsDraggingModal] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync initial tab when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setError(null);
    }
  }, [isOpen, initialTab]);

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (isAddingBaseMap) {
          setIsAddingBaseMap(false);
        } else if (isAddingUrl) {
          setIsAddingUrl(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isAddingBaseMap, isAddingUrl, onClose]);

  if (!isOpen) return null;

  const handleApplyPreset = (preset: BaseMapPreset) => {
    setBmName(preset.name);
    setBmUrl(preset.url);
    setBmAttribution(preset.attribution || "");
    setBmMaxZoom(preset.maxZoom || 19);
    setBmSubdomains(preset.subdomains || "abc");
    setError(null);
  };

  const handleAddBaseMapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = bmName.trim();
    const trimmedUrl = bmUrl.trim();

    if (!trimmedName) {
      setError("Please provide a name for the base map.");
      return;
    }
    if (!trimmedUrl) {
      setError("Please provide a tile URL template.");
      return;
    }
    if (!trimmedUrl.includes("{z}") || !trimmedUrl.includes("{x}") || !trimmedUrl.includes("{y}")) {
      setError("The URL template must contain {z}, {x}, and {y} coordinate tokens.");
      return;
    }

    setIsSubmittingBaseMap(true);
    try {
      await onAddBaseMap({
        name: trimmedName,
        url: trimmedUrl,
        attribution: bmAttribution.trim(),
        maxZoom: Number(bmMaxZoom) || 19,
        subdomains: bmSubdomains.trim() || "abc",
      });
      setBmName("");
      setBmUrl("");
      setBmAttribution("");
      setBmMaxZoom(19);
      setBmSubdomains("abc");
      setIsAddingBaseMap(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add base map");
    } finally {
      setIsSubmittingBaseMap(false);
    }
  };

  const handleDeleteBaseMap = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to remove this base map?")) return;

    setDeletingBmId(id);
    setError(null);
    try {
      await onDeleteBaseMap(id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete base map");
    } finally {
      setDeletingBmId(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingGpx(true);
    setError(null);
    try {
      if (onUploadGpxFile) {
        await onUploadGpxFile(file);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload GPX file");
    } finally {
      setIsUploadingGpx(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleAddUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = gpxUrlInput.trim();
    if (!url) {
      setError("Please provide a GPX URL.");
      return;
    }

    setIsSubmittingUrl(true);
    setError(null);
    try {
      if (onAddGpxUrl) {
        await onAddGpxUrl(url, gpxNameInput.trim() || undefined);
      }
      setGpxUrlInput("");
      setGpxNameInput("");
      setIsAddingUrl(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add GPX URL track");
    } finally {
      setIsSubmittingUrl(false);
    }
  };

  const handleDeleteGpx = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to remove this GPX track?")) return;

    setDeletingGpxId(id);
    setError(null);
    try {
      if (onDeleteGpxTrack) {
        await onDeleteGpxTrack(id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete GPX track");
    } finally {
      setDeletingGpxId(null);
    }
  };

  const handleModalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingModal(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (!file.name.toLowerCase().endsWith(".gpx")) {
        setError("Only .gpx files are supported.");
        return;
      }

      setIsUploadingGpx(true);
      setError(null);
      try {
        if (onUploadGpxFile) {
          await onUploadGpxFile(file);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to upload GPX file");
      } finally {
        setIsUploadingGpx(false);
      }
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingModal(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDraggingModal(false);
        }}
        onDrop={handleModalDrop}
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Layers size={20} />
            </div>
            <div>
              <h2 className={styles.title}>Map Layers</h2>
              <span className={styles.subtitle}>Base maps and precision GPX tracks</span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === "basemaps" ? styles.activeTab : ""}`}
            onClick={() => {
              setActiveTab("basemaps");
              setError(null);
            }}
          >
            <Layers size={15} />
            <span>Base Maps</span>
            <span className={styles.tabBadge}>{baseMaps.length}</span>
          </button>
          <button
            className={`${styles.tab} ${activeTab === "gpx" ? styles.activeTab : ""}`}
            onClick={() => {
              setActiveTab("gpx");
              setError(null);
            }}
          >
            <Route size={15} />
            <span>GPX Tracks</span>
            <span className={styles.tabBadge}>{gpxTracks.length}</span>
          </button>
        </div>

        {/* Modal Content */}
        <div className={styles.content}>
          {error && (
            <div className={styles.errorBanner}>
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: Base Maps */}
          {activeTab === "basemaps" && (
            <>
              <div>
                <div className={styles.sectionTitle}>Available Base Maps</div>
                <div className={styles.mapList}>
                  {baseMaps.map((map) => {
                    const isSelected = selectedId === map.id;
                    const isDeleting = deletingBmId === map.id;

                    return (
                      <div
                        key={map.id}
                        className={`${styles.mapItem} ${isSelected ? styles.active : ""}`}
                        onClick={() => onSelectBaseMap(map.id)}
                      >
                        <div className={styles.mapItemLeft}>
                          <div className={styles.radioIndicator} />
                          <div className={styles.mapItemInfo}>
                            <span className={styles.mapItemName}>{map.name}</span>
                            <div className={styles.mapItemMeta}>
                              {map.isDefault ? (
                                <span className={`${styles.tag} ${styles.default}`}>Default</span>
                              ) : (
                                <span className={`${styles.tag} ${styles.custom}`}>Custom</span>
                              )}
                              {map.maxZoom && (
                                <span className={styles.subtitle}>Max Zoom: {map.maxZoom}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {!map.isDefault && (
                          <button
                            className={styles.deleteBtn}
                            onClick={(e) => handleDeleteBaseMap(map.id, e)}
                            disabled={isDeleting}
                            title="Remove base map"
                          >
                            {isDeleting ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Trash2 size={16} />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Add Custom Base Map */}
              <div className={styles.addSection}>
                {!isAddingBaseMap ? (
                  <button
                    className={styles.toggleAddBtn}
                    onClick={() => {
                      setError(null);
                      setIsAddingBaseMap(true);
                    }}
                  >
                    <Plus size={16} />
                    <span>Add Custom Base Map</span>
                  </button>
                ) : (
                  <form className={styles.addForm} onSubmit={handleAddBaseMapSubmit}>
                    <div className={styles.sectionTitle} style={{ marginBottom: 0 }}>
                      Add Base Map
                    </div>

                    {presets && presets.length > 0 && (
                      <div className={styles.presetBar}>
                        <div className={styles.presetLabel}>
                          <Sparkles size={11} style={{ display: "inline", marginRight: 4 }} />
                          Quick Presets:
                        </div>
                        <div className={styles.presetChips}>
                          {presets.map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              className={styles.presetChip}
                              onClick={() => handleApplyPreset(p)}
                            >
                              {p.name.split(" ")[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className={styles.field}>
                      <label className={styles.label}>Name</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. Esri Satellite, OpenTopoMap"
                        value={bmName}
                        onChange={(e) => setBmName(e.target.value)}
                        required
                      />
                    </div>

                    <div className={styles.field}>
                      <label className={styles.label}>Tile URL Template</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="https://{s}.tile.example.com/{z}/{x}/{y}.png"
                        value={bmUrl}
                        onChange={(e) => setBmUrl(e.target.value)}
                        required
                      />
                      <span className={styles.hint}>
                        Must include tokens: <code>{`{z}`}</code>, <code>{`{x}`}</code>, and <code>{`{y}`}</code>.
                      </span>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.label}>Attribution / Copyright (Optional)</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. &copy; OpenTopoMap contributors"
                        value={bmAttribution}
                        onChange={(e) => setBmAttribution(e.target.value)}
                      />
                    </div>

                    <div className={styles.formRow}>
                      <div className={styles.field} style={{ flex: 1 }}>
                        <label className={styles.label}>Max Zoom</label>
                        <input
                          type="number"
                          className={styles.input}
                          min={1}
                          max={24}
                          value={bmMaxZoom}
                          onChange={(e) => setBmMaxZoom(Number(e.target.value))}
                        />
                      </div>
                      <div className={styles.field} style={{ flex: 1 }}>
                        <label className={styles.label}>Subdomains</label>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="abc"
                          value={bmSubdomains}
                          onChange={(e) => setBmSubdomains(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className={styles.formActions}>
                      <button
                        type="button"
                        className={styles.cancelBtn}
                        onClick={() => {
                          setIsAddingBaseMap(false);
                          setError(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className={styles.saveBtn}
                        disabled={isSubmittingBaseMap}
                      >
                        {isSubmittingBaseMap ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            <Check size={14} />
                            <span>Save Base Map</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}

          {/* TAB 2: GPX Tracks */}
          {activeTab === "gpx" && (
            <>
              {/* Action Buttons */}
              <div className={styles.gpxTopActions}>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".gpx"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.primary}`}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingGpx}
                >
                  {isUploadingGpx ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <UploadCloud size={14} />
                  )}
                  <span>Upload GPX File</span>
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    setIsAddingUrl((prev) => !prev);
                    setError(null);
                  }}
                >
                  <Link size={14} />
                  <span>Add via URL</span>
                </button>
              </div>

              {/* Add Track via URL Form */}
              {isAddingUrl && (
                <form className={styles.addForm} onSubmit={handleAddUrlSubmit}>
                  <div className={styles.sectionTitle} style={{ marginBottom: 0 }}>
                    Add GPX Track from Live URL
                  </div>
                  <span className={styles.hint}>
                    URL is downloaded fresh server-side every time the map loads. Only the link is saved in the volume.
                  </span>

                  <div className={styles.field}>
                    <label className={styles.label}>GPX URL</label>
                    <input
                      type="url"
                      className={styles.input}
                      placeholder="https://example.com/tracks/tour.gpx"
                      value={gpxUrlInput}
                      onChange={(e) => setGpxUrlInput(e.target.value)}
                      required
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>Custom Track Name (Optional)</label>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="e.g. Mountain Hike 2026"
                      value={gpxNameInput}
                      onChange={(e) => setGpxNameInput(e.target.value)}
                    />
                  </div>

                  <div className={styles.formActions}>
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      onClick={() => {
                        setIsAddingUrl(false);
                        setError(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={styles.saveBtn}
                      disabled={isSubmittingUrl}
                    >
                      {isSubmittingUrl ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Downloading & Adding...</span>
                        </>
                      ) : (
                        <>
                          <Check size={14} />
                          <span>Add URL Track</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* Drag and drop zone */}
              <div
                className={`${styles.dropZone} ${isDraggingModal ? styles.dragging : ""}`}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud size={20} />
                <span>Click or drag and drop a <strong>.gpx</strong> file here</span>
              </div>

              {/* Track List */}
              <div>
                <div className={styles.sectionTitle}>
                  Your Tracks ({gpxTracks.length})
                </div>

                {gpxTracks.length === 0 ? (
                  <div className={styles.emptyState}>
                    <Route size={32} strokeWidth={1.5} />
                    <h4>No GPX tracks added</h4>
                    <p>
                      Upload a GPX file or enter a live URL. Trackpoints will automatically refine the route path and pinpoint photo capture locations.
                    </p>
                  </div>
                ) : (
                  <div className={styles.mapList}>
                    {gpxTracks.map((track) => {
                      const isDeleting = deletingGpxId === track.id;
                      const timeStr = formatTrackTime(track.startTime, track.endTime);

                      return (
                        <div
                          key={track.id}
                          className={`${styles.gpxItem} ${!track.isVisible ? styles.hiddenTrack : ""}`}
                        >
                          <div className={styles.gpxItemLeft}>
                            <button
                              type="button"
                              className={`${styles.iconBtn} ${track.isVisible ? styles.active : ""}`}
                              onClick={() =>
                                onToggleGpxVisibility &&
                                onToggleGpxVisibility(track.id, !track.isVisible)
                              }
                              title={track.isVisible ? "Hide track" : "Show track"}
                            >
                              {track.isVisible ? <Eye size={18} /> : <EyeOff size={18} />}
                            </button>

                            <div className={styles.gpxItemInfo}>
                              <span className={styles.gpxItemName} title={track.name}>
                                {track.name}
                              </span>
                              <div className={styles.gpxItemMeta}>
                                {track.type === "url" ? (
                                  <span className={styles.urlBadge}>
                                    <Globe size={10} /> Live URL
                                  </span>
                                ) : (
                                  <span className={styles.fileBadge}>
                                    <FileText size={10} /> File
                                  </span>
                                )}
                                <span>{track.pointsCount.toLocaleString()} pts</span>
                                {timeStr && <span>· {timeStr}</span>}
                                {track.fetchError && (
                                  <span className={styles.errorText} title={track.fetchError}>
                                    · Error loading
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className={styles.gpxItemActions}>
                            {onEditGpxTrack && (
                              <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={() => onEditGpxTrack(track)}
                                title="Edit track name and timestamp offset"
                              >
                                <Pencil size={15} />
                              </button>
                            )}

                            {track.bounds && onZoomToGpxTrack && (
                              <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={() => onZoomToGpxTrack(track)}
                                title="Zoom to track bounds"
                              >
                                <Maximize2 size={15} />
                              </button>
                            )}

                            <button
                              type="button"
                              className={`${styles.iconBtn} ${styles.danger}`}
                              onClick={(e) => handleDeleteGpx(track.id, e)}
                              disabled={isDeleting}
                              title="Delete GPX track"
                            >
                              {isDeleting ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <Trash2 size={15} />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
