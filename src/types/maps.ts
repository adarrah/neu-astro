export interface MapPopupLink {
  label: string;
  url: string;
}

export interface MapPopupData {
  title?: string;
  category?: string;
  lead?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  details?: string[];
  links?: MapPopupLink[];
}

export interface MapCategory {
  slug: string;
  name: string;
}

export interface MapPolygon {
  id: string;
  title: string;
  categories?: string[];
  geojson: GeoJSON.FeatureCollection | GeoJSON.Feature;
  color?: string;
  opacity?: number;
  borderColor?: string;
  borderOpacity?: number;
  borderWidth?: number;
  popup?: MapPopupData;
}

export interface MapLine {
  id: string;
  title: string;
  categories?: string[];
  geojson: GeoJSON.FeatureCollection | GeoJSON.Feature;
  color?: string;
  opacity?: number;
  width?: number;
}

export interface MapLocation {
  id: string;
  title: string;
  categories?: string[];
  geojson: GeoJSON.FeatureCollection;
  style?: 'label' | 'marker' | string;
  markerColor?: string;
  labelText?: string;
  labelColor?: string;
  labelHaloColor?: string;
  labelSize?: number;
  popup?: MapPopupData;
}

export interface MapConfig {
  id: string;
  title: string;
  style?: string;
  center: [number, number];
  zoom: number;
  height?: string;
  zoomControl?: boolean;
  scrollZoom?: boolean;
  categoryFilter?: boolean;
  categories?: MapCategory[];
  polygons?: MapPolygon[];
  lines?: MapLine[];
  locations?: MapLocation[];
  accessToken?: string;
}

