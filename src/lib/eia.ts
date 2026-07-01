import { config, fetchJson } from "./config.js";

export interface ElectricityRateResult {
  state: string;
  sector: string;
  centsPerKwh: number;
  period: string;
  source: "EIA" | "national-average-fallback";
}

// Used only if a specific state lookup fails; keeps the tool useful even
// when EIA's API has a data gap for a given state/period.
const NATIONAL_AVERAGE_FALLBACK_CENTS_PER_KWH = 16.5;

/**
 * Look up the average residential electricity retail price (cents/kWh) for
 * a US state from the EIA API (series: electricity/retail-sales). Docs:
 * https://www.eia.gov/opendata/browser/electricity/retail-sales
 */
export async function getElectricityRate(
  stateCode: string,
  sector: "RES" | "COM" | "IND" = "RES"
): Promise<ElectricityRateResult> {
  const url =
    "https://api.eia.gov/v2/electricity/retail-sales/data/?" +
    new URLSearchParams({
      api_key: config.eiaApiKey,
      "frequency": "monthly",
      "data[0]": "price",
      "facets[stateid][]": stateCode.toUpperCase(),
      "facets[sectorid][]": sector,
      "sort[0][column]": "period",
      "sort[0][direction]": "desc",
      "length": "1",
    }).toString();

  try {
    const data = await fetchJson<any>(url, "EIA");
    const row = data.response?.data?.[0];

    if (!row || row.price == null) {
      throw new Error(`No EIA price data returned for state ${stateCode}`);
    }

    return {
      state: stateCode.toUpperCase(),
      sector,
      centsPerKwh: row.price,
      period: row.period,
      source: "EIA",
    };
  } catch (err) {
    // Degrade gracefully rather than blocking a whole savings estimate.
    return {
      state: stateCode.toUpperCase(),
      sector,
      centsPerKwh: NATIONAL_AVERAGE_FALLBACK_CENTS_PER_KWH,
      period: "unavailable",
      source: "national-average-fallback",
    };
  }
}
