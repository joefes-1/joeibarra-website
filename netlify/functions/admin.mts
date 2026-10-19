// Private data for Joseph's /admin page: every client page + every client reaction.
// GET  /api/admin                          -> { pages, reactions, removed }
// POST /api/admin { action, page }         -> action "remove" takes a client page offline, "restore" brings it back
// POST /api/admin { action: "check" }               -> 200 if the password is right (client pages use it to unlock tour picks)
// POST /api/admin { action: "tour-picks", page, homes } -> homes Joseph picked on a client page for the next tour
// POST /api/admin { action, items }        -> action "hide"/"unhide" a reaction in the feed, items [{ page, home, at }]
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
    // Client pages ask this before turning on Joseph-only tools (tour picks): 200 only with the right password.
    if (action === "check") return json({ ok: true })
    const known = (p: string) => directory.pages.some((d) => d.page === p)

    // Hide / unhide reactions in the feed: items [{ page, home, at }]. A hidden reaction comes back
    // on its own if the client changes it later (its `at` moves past the hidden one).
    if (action === "hide" || action === "unhide") {
      const items = Array.isArray(body?.items) ? body.items.slice(0, 500) : []
      const clean = items
        .map((i: any) => ({ page: String(i?.page || ""), home: String(i?.home || ""), at: String(i?.at || "") }))
        .filter((i: any) => known(i.page) && /^[A-Za-z0-9-]{1,80}$/.test(i.home) && i.at.length <= 40)
      if (!clean.length) return json({ error: "Nothing to change" }, 400)
      await Promise.all(clean.map((i: any) => action === "hide"
        ? admin.setJSON(`hidden/${i.page}/${i.home}`, { at: i.at })
        : admin.delete(`hidden/${i.page}/${i.home}`)))
      return json({ ok: true })
    }

    if (!known(page)) return json({ error: "Unknown page" }, 400)

    // Homes Joseph tapped on a client page to put on the next buyer tour: { homes: [homeId...] }
    if (action === "tour-picks") {
      const homes = Array.isArray(body?.homes) ? body.homes.map(String).filter((h: string) => /^[A-Za-z0-9-]{1,60}$/.test(h)).slice(0, 20) : []
      if (homes.length) await admin.setJSON(`tourpicks/${page}`, { homes, at: new Date().toISOString() })
      else await admin.delete(`tourpicks/${page}`)
      return json({ ok: true, homes })
    }

    if (action === "remove") await admin.setJSON(`removed/${page}`, { at: new Date().toISOString() })
    else if (action === "restore") await admin.delete(`removed/${page}`)
    else return json({ error: "Unknown action" }, 400)
    return json({ ok: true })
  }

  // Pages Joseph removed: { "dolce-ibarra": { at } }
  const removed: Record<string, unknown> = {}
  const { blobs: removedKeys } = await admin.list({ prefix: "removed/" })
  await Promise.all(removedKeys.map(async ({ key }) => { removed[key.slice(8)] = await admin.get(key, { type: "json" }) }))

  // Reactions Joseph hid from his feed: { "dolce-ibarra": { "<homeId>": "<reaction at>" } }
  const hidden: Record<string, Record<string, string>> = {}
  const { blobs: hiddenKeys } = await admin.list({ prefix: "hidden/" })
  await Promise.all(hiddenKeys.map(async ({ key }) => {
    const [, page, home] = key.split("/")
    const v: any = await admin.get(key, { type: "json" })
    if (page && home && v) (hidden[page] ||= {})[home] = String(v.at || "")
  }))

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
  return json({ pages: directory.pages, reactions, removed, hidden })
}

// A handful of tries per minute per visitor is plenty for Joseph and slows down password guessing.
export const config: Config = {
  path: "/api/admin",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
