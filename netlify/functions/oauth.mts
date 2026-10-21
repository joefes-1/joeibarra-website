// OAuth for Joseph's private Claude connector (see netlify/lib/connector-auth.ts).
//   GET  /.well-known/oauth-protected-resource[/mcp]  -> which server signs people in for /mcp
//   GET  /.well-known/oauth-authorization-server       -> endpoints + supported options
//   POST /oauth/register                               -> dynamic client registration (Claude's callback URLs only)
//   GET  /oauth/authorize                              -> "Connect Claude" page asking for the admin password
//   POST /oauth/authorize                              -> checks the password, sends Claude a one-time code
//   POST /oauth/token                                  -> code (+ PKCE verifier) or refresh token -> tokens
import type { Config } from "@netlify/functions"
import {
  ALLOWED_REDIRECTS, CODE_TTL, issueTokens, newSecret, origin, passwordMatches, pkceOk, sha, store,
} from "../lib/connector-auth.ts"

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", "access-control-allow-origin": "*", ...extra } })
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status)
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

async function formOrJson(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") || ""
  if (type.includes("application/json")) {
    try { const b = await req.json(); return Object.fromEntries(Object.entries(b || {}).map(([k, v]) => [k, String(v)])) } catch { return {} }
  }
  return Object.fromEntries(new URLSearchParams(await req.text()))
}

function metadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["fub"],
  }
}

/* ---------- The sign-in page ---------- */
function page(p: Record<string, string>, clientName: string, error = "") {
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"]
    .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k] || "")}">`).join("")
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Connect Claude · Joseph Ibarra</title>
<style>
:root{--ink:#1F2A37;--slate:#3F5266;--muted:#6B7280;--line:#E5E1D8;--cream:#F7F4EE}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--cream);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink)}
main{width:min(420px,calc(100vw - 32px));background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 10px 30px rgba(31,42,55,.08)}
h1{font:500 28px/1.15 Georgia,serif;margin:0 0 8px}
p{margin:0 0 16px;color:var(--muted);font-size:15px}
label{display:block;font-weight:700;font-size:13px;margin-bottom:6px}
input[type=password]{width:100%;box-sizing:border-box;font:inherit;border:1.5px solid #CFC8BA;border-radius:10px;padding:12px 14px}
input[type=password]:focus{outline:none;border-color:var(--slate);box-shadow:0 0 0 3px #E6ECF2}
button{margin-top:14px;width:100%;border:0;border-radius:999px;background:var(--slate);color:#fff;font:700 15px system-ui,sans-serif;padding:13px}
.err{color:#8A3B2B;font-weight:700;font-size:14px;margin-top:10px}
</style></head><body><main>
<h1>Connect Claude</h1>
<p>${esc(clientName || "Claude")} is asking to work with your Follow Up Boss: read contacts and activity, and add notes, appointments and tasks. Enter your admin password to allow it.</p>
<form method="post" action="/oauth/authorize">${hidden}
<label for="pw">Admin password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Allow</button>${error ? `<p class="err">${esc(error)}</p>` : ""}
</form></main></body></html>`, {
    status: error ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY",
               "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" },
  })
}

async function getClient(id: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id || "")) return null
  return (await store().get(`clients/${id}`, { type: "json" })) as { redirect_uris: string[]; name?: string } | null
}

export default async (req: Request) => {
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, ""), base = origin(req)

  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    return json({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ["fub"], bearer_methods_supported: ["header"] })
  }
  if (path === "/.well-known/oauth-authorization-server") return json(metadata(base))

  if (path === "/oauth/register" && req.method === "POST") {
    let body: any
    try { body = await req.json() } catch { return oauthError("invalid_client_metadata", "Body must be JSON") }
    const uris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : []
    if (!uris.length || !uris.every((u) => ALLOWED_REDIRECTS.includes(u))) {
      return oauthError("invalid_redirect_uri", "This connector only works with Claude.")
    }
    const s = store()
    const { blobs } = await s.list({ prefix: "clients/" })
    if (blobs.length >= 50) return oauthError("invalid_client_metadata", "Too many registered clients", 429)
    const client_id = newSecret().slice(0, 32)
    const name = String(body?.client_name || "Claude").slice(0, 80)
    await s.setJSON(`clients/${client_id}`, { redirect_uris: uris, name, at: new Date().toISOString() })
    return json({
      client_id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    }, 201)
  }

  if (path === "/oauth/authorize") {
    const p = req.method === "POST" ? await formOrJson(req) : Object.fromEntries(url.searchParams)
    const client = await getClient(p.client_id)
    // Bad client or redirect: never redirect anywhere, just stop.
    if (!client || !client.redirect_uris.includes(p.redirect_uri)) {
      return new Response("This sign-in link isn't valid. Start the connection again from Claude.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } })
    }
    const back = (params: Record<string, string>) => {
      const u = new URL(p.redirect_uri)
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
      if (p.state) u.searchParams.set("state", p.state)
      return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } })
    }
    if (req.method === "GET" && p.response_type !== "code") return back({ error: "unsupported_response_type" })
    if (p.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge || "")) {
      return back({ error: "invalid_request", error_description: "PKCE S256 is required" })
    }
    if (req.method !== "POST") return page(p, client.name || "Claude")
    if (!passwordMatches(p.password || "")) return page(p, client.name || "Claude", "That password didn’t work.")
    const code = newSecret()
    await store().setJSON(`codes/${sha(code)}`, { client_id: p.client_id, redirect_uri: p.redirect_uri, challenge: p.code_challenge, exp: Date.now() + CODE_TTL })
    return back({ code })
  }

  if (path === "/oauth/token" && req.method === "POST") {
    const p = await formOrJson(req), s = store()
    // Unknown client: 401 invalid_client makes Claude register again
    if (p.client_id && !(await getClient(p.client_id))) return oauthError("invalid_client", "Unknown client", 401)
    if (p.grant_type === "authorization_code") {
      const key = `codes/${sha(p.code || "")}`
      const rec = (await s.get(key, { type: "json" })) as { client_id: string; redirect_uri: string; challenge: string; exp: number } | null
      if (rec) await s.delete(key)                                     // one use only
      if (!rec || rec.exp < Date.now()) return oauthError("invalid_grant", "Code is invalid or expired")
      if (rec.client_id !== p.client_id || rec.redirect_uri !== p.redirect_uri) return oauthError("invalid_grant", "Code was issued to a different client")
      if (!pkceOk(p.code_verifier || "", rec.challenge)) return oauthError("invalid_grant", "PKCE check failed")
      return json(await issueTokens(rec.client_id))
    }
    if (p.grant_type === "refresh_token") {
      const key = `refresh/${sha(p.refresh_token || "")}`
      const rec = (await s.get(key, { type: "json" })) as { client_id: string; exp: number } | null
      if (rec) await s.delete(key)                                     // rotate: old refresh token stops working
      if (!rec || rec.exp < Date.now()) return oauthError("invalid_grant", "Refresh token is invalid or expired")
      if (p.client_id && p.client_id !== rec.client_id) return oauthError("invalid_grant", "Wrong client")
      return json(await issueTokens(rec.client_id))
    }
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token")
  }

  return json({ error: "not_found" }, 404)
}

export const config: Config = {
  path: ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp",
         "/.well-known/oauth-authorization-server", "/oauth/register", "/oauth/authorize", "/oauth/token"],
  method: ["GET", "POST"],
  // Slows down password guessing on the sign-in page
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
