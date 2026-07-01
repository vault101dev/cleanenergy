#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

// Local entry point: used by the Claude Desktop extension (.mcpb).
// Speaks MCP over stdio to a single client process.

async function main() {
  const server = new McpServer({
    name: "clean-energy-mcp",
    version: "1.0.0",
  });
  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("clean-energy-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting clean-energy-mcp:", err);
  process.exit(1);
});
