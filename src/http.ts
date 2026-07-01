#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response, NextFunction } from "express";
import { registerTools } from "./tools.js";

// Remote entry point: used when hosting this server on the public internet
// (Render, Fly.io, etc.) so it can be attached via the Anthropic API's
// `mcp_servers` parameter, or any other remote MCP client.
//
// Runs in STATELESS mode: a fresh McpServer + transport is created per
// request (sessionIdGenerator: undefined). This fits a read-only, no-memory
// tool server like this one, and avoids needing sticky sessions or shared
// session storage across instances/redeploys.

const PORT = Number(process.env.PORT) || 3000;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.warn(
    "WARNING: MCP_AUTH_TOKEN is not set. This server will accept unauthenticated requests " +
      "from anyone who finds the URL. Set MCP_AUTH_TOKEN before deploying publicly."
  );
}

// Binding to 0.0.0.0 is required for Render/Fly/most PaaS hosts; the SDK's
// helper only auto-applies DNS-rebinding protection for localhost-style
// hosts, so we rely on the bearer-token check below for public binding.
const app = createMcpExpressApp({ host: "0.0.0.0" });

// CORS: allows this server to be called directly from a browser-based
// frontend (e.g. the solar quote widget) on a different origin. The bearer
// token below is the actual access control; this just permits the browser
// to make and read the cross-origin request in the first place.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

function checkAuth(req: Request, res: Response, next: NextFunction) {
  if (!AUTH_TOKEN) return next(); // no token configured — see warning above
  const header = req.headers["authorization"];
  if (header === `Bearer ${AUTH_TOKEN}`) return next();
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized: missing or invalid bearer token" },
    id: null,
  });
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "clean-energy-mcp" });
});

app.post("/mcp", checkAuth, async (req, res) => {
  try {
    const server = new McpServer({ name: "clean-energy-mcp", version: "1.0.0" });
    registerTools(server);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET/DELETE are used for server-initiated streams and session teardown in
// stateful mode; neither applies here since we run stateless.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (this server runs in stateless mode)." },
    id: null,
  });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (this server runs in stateless mode)." },
    id: null,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`clean-energy-mcp HTTP server listening on port ${PORT}`);
  console.log(`MCP endpoint: POST /mcp`);
  console.log(`Health check: GET /health`);
});
