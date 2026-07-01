import { config, fetchJson } from "./config.js";

export interface PVWattsParams {
  lat: number;
  lon: number;
  systemCapacityKw: number;
  moduleType: 0 | 1 | 2; // 0=standard, 1=premium, 2=thin film
  arrayType: 0 | 1 | 2 | 3 | 4; // 0=fixed open rack ... 4=2-axis tracking
  tiltDeg: number;
  azimuthDeg: number;
  lossesPct: number;
}

export interface PVWattsResult {
  acAnnualKwh: number;
  acMonthlyKwh: number[];
  solradAnnualKwhPerM2Day: number;
  capacityFactorPct: number;
  stationInfo: {
    city?: string;
    state?: string;
    distanceMeters?: number;
  };
}

/**
 * Call NREL's PVWatts v8 API to model expected AC energy production for a
 * given location and system configuration. Docs:
 * https://developer.nlr.gov/docs/solar/pvwatts/v8/
 */
export async function getPvWattsEstimate(params: PVWattsParams): Promise<PVWattsResult> {
  const url =
    "https://developer.nlr.gov/api/pvwatts/v8.json?" +
    new URLSearchParams({
      api_key: config.nrelApiKey,
      lat: String(params.lat),
      lon: String(params.lon),
      system_capacity: String(params.systemCapacityKw),
      module_type: String(params.moduleType),
      array_type: String(params.arrayType),
      tilt: String(params.tiltDeg),
      azimuth: String(params.azimuthDeg),
      losses: String(params.lossesPct),
      timeframe: "monthly",
    }).toString();

  const data = await fetchJson<any>(url, "NREL PVWatts");

  if (!data.outputs) {
    throw new Error(
      `NREL PVWatts returned no output for lat=${params.lat}, lon=${params.lon}. ` +
        `This location may be outside PVWatts' solar resource coverage.`
    );
  }

  return {
    acAnnualKwh: data.outputs.ac_annual,
    acMonthlyKwh: data.outputs.ac_monthly,
    solradAnnualKwhPerM2Day: data.outputs.solrad_annual,
    capacityFactorPct: data.outputs.capacity_factor,
    stationInfo: {
      city: data.station_info?.city,
      state: data.station_info?.state,
      distanceMeters: data.station_info?.distance,
    },
  };
}

export interface SolarResourceResult {
  avgGhiKwhPerM2Day: number; // Global Horizontal Irradiance, annual average
  avgDniKwhPerM2Day: number; // Direct Normal Irradiance, annual average
  avgLatTiltKwhPerM2Day: number; // irradiance at latitude-tilt, annual average
  monthlyGhi: number[];
  monthlyDni: number[];
}

/**
 * Call NREL's Solar Resource Data API for raw irradiance/weather-derived
 * averages at a location (independent of any PV system design). Docs:
 * https://developer.nlr.gov/docs/solar/solar-resource-v1/
 */
export async function getSolarResource(lat: number, lon: number): Promise<SolarResourceResult> {
  const url =
    "https://developer.nlr.gov/api/solar/solar_resource/v1.json?" +
    new URLSearchParams({
      api_key: config.nrelApiKey,
      lat: String(lat),
      lon: String(lon),
    }).toString();

  const data = await fetchJson<any>(url, "NREL Solar Resource");
  const outputs = data.outputs;

  if (!outputs) {
    throw new Error(
      `NREL Solar Resource API returned no data for lat=${lat}, lon=${lon}.`
    );
  }

  return {
    avgGhiKwhPerM2Day: outputs.avg_ghi?.annual,
    avgDniKwhPerM2Day: outputs.avg_dni?.annual,
    avgLatTiltKwhPerM2Day: outputs.avg_lat_tilt?.annual,
    monthlyGhi: outputs.avg_ghi?.monthly ? Object.values(outputs.avg_ghi.monthly) : [],
    monthlyDni: outputs.avg_dni?.monthly ? Object.values(outputs.avg_dni.monthly) : [],
  };
}
