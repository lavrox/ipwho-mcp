// Runs the Worker in the real Cloudflare runtime (workerd, via `wrangler dev --local`)
// against the local mock API, then drives it with the official MCP client.
// Usage: npm run test:workerd   (no Cloudflare account needed; nothing is deployed)
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startMockApi, GOOD_KEY } from "./mock-api.mjs";

const PORT = 8799;
try {
  await fetch(`http://127.0.0.1:${PORT}/`);
  console.error(`Port ${PORT} is already in use (a stale wrangler dev?). Stop it and retry.`);
  process.exit(1);
} catch { /* port free */ }
const api = await startMockApi();
const dev = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1", "--var", `IPWHO_API_BASE:${api.base}`], {
  env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true, // own process group, so cleanup kills npx, wrangler AND workerd
});
const stopDev = () => { try { process.kill(-dev.pid, "SIGTERM"); } catch {} };
process.on("exit", stopDev);
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

const base = `http://127.0.0.1:${PORT}`;
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
};

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  await check("info page", async () => assert.equal((await (await fetch(`${base}/`)).json()).mcp_endpoint, `${base}/mcp`));
  await check("no key -> 401", async () => {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" });
    assert.equal(r.status, 401);
  });
  for (const [label, headers] of [["X-API-Key", { "X-API-Key": GOOD_KEY }], ["Bearer", { Authorization: `Bearer ${GOOD_KEY}` }]]) {
    await check(`${label}: initialize, list, lookup_ip, lookup_bulk`, async () => {
      const client = new Client({ name: "smoke", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ["lookup_bulk", "lookup_ip"]);
      const one = await client.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8", get: "geoLocation" } });
      assert.ok(!one.isError, one.content?.[0]?.text);
      assert.equal(JSON.parse(one.content[0].text).data.geoLocation.countryCode, "US");
      const bulk = await client.callTool({ name: "lookup_bulk", arguments: { ips: ["8.8.8.8", "1.1.1.1"] } });
      assert.equal(JSON.parse(bulk.content[0].text).data.responseArray.length, 2);
      const bad = await client.callTool({ name: "lookup_ip", arguments: { ip: "999.1.1.1" } });
      assert.equal(bad.isError, true);
      await client.close();
    });
  }
  await check("bad key -> tool error", async () => {
    const client = new Client({ name: "smoke", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { "X-API-Key": "sk.bad" } } }));
    const r = await client.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8" } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /rejected the API key/);
    await client.close();
  });
  await check("key never in an upstream URL, always in X-API-Key", async () => {
    assert.ok(api.requests.length > 0);
    for (const r of api.requests) {
      assert.ok(!/apikey|sk\./i.test(r.url), r.url);
      assert.ok(r.headers["x-api-key"]);
    }
  });
  await check("key never in wrangler's console output", async () => assert.ok(!log.includes(GOOD_KEY)));
} finally {
  stopDev();
  await api.close();
}
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) { console.log(log.slice(-3000)); process.exit(1); }
