'use client';

import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import styles from "./SelectionGallery.module.scss";
import { MapDisplayItem } from "./LeafletGeorefMap";
import {
  X,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Layers,
} from "lucide-react";

interface SelectionGalleryProps {
  photos: MapDisplayItem[];
  selectedPhotoId: string | null;
  onSelectPhoto: (photo: MapDisplayItem) => void;
  onRemovePhoto: (photoId: string) => void;
  onClearSelection?: () => void;
  sessionToken?: string | null;
  isInspectorOpen: boolean;
}

const PAGE_SIZE = 35;

function hasValidCoords(img: { coords?: { lat?: number; lng?: number } }): boolean {
  return (
    !!img.coords &&
    typeof img.coords.lat === "number" &&
    typeof img.coords.lng === "number" &&
    !Number.isNaN(img.coords.lat) &&
    !Number.isNaN(img.coords.lng)
  );
}

export default function SelectionGallery({
  photos,
  selectedPhotoId,
  onSelectPhoto,
  onRemovePhoto,
  onClearSelection,
  sessionToken,
  isInspectorOpen,
}: SelectionGalleryProps) {
  // Filter visibility toggles: verified, estimated, removed
  const [showVerified, setShowVerified] = useState(true);
  const [showEstimated, setShowEstimated] = useState(true);
  const [showRemoved, setShowRemoved] = useState(true);

  // Progressive loading pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Thumbnail URL builder with auth session token
  const getThumbnailUrl = useCallback(
    (id: string) => {
      const token =
        sessionToken ||
        (typeof window !== "undefined"
          ? localStorage.getItem("geopic_session_token")
          : null);
      return `/api/images/${id}/thumbnail?size=thumbnail${
        token ? `&token=${encodeURIComponent(token)}` : ""
      }`;
    },
    [sessionToken]
  );

  // Counts by category within the current selection
  const verifiedCount = useMemo(
    () => photos.filter((p) => hasValidCoords(p)).length,
    [photos]
  );
  const removedCount = useMemo(
    () => photos.filter((p) => !hasValidCoords(p) && p.isCleared).length,
    [photos]
  );
  const estimatedCount = useMemo(
    () => photos.filter((p) => !hasValidCoords(p) && !p.isCleared).length,
    [photos]
  );

  // Filter photos according to toggled categories
  const filteredPhotos = useMemo(() => {
    return photos.filter((p) => {
      const isVerified = hasValidCoords(p);
      const isRemoved = !isVerified && p.isCleared;
      const isEstimated = !isVerified && !p.isCleared;

      if (isVerified) return showVerified;
      if (isRemoved) return showRemoved;
      if (isEstimated) return showEstimated;
      return true;
    });
  }, [photos, showVerified, showEstimated, showRemoved]);

  // Reset pagination when category toggles change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [showVerified, showEstimated, showRemoved]);

  // Observer on sentinel to load more photos as the user scrolls horizontally near the end
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(filteredPhotos.length, prev + PAGE_SIZE));
        }
      },
      {
        root: scrollContainerRef.current,
        rootMargin: "250px",
      }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [filteredPhotos.length, visibleCount]);

  // Convert vertical mouse wheel delta into horizontal scroll
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  };

  // Scroll listener as reliable fallback to load more
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollWidth, clientWidth } = e.currentTarget;
    if (scrollLeft + clientWidth >= scrollWidth - 250) {
      setVisibleCount((prev) => Math.min(filteredPhotos.length, prev + PAGE_SIZE));
    }
  };

  // Smooth scroll helper for left/right navigation buttons
  const scrollBy = (amount: number) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: amount, behavior: "smooth" });
    }
  };

  // Smoothly scroll active thumbnail into view when selected
  useEffect(() => {
    if (!selectedPhotoId || !scrollContainerRef.current) return;
    const activeEl = scrollContainerRef.current.querySelector<HTMLElement>(
      `[data-photo-id="${selectedPhotoId}"]`
    );
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [selectedPhotoId]);

  const displayedPhotos = filteredPhotos.slice(0, visibleCount);

  return (
    <div
      className={`selectionGallery ${styles.galleryContainer} ${
        isInspectorOpen ? styles.withPreview : ""
      }`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Header bar with filters and counts */}
      <div className={styles.headerRow}>
        <div className={styles.leftControls}>
          <div className={styles.galleryTitle}>
            <Layers size={13} />
            <span>Selection ({photos.length})</span>
          </div>

          <div className={styles.filterPills}>
            <button
              type="button"
              className={`${styles.filterBtn} ${
                showVerified ? styles.activeVerified : styles.inactive
              }`}
              onClick={() => setShowVerified((prev) => !prev)}
              title={showVerified ? "Hide verified photos from gallery" : "Show verified photos"}
            >
              <CheckCircle2 size={12} />
              <span>Verified ({verifiedCount})</span>
            </button>

            <button
              type="button"
              className={`${styles.filterBtn} ${
                showEstimated ? styles.activeEstimated : styles.inactive
              }`}
              onClick={() => setShowEstimated((prev) => !prev)}
              title={showEstimated ? "Hide estimated photos from gallery" : "Show estimated photos"}
            >
              <AlertCircle size={12} />
              <span>Estimated ({estimatedCount})</span>
            </button>

            {removedCount > 0 && (
              <button
                type="button"
                className={`${styles.filterBtn} ${
                  showRemoved ? styles.activeRemoved : styles.inactive
                }`}
                onClick={() => setShowRemoved((prev) => !prev)}
                title={showRemoved ? "Hide removed GPS photos from gallery" : "Show removed GPS photos"}
              >
                <XCircle size={12} />
                <span>Removed ({removedCount})</span>
              </button>
            )}
          </div>
        </div>

        <div className={styles.rightControls}>
          <span className={styles.showingText}>
            Showing {Math.min(visibleCount, filteredPhotos.length)} of {filteredPhotos.length}
          </span>
          <button
            type="button"
            className={styles.scrollNavBtn}
            onClick={() => scrollBy(-200)}
            title="Scroll left"
            aria-label="Scroll gallery left"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            className={styles.scrollNavBtn}
            onClick={() => scrollBy(200)}
            title="Scroll right"
            aria-label="Scroll gallery right"
          >
            <ChevronRight size={13} />
          </button>
          {onClearSelection && (
            <button
              type="button"
              className={styles.clearSelectionBtn}
              onClick={onClearSelection}
              title="Clear selection"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Horizontal Scroll Track */}
      <div
        ref={scrollContainerRef}
        className={styles.scrollTrack}
        onWheel={handleWheel}
        onScroll={handleScroll}
      >
        {filteredPhotos.length === 0 ? (
          <div className={styles.emptyGallery}>
            <span>No photos match current filter.</span>
            <button
              type="button"
              className={styles.resetFilterBtn}
              onClick={() => {
                setShowVerified(true);
                setShowEstimated(true);
                setShowRemoved(true);
              }}
            >
              Show all
            </button>
          </div>
        ) : (
          displayedPhotos.map((photo, index) => {
            const isVerified = hasValidCoords(photo);
            const isRemoved = !isVerified && photo.isCleared;
            const isSelected = selectedPhotoId === photo.id;
            const statusColor = isVerified
              ? "var(--success)"
              : isRemoved
              ? "var(--danger)"
              : "var(--warning)";
            const statusText = isVerified
              ? "GPS Verified"
              : isRemoved
              ? "Removed GPS (Estimated)"
              : "Estimated GPS";

            return (
              <div
                key={photo.id}
                data-photo-id={photo.id}
                className={`${styles.thumbCard} ${isSelected ? styles.selected : ""}`}
                onClick={() => onSelectPhoto(photo)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectPhoto(photo);
                  }
                }}
                title={`${photo.name}\n${statusText}\n${new Date(photo.timestamp).toLocaleString()}`}
              >
                {/* Small remove cross in top-left corner */}
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemovePhoto(photo.id);
                  }}
                  title="Remove from selection"
                  aria-label={`Remove ${photo.name} from selection`}
                >
                  <X size={10} strokeWidth={2.5} />
                </button>

                <img
                  src={getThumbnailUrl(photo.id)}
                  alt={photo.name}
                  className={styles.thumbImage}
                  loading={index < 2 ? undefined : "lazy"}
                  decoding="async"
                  width={56}
                  height={56}
                  onError={(e) => {
                    const target = e.currentTarget as HTMLElement;
                    target.style.display = "none";
                    if (target.parentElement) {
                      target.parentElement.classList.add(styles.imgFallback);
                    }
                  }}
                />

                {/* Status indicator dot */}
                <span
                  className={styles.statusDot}
                  style={{ backgroundColor: statusColor }}
                  title={statusText}
                />
              </div>
            );
          })
        )}

        {/* Sentinel element to trigger loading more photos upon scrolling */}
        {visibleCount < filteredPhotos.length && (
          <div
            ref={sentinelRef}
            className={styles.loadMoreSentinel}
            onClick={() =>
              setVisibleCount((prev) =>
                Math.min(filteredPhotos.length, prev + PAGE_SIZE)
              )
            }
            title="Load more photos"
          >
            <span>+{filteredPhotos.length - visibleCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
