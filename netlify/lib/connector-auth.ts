// Sign-in for Joseph's private Claude connector (Follow Up Boss tools at /mcp).
// Standard OAuth 2.1 (authorization code + PKCE S256, dynamic client registration), where the
// "login" step is Joseph's admin password. Everything is kept in the Blobs store "connector":
//   clients/<client_id>        registered OAuth clients (Claude)            { redirect_uris, name, at }
//   codes/<sha256(code)>       one-time authorization codes (5 minutes)     { client_id, redirect_uri, challenge, exp }
//   access/<sha256(token)>     access tokens (1 hour)                       { client_id, exp }
//   refresh/<sha256(token)>    refresh tokens (90 days, rotated on use)     { client_id, exp }
// Only hashes of codes/tokens are stored, so a leak of the store can't be replayed.
import { getStore } from "@netlify/blobs"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export const ACCESS_TTL = 60 * 60 * 1000              // 1 hour
export const REFRESH_TTL = 90 * 24 * 60 * 60 * 1000   // 90 days
export const CODE_TTL = 5 * 60 * 1000                 // 5 minutes

// Claude's OAuth callback URLs. Registration only accepts these, so a stranger can't register
// a client that sends Joseph's sign-in somewhere else.
export const ALLOWED_REDIRECTS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]

export const store = () => getStore({ name: "connector", consistency: "strong" })
export const sha = (s: string) => createHash("sha256").update(s).digest("hex")
export const newSecret = () => randomBytes(32).toString("base64url")

export function origin(req: Request) {
  const u = new URL(req.url)
  return `${u.protocol}//${u.host}`
}

export function passwordMatches(given: string) {
  const expected = Netlify.env.get("ADMIN_PASSWORD") || ""
  if (!expected || !given) return false
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest())
}

// PKCE S256: base64url(sha256(verifier)) must equal the challenge sent at /oauth/authorize
export function pkceOk(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier || "")) return false
  const got = createHash("sha256").update(verifier).digest("base64url")
  return got.length === challenge.length && timingSafeEqual(Buffer.from(got), Buffer.from(challenge))
}

export async function issueTokens(client_id: string) {
  const s = store(), now = Date.now()
  const access = newSecret(), refresh = newSecret()
  await s.setJSON(`access/${sha(access)}`, { client_id, exp: now + ACCESS_TTL })
  await s.setJSON(`refresh/${sha(refresh)}`, { client_id, exp: now + REFRESH_TTL })
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh }
}

// Returns true if the request carries a live access token.
export async function authorized(req: Request) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "")
  if (!m) return false
  const rec = (await store().get(`access/${sha(m[1].trim())}`, { type: "json" })) as { exp: number } | null
  return !!rec && rec.exp > Date.now()
}

// Signs Claude out everywhere (used by /admin "Disconnect Claude").
export async function revokeAll() {
  const s = store()
  for (const prefix of ["access/", "refresh/", "codes/"]) {
    const { blobs } = await s.list({ prefix })
    await Promise.all(blobs.map((b) => s.delete(b.key)))
  }
}
