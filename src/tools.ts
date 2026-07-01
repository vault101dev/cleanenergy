import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { geocodeAddress, reverseGeocodeState, GeoPoint } from "./lib/geocode.js";
import { getPvWattsEstimate, getSolarResource } from "./lib/nrel.js";
import { getElectricityRate } from "./lib/eia.js";

// ---------------------------------------------------------------------------
// Shared location input: callers can pass either a free-form US address, or
// explicit lat/lon (useful for non-US locations, or to skip geocoding).
// ---------------------------------------------------------------------------
const locationShape = {
  address: z
    .string()
    .optional()
    .describe('Street address, city, or zip code, e.g. "1600 Amphitheatre Pkwy, Mountain View, CA". US addresses only.'),
  lat: z.number().optional().describe("Latitude, if address is not provided."),
  lon: z.number().optional().describe("Longitude, if address is not provided."),
};

async function resolveLocation(input: { address?: string; lat?: number; lon?: number }): Promise<GeoPoint> {
  if (input.lat != null && input.lon != null) {
    return { lat: input.lat, lon: input.lon };
  }
  if (input.address) {
    return geocodeAddress(input.address);
  }
  throw new Error('Provide either "address" or both "lat" and "lon".');
}

function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/**
 * Registers all clean-energy-mcp tools on a given McpServer instance.
 *
 * Shared between the stdio entry point (src/index.ts, used by the Claude
 * Desktop extension) and the HTTP entry point (src/http.ts, used for remote
 * hosting) so both surfaces expose identical tool behavior.
 */
