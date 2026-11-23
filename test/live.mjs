// Live test against the real api.ipwho.org through the LOCAL (stdio) server.
// Usage: IPWHO_API_KEY=<your key> npm run test:live
// Spends a handful of lookups from that key's quota (1 + 1 + 2 + 1). Never prints the key.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const key = process.env.IPWHO_API_KEY?.trim();
if (!key) { console.error("Set IPWHO_API_KEY first."); process.exit(2); }

async function connect(apiKey) {
  const client = new Client({ name: "live-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/stdio.js"], env: { PATH: process.env.PATH, IPWHO_API_KEY: apiKey } }));
  return client;
}
const out = [];
const check = async (name, fn) => {
  try { out.push(`PASS ${name}${(await fn()) ?? ""}`); } catch (e) { out.push(`FAIL ${name}: ${String(e.message).replaceAll(key, "<key>")}`); }
};
const ok = (r) => { if (r.isError) throw new Error(r.content[0].text); return JSON.parse(r.content[0].text); };

const c = await connect(key);
await check("single lookup_ip 8.8.8.8", async () => {
  const b = ok(await c.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8" } }));
  if (b.success !== true || !b.data) throw new Error("unexpected shape");
  return ` (top-level keys: ${Object.keys(b.data).join(",")})`;
});
await check("field filter get=geoLocation,security", async () => {
  const b = ok(await c.callTool({ name: "lookup_ip", arguments: { ip: "1.1.1.1", get: "geoLocation,security" } }));
  return ` (keys: ${Object.keys(b.data).join(",")})`;
});
await check("bulk 8.8.8.8 + 2606:4700:4700::1111", async () => {
  const b = ok(await c.callTool({ name: "lookup_bulk", arguments: { ips: ["8.8.8.8", "2606:4700:4700::1111"] } }));
  const n = b.data?.responseArray?.length;
  if (n !== 2) throw new Error(`responseArray length ${n}`);
  return " (responseArray: 2)";
});
await check("lookup_me", async () => { ok(await c.callTool({ name: "lookup_me", arguments: {} })); return " (returned data; IP not printed)"; });
await check("bad IP rejected (no API call)", async () => {
  const r = await c.callTool({ name: "lookup_ip", arguments: { ip: "999.1.1.1" } });
  if (!r.isError) throw new Error("expected an error");
});
await c.close();

const bad = await connect("sk.invalid-key-for-testing");
await check("bad key -> clear 401 error", async () => {
  const r = await bad.callTool({ name: "lookup_ip", arguments: { ip: "8.8.8.8" } });
  if (!r.isError || !/rejected the API key/.test(r.content[0].text)) throw new Error(r.content[0].text);
  return ` (${r.content[0].text})`;
});
await bad.close();

console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
