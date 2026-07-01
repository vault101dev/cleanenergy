# clean-energy-mcp

An MCP (Model Context Protocol) server that connects Claude to **live solar and
energy data** — so anyone using Claude can ask, in plain English:

> "What would solar look like for 742 Evergreen Terrace, Springfield?"

...and get a real, data-backed answer: expected system production, local
electricity rates, and a savings/payback estimate — computed from live
government/utility data, not the model's imagination.

> **Note on naming:** On December 1, 2025, DOE renamed the National Renewable
> Energy Laboratory (NREL) to the National Laboratory of the Rockies (NLR).
> Existing API keys still work — only the API domain changed, from
> `developer.nrel.gov` to `developer.nlr.gov`. This codebase uses the new
> domain in all API calls; env var names (`NREL_API_KEY`) and comments
> referencing "NREL" are kept for continuity with the still-widely-used lab
> name and existing key-signup flow.

## Why this exists

Solar feasibility questions ("is my roof any good for panels? what would I
actually save?") require three pieces of live, location-specific data that an
LLM cannot know on its own:

1. **How much sun hits this exact spot** (irradiance / weather-derived solar resource)
2. **How much electricity a given system would actually produce there** (accounting for panel angle, shading losses, local climate)
3. **What electricity actually costs in that state** (rates vary 3x+ across the US)

This server wires all three into Claude via MCP tools backed by authoritative
public APIs — [NREL PVWatts](https://developer.nlr.gov/docs/solar/pvwatts/v8/),
[NREL Solar Resource Data](https://developer.nlr.gov/docs/solar/solar-resource-v1/),
and the [EIA electricity retail-sales API](https://www.eia.gov/opendata/browser/electricity/retail-sales) —
plus free US Census geocoding to turn addresses into coordinates.

## Tools exposed

| Tool | What it does |
|---|---|
| `get_solar_production_estimate` | PVWatts-modeled annual/monthly kWh production for a location + system design (size, tilt, azimuth, panel/mount type) |
| `get_electricity_rate` | Current average residential/commercial/industrial electricity rate (¢/kWh) for a US state |
| `get_solar_irradiance` | Raw solar resource data (GHI/DNI, annual + monthly) — solar viability independent of any specific system |
| `get_solar_savings_estimate` | **The main "what would solar look like" tool.** Chains geocoding → PVWatts → EIA rates into estimated annual $ savings, simple payback period, and a 25-year projection |

Every location-taking tool accepts either a free-form US `address`, or
explicit `lat`/`lon` (handy for non-US locations or to skip geocoding).

## Publishing this to your own GitHub repo

```bash
cd clean-energy-mcp
git init
git add .
git commit -m "Initial commit: clean-energy-mcp"
git branch -M main
git remote add origin https://github.com/<your-username>/clean-energy-mcp.git
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `dist/`, and `.env` — **your
API keys will never be committed** as long as you keep them in `.env` (which
is what `.env.example` is for). Double-check with `git status` before your
first commit that `.env` isn't staged.

A GitHub Actions workflow (`.github/workflows/build.yml`) is included and
will automatically verify the project builds on every push — a nice signal
for anyone (e.g. Sunrun engineers) browsing the repo. It needs no secrets
since it only compiles the TypeScript, it doesn't call the live APIs.

> **Note: GitHub Pages will not work for this project.** Pages only serves
> static files to a browser — it can't run a persistent Node process, speak
> the MCP stdio protocol, or hold API keys server-side. This is a real
> limitation of Pages, not a config issue. Once published, people use this
> repo by **cloning it and running it locally** (see below) — the same way
> most MCP servers are distributed today. If you eventually want it reachable
> remotely over the network (not through Pages), that requires switching the
> transport from stdio to HTTP/SSE and deploying to a Node-capable host like
> Render, Fly.io, or Railway — a different, larger change. Happy to help with
> that if/when you want it.

### Running it from a cloned GitHub repo

Anyone (including you, on a different machine) sets it up the same way:

```bash
git clone https://github.com/<your-username>/clean-energy-mcp.git
cd clean-energy-mcp
npm install
cp .env.example .env
# edit .env and paste in your own NREL_API_KEY and EIA_API_KEY
npm run build
```

Then point Claude Desktop at the built file as described below. Each person
running this needs their **own** API keys in their **own** local `.env` —
keys should never be shared via the repo, chat, or any committed file.

## Quick start (local dev, no GitHub needed)

```bash
git clone <this-repo>
cd clean-energy-mcp
npm install
cp .env.example .env
# edit .env and add your NREL_API_KEY and EIA_API_KEY (both free, instant signup)
npm run build
```

Get free API keys:
- NREL: https://developer.nlr.gov/signup/
- EIA: https://www.eia.gov/opendata/register.php

### Run it standalone (for testing)

```bash
npm start
```

The server speaks MCP over stdio and will wait for a client to connect.

### Connect it to Claude Desktop

Add to your Claude Desktop config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "clean-energy": {
      "command": "node",
      "args": ["/absolute/path/to/clean-energy-mcp/dist/index.js"],
      "env": {
        "NREL_API_KEY": "your_nrel_api_key_here",
        "EIA_API_KEY": "your_eia_api_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "clean-energy" listed as an available
MCP server, with its four tools ready to use.

### Connect it to Claude Code / other MCP clients

Any MCP-compatible client that supports stdio servers can run this the same
way: `node dist/index.js` with `NREL_API_KEY` and `EIA_API_KEY` set in the
environment.

## Example prompts once connected

- "What would a 7kW solar system produce at 350 Fifth Ave, New York, NY?"
- "What's the average electricity rate in Texas right now?"
- "Is 29 Palms, CA a good spot for solar? Show me the irradiance data."
- "I pay about $180/month for electricity in Denver, CO. What would solar
  savings and payback look like for a 6kW system?"

## Two ways to run this

| | Local (Claude Desktop) | Remote (hosted, public URL) |
|---|---|---|
| Transport | stdio | Streamable HTTP |
| Entry point | `dist/index.js` | `dist/http.js` |
| Install method | `.mcpb` extension | Deploy to Render/Fly/etc. |
| Auth | N/A (local process) | Bearer token (`MCP_AUTH_TOKEN`) |
| Use case | Chatting with Claude Desktop | Calling from the Anthropic API's `mcp_servers` param, or sharing a live demo link |

Both entry points share identical tool logic (`src/tools.ts`) — only the transport differs.

## Deploying the HTTP server (Render)

This gives you a public URL you can attach to any MCP-compatible client that
supports remote servers — including the Anthropic API directly, without
Claude Desktop in the loop at all. Useful for demos, or building a real app
on top of this.

### 1. Test it locally first

```bash
npm run build
MCP_AUTH_TOKEN=$(openssl rand -hex 32) NREL_API_KEY=... EIA_API_KEY=... npm run start:http
```

In another terminal:
```bash
curl http://localhost:3000/health
# {"status":"ok","service":"clean-energy-mcp"}
```

### 2. Deploy to Render

Push this repo to GitHub (see above), then either:

- **Blueprint (recommended):** In the Render dashboard, choose **New → Blueprint**, point it at your repo. Render reads `render.yaml` and creates the service automatically, including auto-generating `MCP_AUTH_TOKEN` for you.
- **Manual:** New → Web Service → connect your repo. Set build command `npm install && npm run build`, start command `npm run start:http`, instance type **Free**.

Either way, go to the service's **Environment** tab and set `NREL_API_KEY` and `EIA_API_KEY` (these are marked `sync: false` in `render.yaml` specifically so they're never committed — you enter them directly in Render's dashboard).

### 3. Remember the free-tier tradeoff

Render's free web services spin down after 15 minutes of no traffic and take 30–60 seconds to cold-start on the next request. Fine for a demo you're actively showing; if you want it always-warm for something like a live interview link, Render's cheapest paid tier ($7/mo) removes the sleep behavior.

### 4. Verify the deployed endpoint

```bash
curl https://your-service.onrender.com/health

curl -X POST https://your-service.onrender.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer YOUR_MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### 5. Call it from the Anthropic API

Once deployed, attach it via `mcp_servers` in the Messages API — this is the
piece that makes a standalone app possible, since your app's backend can now
call Claude with this MCP server attached instead of going through Claude
Desktop:

```python
import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1000,
    messages=[{"role": "user", "content": "What would solar look like at 1600 Amphitheatre Pkwy, Mountain View, CA?"}],
    mcp_servers=[{
        "type": "url",
        "url": "https://your-service.onrender.com/mcp",
        "name": "clean-energy",
        "authorization_token": "YOUR_MCP_AUTH_TOKEN",  # matches MCP_AUTH_TOKEN on Render
    }],
    betas=["mcp-client-2025-11-20"],
)
print(response.content)
```

Note this is a separate integration path from the Claude Desktop extension —
the `.mcpb` file and the hosted HTTP server can both exist and be used
independently; installing one doesn't affect the other.

## Architecture

```
src/
  index.ts        Local (stdio) entry point — used by the Claude Desktop extension
  http.ts         Remote (Streamable HTTP) entry point — used for hosted deployment
  tools.ts        All 4 tool definitions (input schemas, orchestration) — shared by both entry points
  lib/
    config.ts     env var loading + shared fetch/error handling
    geocode.ts     US Census geocoder (free, no API key) — address -> lat/lon
    nrel.ts         NREL PVWatts + Solar Resource clients
    eia.ts          EIA electricity retail rate client (with graceful fallback)
```

Design choices worth noting for reviewers:

- **Geocoding uses the US Census Bureau's free geocoder**, not a paid service —
  no extra API key needed, and it's a good match since PVWatts/EIA are
  fundamentally US-focused datasets. `lat`/`lon` can always be passed directly
  to bypass it (e.g. for non-US locations).
- **EIA lookups degrade gracefully**: if a specific state/period has a data
  gap, the tool falls back to a labeled national-average rate rather than
  failing the whole request — important for a savings estimate that chains
  three upstream APIs.
- **The savings estimate tool is intentionally conservative and transparent**:
  it surfaces every assumption (install cost/watt, tax credit %, degradation,
  inflation) as an overridable parameter and echoes them back in the output,
  plus an explicit `caveats` field, rather than presenting a single
  confident-looking number.
- **The HTTP transport runs stateless** (`sessionIdGenerator: undefined`): a
  fresh `McpServer` + transport per request, no session store. This fits a
  read-only tool server with no per-user memory, and sidesteps needing sticky
  sessions or shared session storage across free-tier instances that spin
  down/restart.

## Extending this

Natural next additions:
- Utility-specific net metering / time-of-use rate schedules (EIA's
  retail-sales series is state-average only)
- Roof polygon / shading analysis via Google Solar API for a specific building
- Battery storage sizing and ROI (e.g. against outage-risk or TOU arbitrage)
- Caching layer for PVWatts/EIA responses (both are cheap to cache by
  lat/lon-rounded-to-3-decimals + system params)

## License

MIT
