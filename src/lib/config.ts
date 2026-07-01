import "dotenv/config";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example for setup instructions.`
    );
  }
  return val;
}

export const config = {
  get nrelApiKey(): string {
    return requireEnv("NREL_API_KEY");
  },
  get eiaApiKey(): string {
    return requireEnv("EIA_API_KEY");
  },
  userAgent: "clean-energy-mcp/1.0 (https://github.com/your-org/clean-energy-mcp)",
};

export class UpstreamApiError extends Error {
  constructor(public source: string, public status: number, public detail: string) {
    super(`${source} API error (HTTP ${status}): ${detail}`);
    this.name = "UpstreamApiError";
  }
}

/** Fetch JSON with a clear, tool-friendly error on failure. */
export async function fetchJson<T = any>(
  url: string,
  source: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": config.userAgent,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const detail =
      body?.errors?.[0]?.message ||
      body?.error ||
      body?.message ||
      text.slice(0, 300) ||
      res.statusText;
    throw new UpstreamApiError(source, res.status, detail);
  }

  return body as T;
}
