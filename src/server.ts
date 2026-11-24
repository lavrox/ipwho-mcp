import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { IpwhoClient, MAX_BULK_IPS, type IpwhoClientOptions, type IpwhoResult } from "./ipwho.js";

export const SERVER_NAME = "ipwho";
export const SERVER_VERSION = "0.1.0";

/** Attribution line appended to every successful result (the API JSON itself stays unchanged). */
export const ATTRIBUTION = "Data source: IPWho (https://www.ipwho.org)";

export interface CreateServerOptions extends IpwhoClientOptions {
  /** Register lookup_me. True for the local package only: on a hosted server /me would see the host's IP, not the user's. */
  includeLookupMe: boolean;
}

/** Shared honesty notes, so every tool states the same limits. */
const FIELD_NOTES =
  "The response is the IPWho API's JSON, unchanged: {success, data:{...}}. Field names keep their exact wire casing " +
  "(e.g. postal_Code, flag_Icon, asn_number); do not rename them. Objects: geoLocation, timezone, flag, currency, " +
  "connection, security, userAgent. Many fields can be null (region and city often are). " +
  "connection.connection_type is one of Cable/DSL, Cellular, Corporate, Satellite, or null. Corporate also covers " +
  "offices, VPNs and cloud networks, so do NOT treat it as datacenter detection. " +
  "security is a BASIC signal (isVpn, isTor booleans; isThreat is a string low|medium|high). It is not a fraud or risk score. " +
  "IP geolocation is approximate, especially at city level. Each call counts against the user's IPWho plan quota. " +
  "When you present these results, name IPWho (ipwho.org) as the data source.";

export function createServer(opts: CreateServerOptions): McpServer {
  const client = new IpwhoClient(opts);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "IPWho IP geolocation (https://www.ipwho.org). Use lookup_ip for one address, lookup_bulk for several" +
        (opts.includeLookupMe ? ", lookup_me for the user's own public IP" : "") +
        ". " + FIELD_NOTES,
    },
  );

  server.registerTool(
    "lookup_ip",
    {
      title: "IPWho: Look up an IP address",
      description:
        "Geolocation, timezone, currency, network (ASN/ISP) and basic security data for one IPv4 or IPv6 address. " +
        'Use "get" to return only some objects or fields, e.g. "geoLocation,security". ' + FIELD_NOTES,
      inputSchema: {
        ip: z.string().trim().min(2).max(64).describe('The IPv4 or IPv6 address, e.g. "8.8.8.8" or "2606:4700:4700::1111".'),
        get: z
          .string()
          .trim()
          .max(300)
          .optional()
          .describe('Optional comma-separated field filter passed to the API as ?get=, e.g. "geoLocation,timezone". Omit for everything.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ ip, get }) => toToolResult(await client.lookupIp(ip, get || undefined)),
  );

  server.registerTool(
    "lookup_bulk",
    {
      title: "IPWho: Look up many IP addresses",
      description:
        `Look up 1 to ${MAX_BULK_IPS} IPv4/IPv6 addresses in one request. Results are in data.responseArray. ` +
        "No field filter is available for bulk lookups. Each IP counts against the user's plan quota. " + FIELD_NOTES,
      inputSchema: {
        ips: z
          .array(z.string().trim().min(2).max(64))
          .min(1)
          .max(MAX_BULK_IPS)
          .describe(`The IP addresses to look up (max ${MAX_BULK_IPS}).`),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ ips }) => toToolResult(await client.lookupBulk(ips)),
  );

  if (opts.includeLookupMe) {
    server.registerTool(
      "lookup_me",
      {
        title: "IPWho: Look up my own IP",
        description:
          "Detect the public IP of the machine running this server (the user's own connection, or their VPN/proxy if one is on) and look it up. " +
          FIELD_NOTES,
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async () => toToolResult(await client.lookupMe()),
    );
  }

  return server;
}

function toToolResult(result: IpwhoResult): CallToolResult {
  if (!result.ok) return { isError: true, content: [{ type: "text", text: result.message }] };
  const text = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
  return {
    content: [
      { type: "text", text },
      { type: "text", text: ATTRIBUTION },
    ],
  };
}
