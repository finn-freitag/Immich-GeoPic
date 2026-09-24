export type ImageItem = {
    id: string;
    name: string;
    path?: string;
    timestamp: string; // ISO 8601 or any format parsable by Date
    coords?: {
        lat: number;
        lng: number;
    };
    city?: string;
    country?: string;
    thumbUrl?: string;
    timeZone?: string | null;
    localDateTime?: string | null;
    camera?: string | null;
    cameraMake?: string | null;
    cameraModel?: string | null;
};