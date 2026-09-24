export type GpxTrackType = "file" | "url";

export interface GpxPoint {
  lat: number;
  lng: number;
  time: number; // UTC millisecond epoch
  ele?: number;
  name?: string;
  desc?: string;
}

export interface GpxBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface GpxTrackMetadata {
  id: string;
  userId: string;
  type: GpxTrackType;
  name: string;
  filename?: string;
  url?: string;
  createdAt: string;
  fileSize?: number;
  pointsCount: number;
  startTime?: string;
  endTime?: string;
  bounds?: GpxBounds;
  isVisible: boolean;
  isInternal?: boolean;
  lastFetchedAt?: string;
  fetchError?: string;
  timeOffsetMs?: number;
}

export interface GpxTrackWithPoints extends GpxTrackMetadata {
  points: GpxPoint[];
}
