# IPWho MCP server

An [MCP](https://modelcontextprotocol.io) server for the [IPWho](https://www.ipwho.org) IP geolocation API. It lets AI agents (Claude, Cursor, VS Code Copilot and other MCP clients) look up IP addresses directly.

> **Status: v0.1.0.** The hosted server at `mcp.ipwho.org` is live. The npm package `@ipwho/mcp-server` is published from this repository; `ipwho-mcp` is an alias that runs the same server. Setup guide with per-client tabs: [ipwho.org/docs/api/mcp-server](https://www.ipwho.org/docs/api/mcp-server).

You need an IPWho API key ([sign up at ipwho.org](https://www.ipwho.org)). Every lookup counts against your plan's quota, the same as calling the API directly.

## Tools

| Tool | What it does | Local | Hosted |
|---|---|:-:|:-:|
| `lookup_ip` | One IPv4 or IPv6 address. Optional `get` field filter, e.g. `geoLocation,security`. | ✅ | ✅ |
| `lookup_bulk` | 1–100 addresses in one call. Results are in `data.responseArray`. | ✅ | ✅ |
| `lookup_me` | The public IP of the machine running the server. | ✅ | — |

`lookup_me` isn't offered on the hosted server: there it would look up Cloudflare's IP, not yours.

**What you get back:** two parts. First, the API's JSON, unchanged: `{ "success": true, "data": { … } }`, with the objects `geoLocation`, `timezone`, `flag`, `currency`, `connection`, `security` and `userAgent`. Field names keep their exact wire casing (`postal_Code`, `flag_Icon`, `asn_number`). See the [API docs](https://www.ipwho.org/docs). Second, a one-line attribution: `Data source: IPWho (https://www.ipwho.org)`. The tool descriptions also ask the agent to name IPWho as the source.

**Honest limits** (the tool descriptions tell the agent these too):

- IP geolocation is approximate, especially at city level. Many fields can be `null`; `region` and `city` often are.
- `connection.connection_type` is `Cable/DSL`, `Cellular`, `Corporate`, `Satellite` or `null`. `Corporate` also covers offices, VPNs and cloud networks, so it isn't datacenter detection.
- `security` is a basic signal: `isVpn` and `isTor` (true/false) and `isThreat` (`low`/`medium`/`high`). It isn't a fraud or risk score.
- Only JSON is returned. The API's XML and CSV formats aren't exposed.

## Local setup (npm package, runs on your machine)

The server reads your key from the `IPWHO_API_KEY` environment variable. Node.js 18 or later is required.

### Claude Code

```bash
claude mcp add ipwho --env IPWHO_API_KEY=YOUR_KEY -- npx -y @ipwho/mcp-server
```

### Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ipwho": {
      "command": "npx",
      "args": ["-y", "@ipwho/mcp-server"],
      "env": { "IPWHO_API_KEY": "YOUR_KEY" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "ipwho": {
      "command": "npx",
      "args": ["-y", "@ipwho/mcp-server"],
      "env": { "IPWHO_API_KEY": "YOUR_KEY" }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`. VS Code asks for the key once and stores it securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "ipwho-key", "description": "IPWho API key", "password": true }
  ],
  "servers": {
    "ipwho": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ipwho/mcp-server"],
      "env": { "IPWHO_API_KEY": "${input:ipwho-key}" }
    }
  }
}
```

## Hosted setup (`https://mcp.ipwho.org/mcp`)

The hosted server uses Streamable HTTP. Send your key in a header on every request, either `X-API-Key: YOUR_KEY` or `Authorization: Bearer YOUR_KEY`. Without a key it returns `401`. A key in the URL is refused.

```bash
# Claude Code
claude mcp add --transport http ipwho https://mcp.ipwho.org/mcp --header "X-API-Key: YOUR_KEY"
```

```json
// Cursor (~/.cursor/mcp.json)
{ "mcpServers": { "ipwho": { "url": "https://mcp.ipwho.org/mcp", "headers": { "X-API-Key": "YOUR_KEY" } } } }
```

```json
// VS Code (.vscode/mcp.json), with the same "inputs" block as above
{ "servers": { "ipwho": { "type": "http", "url": "https://mcp.ipwho.org/mcp", "headers": { "X-API-Key": "${input:ipwho-key}" } } } }
```

Claude Desktop's and claude.ai's custom connectors expect OAuth sign-in rather than a pasted key, so use the local package there for now. OAuth is planned.

## Your key

- It's sent to `api.ipwho.org` only, in the `X-API-Key` header, and never in a URL.
- It's never logged or echoed back in error messages.
- The hosted server is stateless: it keeps no sessions and stores nothing. Each request carries its own key, which is used for that request only.
- The hosted server logs one line per request for operations: the HTTP method, path, status, duration and the MCP method or tool name. It never logs headers, your key, the IP addresses you look up, or results. Cloudflare's automatic request logs are switched off.

## Development

```bash
npm install
npm run typecheck      # Node (stdio) and Cloudflare Workers types
npm test               # 20 tests against a local mock API, local and hosted
npm run test:workerd   # the Worker in Cloudflare's local runtime (wrangler dev --local), against the mock
IPWHO_API_KEY=... npm run test:live   # live API through the local server (uses ~5 lookups)
```

**Publishing to npm (maintainers):** `server.json` (official MCP registry entry) and `mcpName` in `package.json` must keep the same name, `io.github.lavrox/ipwho-mcp`, and the versions must match. From a fresh clone of `main`: `npm ci && npm test && npm publish --access public`, then `cd packages/ipwho-mcp && npm publish --access public` (the alias depends on the exact version just published). Registry entry: `mcp-publisher login github`, then `mcp-publisher publish`.

**Deploying the hosted server:** merging to `main` runs `.github/workflows/deploy.yml`. It runs the tests, then `wrangler deploy`, then checks mcp.ipwho.org. It needs the repo secrets `CF_API_TOKEN` (a Cloudflare "Edit Cloudflare Workers" token that also has Zone → Workers Routes → Edit on ipwho.org) and `CF_ACCOUNT_ID`. The deploy attaches the custom domain `mcp.ipwho.org` itself (`routes` in `wrangler.jsonc`).

Layout: `src/ipwho.ts` (API client) · `src/server.ts` (tool definitions, shared) · `src/stdio.ts` (local entry) · `src/worker.ts` (hosted entry, Cloudflare Worker) · `wrangler.jsonc` (Worker config; no secrets; Workers Logs on for our own log lines only).

## License

MIT
