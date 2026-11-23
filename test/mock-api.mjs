// Local stand-in for api.ipwho.org. Response shapes follow public/openapi.yaml (v1.0.0).
import http from "node:http";

export const GOOD_KEY = "sk.test-good-key-0000";

export function record(ip) {
  return {
    success: true,
    data: {
      ip,
      geoLocation: {
        continent: "North America", continentCode: "NA", country: "United States", countryCode: "US",
        capital: "Washington", region: null, regionCode: null, city: null, postal_Code: null,
        dial_code: "+1", is_in_eu: false, latitude: 37.751, longitude: -97.822, accuracy_radius: 1000,
      },
      timezone: { time_zone: "America/Chicago", abbr: "CST", offset: -21600, is_dst: false, utc: "-06:00", current_time: "2026-11-23T00:00:00-06:00" },
      flag: { flag_Icon: "🇺🇸", flag_unicode: "U+1F1FA U+1F1F8" },
      currency: { code: "USD", symbol: "$", name: "US Dollar", name_plural: "US dollars", hex_unicode: "24" },
      connection: { asn_number: 15169, asn_org: "GOOGLE", isp: "Google LLC", org: "Google LLC", domain: "google.com", connection_type: "Corporate" },
      security: { isVpn: false, isTor: false, isThreat: "low" },
    },
  };
}

export async function startMockApi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: { ...req.headers } });
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const key = req.headers["x-api-key"];
    if (!key) return send(401, { error: "missing_api_key" });
    if (key !== GOOD_KEY) return send(401, { error: "invalid_api_key" });

    const url = new URL(req.url, "http://mock");
    const [, kind, arg] = url.pathname.split("/");
    if (kind === "ip" && decodeURIComponent(arg) === "203.0.113.99") return send(429, { success: false, message: "Rate limit exceeded" });
    if (kind === "ip" && decodeURIComponent(arg) === "192.0.2.1") return send(404, { success: false, message: "Invalid IP or not found" });
    if (kind === "ip") {
      const rec = record(decodeURIComponent(arg));
      const get = url.searchParams.get("get");
      if (get) {
        const keep = new Set(get.split(","));
        rec.data = Object.fromEntries(Object.entries(rec.data).filter(([k]) => keep.has(k)));
      }
      return send(200, rec);
    }
    if (kind === "bulk") {
      const ips = decodeURIComponent(arg).split(",");
      return send(200, { success: true, data: { responseArray: ips.map((ip) => record(ip)) } });
    }
    if (kind === "me") return send(200, record("198.51.100.7"));
    send(404, { success: false, message: "Not found" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, requests, close: () => new Promise((r) => server.close(r)) };
}
