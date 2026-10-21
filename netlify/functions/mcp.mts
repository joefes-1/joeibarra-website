// Joseph's private Claude connector: Follow Up Boss tools over MCP (Streamable HTTP, stateless JSON).
// Claude signs in through /oauth/* with Joseph's admin password; every request here needs that token.
// Tools live in netlify/lib/fub-tools.ts (read anything; add notes, appointments and tasks; nothing else).
import type { Config } from "@netlify/functions"
import { authorized, origin } from "../lib/connector-auth.ts"
import { TOOLS, runTool } from "../lib/fub-tools.ts"

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

const reply = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...extra } })

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any }

async function handle(msg: Rpc) {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result })
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } })
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion || "")
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "joeibarra-fub", title: "Joseph Ibarra · Follow Up Boss", version: "1.0.0" },
        instructions: "Joseph Ibarra's Follow Up Boss CRM. Look people up with find_contacts before writing. " +
          "You can add notes, appointments and tasks; you cannot edit or delete records or send texts/emails. " +
          "Times are Pacific (America/Los_Angeles) unless an offset is given.",
      })
    }
    case "ping": return ok({})
    case "tools/list": return ok({ tools: TOOLS.map(({ run, ...t }) => t) })
    case "tools/call": {
      const name = String(msg.params?.name || "")
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`)
      return ok(await runTool(name, msg.params?.arguments || {}))
    }
    default:
      return msg.method?.startsWith("notifications/") ? null : fail(-32601, `Method not found: ${msg.method}`)
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } })
  // Browsers on other sites can't drive this endpoint (Claude calls it server-to-server)
  const from = req.headers.get("origin")
  if (from && !["https://claude.ai", "https://claude.com", origin(req)].includes(from)) return reply({ error: "forbidden origin" }, 403)
  if (!(await authorized(req))) {
    return reply({ error: "unauthorized" }, 401, {
      "www-authenticate": `Bearer resource_metadata="${origin(req)}/.well-known/oauth-protected-resource/mcp"`,
    })
  }
  let body: any
  try { body = await req.json() } catch { return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400) }
  const batch = Array.isArray(body)
  const out = (await Promise.all((batch ? body : [body]).map(handle))).filter(Boolean)
  if (!out.length) return new Response(null, { status: 202 })     // notifications only
  return reply(batch ? out : out[0])
}

export const config: Config = { path: "/mcp", method: ["GET", "POST", "DELETE"] }
