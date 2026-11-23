/**
 * Minimal IPWho API client shared by the local (stdio) and hosted (Worker) servers.
 *
 * Contract: lavrox/lavrox-ipwho-website public/openapi.yaml (v1.0.0) and
 * https://www.ipwho.org/docs. The API key is ALWAYS sent in the X-API-Key header,
 * never in the URL, and is never logged or echoed back in errors.
 */

export const DEFAULT_API_BASE = "https://api.ipwho.org";
export const USER_AGENT = "ipwho-mcp/0.1.0 (+https://github.com/lavrox/ipwho-mcp)";

/** Max IPs per lookup_bulk call. A safety cap chosen by this server, not an API limit. */
export const MAX_BULK_IPS = 100;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** True for a syntactically valid IPv4 or IPv6 address (no ports, no CIDR, no zone IDs). */
export function isIpAddress(value: string): boolean {
  if (IPV4.test(value)) return true;
  if (!value.includes(":") || !/^[0-9A-Fa-f:.]+$/.test(value)) return false;
  try {
    // The WHATWG URL parser validates IPv6 literals in Node and Workers alike.
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

/** Field filter for ?get=: comma-separated field or object names, e.g. "geoLocation,security". */
const GET_FILTER = /^[A-Za-z_]+(,[A-Za-z_]+)*$/;

export interface IpwhoClientOptions {
  apiKey: string;
  apiBase?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type IpwhoResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; message: string };

export class IpwhoClient {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: IpwhoClientOptions) {
    this.apiKey = opts.apiKey;
    this.apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
    // Wrap the global fetch: calling it as a method of this class throws "Illegal invocation" on Workers.
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  lookupIp(ip: string, get?: string): Promise<IpwhoResult> {
    if (!isIpAddress(ip)) return Promise.resolve(invalid(`"${clip(ip)}" is not a valid IPv4 or IPv6 address.`));
    if (get !== undefined && get !== "" && !GET_FILTER.test(get)) {
      return Promise.resolve(invalid('"get" must be comma-separated field or object names, e.g. "geoLocation,security".'));
    }
    const qs = get ? `?get=${encodeURIComponent(get)}` : "";
    return this.request(`/ip/${encodeURIComponent(ip)}${qs}`);
  }

  lookupBulk(ips: string[]): Promise<IpwhoResult> {
    if (ips.length === 0) return Promise.resolve(invalid("Provide at least one IP address."));
    if (ips.length > MAX_BULK_IPS) {
      return Promise.resolve(invalid(`Too many IPs: ${ips.length}. This server accepts up to ${MAX_BULK_IPS} per call; split the list.`));
    }
    const bad = ips.filter((ip) => !isIpAddress(ip));
    if (bad.length) {
      return Promise.resolve(invalid(`Not valid IP addresses: ${bad.slice(0, 5).map(clip).join(", ")}${bad.length > 5 ? ` (+${bad.length - 5} more)` : ""}.`));
    }
    return this.request(`/bulk/${ips.map(encodeURIComponent).join(",")}`);
  }

  lookupMe(): Promise<IpwhoResult> {
    return this.request("/me");
  }

  private async request(path: string): Promise<IpwhoResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method: "GET",
        headers: { "X-API-Key": this.apiKey, Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "failed (network error)";
      return { ok: false, status: 0, message: `The request to the IPWho API ${reason}. Try again shortly.` };
    }

    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body: keep the text */
    }

    if (res.ok && !(isObject(body) && body.success === false)) return { ok: true, status: res.status, body };
    return { ok: false, status: res.status, message: describeError(res.status, body) };
  }
}

function describeError(status: number, body: unknown): string {
  const code = isObject(body) ? String(body.error ?? body.message ?? "") : "";
  const detail = code ? ` (${clip(code)})` : "";
  switch (status) {
    case 401:
    case 403:
      return code === "missing_api_key"
        ? "No IPWho API key was sent. Set your key and try again."
        : `IPWho rejected the API key${detail}. Check the key in your IPWho dashboard.`;
    case 404:
      return `IPWho could not find that address or it is not a valid IP${detail}.`;
    case 429:
      return `Your IPWho plan's rate limit or quota was reached${detail}. Wait, or upgrade the plan.`;
    default:
      return status >= 500
        ? `The IPWho API returned a server error (HTTP ${status})${detail}. Try again shortly.`
        : `The IPWho API returned HTTP ${status}${detail}.`;
  }
}

function invalid(message: string): IpwhoResult {
  return { ok: false, status: 400, message };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Truncate user- or API-supplied strings before echoing them. */
function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}
