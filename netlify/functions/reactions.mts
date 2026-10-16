// Client reactions (Love it / Not for me + optional note) on /homes pages.
// GET  /api/reactions?page=dolce-ibarra            -> { reactions: { <homeId>: { r, note, at } } }
// POST /api/reactions { page, home, r, note }      -> saves one home's reaction (r "" + no note = clear)
// One blob per page+home, so a save never has to read-modify-write anything.
import { getStore } from "@netlify/blobs"
import type { Config } from "@netlify/functions"

const REACTIONS = new Set(["love", "pass", ""])
const PAGE_RE = /^[a-z0-9-]{1,80}$/
const HOME_RE = /^[A-Za-z0-9-]{1,60}$/

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } })

export default async (req: Request) => {
  const store = getStore({ name: "client-reactions", consistency: "strong" })

  if (req.method === "GET") {
    const page = new URL(req.url).searchParams.get("page") || ""
    if (!PAGE_RE.test(page)) return json({ error: "Bad page" }, 400)
    const { blobs } = await store.list({ prefix: page + "/" })
    const reactions: Record<string, unknown> = {}
    await Promise.all(
      blobs.map(async (b) => {
        const value = await store.get(b.key, { type: "json" })
        if (value) reactions[b.key.slice(page.length + 1)] = value
      })
    )
    return json({ reactions })
  }

  if (req.method === "POST") {
    let body: any
    try { body = await req.json() } catch { return json({ error: "Bad JSON" }, 400) }
    const page = String(body?.page || ""), home = String(body?.home || "")
    const r = String(body?.r ?? ""), note = String(body?.note ?? "").trim().slice(0, 300)
    if (!PAGE_RE.test(page) || !HOME_RE.test(home) || !REACTIONS.has(r)) return json({ error: "Bad request" }, 400)

    const key = `${page}/${home}`
    if (!r && !note) {
      await store.delete(key)
      return json({ ok: true, reaction: null })
    }
    const reaction = { r, note, at: new Date().toISOString() }
    await store.setJSON(key, reaction)
    return json({ ok: true, reaction })
  }

  return json({ error: "Method not allowed" }, 405)
}

export const config: Config = { path: "/api/reactions", method: ["GET", "POST"] }