export function registerTools(server: McpServer) {
  // ---------------------------------------------------------------------------
  // Tool 1: Solar production estimate (NREL PVWatts)
  // ---------------------------------------------------------------------------
  server.tool(
    "get_solar_production_estimate",
    "Estimate annual/monthly solar PV electricity production (kWh) for a US location using NREL's PVWatts model. " +
      "Accepts a street address or lat/lon, plus optional system design parameters (size, tilt, azimuth, panel/mounting type).",
    {
      ...locationShape,
      system_capacity_kw: z.number().positive().default(6).describe("DC system size in kW. Residential systems are typically 4-10 kW."),
      tilt_deg: z.number().min(0).max(90).optional().describe("Panel tilt in degrees from horizontal. Defaults to the location's latitude (a common rule of thumb for fixed roof mounts)."),
      azimuth_deg: z.number().min(0).max(360).default(180).describe("Panel azimuth in degrees (180 = true south, best for northern hemisphere)."),
      module_type: z.enum(["standard", "premium", "thin_film"]).default("standard"),
      array_type: z
        .enum(["fixed_open_rack", "fixed_roof_mount", "1axis_tracking", "1axis_backtracked", "2axis_tracking"])
        .default("fixed_roof_mount"),
      losses_pct: z.number().min(0).max(99).default(14.08).describe("System losses (shading, soiling, wiring, inverter, etc). NREL default is 14.08%."),
    },
    async (input) => {
      try {
        const loc = await resolveLocation(input);
        const moduleMap = { standard: 0, premium: 1, thin_film: 2 } as const;
        const arrayMap = {
          fixed_open_rack: 0,
          fixed_roof_mount: 1,
          "1axis_tracking": 2,
          "1axis_backtracked": 3,
          "2axis_tracking": 4,
        } as const;

        const result = await getPvWattsEstimate({
          lat: loc.lat,
          lon: loc.lon,
          systemCapacityKw: input.system_capacity_kw,
          moduleType: moduleMap[input.module_type],
          arrayType: arrayMap[input.array_type],
          tiltDeg: input.tilt_deg ?? Math.round(Math.abs(loc.lat)),
          azimuthDeg: input.azimuth_deg,
          lossesPct: input.losses_pct,
        });

        const summary = {
          location: {
            matchedAddress: loc.matchedAddress,
            lat: loc.lat,
            lon: loc.lon,
            nearestWeatherStation: result.stationInfo,
          },
          systemDesign: {
            systemCapacityKw: input.system_capacity_kw,
            tiltDeg: input.tilt_deg ?? Math.round(Math.abs(loc.lat)),
            azimuthDeg: input.azimuth_deg,
            moduleType: input.module_type,
            arrayType: input.array_type,
          },
          estimatedProduction: {
            acAnnualKwh: Math.round(result.acAnnualKwh),
            acMonthlyKwh: result.acMonthlyKwh.map((v) => Math.round(v)),
            capacityFactorPct: Number(result.capacityFactorPct.toFixed(1)),
            avgSolarIrradianceKwhPerM2Day: Number(result.solradAnnualKwhPerM2Day.toFixed(2)),
          },
          source: "NREL PVWatts v8",
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 2: Electricity rates (EIA)
  // ---------------------------------------------------------------------------
  server.tool(
    "get_electricity_rate",
    "Look up the current average electricity retail rate (cents/kWh) for a US state from the EIA. " +
      "Accepts either a two-letter state code, or an address/lat/lon to resolve the state automatically.",
    {
      ...locationShape,
      state: z.string().length(2).optional().describe('Two-letter US state code, e.g. "CA". If provided, skips geocoding.'),
      sector: z.enum(["residential", "commercial", "industrial"]).default("residential"),
    },
    async (input) => {
      try {
        let stateCode = input.state;
        if (!stateCode) {
          const loc = await resolveLocation(input);
          stateCode = loc.state ?? (await reverseGeocodeState(loc.lat, loc.lon));
        }
        if (!stateCode) {
          throw new Error('Could not determine a US state. Provide "state" explicitly (two-letter code).');
        }

        const sectorMap = { residential: "RES", commercial: "COM", industrial: "IND" } as const;
        const rate = await getElectricityRate(stateCode, sectorMap[input.sector]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  state: rate.state,
                  sector: input.sector,
                  centsPerKwh: rate.centsPerKwh,
                  dollarsPerKwh: Number((rate.centsPerKwh / 100).toFixed(4)),
                  period: rate.period,
                  source: rate.source,
                  note:
                    rate.source === "national-average-fallback"
                      ? "EIA lookup failed for this state/period; using a national average estimate instead."
                      : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 3: Raw irradiance / solar resource data (NREL Solar Resource)
  // ---------------------------------------------------------------------------
  server.tool(
    "get_solar_irradiance",
    "Get raw solar resource (irradiance) data for a location from NREL: average daily GHI, DNI, and " +
      "latitude-tilt irradiance (kWh/m²/day), annual and monthly. Useful for gauging solar viability " +
      "independent of any specific panel system design.",
    locationShape,
    async (input) => {
      try {
        const loc = await resolveLocation(input);
        const resource = await getSolarResource(loc.lat, loc.lon);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  location: { matchedAddress: loc.matchedAddress, lat: loc.lat, lon: loc.lon },
                  annualAverages: {
                    globalHorizontalIrradianceKwhPerM2Day: resource.avgGhiKwhPerM2Day,
                    directNormalIrradianceKwhPerM2Day: resource.avgDniKwhPerM2Day,
                    latitudeTiltIrradianceKwhPerM2Day: resource.avgLatTiltKwhPerM2Day,
                  },
                  monthly: {
                    ghi: resource.monthlyGhi,
                    dni: resource.monthlyDni,
                  },
                  source: "NREL Solar Resource Data v1",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 4: Combined savings/payback estimate
  // ---------------------------------------------------------------------------
  server.tool(
    "get_solar_savings_estimate",
    "End-to-end estimate for 'what would solar look like for this address?': chains geocoding, NREL PVWatts " +
      "production, and EIA electricity rates into an estimated annual $ savings, simple payback period, and " +
      "25-year savings projection. Uses reasonable defaults for install cost and incentives unless overridden.",
    {
      ...locationShape,
      system_capacity_kw: z.number().positive().default(6),
      monthly_electric_bill_usd: z
        .number()
        .positive()
        .optional()
        .describe("Current average monthly electric bill in USD, if known. Used to sanity-check offset %."),
      install_cost_per_watt_usd: z
        .number()
        .positive()
        .default(3.0)
        .describe("Gross install cost per watt before incentives. National residential average is roughly $2.50-$3.50/W."),
      federal_tax_credit_pct: z
        .number()
        .min(0)
        .max(100)
        .default(30)
        .describe("Federal solar investment tax credit (ITC), as a percent of gross cost. Default 30% reflects the standard residential ITC rate."),
      electricity_price_inflation_pct_per_year: z.number().min(0).max(20).default(2.5),
    },
    async (input) => {
      try {
        const loc = await resolveLocation(input);

        const [production, rate] = await Promise.all([
          getPvWattsEstimate({
            lat: loc.lat,
            lon: loc.lon,
            systemCapacityKw: input.system_capacity_kw,
            moduleType: 0,
            arrayType: 1,
            tiltDeg: Math.round(Math.abs(loc.lat)),
            azimuthDeg: 180,
            lossesPct: 14.08,
          }),
          (async () => {
            const stateCode = loc.state ?? (await reverseGeocodeState(loc.lat, loc.lon));
            if (!stateCode) return getElectricityRate("US" as any).catch(() => null);
            return getElectricityRate(stateCode, "RES");
          })(),
        ]);

        if (!rate) {
          throw new Error("Could not determine electricity rate for this location.");
        }

        const dollarsPerKwh = rate.centsPerKwh / 100;
        const grossCostUsd = input.system_capacity_kw * 1000 * input.install_cost_per_watt_usd;
        const netCostUsd = grossCostUsd * (1 - input.federal_tax_credit_pct / 100);
        const year1SavingsUsd = production.acAnnualKwh * dollarsPerKwh;

        // Simple 25-year projection accounting for electricity price inflation
        // and a modest linear panel degradation (~0.5%/year, industry standard).
        const degradationPerYear = 0.005;
        const inflation = input.electricity_price_inflation_pct_per_year / 100;
        let cumulativeSavings = 0;
        let paybackYear: number | null = null;
        const yearlyProjection: { year: number; productionKwh: number; savingsUsd: number; cumulativeSavingsUsd: number }[] = [];

        for (let year = 1; year <= 25; year++) {
          const productionKwh = production.acAnnualKwh * Math.pow(1 - degradationPerYear, year - 1);
          const priceThatYear = dollarsPerKwh * Math.pow(1 + inflation, year - 1);
          const savingsUsd = productionKwh * priceThatYear;
          cumulativeSavings += savingsUsd;
          if (paybackYear === null && cumulativeSavings >= netCostUsd) {
            paybackYear = year;
          }
          yearlyProjection.push({
            year,
            productionKwh: Math.round(productionKwh),
            savingsUsd: Math.round(savingsUsd),
            cumulativeSavingsUsd: Math.round(cumulativeSavings),
          });
        }

        const monthlyKwhUsage = input.monthly_electric_bill_usd
          ? (input.monthly_electric_bill_usd / dollarsPerKwh) * 12
          : null;
        const estimatedOffsetPct = monthlyKwhUsage
          ? Number(((production.acAnnualKwh / monthlyKwhUsage) * 100).toFixed(0))
          : null;

        const summary = {
          location: { matchedAddress: loc.matchedAddress, lat: loc.lat, lon: loc.lon, state: loc.state },
          systemAssumptions: {
            systemCapacityKw: input.system_capacity_kw,
            installCostPerWattUsd: input.install_cost_per_watt_usd,
            grossCostUsd: Math.round(grossCostUsd),
            federalTaxCreditPct: input.federal_tax_credit_pct,
            netCostAfterCreditUsd: Math.round(netCostUsd),
          },
          electricityRate: {
            dollarsPerKwh: Number(dollarsPerKwh.toFixed(4)),
            state: rate.state,
            source: rate.source,
          },
          production: {
            acAnnualKwhYear1: Math.round(production.acAnnualKwh),
            estimatedAnnualUsageOffsetPct: estimatedOffsetPct,
          },
          financials: {
            estimatedYear1SavingsUsd: Math.round(year1SavingsUsd),
            simplePaybackYears: paybackYear,
            cumulative25YearSavingsUsd: Math.round(cumulativeSavings),
            netLifetimeGainUsd: Math.round(cumulativeSavings - netCostUsd),
          },
          yearlyProjection,
          caveats: [
            "Uses default 6kW system and NREL default losses unless overridden; actual quotes will vary by installer, roof condition, and equipment.",
            "Install cost/watt and ITC are estimates, not a real quote — verify with a licensed installer.",
            "Electricity price inflation and panel degradation are simplified linear assumptions.",
          ],
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
