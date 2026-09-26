export interface AppSettings {
  // Timezone & DST
  autoDetectDstMismatch: boolean; // default: true
  preferGpxTimezone: boolean; // default: true
  strictGpxUtc: boolean; // default: true
  fallbackTimezone: string; // default: "Europe/Berlin"

  // Map & Routing
  showContinuousPolyline: boolean; // default: true
  polylineColor: string; // default: "#4250af"
  markerTooltipThreshold: number; // default: 1500

  // General & Defaults
  defaultTimespanPreset: "1m" | "3m" | "6m" | "1y" | "all"; // default: "6m"
  confirmBulkLocationUpdates: boolean; // default: true
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoDetectDstMismatch: true,
  preferGpxTimezone: true,
  strictGpxUtc: true,
  fallbackTimezone: "Europe/Berlin",
  showContinuousPolyline: true,
  polylineColor: "#4250af",
  markerTooltipThreshold: 1500,
  defaultTimespanPreset: "6m",
  confirmBulkLocationUpdates: true,
};
