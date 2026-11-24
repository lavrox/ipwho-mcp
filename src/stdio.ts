#!/usr/bin/env node
/**
 * Local IPWho MCP server (stdio). Runs on the user's machine with their own key:
 *   IPWHO_API_KEY=sk.xxx npx -y @ipwho/mcp-server
 * Nothing is written to stdout except MCP protocol messages; the key is never logged.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const apiKey = process.env.IPWHO_API_KEY?.trim();
if (!apiKey) {
  console.error("ipwho-mcp: set the IPWHO_API_KEY environment variable to your IPWho API key (https://www.ipwho.org).");
  process.exit(1);
}

const server = createServer({
  apiKey,
  apiBase: process.env.IPWHO_API_BASE || undefined,
  includeLookupMe: true,
});

await server.connect(new StdioServerTransport());
