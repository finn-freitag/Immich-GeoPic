'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng, LatLngBounds, LatLngExpression, LeafletMouseEvent } from "leaflet";
import styles from "./LeafletGeorefMap.module.scss";
import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";
import {
  MapContainer,
  useMapEvents,
  TileLayer,
  CircleMarker,
  Circle,
  Polyline,
  Rectangle,
  useMap,
  Tooltip,
} from "react-leaflet";
import { ImageItem } from "@/types/ImageItem";
import { GpxPoint, GpxTrackMetadata, GpxTrackWithPoints } from "@/types/GpxTrack";
import { getTimezoneForCoords, resolvePhotoTimeMs } from "@/lib/timezone";
import L from "leaflet";
import {
  X,
  MapPin,
  Calendar,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Maximize2,
  BoxSelect,
  Trash2,
  CheckCheck,
  Compass,
  Layers,
  Route,
  UploadCloud,
  Crosshair,
  CircleDot,
  BookmarkPlus,
} from "lucide-react";
import { BaseMap, BaseMapPreset, DEFAULT_BASEMAP, BASEMAP_PRESETS } from "@/types/BaseMap";
import { VirtualGroup } from "@/types/VirtualGroup";
import BaseMapModal from "@/components/BaseMapModal";
import GroupsModal from "@/components/GroupsModal";
import MixedSelectionDialog from "@/components/MixedSelectionDialog";
import TrackEditMenu from "@/components/TrackEditMenu";

type Props = {
  images: ImageItem[];
  onImagesUpdate?: (images: ImageItem[]) => void;
  center?: LatLngExpression;
  zoom?: number;
  sessionToken?: string | null;
  zoomCategoryTarget?: {
    category: "all" | "geotagged" | "unreferenced";
    timestamp: number;
  } | null;
};

export type MapDisplayItem = ImageItem & {
  estimated?: boolean;
  estCoords?: { lat: number; lng: number };
  resolvedTime?: number;
  isGpx?: boolean;
};

function interpolate(a: number, b: number, ratio: number): number {
  return a + (b - a) * ratio;
}

function interpolateCoords(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  ratio: number
) {
  return {
    lat: interpolate(a.lat, b.lat, ratio),
    lng: interpolate(a.lng, b.lng, ratio),
  };
}

function hasValidCoords(img: { coords?: { lat?: number; lng?: number } }): boolean {
  return (
    !!img.coords &&
    typeof img.coords.lat === "number" &&
    typeof img.coords.lng === "number" &&
    !Number.isNaN(img.coords.lat) &&
    !Number.isNaN(img.coords.lng)
  );
}

function deterministicOffset(id: string, salt: number, scale = 0.001): number {
  let hash = salt;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0;
  }
  const normalized = ((Math.abs(hash) % 10000) / 10000) - 0.5;
  return normalized * scale;
}

/**
 * Computes positions for all photos and GPX track points in a single unified sequence.
 * Per user instructions:
 * - A track point is handled directly like a marker position.
 * - Unlocated photos are automatically estimated between the surrounding reference points
 *   (which can be geotagged photos or GPX track points) using the standard forward/backward scan.
 * - No custom binary search logic.
 */
function computeEstimatedPositions(
  images: ImageItem[],
  visibleGpxTracks: GpxTrackWithPoints[] = []
): MapDisplayItem[] {
  if (!Array.isArray(images)) images = [];

  // 1. Convert all visible GPX points into sequence items
  const gpxItems: MapDisplayItem[] = [];
  for (const track of visibleGpxTracks) {
    if (!track.points) continue;
    for (let i = 0; i < track.points.length; i++) {
      const pt = track.points[i];
      gpxItems.push({
        id: `gpx_${track.id}_${i}`,
        name: track.name || "GPX Track Point",
        timestamp: new Date(pt.time).toISOString(),
        coords: { lat: pt.lat, lng: pt.lng },
        resolvedTime: pt.time,
        isGpx: true,
      });
    }
  }

  if (images.length === 0 && gpxItems.length === 0) return [];

  // 2. Determine fallback timezone for unlocated photos
  // Inferred from GPX points or geotagged photos
  let fallbackTz: string | null = null;
  if (gpxItems.length > 0 && gpxItems[0].coords) {
    fallbackTz = getTimezoneForCoords(gpxItems[0].coords.lat, gpxItems[0].coords.lng);
  }
  if (!fallbackTz) {
    const geo = images.find(hasValidCoords);
    if (geo?.coords) {
      fallbackTz = getTimezoneForCoords(geo.coords.lat, geo.coords.lng);
    }
  }

  // 3. Prepare photo items with resolved times
  const photoItems: MapDisplayItem[] = images.map((img) => {
    const { estimated, estCoords, ...clean } = img as MapDisplayItem;
    const resolvedTime = resolvePhotoTimeMs(clean, fallbackTz);
    return {
      ...clean,
      resolvedTime,
      estimated: false,
      estCoords: undefined,
      isGpx: false,
    };
  });

  // 4. Merge all items and sort chronologically
  const allItems: MapDisplayItem[] = [...photoItems, ...gpxItems].sort(
    (a, b) => (a.resolvedTime || 0) - (b.resolvedTime || 0)
  );

  const n = allItems.length;

  // Pass 1: Forward scan - find previous item with valid coordinates
  const prevGeoIndex = new Int32Array(n);
  let lastGeo = -1;
  for (let i = 0; i < n; i++) {
    prevGeoIndex[i] = lastGeo;
    if (hasValidCoords(allItems[i])) {
      lastGeo = i;
    }
  }

  // Pass 2: Backward scan - find next item with valid coordinates
  const nextGeoIndex = new Int32Array(n);
  lastGeo = -1;
  for (let i = n - 1; i >= 0; i--) {
    nextGeoIndex[i] = lastGeo;
    if (hasValidCoords(allItems[i])) {
      lastGeo = i;
    }
  }

  // Pass 3: Estimate unlocated photos in O(1) per photo
  for (let i = 0; i < n; i++) {
    if (hasValidCoords(allItems[i])) {
      allItems[i].estimated = false;
      allItems[i].estCoords = undefined;
      continue;
    }

    const prevIndex = prevGeoIndex[i];
    const nextIndex = nextGeoIndex[i];

    if (prevIndex !== -1 && nextIndex !== -1) {
      const tPrev = allItems[prevIndex].resolvedTime || 0;
      const tNext = allItems[nextIndex].resolvedTime || 0;
      const tCur = allItems[i].resolvedTime || 0;
      const diff = tNext - tPrev;
      const ratio = diff > 0 ? (tCur - tPrev) / diff : 0.5;
      const est = interpolateCoords(
        allItems[prevIndex].coords!,
        allItems[nextIndex].coords!,
        ratio
      );
      allItems[i].estimated = true;
      allItems[i].estCoords = { lat: est.lat, lng: est.lng };
    } else if (prevIndex !== -1) {
      allItems[i].estimated = true;
      const base = allItems[prevIndex].coords!;
      allItems[i].estCoords = {
        lat: base.lat + deterministicOffset(allItems[i].id, 1),
        lng: base.lng + deterministicOffset(allItems[i].id, 2),
      };
    } else if (nextIndex !== -1) {
      allItems[i].estimated = true;
      const base = allItems[nextIndex].coords!;
      allItems[i].estCoords = {
        lat: base.lat + deterministicOffset(allItems[i].id, 3),
        lng: base.lng + deterministicOffset(allItems[i].id, 4),
      };
    } else {
      allItems[i].estimated = true;
      allItems[i].estCoords = {
        lat: 51.5074 + deterministicOffset(allItems[i].id, 5, 0.05),
        lng: -0.1278 + deterministicOffset(allItems[i].id, 6, 0.05),
      };
    }
  }

  return allItems;
}

interface CameraControllerProps {
  trigger: number;
  coords: [number, number][];
  zoomCategoryTarget?: {
    category: "all" | "geotagged" | "unreferenced";
    timestamp: number;
  } | null;
  computedImages: MapDisplayItem[];
  flyToBoundsTarget?: LatLngBounds | null;
  onClearFlyTarget?: () => void;
}

