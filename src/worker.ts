/**
 * Hosted IPWho MCP server for mcp.ipwho.org (Cloudflare Worker, Streamable HTTP, stateless).
 *
 * - No key, no service: every MCP request must carry the user's IPWho key in
 *   `X-API-Key: <key>` or `Authorization: Bearer <key>`. It is forwarded to api.ipwho.org
 *   in X-API-Key, so the user's normal plan quotas apply.
 * - The key is never logged, stored, or put in a URL. The Worker holds no secrets of its own.
 * - Logging: one JSON line per request (logRequest below) with the HTTP method, path, status,
 *   duration and the MCP method/tool name. Never headers, the key, query strings, tool
 *   arguments (the IPs users look up) or results.
 * - lookup_me is not offered: /me would return Cloudflare's IP, not the user's.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

export interface Env {
  /** Optional override of the upstream API, e.g. for staging. Operator-set only; never taken from requests. */
  IPWHO_API_BASE?: string;
}

const MCP_PATH = "/mcp";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

export function extractApiKey(headers: Headers): string | undefined {
  const direct = headers.get("x-api-key")?.trim();
  if (direct) return direct;
  const auth = headers.get("authorization")?.trim();
  const m = auth?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const rpc = await describeRpc(request);
    let status = 500;
    try {
      const res = await handle(request, env);
      status = res.status;
      return res;
    } finally {
      logRequest({ method: request.method, path: new URL(request.url).pathname, status, ms: Date.now() - started, rpc });
    }
  },
};

/** One safe log line per request. Only these fields; never headers, keys, query strings or tool arguments. */
export function logRequest(entry: { method: string; path: string; status: number; ms: number; rpc?: string[] }): void {
  console.log(JSON.stringify({ event: "mcp_request", ...entry, path: entry.path.slice(0, 64) }));
}

/** MCP JSON-RPC method names (and tool names for tools/call) from a POST /mcp body; nothing else. */
async function describeRpc(request: Request): Promise<string[] | undefined> {
  if (request.method !== "POST" || new URL(request.url).pathname !== MCP_PATH) return undefined;
  try {
    const body: unknown = await request.clone().json();
    const msgs = (Array.isArray(body) ? body : [body]).slice(0, 5) as Array<{ method?: unknown; params?: { name?: unknown } }>;
    return msgs.map((m) => {
      const method = typeof m?.method === "string" ? m.method.slice(0, 40) : "response";
      const tool = method === "tools/call" && typeof m.params?.name === "string" ? `:${m.params.name.slice(0, 40)}` : "";
      return method + tool;
    });
  } catch {
    return ["unparsed"];
  }
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === "/" && request.method === "GET") {
      return json(200, {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        mcp_endpoint: `${url.origin}${MCP_PATH}`,
        transport: "streamable-http",
        auth: "Send your IPWho API key in the X-API-Key header or as Authorization: Bearer <key>.",
        docs: "https://github.com/lavrox/ipwho-mcp",
      });
    }

    if (url.pathname !== MCP_PATH) return json(404, { error: "not_found", mcp_endpoint: MCP_PATH });

    // Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
    if (request.method !== "POST") {
      return json(405, rpcError(-32000, "Method not allowed. This stateless MCP endpoint accepts POST only."), { Allow: "POST, OPTIONS" });
    }

    if (url.searchParams.has("apiKey") || url.searchParams.has("apikey") || url.searchParams.has("api_key")) {
      return json(400, rpcError(-32600, "Do not put your API key in the URL. Send it in the X-API-Key header or as Authorization: Bearer <key>."));
    }

    const apiKey = extractApiKey(request.headers);
    if (!apiKey) {
      return json(401, rpcError(-32001, "IPWho API key required. Send it in the X-API-Key header or as Authorization: Bearer <key>."), {
        "WWW-Authenticate": 'Bearer realm="ipwho"',
      });
    }

    // Stateless: a fresh server + transport per request, so no key or state outlives the request.
    const server = createServer({ apiKey, apiBase: env.IPWHO_API_BASE || undefined, includeLookupMe: false });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const res = await transport.handleRequest(request);
      return withCors(res);
    } finally {
      // JSON-response mode has finished writing by now; release the per-request server.
      await server.close().catch(() => {});
    }
  },
};

const handle = (request: Request, env: Env) => handler.fetch(request, env);

function rpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
