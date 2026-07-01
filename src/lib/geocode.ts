import { fetchJson } from "./config.js";

export interface GeoPoint {
  lat: number;
  lon: number;
  matchedAddress?: string;
  state?: string;
}

interface CensusResponse {
  result: {
    addressMatches: Array<{
      matchedAddress: string;
      coordinates: { x: number; y: number };
      addressComponents?: { state?: string };
    }>;
  };
}

/**
 * Resolve a free-form US address/city/zip to lat/lon using the US Census
 * Bureau's free geocoder (no API key required). This is the fallback path
 * used when the caller supplies an address instead of raw coordinates.
 */
export async function geocodeAddress(address: string): Promise<GeoPoint> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" +
    new URLSearchParams({
      address,
      benchmark: "Public_AR_Current",
      format: "json",
    }).toString();

  const data = await fetchJson<CensusResponse>(url, "US Census Geocoder");
  const match = data.result?.addressMatches?.[0];

  if (!match) {
    throw new Error(
      `Could not geocode address "${address}". This geocoder only covers US addresses. ` +
        `Try a more specific address (street, city, state), or call the tool again with ` +
        `explicit "lat" and "lon" parameters if you already know the coordinates.`
    );
  }

  return {
    lat: match.coordinates.y,
    lon: match.coordinates.x,
    matchedAddress: match.matchedAddress,
    state: match.addressComponents?.state,
  };
}

/**
 * Resolve a two-letter US state code from coordinates using the Census
 * reverse-geocoder. Used when a caller supplies lat/lon directly but a
 * downstream tool (EIA rates) needs a state.
 */
export async function reverseGeocodeState(lat: number, lon: number): Promise<string | undefined> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?" +
    new URLSearchParams({
      x: String(lon),
      y: String(lat),
      benchmark: "Public_AR_Current",
      vintage: "Current_Current",
      format: "json",
    }).toString();

  try {
    const data = await fetchJson<any>(url, "US Census Reverse Geocoder");
    const states = data.result?.geographies?.["States"];
    return states?.[0]?.STUSAB;
  } catch {
    // Non-fatal: EIA lookup can fall back to national average if this fails.
    return undefined;
  }
}
