# ipwho-mcp

This package only reserves the plain name. The official MCP server for the [IPWho](https://www.ipwho.org) IP geolocation API is **[`@ipwho/mcp-server`](https://www.npmjs.com/package/@ipwho/mcp-server)**; this package depends on it and runs the same server, so `npx -y ipwho-mcp` behaves like `npx -y @ipwho/mcp-server`.

Please install `@ipwho/mcp-server` directly. Setup for Claude Code, Claude Desktop, Cursor and VS Code, the hosted endpoint at `https://mcp.ipwho.org/mcp`, and the honest limits are documented at [ipwho.org/docs/api/mcp-server](https://www.ipwho.org/docs/api/mcp-server) and in the [repository](https://github.com/lavrox/ipwho-mcp).

You need an IPWho API key in `IPWHO_API_KEY` ([free plan](https://www.ipwho.org/free-plan), 2,000 lookups a day). MIT licence.
