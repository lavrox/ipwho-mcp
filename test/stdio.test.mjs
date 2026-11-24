// Local package: spawn dist/stdio.js and drive it with the official MCP client over stdio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockApi, GOOD_KEY } from "./mock-api.mjs";

let api;
before(async () => { api = await startMockApi(); });
after(async () => { await api.close(); });

async function connect(key) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/stdio.js"],
    env: { PATH: process.env.PATH, IPWHO_API_KEY: key, IPWHO_API_BASE: api.base },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => { stderr += d; });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}

const text = (r) => r.content[0].text;

test("local: lists lookup_ip, lookup_bulk, lookup_me with read-only annotations", async () => {
  const { client } = await connect(GOOD_KEY);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["lookup_bulk", "lookup_ip", "lookup_me"]);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.match(t.description, /BASIC signal/);
    assert.match(t.description, /not a fraud or risk score/);
    assert.match(t.description, /Cable\/DSL, Cellular, Corporate, Satellite/);
    assert.match(t.description, /name IPWho \(ipwho\.org\) as the data source/);
    assert.match(t.title, /^IPWho: /);
  }
  await client.close();
});

test("local: lookup_ip returns the API JSON verbatim, key only in X-API-Key header", async () => {
  const { client, stderr } = await connect(GOOD_KEY);
  const r = await client.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8" } });
  assert.ok(!r.isError);
  const body = JSON.parse(text(r));
  assert.equal(body.success, true);
  assert.equal(body.data.geoLocation.postal_Code, null);
  assert.equal(body.data.flag.flag_Icon, "🇺🇸");
  assert.equal(body.data.connection.asn_number, 15169);
  assert.equal(body.data.security.isThreat, "low");
  assert.equal(r.content.length, 2);
  assert.equal(r.content[1].text, "Data source: IPWho (https://www.ipwho.org)");
  const last = api.requests.at(-1);
  assert.equal(last.url, "/ip/8.8.8.8");
  assert.equal(last.headers["x-api-key"], GOOD_KEY);
  assert.match(last.headers["user-agent"], /^ipwho-mcp\//);
  await client.close();
  assert.ok(!stderr().includes(GOOD_KEY));
});

test("local: get filter is passed through as ?get=", async () => {
  const { client } = await connect(GOOD_KEY);
  const r = await client.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8", get: "geoLocation,security" } });
  assert.equal(api.requests.at(-1).url, "/ip/8.8.8.8?get=geoLocation%2Csecurity");
  assert.deepEqual(Object.keys(JSON.parse(text(r)).data).sort(), ["geoLocation", "security"]);
  const bad = await client.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8", get: "geo&apiKey=x" } });
  assert.equal(bad.isError, true);
  await client.close();
});

test("local: IPv6 works", async () => {
  const { client } = await connect(GOOD_KEY);
  const r = await client.callTool({ name: "lookup_ip", arguments: { ip: "2606:4700:4700::1111" } });
  assert.ok(!r.isError);
  assert.equal(api.requests.at(-1).url, "/ip/2606%3A4700%3A4700%3A%3A1111");
  await client.close();
});

test("local: lookup_bulk returns data.responseArray", async () => {
  const { client } = await connect(GOOD_KEY);
  const r = await client.callTool({ name: "lookup_bulk", arguments: { ips: ["8.8.8.8", "1.1.1.1"] } });
  assert.ok(!r.isError);
  assert.equal(JSON.parse(text(r)).data.responseArray.length, 2);
  assert.equal(api.requests.at(-1).url, "/bulk/8.8.8.8,1.1.1.1");
  await client.close();
});

test("local: lookup_bulk rejects >100 IPs and invalid entries without calling the API", async () => {
  const { client } = await connect(GOOD_KEY);
  const n = api.requests.length;
  const many = Array.from({ length: 101 }, (_, i) => `10.0.0.${i % 250}`);
  const tooMany = await client.callTool({ name: "lookup_bulk", arguments: { ips: many } });
  assert.equal(tooMany.isError, true);
  const bad = await client.callTool({ name: "lookup_bulk", arguments: { ips: ["8.8.8.8", "not-an-ip", "../me"] } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /not-an-ip/);
  assert.equal(api.requests.length, n);
  await client.close();
});

test("local: lookup_me calls /me", async () => {
  const { client } = await connect(GOOD_KEY);
  const r = await client.callTool({ name: "lookup_me", arguments: {} });
  assert.ok(!r.isError);
  assert.equal(api.requests.at(-1).url, "/me");
  await client.close();
});

test("local: bad IP is rejected locally (no API call); 404 and 429 are reported clearly", async () => {
  const { client } = await connect(GOOD_KEY);
  const n = api.requests.length;
  for (const ip of ["999.1.1.1", "8.8.8.8/24", "8.8.8.8?apiKey=x", "../me", "1.2.3"]) {
    const r = await client.callTool({ name: "lookup_ip", arguments: { ip } });
    assert.equal(r.isError, true, ip);
    assert.match(text(r), /not a valid IPv4 or IPv6/);
  }
  assert.equal(api.requests.length, n);
  const notFound = await client.callTool({ name: "lookup_ip", arguments: { ip: "192.0.2.1" } });
  assert.equal(notFound.isError, true);
  assert.match(text(notFound), /could not find/);
  const limited = await client.callTool({ name: "lookup_ip", arguments: { ip: "203.0.113.99" } });
  assert.equal(limited.isError, true);
  assert.match(text(limited), /rate limit or quota/);
  await client.close();
});

test("local: bad key gives a clear error that does not echo the key", async () => {
  const badKey = "sk.wrong-key-123456";
  const { client } = await connect(badKey);
  const r = await client.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8" } });
  assert.equal(r.isError, true);
  assert.match(text(r), /rejected the API key \(invalid_api_key\)/);
  assert.ok(!text(r).includes(badKey));
  assert.equal(r.content.length, 1, "errors carry no attribution line");
  await client.close();
});

test("local: never puts the key in a URL", () => {
  for (const r of api.requests) assert.ok(!/apikey|sk\./i.test(r.url), r.url);
});

test("local: exits with a message when IPWHO_API_KEY is missing", () => {
  const r = spawnSync(process.execPath, ["dist/stdio.js"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /IPWHO_API_KEY/);
  assert.equal(r.stdout, "");
});
