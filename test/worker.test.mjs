// Hosted server: call the compiled Worker's fetch() directly (Node 22 has Request/Response)
// and drive it with the official MCP client over Streamable HTTP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import worker from "../dist/worker.js";
import { startMockApi, GOOD_KEY } from "./mock-api.mjs";

let api, env;
before(async () => { api = await startMockApi(); env = { IPWHO_API_BASE: api.base }; });
after(async () => { await api.close(); });

const ORIGIN = "https://mcp.ipwho.org";
const workerFetch = (input, init) => worker.fetch(new Request(input, init), env);

async function connect(headers) {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    requestInit: { headers },
    fetch: workerFetch,
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

test("hosted: X-API-Key works; only lookup_ip and lookup_bulk are offered", async () => {
  const client = await connect({ "X-API-Key": GOOD_KEY });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["lookup_bulk", "lookup_ip"]);
  const r = await client.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8", get: "security" } });
  assert.ok(!r.isError);
  assert.equal(JSON.parse(r.content[0].text).data.security.isThreat, "low");
  const last = api.requests.at(-1);
  assert.equal(last.headers["x-api-key"], GOOD_KEY);
  assert.equal(last.url, "/ip/8.8.8.8?get=security");
  await client.close();
});

test("hosted: Authorization: Bearer works, bulk works", async () => {
  const client = await connect({ Authorization: `Bearer ${GOOD_KEY}` });
  const r = await client.callTool({ name: "lookup_bulk", arguments: { ips: ["8.8.8.8", "2606:4700:4700::1111"] } });
  assert.ok(!r.isError);
  assert.equal(JSON.parse(r.content[0].text).data.responseArray.length, 2);
  assert.equal(api.requests.at(-1).headers["x-api-key"], GOOD_KEY);
  await client.close();
});

test("hosted: lookup_me is not callable", async () => {
  const client = await connect({ "X-API-Key": GOOD_KEY });
  const r = await client.callTool({ name: "lookup_me", arguments: {} }).catch((e) => ({ thrown: e }));
  assert.ok(r.thrown || r.isError, "lookup_me must not succeed on the hosted server");
  assert.ok(!api.requests.some((q) => q.url === "/me"));
  await client.close();
});

test("hosted: no key -> 401 before any MCP handling, no upstream call", async () => {
  const n = api.requests.length;
  const res = await workerFetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate"), /Bearer/);
  assert.match((await res.json()).error.message, /API key required/);
  assert.equal(api.requests.length, n);
  await assert.rejects(connect({}));
});

test("hosted: bad key -> tool error, key not echoed", async () => {
  const client = await connect({ "X-API-Key": "sk.not-valid-999" });
  const r = await client.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /rejected the API key/);
  assert.ok(!r.content[0].text.includes("sk.not-valid-999"));
  await client.close();
});

test("hosted: key in the URL is refused", async () => {
  const res = await workerFetch(`${ORIGIN}/mcp?apiKey=${GOOD_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 400);
  assert.ok(!(await res.text()).includes(GOOD_KEY));
});

test("hosted: info page, 404 and CORS preflight", async () => {
  const info = await workerFetch(`${ORIGIN}/`);
  assert.equal(info.status, 200);
  assert.equal((await info.json()).mcp_endpoint, `${ORIGIN}/mcp`);
  assert.equal((await workerFetch(`${ORIGIN}/other`)).status, 404);
  const pre = await workerFetch(`${ORIGIN}/mcp`, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers"), /X-API-Key/);
  assert.match(pre.headers.get("access-control-allow-headers"), /Authorization/);
});

test("hosted: never puts the key in an upstream URL", () => {
  for (const r of api.requests) assert.ok(!/apikey|sk\./i.test(r.url), r.url);
});

test("hosted: GET and DELETE on /mcp -> 405 (stateless, POST only)", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = await workerFetch(`${ORIGIN}/mcp`, { method, headers: { "X-API-Key": GOOD_KEY, Accept: "text/event-stream" } });
    assert.equal(res.status, 405, method);
  }
});
