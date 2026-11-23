# IPWho MCP server

An [MCP](https://modelcontextprotocol.io) server for the [IPWho](https://www.ipwho.org) IP geolocation API. It lets AI agents (Claude, Cursor, VS Code Copilot and other MCP clients) look up IP addresses directly.

> **Status: pre-release (v0.1.0).** It isn't published to npm yet, and `mcp.ipwho.org` isn't live yet. The setup below shows how it will work once both are released.

You need an IPWho API key ([sign up at ipwho.org](https://www.ipwho.org)). Every lookup counts against your plan's quota, the same as calling the API directly.

## Tools

| Tool | What it does | Local | Hosted |
|---|---|:-:|:-:|
| `lookup_ip` | One IPv4 or IPv6 address. Optional `get` field filter, e.g. `geoLocation,security`. | ✅ | ✅ |
| `lookup_bulk` | 1–100 addresses in one call. Results are in `data.responseArray`. | ✅ | ✅ |
| `lookup_me` | The public IP of the machine running the server. | ✅ | — |

`lookup_me` isn't offered on the hosted server: there it would look up Cloudflare's IP, not yours.

**What you get back:** the API's JSON, unchanged: `{ "success": true, "data": { … } }`, with the objects `geoLocation`, `timezone`, `flag`, `currency`, `connection`, `security` and `userAgent`. Field names keep their exact wire casing (`postal_Code`, `flag_Icon`, `asn_number`). See the [API docs](https://www.ipwho.org/docs).

**Honest limits** (the tool descriptions tell the agent these too):

- IP geolocation is approximate, especially at city level. Many fields can be `null`; `region` and `city` often are.
- `connection.connection_type` is `Cable/DSL`, `Cellular`, `Corporate`, `Satellite` or `null`. `Corporate` also covers offices, VPNs and cloud networks, so it isn't datacenter detection.
- `security` is a basic signal: `isVpn` and `isTor` (true/false) and `isThreat` (`low`/`medium`/`high`). It isn't a fraud or risk score.
- Only JSON is returned. The API's XML and CSV formats aren't exposed.

## Local setup (npm package, runs on your machine)

The server reads your key from the `IPWHO_API_KEY` environment variable. Node.js 18 or later is required.

### Claude Code

```bash
claude mcp add ipwho --env IPWHO_API_KEY=YOUR_KEY -- npx -y @lavrox/ipwho-mcp
```

### Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ipwho": {
      "command": "npx",
      "args": ["-y", "@lavrox/ipwho-mcp"],
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
      "args": ["-y", "@lavrox/ipwho-mcp"],
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
      "args": ["-y", "@lavrox/ipwho-mcp"],
      "env": { "IPWHO_API_KEY": "${input:ipwho-key}" }
    }
  }
}
```

## Hosted setup (`https://mcp.ipwho.org/mcp`, not live yet)

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

## Development

```bash
npm install
npm run typecheck      # Node (stdio) and Cloudflare Workers types
npm test               # 20 tests against a local mock API, local and hosted
npm run test:workerd   # the Worker in Cloudflare's local runtime (wrangler dev --local), against the mock
IPWHO_API_KEY=... npm run test:live   # live API through the local server (uses ~5 lookups)
```

Layout: `src/ipwho.ts` (API client) · `src/server.ts` (tool definitions, shared) · `src/stdio.ts` (local entry) · `src/worker.ts` (hosted entry, Cloudflare Worker) · `wrangler.jsonc` (Worker config; no secrets, logging off).

## License

MIT