function CameraController({
  trigger,
  coords,
  zoomCategoryTarget,
  computedImages,
  flyToBoundsTarget,
  onClearFlyTarget,
}: CameraControllerProps) {
  const map = useMap();
  const prevTriggerRef = useRef(0);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const prevCategoryTargetRef = useRef<number>(0);

  // Handle explicit fly to bounds target (e.g. from GPX track zoom)
  useEffect(() => {
    if (!flyToBoundsTarget) return;
    map.invalidateSize();
    map.flyToBounds(flyToBoundsTarget, {
      padding: [60, 60],
      maxZoom: 16,
      duration: 1.0,
    });
    if (onClearFlyTarget) onClearFlyTarget();
  }, [flyToBoundsTarget, map, onClearFlyTarget]);

  useEffect(() => {
    // Only fit bounds if trigger was explicitly incremented and changed
    if (trigger === 0 || trigger === prevTriggerRef.current) return;
    prevTriggerRef.current = trigger;

    const timer = setTimeout(() => {
      map.invalidateSize();
      const currentCoords = coordsRef.current;
      if (currentCoords.length > 0) {
        const b = L.latLngBounds(currentCoords);
        map.fitBounds(b, { padding: [60, 60], maxZoom: 16 });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [trigger, map]);

  // Handle category-specific zoom (All, Geotagged, Unreferenced)
  useEffect(() => {
    if (
      !zoomCategoryTarget ||
      zoomCategoryTarget.timestamp === prevCategoryTargetRef.current
    ) {
      return;
    }
    prevCategoryTargetRef.current = zoomCategoryTarget.timestamp;

    const { category } = zoomCategoryTarget;
    const targetCoords: [number, number][] = [];
    const photos = computedImages.filter((img) => !img.isGpx);

    if (category === "all") {
      for (const img of photos) {
        const c = img.coords || img.estCoords;
        if (c && !Number.isNaN(c.lat) && !Number.isNaN(c.lng)) {
          targetCoords.push([c.lat, c.lng]);
        }
      }
    } else if (category === "geotagged") {
      for (const img of photos) {
        if (
          img.coords &&
          !Number.isNaN(img.coords.lat) &&
          !Number.isNaN(img.coords.lng)
        ) {
          targetCoords.push([img.coords.lat, img.coords.lng]);
        }
      }
    } else if (category === "unreferenced") {
      for (const img of photos) {
        if (
          !img.coords &&
          img.estCoords &&
          !Number.isNaN(img.estCoords.lat) &&
          !Number.isNaN(img.estCoords.lng)
        ) {
          targetCoords.push([img.estCoords.lat, img.estCoords.lng]);
        }
      }
    }

    if (targetCoords.length === 0) return;

    map.invalidateSize();
    if (targetCoords.length === 1) {
      map.flyTo(targetCoords[0], Math.min(map.getZoom() || 14, 16), {
        duration: 0.8,
      });
    } else {
      const bounds = L.latLngBounds(targetCoords);
      map.flyToBounds(bounds, {
        padding: [60, 60],
        maxZoom: 16,
        duration: 0.8,
      });
    }
  }, [zoomCategoryTarget, computedImages, map]);

  return null;
}

interface RectangleDrawerProps {
  boxSelectMode: boolean;
  isRelocating: boolean;
  setIsRelocating: (val: boolean) => void;
  isPickingGroupPos?: boolean;
  setIsPickingGroupPos?: (val: boolean) => void;
  bounds: LatLngBounds | null;
  setBounds: (bounds: LatLngBounds | null) => void;
  onMapClick: (e: LeafletMouseEvent) => void;
}

function RectangleDrawer({
  boxSelectMode,
  isRelocating,
  setIsRelocating,
  isPickingGroupPos = false,
  setIsPickingGroupPos,
  bounds,
  setBounds,
  onMapClick,
}: RectangleDrawerProps) {
  const map = useMap();
  const isDrawingRef = useRef(false);
  const startLatLngRef = useRef<LatLng | null>(null);
  const drawBoundsRef = useRef<LatLngBounds | null>(null);
  const [drawBounds, setDrawBounds] = useState<LatLngBounds | null>(null);
  const shiftPressed = useRef(false);

  const boxSelectModeRef = useRef(boxSelectMode);
  boxSelectModeRef.current = boxSelectMode;

  const isRelocatingRef = useRef(isRelocating);
  isRelocatingRef.current = isRelocating;

  const isPickingGroupPosRef = useRef(isPickingGroupPos);
  isPickingGroupPosRef.current = isPickingGroupPos;

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  const setBoundsRef = useRef(setBounds);
  setBoundsRef.current = setBounds;

  const setIsRelocatingRef = useRef(setIsRelocating);
  setIsRelocatingRef.current = setIsRelocating;

  const setIsPickingGroupPosRef = useRef(setIsPickingGroupPos);
  setIsPickingGroupPosRef.current = setIsPickingGroupPos;

  // Disable map panning when boxSelectMode is active
  useEffect(() => {
    if (boxSelectMode) {
      map.dragging.disable();
    } else if (!shiftPressed.current && !isDrawingRef.current) {
      map.dragging.enable();
    }
  }, [boxSelectMode, map]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftPressed.current = true;
        map.dragging.disable();
      }
      if (e.key === "Escape") {
        setIsRelocatingRef.current(false);
        if (setIsPickingGroupPosRef.current) {
          setIsPickingGroupPosRef.current(false);
        }
        setBoundsRef.current(null);
        setDrawBounds(null);
        drawBoundsRef.current = null;
        isDrawingRef.current = false;
        startLatLngRef.current = null;
        if (!boxSelectModeRef.current) {
          map.dragging.enable();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftPressed.current = false;
        if (!boxSelectModeRef.current && !isDrawingRef.current) {
          map.dragging.enable();
        }
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDrawingRef.current) {
        if (drawBoundsRef.current) {
          setBoundsRef.current(drawBoundsRef.current);
        }
        isDrawingRef.current = false;
        startLatLngRef.current = null;
        drawBoundsRef.current = null;
        setDrawBounds(null);
        if (!boxSelectModeRef.current && !shiftPressed.current) {
          map.dragging.enable();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mouseup", handleGlobalMouseUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [map]);

  useMapEvents({
    mousedown(e) {
      if (isRelocatingRef.current || isPickingGroupPosRef.current) return;
      if (shiftPressed.current || boxSelectModeRef.current) {
        isDrawingRef.current = true;
        startLatLngRef.current = e.latlng;
        drawBoundsRef.current = null;
        map.dragging.disable();
        setBoundsRef.current(null);
        setDrawBounds(null);
      }
    },
    mousemove(e) {
      if (isDrawingRef.current && startLatLngRef.current) {
        const currentBounds = L.latLngBounds(startLatLngRef.current, e.latlng);
        drawBoundsRef.current = currentBounds;
        setDrawBounds(currentBounds);
      }
    },
    mouseup(e) {
      if (isDrawingRef.current && startLatLngRef.current) {
        const startPt = map.latLngToContainerPoint(startLatLngRef.current);
        const endPt = map.latLngToContainerPoint(e.latlng);
        const dist = startPt.distanceTo(endPt);

        // Only create selection if user dragged at least 15 pixels
        if (dist >= 15) {
          const finalBounds = L.latLngBounds(startLatLngRef.current, e.latlng);
          setBoundsRef.current(finalBounds);
        } else {
          setBoundsRef.current(null);
        }

        isDrawingRef.current = false;
        startLatLngRef.current = null;
        drawBoundsRef.current = null;
        setDrawBounds(null);

        if (!boxSelectModeRef.current && !shiftPressed.current) {
          map.dragging.enable();
        }
      }
    },
    click(e) {
      if ((isRelocatingRef.current || isPickingGroupPosRef.current) && e.originalEvent) {
        // Calculate true geographic coordinates from mouse position so it never snaps to marker centers
        const trueLatLng = map.mouseEventToLatLng(e.originalEvent);
        onMapClickRef.current({ ...e, latlng: trueLatLng });
      } else {
        onMapClickRef.current(e);
      }
    },
  });

  const activeBounds = drawBounds || bounds;

  return activeBounds ? (
    <Rectangle
      bounds={activeBounds}
      interactive={false}
      pathOptions={{
        color: "#4250af",
        weight: 2,
        fillColor: "#4250af",
        fillOpacity: 0.15,
        dashArray: "6, 6",
      }}
    />
  ) : null;
}

interface RelocationInteractivityControllerProps {
  isRelocating: boolean;
  isPickingGroupPos?: boolean;
  images: ImageItem[];
}

function RelocationInteractivityController({
  isRelocating,
  isPickingGroupPos = false,
  images,
}: RelocationInteractivityControllerProps) {
  const map = useMap();
  const isClickThrough = isRelocating || isPickingGroupPos;

  useEffect(() => {
    map.eachLayer((layer: any) => {
      const pathEl = (layer as { _path?: SVGElement })._path;
      if (layer instanceof L.CircleMarker || layer instanceof L.Circle) {
        const isGroupLayer =
          (layer.options as any)?.isGroupLayer ||
          (layer.options as any)?.className?.includes("groupShape") ||
          (pathEl && pathEl.classList.contains(styles.groupShape));

        if (isGroupLayer) {
          layer.options.interactive = false;
          if (pathEl) {
            pathEl.classList.remove("leaflet-interactive");
            pathEl.style.pointerEvents = "none";
          }
          return;
        }

        layer.options.interactive = !isClickThrough;
        if (isClickThrough && typeof layer.closeTooltip === "function") {
          layer.closeTooltip();
        }
        if (pathEl) {
          if (isClickThrough) {
            pathEl.classList.remove("leaflet-interactive");
            pathEl.style.pointerEvents = "none";
          } else {
            pathEl.classList.add("leaflet-interactive");
            pathEl.style.pointerEvents = "";
          }
        }
      } else if (layer instanceof L.Polyline) {
        layer.options.interactive = false;
        if (pathEl) {
          pathEl.classList.remove("leaflet-interactive");
          pathEl.style.pointerEvents = "none";
        }
      }
    });

    const container = map.getContainer();
    if (isClickThrough) {
      container.classList.add("leaflet-crosshair");
      const canvas = container.querySelector("canvas");
      if (canvas) {
        canvas.classList.remove("leaflet-interactive");
      }
    } else {
      container.classList.remove("leaflet-crosshair");
    }
  }, [isClickThrough, images, map]);

  return null;
}

function MapCenterTracker({
  onCenterChange,
}: {
  onCenterChange: (center: { lat: number; lng: number }) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const updateCenter = () => {
      const c = map.getCenter();
      onCenterChange({ lat: c.lat, lng: c.lng });
    };
    updateCenter();
    map.on("moveend", updateCenter);
    return () => {
      map.off("moveend", updateCenter);
    };
  }, [map, onCenterChange]);
  return null;
}

export default function LeafletGeorefMap(props: Props) {
  const [images, setImages] = useState<ImageItem[]>(props.images);
  const [selectedImage, setSelectedImage] = useState<MapDisplayItem | null>(null);
  const [isRelocating, setIsRelocating] = useState(false);
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isImageEnlarged, setIsImageEnlarged] = useState(false);

  // Virtual Marker Groups state
  const [groups, setGroups] = useState<VirtualGroup[]>([]);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [showGroupsOnMap, setShowGroupsOnMap] = useState(true);
  const [isPickingGroupPos, setIsPickingGroupPos] = useState(false);
  const [pickedGroupCoords, setPickedGroupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [currentMapCenter, setCurrentMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [mixedDialogState, setMixedDialogState] = useState<{
    isOpen: boolean;
    group: VirtualGroup | null;
    photos: MapDisplayItem[];
    fixedCount: number;
    estimatedCount: number;
  }>({
    isOpen: false,
    group: null,
    photos: [],
    fixedCount: 0,
    estimatedCount: 0,
  });

  // Close enlarged image modal on Escape key
  useEffect(() => {
    if (!isImageEnlarged) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsImageEnlarged(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isImageEnlarged]);

  // GPX Track state
  const [gpxTracks, setGpxTracks] = useState<GpxTrackMetadata[]>([]);
  const [visibleGpxTracks, setVisibleGpxTracks] = useState<GpxTrackWithPoints[]>([]);
  const [editingGpxTrack, setEditingGpxTrack] = useState<GpxTrackMetadata | null>(null);
  const rawTrackPointsMapRef = useRef<Map<string, GpxPoint[]>>(new Map());
  const [isDraggingGpx, setIsDraggingGpx] = useState(false);
  const dragCounterRef = useRef(0);
  const [showBaseMapModal, setShowBaseMapModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<"basemaps" | "gpx">("basemaps");
  const [flyToBoundsTarget, setFlyToBoundsTarget] = useState<LatLngBounds | null>(null);
  const gpxFileInputRef = useRef<HTMLInputElement>(null);

  // Sync state if props change from outside
  useEffect(() => {
    setImages(props.images);
  }, [props.images]);

  // Notify parent of state updates
  const updateImages = (newImages: ImageItem[]) => {
    setImages(newImages);
    props.onImagesUpdate?.(newImages);
  };

  // Compute unified positions: photos and GPX trackpoints are sequenced together
  const computed = useMemo(() => {
    return computeEstimatedPositions(images, visibleGpxTracks);
  }, [images, visibleGpxTracks]);

  // Photo-only items for markers, inspector, and selection
  const photoItems = useMemo(() => {
    return computed.filter((it) => !it.isGpx);
  }, [computed]);

  // Keep selected image in sync with computed photo list
  useEffect(() => {
    if (selectedImage) {
      const refreshed = photoItems.find((img) => img.id === selectedImage.id);
      if (refreshed) {
        setSelectedImage(refreshed);
      }
    }
  }, [photoItems]);

  const initialCenter: LatLngExpression = useMemo(() => {
    if (props.center) return props.center;
    const firstWithCoords = computed.find((i) => i.coords || i.estCoords);
    if (firstWithCoords?.coords) {
      return [firstWithCoords.coords.lat, firstWithCoords.coords.lng];
    }
    if (firstWithCoords?.estCoords) {
      return [firstWithCoords.estCoords.lat, firstWithCoords.estCoords.lng];
    }
    return [51.5074, -0.1278]; // Default London
  }, [computed, props.center]);

  // One single continuous polyline connecting ALL photo markers and all GPX trackpoints
  const continuousPolylinePositions: LatLngExpression[] = useMemo(() => {
    const pos: [number, number][] = [];
    for (let i = 0; i < computed.length; i++) {
      if (computed[i].isGpx && computed[i].id.startsWith("gpx_internal_estimated")) {
        continue;
      }
      const c = computed[i].coords || computed[i].estCoords;
      if (
        c &&
        typeof c.lat === "number" &&
        typeof c.lng === "number" &&
        !Number.isNaN(c.lat) &&
        !Number.isNaN(c.lng)
      ) {
        pos.push([c.lat, c.lng]);
      }
    }
    return pos;
  }, [computed]);

  // Filter items within selection rectangle (photos only)
  const selectedItemsInBounds = useMemo(() => {
    if (!bounds) return [];
    return photoItems.filter((i) => {
      const c = i.coords || i.estCoords;
      if (!c || Number.isNaN(c.lat) || Number.isNaN(c.lng)) return false;
      return bounds.contains([c.lat, c.lng]);
    });
  }, [bounds, photoItems]);

  const estimatedInBounds = useMemo(() => {
    return selectedItemsInBounds.filter(
      (i) => !hasValidCoords(i) && i.estimated && i.estCoords
    );
  }, [selectedItemsInBounds]);

  // Clear map drag overlay if modal opens
  useEffect(() => {
    if (showBaseMapModal) {
      setIsDraggingGpx(false);
      dragCounterRef.current = 0;
    }
  }, [showBaseMapModal]);

  // Window-level safety listeners to ensure drag overlay never gets stuck
  useEffect(() => {
    const handleDragEnd = () => {
      dragCounterRef.current = 0;
      setIsDraggingGpx(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dragCounterRef.current = 0;
        setIsDraggingGpx(false);
      }
    };

    window.addEventListener("dragend", handleDragEnd);
    window.addEventListener("drop", handleDragEnd);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("dragend", handleDragEnd);
      window.removeEventListener("drop", handleDragEnd);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const getAuthHeaders = () => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token =
      props.sessionToken ||
      (typeof window !== "undefined"
        ? localStorage.getItem("geopic_session_token")
        : null);
    if (token) {
      h["Authorization"] = `Bearer ${token}`;
    }
    return h;
  };

  const [baseMaps, setBaseMaps] = useState<BaseMap[]>([DEFAULT_BASEMAP]);
  const [selectedBaseMapId, setSelectedBaseMapId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("geopic_active_basemap") || DEFAULT_BASEMAP.id;
    }
    return DEFAULT_BASEMAP.id;
  });
  const [presets, setPresets] = useState<BaseMapPreset[]>(BASEMAP_PRESETS);

  useEffect(() => {
    let isMounted = true;
    async function loadBaseMaps() {
      try {
        const res = await fetch("/api/settings/basemaps", {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            if (Array.isArray(data.baseMaps) && data.baseMaps.length > 0) {
              setBaseMaps(data.baseMaps);
            }
            if (data.selectedId) {
              setSelectedBaseMapId(data.selectedId);
              if (typeof window !== "undefined") {
                localStorage.setItem("geopic_active_basemap", data.selectedId);
              }
            }
            if (Array.isArray(data.presets)) {
              setPresets(data.presets);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load base maps:", err);
      }
    }
    loadBaseMaps();
    return () => {
      isMounted = false;
    };
  }, [props.sessionToken]);

  const activeBaseMap = useMemo(() => {
    return (
      baseMaps.find((b) => b.id === selectedBaseMapId) ||
      baseMaps[0] ||
      DEFAULT_BASEMAP
    );
  }, [baseMaps, selectedBaseMapId]);

  const handleSelectBaseMap = async (id: string) => {
    setSelectedBaseMapId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("geopic_active_basemap", id);
    }
    try {
      await fetch("/api/settings/basemaps", {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ selectedId: id }),
      });
    } catch (err) {
      console.error("Failed to persist selected base map:", err);
    }
  };

  const handleAddBaseMap = async (newMap: Omit<BaseMap, "id" | "isDefault">) => {
    const res = await fetch("/api/settings/basemaps", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(newMap),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to add base map");
    }
    const data = await res.json();
    setBaseMaps(data.baseMaps);
    if (data.selectedId) {
      setSelectedBaseMapId(data.selectedId);
      if (typeof window !== "undefined") {
        localStorage.setItem("geopic_active_basemap", data.selectedId);
      }
    }
  };

  const handleDeleteBaseMap = async (id: string) => {
    const res = await fetch(`/api/settings/basemaps?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to delete base map");
    }
    const data = await res.json();
    setBaseMaps(data.baseMaps);
    if (data.selectedId) {
      setSelectedBaseMapId(data.selectedId);
      if (typeof window !== "undefined") {
        localStorage.setItem("geopic_active_basemap", data.selectedId);
      }
    }
  };

  // GPX Track loaders and management handlers
  const loadGpxTracks = React.useCallback(async () => {
    try {
      // 1. Fetch visible tracks with points for path interpolation and dotted line
      const ptsRes = await fetch("/api/gpx?includePoints=true&visibleOnly=true", {
        headers: getAuthHeaders(),
      });
      if (ptsRes.ok) {
        const data = await ptsRes.json();
        setVisibleGpxTracks(data.tracks || []);
      }

      // 2. Fetch full metadata list for layer dialog
      const metaRes = await fetch("/api/gpx", {
        headers: getAuthHeaders(),
      });
      if (metaRes.ok) {
        const data = await metaRes.json();
        setGpxTracks(data.tracks || []);
      }
    } catch (err) {
      console.error("Failed to load GPX tracks:", err);
    }
  }, [props.sessionToken]);

  useEffect(() => {
    loadGpxTracks();
  }, [loadGpxTracks]);

  const handleUploadGpxFile = async (fileOrFiles: File | File[]) => {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    if (files.length === 0) return;

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }
    const token =
      props.sessionToken ||
      (typeof window !== "undefined"
        ? localStorage.getItem("geopic_session_token")
        : null);
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch("/api/gpx", {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to upload GPX file(s)");
    }

    await loadGpxTracks();
  };

  const handleAddGpxUrl = async (url: string, name?: string) => {
    const res = await fetch("/api/gpx", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ url, name }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to add GPX URL");
    }

    await loadGpxTracks();
  };

  const handleToggleGpxVisibility = async (id: string, isVisible: boolean) => {
    setGpxTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isVisible } : t))
    );

    const res = await fetch("/api/gpx", {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ id, isVisible }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to update track visibility");
    }

    await loadGpxTracks();
  };

  const handleDeleteGpxTrack = async (id: string) => {
    const res = await fetch(`/api/gpx?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete GPX track");
    }

    await loadGpxTracks();
  };

  const handleZoomToGpxTrack = (track: GpxTrackMetadata) => {
    if (track.bounds) {
      setShowBaseMapModal(false);
      const b = L.latLngBounds([
        [track.bounds.minLat, track.bounds.minLng],
        [track.bounds.maxLat, track.bounds.maxLng],
      ]);
      setFlyToBoundsTarget(b);
    }
  };

  const handleStartEditGpxTrack = async (track: GpxTrackMetadata) => {
    // 1. Close BaseMapModal so the user has full view of the map and markers
    setShowBaseMapModal(false);

    // 2. Ensure track is visible so its points and estimated markers appear on map
    let currentTracks = visibleGpxTracks;
    let targetTrackWithPoints = currentTracks.find((t) => t.id === track.id);

    if (!targetTrackWithPoints || !track.isVisible) {
      try {
        await handleToggleGpxVisibility(track.id, true);
        const ptsRes = await fetch("/api/gpx?includePoints=true&visibleOnly=true", {
          headers: getAuthHeaders(),
        });
        if (ptsRes.ok) {
          const data = await ptsRes.json();
          currentTracks = data.tracks || [];
          setVisibleGpxTracks(currentTracks);
          targetTrackWithPoints = currentTracks.find((t) => t.id === track.id);
        }
      } catch (err) {
        console.error("Failed to make track visible for editing:", err);
      }
    }

    // 3. If points are missing, fetch points directly
    if (!targetTrackWithPoints || !targetTrackWithPoints.points) {
      try {
        const res = await fetch(`/api/gpx?id=${encodeURIComponent(track.id)}`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          const pts = data.points || [];
          targetTrackWithPoints = {
            ...track,
            isVisible: true,
            points: pts,
          };
          setVisibleGpxTracks((prev) => {
            const filtered = prev.filter((t) => t.id !== track.id);
            return [...filtered, targetTrackWithPoints!];
          });
        }
      } catch (err) {
        console.error("Failed to fetch track points for edit:", err);
      }
    }

    // 4. Save raw unshifted points in ref to avoid any accumulated drift
    if (targetTrackWithPoints && targetTrackWithPoints.points) {
      const currentOffset = track.timeOffsetMs || 0;
      const rawPoints: GpxPoint[] = targetTrackWithPoints.points.map((p) => ({
        ...p,
        time: p.time - currentOffset,
      }));
      rawTrackPointsMapRef.current.set(track.id, rawPoints);
    }

    // 5. Zoom to track bounds if present
    if (track.bounds) {
      const b = L.latLngBounds([
        [track.bounds.minLat, track.bounds.minLng],
        [track.bounds.maxLat, track.bounds.maxLng],
      ]);
      setFlyToBoundsTarget(b);
    }

    // 6. Set editing track and deselect any photo so the editor has focus
    setSelectedImage(null);
    setEditingGpxTrack(track);
  };

  const handlePreviewGpxTimeOffset = React.useCallback(
    (trackId: string, previewOffsetMs: number) => {
      const rawPoints = rawTrackPointsMapRef.current.get(trackId);
      if (!rawPoints || rawPoints.length === 0) return;

      const shiftedPoints: GpxPoint[] = rawPoints.map((p) => ({
        ...p,
        time: p.time + previewOffsetMs,
      }));

      const newStartTime = new Date(shiftedPoints[0].time).toISOString();
      const newEndTime = new Date(shiftedPoints[shiftedPoints.length - 1].time).toISOString();

      setVisibleGpxTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          return {
            ...t,
            points: shiftedPoints,
            startTime: newStartTime,
            endTime: newEndTime,
            timeOffsetMs: previewOffsetMs,
          };
        })
      );
    },
    []
  );

  const handleRevertGpxPreview = React.useCallback(
    (trackId: string) => {
      const rawPoints = rawTrackPointsMapRef.current.get(trackId);
      if (!rawPoints || rawPoints.length === 0) return;

      const savedTrack = gpxTracks.find((t) => t.id === trackId);
      const savedOffset = savedTrack?.timeOffsetMs || 0;

      const restoredPoints: GpxPoint[] = rawPoints.map((p) => ({
        ...p,
        time: p.time + savedOffset,
      }));

      const newStartTime = new Date(restoredPoints[0].time).toISOString();
      const newEndTime = new Date(restoredPoints[restoredPoints.length - 1].time).toISOString();

      setVisibleGpxTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          return {
            ...t,
            points: restoredPoints,
            startTime: newStartTime,
            endTime: newEndTime,
            timeOffsetMs: savedOffset,
          };
        })
      );
    },
    [gpxTracks]
  );

  const handleSaveGpxTrack = async (
    id: string,
    updates: {
      name: string;
      timeOffsetMs: number;
      startTime: string;
      endTime: string;
    }
  ) => {
    const res = await fetch("/api/gpx", {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id,
        name: updates.name,
        timeOffsetMs: updates.timeOffsetMs,
        startTime: updates.startTime,
        endTime: updates.endTime,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save track changes");
    }

    setGpxTracks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              name: updates.name,
              timeOffsetMs: updates.timeOffsetMs,
              startTime: updates.startTime,
              endTime: updates.endTime,
            }
          : t
      )
    );

    // Refresh raw points baseline for this track
    const rawPoints = rawTrackPointsMapRef.current.get(id);
    if (rawPoints) {
      const updatedVisiblePoints: GpxPoint[] = rawPoints.map((p) => ({
        ...p,
        time: p.time + updates.timeOffsetMs,
      }));
      setVisibleGpxTracks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                name: updates.name,
                points: updatedVisiblePoints,
                startTime: updates.startTime,
                endTime: updates.endTime,
                timeOffsetMs: updates.timeOffsetMs,
              }
            : t
        )
      );
    }

    await loadGpxTracks();
  };

  // Groups management and loaders
  const loadGroups = React.useCallback(async () => {
    try {
      const res = await fetch("/api/groups", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
    } catch (err) {
      console.error("Failed to load groups:", err);
    }
  }, [props.sessionToken]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const handleSaveGroup = async (
    groupInput: Omit<VirtualGroup, "id" | "createdAt"> & { id?: string }
  ) => {
    const isEdit = Boolean(groupInput.id);
    const res = await fetch("/api/groups", {
      method: isEdit ? "PATCH" : "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(groupInput),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save group");
    }
    await loadGroups();
  };

  const handleDeleteGroup = async (id: string) => {
    const res = await fetch(`/api/groups?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete group");
    }
    await loadGroups();
  };

  const handleZoomToGroup = (group: VirtualGroup) => {
    if (group.radius > 0) {
      const latDelta = (group.radius / 111320) * 1.2;
      const lngDelta =
        (group.radius / Math.max(1, 111320 * Math.cos((group.lat * Math.PI) / 180))) * 1.2;
      const b = L.latLngBounds([
        [group.lat - latDelta, group.lng - lngDelta],
        [group.lat + latDelta, group.lng + lngDelta],
      ]);
      setFlyToBoundsTarget(b);
    } else {
      const b = L.latLngBounds([
        [group.lat - 0.005, group.lng - 0.005],
        [group.lat + 0.005, group.lng + 0.005],
      ]);
      setFlyToBoundsTarget(b);
    }
  };

  const handleAssignSinglePhotoToGroup = async (photo: MapDisplayItem, group: VirtualGroup) => {
    setIsUpdating(true);
    try {
      const res = await fetch("/api/groups/assign", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          groupId: group.id,
          photos: [{ id: photo.id, timestamp: photo.timestamp, hasCoords: hasValidCoords(photo) }],
          applyTo: "all",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to assign photo to group");
      }

      const data = await res.json();
      const updatedMap = new Map<string, { id: string; coords?: { lat: number; lng: number }; estCoords?: { lat: number; lng: number } }>(
        (data.updatedPhotos || []).map((p: any) => [p.id, p])
      );

      const updated = images.map((img) => {
        const update = updatedMap.get(img.id);
        if (update) {
          const { estimated, estCoords, ...clean } = img as MapDisplayItem;
          if (data.directFix) {
            return { ...clean, coords: update.coords };
          } else {
            return { ...clean, coords: undefined, estimated: true, estCoords: update.estCoords };
          }
        }
        return img;
      });

      updateImages(updated);
      await loadGpxTracks();
    } catch (err) {
      console.error("Failed to assign photo to group:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAssignBatchToGroup = (photos: MapDisplayItem[], group: VirtualGroup) => {
    if (photos.length === 0) return;

    const fixedCount = photos.filter((p) => hasValidCoords(p)).length;
    const estimatedCount = photos.length - fixedCount;

    if (!group.directFix && fixedCount > 0 && estimatedCount > 0) {
      // Mixed selection when assigning to estimated group: prompt user!
      setMixedDialogState({
        isOpen: true,
        group,
        photos,
        fixedCount,
        estimatedCount,
      });
      return;
    }

    executeBatchAssign(photos, group, "all");
  };

  const executeBatchAssign = async (
    photos: MapDisplayItem[],
    group: VirtualGroup,
    applyTo: "all" | "estimatedOnly"
  ) => {
    setIsUpdating(true);
    try {
      const res = await fetch("/api/groups/assign", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          groupId: group.id,
          photos: photos.map((p) => ({
            id: p.id,
            timestamp: p.timestamp,
            hasCoords: hasValidCoords(p),
          })),
          applyTo,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to assign photos to group");
      }

      const data = await res.json();
      const updatedMap = new Map<string, { id: string; coords?: { lat: number; lng: number }; estCoords?: { lat: number; lng: number } }>(
        (data.updatedPhotos || []).map((p: any) => [p.id, p])
      );

      const updated = images.map((img) => {
        const update = updatedMap.get(img.id);
        if (update) {
          const { estimated, estCoords, ...clean } = img as MapDisplayItem;
          if (data.directFix) {
            return { ...clean, coords: update.coords };
          } else {
            return { ...clean, coords: undefined, estimated: true, estCoords: update.estCoords };
          }
        }
        return img;
      });

      updateImages(updated);
      setBounds(null);
      await loadGpxTracks();
    } catch (err) {
      console.error("Failed to assign photos to group:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMapDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingGpx(false);

    if (showBaseMapModal || showGroupsModal) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const gpxFiles = Array.from(e.dataTransfer.files).filter((file) =>
        file.name.toLowerCase().endsWith(".gpx")
      );
      if (gpxFiles.length > 0) {
        try {
          await handleUploadGpxFile(gpxFiles);
        } catch (err) {
          console.error("Map GPX drop upload failed:", err);
        }
      }
    }
  };

  const handleQuickFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      try {
        await handleUploadGpxFile(files);
      } catch (err) {
        console.error("Quick GPX upload failed:", err);
      } finally {
        if (gpxFileInputRef.current) {
          gpxFileInputRef.current.value = "";
        }
      }
    }
  };

  // Single marker relocation click & group position pick
  const handleMapClick = async (e: LeafletMouseEvent) => {
    if (isPickingGroupPos) {
      setIsPickingGroupPos(false);
      setPickedGroupCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
      setShowGroupsModal(true);
      return;
    }

    if (!isRelocating || !selectedImage) return;

    const { lat, lng } = e.latlng;
    setIsRelocating(false);
    setIsUpdating(true);

    try {
      const res = await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords: { lat, lng } }),
      });
      if (!res.ok) {
        throw new Error(`Failed to relocate marker: ${res.status}`);
      }

      const updated = images.map((img) => {
        if (img.id === selectedImage.id) {
          const { estimated, estCoords, ...clean } = img as MapDisplayItem;
          return { ...clean, coords: { lat, lng } };
        }
        return img;
      });
      updateImages(updated);
    } catch (err) {
      console.error("Failed to relocate marker:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Fix single estimated marker
  const handleFixSingleMarker = async () => {
    if (!selectedImage?.estCoords) return;

    setIsUpdating(true);
    try {
      const coords = selectedImage.estCoords;
      const res = await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords }),
      });
      if (!res.ok) {
        throw new Error(`Failed to fix marker: ${res.status}`);
      }

      const updated = images.map((img) => {
        if (img.id === selectedImage.id) {
          const { estimated, estCoords, ...clean } = img as MapDisplayItem;
          return { ...clean, coords };
        }
        return img;
      });
      updateImages(updated);
    } catch (err) {
      console.error("Failed to fix marker:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Remove coordinates for single marker
  const handleRemoveCoordinates = async () => {
    if (!selectedImage) return;

    setIsUpdating(true);
    try {
      const res = await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords: null }),
      });
      if (!res.ok) {
        throw new Error(`Failed to remove coordinates: ${res.status}`);
      }

      const updated = images.map((img) => {
        if (img.id === selectedImage.id) {
          const { estimated, estCoords, ...clean } = img as MapDisplayItem;
          return { ...clean, coords: undefined, city: undefined, country: undefined };
        }
        return img;
      });
      updateImages(updated);
      setSelectedImage((prev) => {
        if (!prev || prev.id !== selectedImage.id) return prev;
        const { estimated, estCoords, ...clean } = prev;
        return {
          ...clean,
          coords: undefined,
          city: undefined,
          country: undefined,
          estimated: true,
        };
      });
    } catch (err) {
      console.error("Failed to remove coordinates:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Fix batch of markers inside rectangle selection
  const handleFixBatchMarkers = async () => {
    if (estimatedInBounds.length === 0) return;

    setIsUpdating(true);
    try {
      const updates = estimatedInBounds.map((img) => ({
        id: img.id,
        coords: img.estCoords!,
      }));

      const res = await fetch("/api/images/bulk-location", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        throw new Error(`Failed to bulk fix markers: ${res.status}`);
      }

      const updatedMap = new Map(updates.map((u) => [u.id, u.coords]));
      const updated = images.map((img) => {
        const newCoords = updatedMap.get(img.id);
        if (newCoords) {
          const { estimated, estCoords, ...clean } = img as MapDisplayItem;
          return { ...clean, coords: newCoords };
        }
        return img;
      });

      updateImages(updated);
      setBounds(null);
    } catch (err) {
      console.error("Failed to bulk fix markers:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const hasAutoFittedRef = useRef(false);
  const [fitTrigger, setFitTrigger] = useState(0);

  useEffect(() => {
    if (images.length > 0 && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      setFitTrigger((prev) => prev + 1);
    } else if (images.length === 0) {
      hasAutoFittedRef.current = false;
    }
  }, [images]);

  const allCoords = useMemo(() => {
    const coords: [number, number][] = [];
    for (let i = 0; i < computed.length; i++) {
      if (!computed[i].isGpx || i % 10 === 0) {
        const c = computed[i].coords || computed[i].estCoords;
        if (c && !Number.isNaN(c.lat) && !Number.isNaN(c.lng)) {
          coords.push([c.lat, c.lng]);
        }
      }
    }
    return coords;
  }, [computed]);

  return (
    <div
      className={`${styles.mapWrapper} ${isRelocating ? styles.relocateActive : ""} ${
        boxSelectMode ? styles.boxSelectActive : ""
      }`}
      onDragEnter={(e) => {
        e.preventDefault();
        if (showBaseMapModal) return;
        dragCounterRef.current++;
        setIsDraggingGpx(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (showBaseMapModal) return;
        if (!isDraggingGpx) {
          setIsDraggingGpx(true);
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setIsDraggingGpx(false);
        }
      }}
      onDrop={handleMapDrop}
    >
      {/* GPX Drag & Drop overlay */}
      {isDraggingGpx && (
        <div
          className={styles.dragOverlay}
          onClick={() => {
            dragCounterRef.current = 0;
            setIsDraggingGpx(false);
          }}
        >
          <div className={styles.dragOverlayContent}>
            <UploadCloud size={48} className={styles.dragIcon} />
            <h3>Drop GPX Track here</h3>
            <p>Will be added to your tracks and used to refine paths and photo locations.</p>
            <span style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
              Click anywhere or press Esc to dismiss
            </span>
          </div>
        </div>
      )}

      {/* Relocation banner */}
      {isRelocating && (
        <div className={styles.relocateBanner}>
          <Compass size={18} className="animate-pulse" />
          <span>Click anywhere on the map to set the new GPS coordinates</span>
          <button
            className={styles.cancelBtn}
            onClick={() => setIsRelocating(false)}
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* Pick Group Position Banner */}
      {isPickingGroupPos && (
        <div className={styles.relocateBanner}>
          <Crosshair size={18} className="animate-pulse" />
          <span>Click anywhere on the map to set the group position</span>
          <button
            className={styles.cancelBtn}
            onClick={() => {
              setIsPickingGroupPos(false);
              setShowGroupsModal(true);
            }}
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* Floating Map Tools (Left Side) */}
      <div className={styles.mapToolGroup}>
        <button
          className={styles.mapControlBtn}
          title="Zoom to all photos"
          onClick={() => setFitTrigger((prev) => prev + 1)}
        >
          <Maximize2 size={18} />
        </button>
        <button
          className={`${styles.mapControlBtn} ${boxSelectMode ? styles.active : ""}`}
          title={boxSelectMode ? "Selection Mode Active" : "Enable Box Selection (or Shift + Drag)"}
          onClick={() => setBoxSelectMode((prev) => !prev)}
        >
          <BoxSelect size={18} />
        </button>
        <input
          type="file"
          ref={gpxFileInputRef}
          accept=".gpx"
          multiple
          style={{ display: "none" }}
          onChange={handleQuickFileInputChange}
        />
        <button
          className={`${styles.mapControlBtn} ${showGroupsModal ? styles.active : ""}`}
          title="Virtual Marker Groups"
          onClick={() => setShowGroupsModal(true)}
        >
          <BookmarkPlus size={18} />
        </button>
        <button
          className={`${styles.mapControlBtn} ${visibleGpxTracks.length > 0 ? styles.active : ""}`}
          title="GPX Tracks & Upload"
          onClick={() => {
            setActiveModalTab("gpx");
            setShowBaseMapModal(true);
          }}
        >
          <Route size={18} />
        </button>
        <button
          className={`${styles.mapControlBtn} ${showBaseMapModal && activeModalTab === "basemaps" ? styles.active : ""}`}
          title="Base Maps & Layers"
          onClick={() => {
            setActiveModalTab("basemaps");
            setShowBaseMapModal(true);
          }}
        >
          <Layers size={18} />
        </button>
        <button
          className={`${styles.mapControlBtn} ${showHelp ? styles.active : ""}`}
          title="How it works"
          onClick={() => setShowHelp((prev) => !prev)}
        >
          <HelpCircle size={18} />
        </button>
      </div>

      {/* Help Popup */}
      {showHelp && (
        <div className={styles.helpModal}>
          <div className={styles.cardHeader} style={{ padding: "0 0 8px 0" }}>
            <h3>How Georeferencing Works</h3>
            <button className={styles.closeBtn} onClick={() => setShowHelp(false)}>
              <X size={16} />
            </button>
          </div>
          <ul>
            <li>
              <strong style={{ color: "var(--success)" }}>Green Markers:</strong> Photos with verified GPS coordinates stored in Immich.
            </li>
            <li>
              <strong style={{ color: "var(--warning)" }}>Orange Markers:</strong> Photos without GPS, estimated along your route based on chronological capture times.
            </li>
            <li>
              <strong>Relocate:</strong> Click any marker, select &quot;Relocate Marker&quot;, then click anywhere on the map to place it.
            </li>
            <li>
              <strong>Box Select:</strong> Hold <kbd>Shift</kbd> (or click the box icon) and drag on the map to select multiple estimated photos and fix them simultaneously.
            </li>
            <li>
              <strong>Groups:</strong> Use Virtual Marker Groups to instantly move single or batch photos to predefined locations or areas.
            </li>
          </ul>
        </div>
      )}

      {/* Selection Action Toolbar (Bottom Center) */}
      {bounds && (
        <div className={styles.selectionBox}>
          <div className={styles.selectionText}>
            <BoxSelect size={16} />
            <span>
              {selectedItemsInBounds.length} photos ({estimatedInBounds.length} estimated)
            </span>
          </div>
          {estimatedInBounds.length > 0 && (
            <button
              className={`${styles.toolBtn} ${styles.fix}`}
              onClick={handleFixBatchMarkers}
              disabled={isUpdating}
            >
              <CheckCheck size={14} />
              <span>Fix {estimatedInBounds.length} Estimated</span>
            </button>
          )}

          {/* Quick Groups assignment for multi-selection */}
          {groups.length > 0 && selectedItemsInBounds.length > 0 && (
            <div className={styles.selectionGroups}>
              <span className={styles.selectionGroupsLabel}>Group:</span>
              {groups.map((g) => (
                <button
                  key={g.id}
                  className={`${styles.selectionGroupChip} ${
                    g.directFix ? styles.directFix : styles.estimated
                  }`}
                  onClick={() => handleAssignBatchToGroup(selectedItemsInBounds, g)}
                  disabled={isUpdating}
                  title={`Move ${selectedItemsInBounds.length} photos to ${g.name} (${
                    g.radius > 0 ? "Area" : "Marker"
                  } - ${g.directFix ? "Direct Fix" : "Estimated"})`}
                >
                  {g.radius > 0 ? <CircleDot size={11} /> : <MapPin size={11} />}
                  <span>{g.name}</span>
                </button>
              ))}
            </div>
          )}

          <button
            className={`${styles.toolBtn} ${styles.clear}`}
            onClick={() => setBounds(null)}
          >
            Clear
          </button>
        </div>
      )}

      {/* Leaflet Map */}
      <MapContainer
        center={initialCenter}
        zoom={props.zoom ?? 13}
        className={styles.mapContainer}
        boxZoom={false}
        preferCanvas={true}
      >
        <TileLayer
          key={activeBaseMap.id}
          attribution={activeBaseMap.attribution}
          url={activeBaseMap.url}
          maxZoom={activeBaseMap.maxZoom ?? 19}
          subdomains={activeBaseMap.subdomains ?? "abc"}
        />

        {/* Route connecting all photo markers and GPX tracks with one continuous polyline */}
        {continuousPolylinePositions.length >= 2 && (
          <Polyline
            positions={continuousPolylinePositions}
            interactive={false}
            pathOptions={{
              color: "#4250af",
              weight: 3,
              opacity: 0.7,
              dashArray: "4, 6",
            }}
            smoothFactor={1.5}
          />
        )}

        {/* Virtual Marker Groups & Areas (Rendered below photo markers and always click-through) */}
        {showGroupsOnMap &&
          groups.map((g) => {
            const color = g.directFix ? "#10b981" : "#f59e0b";
            if (g.radius > 0) {
              return (
                <Circle
                  key={`group_${g.id}`}
                  center={[g.lat, g.lng]}
                  radius={g.radius}
                  interactive={false}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: 0.12,
                    weight: 2,
                    dashArray: "5, 5",
                    className: styles.groupShape,
                  }}
                >
                  <Tooltip
                    permanent
                    direction="center"
                    className={styles.groupTooltip}
                  >
                    <span>
                      ⭕ {g.name}
                    </span>
                  </Tooltip>
                </Circle>
              );
            }

            return (
              <CircleMarker
                key={`group_${g.id}`}
                center={[g.lat, g.lng]}
                radius={9}
                interactive={false}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.5,
                  weight: 2,
                  dashArray: "3, 3",
                  className: styles.groupShape,
                }}
              >
                <Tooltip
                  permanent
                  direction="top"
                  offset={[0, -10]}
                  className={styles.groupTooltip}
                >
                  <span>
                    📍 {g.name}
                  </span>
                </Tooltip>
              </CircleMarker>
            );
          })}

        {/* Photo Markers - rendered on top so they are always clickable */}
        {photoItems.map((it) => {
          const isVerified = !!it.coords;
          const lat = isVerified ? it.coords!.lat : it.estCoords?.lat;
          const lng = isVerified ? it.coords!.lng : it.estCoords?.lng;

          if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
            return null;
          }

          const isSelected = selectedImage?.id === it.id;
          const color = isVerified ? "#10b981" : "#f59e0b";

          return (
            <CircleMarker
              key={it.id}
              center={[lat, lng]}
              radius={isSelected ? 10 : 7}
              interactive={!isRelocating}
              pathOptions={{
                color: isSelected ? "#4250af" : color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{
                click: () => {
                  if (!isRelocating) {
                    setSelectedImage(it);
                  }
                },
              }}
            >
              {!isRelocating && (photoItems.length <= 1500 || isSelected) && (
                <Tooltip direction="top" offset={[0, -6]}>
                  <span>{it.name}</span>
                </Tooltip>
              )}
            </CircleMarker>
          );
        })}

        <RelocationInteractivityController
          isRelocating={isRelocating}
          isPickingGroupPos={isPickingGroupPos}
          images={images}
        />
        <RectangleDrawer
          boxSelectMode={boxSelectMode}
          isRelocating={isRelocating}
          setIsRelocating={setIsRelocating}
          isPickingGroupPos={isPickingGroupPos}
          setIsPickingGroupPos={setIsPickingGroupPos}
          bounds={bounds}
          setBounds={setBounds}
          onMapClick={handleMapClick}
        />
        <CameraController
          trigger={fitTrigger}
          coords={allCoords}
          zoomCategoryTarget={props.zoomCategoryTarget}
          computedImages={computed}
          flyToBoundsTarget={flyToBoundsTarget}
          onClearFlyTarget={() => setFlyToBoundsTarget(null)}
        />
        <MapCenterTracker onCenterChange={setCurrentMapCenter} />
      </MapContainer>

      {/* Photo Inspector Panel */}
      {selectedImage && !editingGpxTrack && (
        <div className={styles.inspectorCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <MapPin size={16} />
              <span>Photo Inspector</span>
            </div>
            <button
              className={styles.closeBtn}
              onClick={() => {
                setSelectedImage(null);
                setIsImageEnlarged(false);
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div
            className={styles.cardImageHolder}
            onClick={() => setIsImageEnlarged(true)}
            role="button"
            tabIndex={0}
            title="Click to view large image"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsImageEnlarged(true);
              }
            }}
          >
            <img
              src={`/api/images/${selectedImage.id}/thumbnail?size=preview${
                props.sessionToken
                  ? `&token=${encodeURIComponent(props.sessionToken)}`
                  : typeof window !== "undefined" && localStorage.getItem("geopic_session_token")
                  ? `&token=${encodeURIComponent(localStorage.getItem("geopic_session_token")!)}`
                  : ""
              }`}
              alt={selectedImage.name}
              className={styles.previewImage}
              loading="lazy"
            />
            <div
              className={`${styles.badgeOverlay} ${
                selectedImage.coords ? styles.verified : styles.estimated
              }`}
            >
              {selectedImage.coords ? (
                <>
                  <CheckCircle2 size={12} />
                  <span>GPS Verified</span>
                </>
              ) : (
                <>
                  <AlertCircle size={12} />
                  <span>Estimated</span>
                </>
              )}
            </div>
            <div className={styles.expandHint}>
              <Maximize2 size={13} />
              <span>Enlarge</span>
            </div>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.metaRow}>
              <span className={styles.metaValue} style={{ fontSize: 13, fontWeight: 700 }}>
                {selectedImage.name}
              </span>
            </div>
            <div className={styles.metaRow}>
              <Calendar size={14} />
              <span className={styles.metaValue}>
                {new Date(selectedImage.timestamp).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
            <div className={styles.metaRow}>
              <MapPin size={14} />
              <span className={styles.metaValue}>
                {selectedImage.coords
                  ? `${selectedImage.coords.lat.toFixed(5)}, ${selectedImage.coords.lng.toFixed(5)}`
                  : selectedImage.estCoords
                  ? `${selectedImage.estCoords.lat.toFixed(5)}, ${selectedImage.estCoords.lng.toFixed(5)} (approx)`
                  : "No coordinates"}
              </span>
            </div>
            {(selectedImage.city || selectedImage.country) && (
              <div className={styles.metaRow}>
                <Compass size={14} />
                <span className={styles.metaValue}>
                  {[selectedImage.city, selectedImage.country].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
          </div>

          <div className={styles.cardActions}>
            <button
              className={`${styles.actionBtn} ${styles.primary}`}
              onClick={() => setIsRelocating(true)}
              disabled={isUpdating}
            >
              <Compass size={15} />
              <span>Relocate Marker</span>
            </button>

            {!selectedImage.coords && selectedImage.estimated && selectedImage.estCoords && (
              <button
                className={`${styles.actionBtn} ${styles.success}`}
                onClick={handleFixSingleMarker}
                disabled={isUpdating}
              >
                <CheckCircle2 size={15} />
                <span>Fix This Location</span>
              </button>
            )}

            {selectedImage.coords && (
              <button
                className={`${styles.actionBtn} ${styles.danger}`}
                onClick={handleRemoveCoordinates}
                disabled={isUpdating}
              >
                <Trash2 size={15} />
                <span>Remove Coordinates</span>
              </button>
            )}
          </div>

          {/* Quick Assign to Group (Bottom of preview) */}
          {groups.length > 0 && (
            <div className={styles.groupsSection}>
              <div className={styles.groupsHeader}>
                <span>Quick Assign to Group</span>
                <button
                  type="button"
                  className={styles.groupsManageBtn}
                  onClick={() => setShowGroupsModal(true)}
                  title="Manage Groups"
                >
                  Manage
                </button>
              </div>
              <div className={styles.groupsList}>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    className={`${styles.groupChip} ${g.directFix ? styles.directFix : styles.estimated}`}
                    onClick={() => handleAssignSinglePhotoToGroup(selectedImage, g)}
                    disabled={isUpdating}
                    title={`${g.name} (${g.radius > 0 ? "Area" : "Marker"} - ${
                      g.directFix ? "Direct Fix" : "Estimated"
                    })`}
                  >
                    {g.radius > 0 ? <CircleDot size={12} /> : <MapPin size={12} />}
                    <span>{g.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Base Map & GPX Layers Manager Modal */}
      <BaseMapModal
        isOpen={showBaseMapModal}
        onClose={() => setShowBaseMapModal(false)}
        baseMaps={baseMaps}
        selectedId={selectedBaseMapId}
        presets={presets}
        onSelectBaseMap={handleSelectBaseMap}
        onAddBaseMap={handleAddBaseMap}
        onDeleteBaseMap={handleDeleteBaseMap}
        gpxTracks={gpxTracks}
        onToggleGpxVisibility={handleToggleGpxVisibility}
        onUploadGpxFile={handleUploadGpxFile}
        onAddGpxUrl={handleAddGpxUrl}
        onDeleteGpxTrack={handleDeleteGpxTrack}
        onZoomToGpxTrack={handleZoomToGpxTrack}
        onEditGpxTrack={handleStartEditGpxTrack}
        initialTab={activeModalTab}
      />

      {/* GPX Track Edit Menu (Floating panel for live marker moving) */}
      {editingGpxTrack && (
        <TrackEditMenu
          track={editingGpxTrack}
          isOpen={!!editingGpxTrack}
          onClose={() => setEditingGpxTrack(null)}
          onSave={handleSaveGpxTrack}
          onPreviewTimeOffset={handlePreviewGpxTimeOffset}
          onRevertPreview={handleRevertGpxPreview}
          onZoomToTrack={() => handleZoomToGpxTrack(editingGpxTrack)}
          onOpenAllTracks={() => {
            setEditingGpxTrack(null);
            setActiveModalTab("gpx");
            setShowBaseMapModal(true);
          }}
        />
      )}

      {/* Groups / Virtual Markers Modal */}
      <GroupsModal
        isOpen={showGroupsModal}
        onClose={() => setShowGroupsModal(false)}
        groups={groups}
        onSaveGroup={handleSaveGroup}
        onDeleteGroup={handleDeleteGroup}
        onZoomToGroup={handleZoomToGroup}
        mapCenter={currentMapCenter || undefined}
        onStartPickOnMap={() => {
          setShowGroupsModal(false);
          setIsPickingGroupPos(true);
        }}
        pickedCoords={pickedGroupCoords}
        onClearPickedCoords={() => setPickedGroupCoords(null)}
      />

      {/* Mixed Selection Confirmation Dialog */}
      <MixedSelectionDialog
        isOpen={mixedDialogState.isOpen}
        onClose={() =>
          setMixedDialogState({
            isOpen: false,
            group: null,
            photos: [],
            fixedCount: 0,
            estimatedCount: 0,
          })
        }
        groupName={mixedDialogState.group?.name || ""}
        fixedCount={mixedDialogState.fixedCount}
        estimatedCount={mixedDialogState.estimatedCount}
        onConfirm={(applyTo) => {
          if (mixedDialogState.group && mixedDialogState.photos.length > 0) {
            executeBatchAssign(mixedDialogState.photos, mixedDialogState.group, applyTo);
          }
          setMixedDialogState({
            isOpen: false,
            group: null,
            photos: [],
            fixedCount: 0,
            estimatedCount: 0,
          });
        }}
      />

      {/* Large Image Lightbox Modal */}
      {isImageEnlarged && selectedImage && (
        <div
          className={styles.lightboxOverlay}
          onClick={() => setIsImageEnlarged(false)}
        >
          <div
            className={styles.lightboxContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.lightboxHeader}>
              <div className={styles.lightboxTitle}>
                <span className={styles.lightboxName}>{selectedImage.name}</span>
                <span className={styles.lightboxDate}>
                  {new Date(selectedImage.timestamp).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <button
                className={styles.lightboxCloseBtn}
                onClick={() => setIsImageEnlarged(false)}
                title="Close"
                aria-label="Close large preview"
              >
                <X size={20} />
              </button>
            </div>
            <div className={styles.lightboxImageWrapper}>
              <img
                src={`/api/images/${selectedImage.id}/thumbnail?size=preview${
                  props.sessionToken
                    ? `&token=${encodeURIComponent(props.sessionToken)}`
                    : typeof window !== "undefined" && localStorage.getItem("geopic_session_token")
                    ? `&token=${encodeURIComponent(localStorage.getItem("geopic_session_token")!)}`
                    : ""
                }`}
                alt={selectedImage.name}
                className={styles.lightboxImage}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
