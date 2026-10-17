// Private data for Joseph's /admin page: every client page + every client reaction.
// GET  /api/admin                          -> { pages, reactions, removed }
// POST /api/admin { action, page }         -> action "remove" takes a client page offline, "restore" brings it back
// Both need header "Authorization: Bearer <password>".
// The password lives only in the Netlify environment variable ADMIN_PASSWORD (Functions scope).
import { getStore } from "@netlify/blobs"
import type { Config } from "@netlify/functions"
import { createHash, timingSafeEqual } from "node:crypto"
import directory from "../data/client-pages.json" with { type: "json" }

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } })

// Compare hashes so the check takes the same time whatever was typed.
function passwordMatches(given: string, expected: string) {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

export default async (req: Request) => {
  const expected = Netlify.env.get("ADMIN_PASSWORD") || ""
  if (!expected) return json({ error: "setup", message: "ADMIN_PASSWORD is not set in Netlify yet." }, 503)

  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  if (!given || !passwordMatches(given, expected)) return json({ error: "locked" }, 401)

  const admin = getStore({ name: "client-admin", consistency: "strong" })

  if (req.method === "POST") {
    let body: any
    try { body = await req.json() } catch { return json({ error: "Bad JSON" }, 400) }
    const page = String(body?.page || ""), action = String(body?.action || "")
    if (!directory.pages.some((p) => p.page === page)) return json({ error: "Unknown page" }, 400)
    if (action === "remove") await admin.setJSON(`removed/${page}`, { at: new Date().toISOString() })
    else if (action === "restore") await admin.delete(`removed/${page}`)
    else return json({ error: "Unknown action" }, 400)
    return json({ ok: true })
  }

  // Pages Joseph removed: { "dolce-ibarra": { at } }
  const removed: Record<string, unknown> = {}
  const { blobs: removedKeys } = await admin.list({ prefix: "removed/" })
  await Promise.all(removedKeys.map(async ({ key }) => { removed[key.slice(8)] = await admin.get(key, { type: "json" }) }))

  // All saved reactions, grouped by page: { "dolce-ibarra": { "<homeId>": { r, note, at } } }
  const store = getStore({ name: "client-reactions", consistency: "strong" })
  const { blobs } = await store.list()
  const reactions: Record<string, Record<string, unknown>> = {}
  await Promise.all(
    blobs.map(async ({ key }) => {
      const value = await store.get(key, { type: "json" })
      const [page, home] = key.split("/")
      if (value && page && home) (reactions[page] ||= {})[home] = value
    })
  )
  return json({ pages: directory.pages, reactions, removed })
}

// A handful of tries per minute per visitor is plenty for Joseph and slows down password guessing.
export const config: Config = {
  path: "/api/admin",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
