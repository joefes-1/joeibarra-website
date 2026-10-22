// Client reactions (Love it / Not for me + optional note) on /homes pages.
// GET  /api/reactions?page=dolce-ibarra            -> { reactions: { <homeId>: { r, note, at } }, removedAt }
//      removedAt: when Joseph removed the page from /admin (null if not removed)
//      tourPicks: home ids Joseph tapped for the next buyer tour (only shown to him; saving needs his password via /api/admin)
// POST /api/reactions { page, home, r, note }      -> saves one home's reaction (r "" + no note = clear)
// One blob per page+home.
// Pages with a fubId (tours and homes pages; set in the page data, read here from the built directory,
// never from the browser): when the client writes or changes a note on a home, it's added to their
// Follow Up Boss profile as a note. Reactions with no note, and re-saves of the same note, don't.
import { getStore } from "@netlify/blobs"
import type { Config } from "@netlify/functions"
import directory from "../data/client-pages.json" with { type: "json" }
import { addFubNote } from "../lib/fub-tools.ts"

type DirPage = { page: string; path: string; mode: string; client: string; fubId?: number | null; date?: string | null;
  listings: { id: string; address: string; city: string }[] }
const PAGES = new Map<string, DirPage>((directory as { pages: DirPage[] }).pages.map((p) => [p.page, p]))
const LABEL: Record<string, string> = { love: "Loved it", pass: "Not for them", "": "No reaction picked" }
const tourDay = (ymd?: string | null) => ymd
  ? new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : ""

// Sends the note to FUB; returns true if it went through. Never throws (the reaction is saved either way).
async function noteToFub(page: string, home: string, r: string, note: string, updated: boolean) {
  const p = PAGES.get(page)
  if (!p || !p.fubId) return false
  const tour = p.mode === "tour"
  const h = p.listings.find((l) => l.id === home)
  if (!h) return false
  const where = [h.address, h.city].filter(Boolean).join(", ")
  const who = p.client || "Client"
  const from = tour ? (p.date ? ` (tour ${tourDay(p.date)})` : " (tour)") : " (homes page)"
  const body = `${updated ? "Updated note" : "Note"} from ${who} on ${where}${from}:\n\n` +
    `"${note}"\n\nReaction: ${LABEL[r] ?? r}\nhttps://joeibarra.com${p.path}`
  try {
    await addFubNote(p.fubId, `${tour ? "Tour note" : "Home note"}: ${h.address}`, body)
    return true
  } catch (e) {
    console.error("FUB note failed", page, home, e)
    return false
  }
}

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
        const value = (await store.get(b.key, { type: "json" })) as { r: string; note: string; at: string } | null
        if (value) reactions[b.key.slice(page.length + 1)] = { r: value.r, note: value.note, at: value.at }
      })
    )
    const admin = getStore({ name: "client-admin", consistency: "strong" })
    const removed = (await admin.get(`removed/${page}`, { type: "json" })) as { at?: string } | null
    const picks = (await admin.get(`tourpicks/${page}`, { type: "json" })) as { homes?: string[]; at?: string } | null
    return json({ reactions, removedAt: removed?.at || null, tourPicks: picks?.homes || [], tourPicksAt: picks?.at || null })
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
    const prev = (await store.get(key, { type: "json" })) as { fubNote?: string } | null
    let fubNote = prev?.fubNote
    if (note && note !== fubNote && (await noteToFub(page, home, r, note, !!fubNote))) fubNote = note
    const reaction = { r, note, at: new Date().toISOString(), ...(fubNote ? { fubNote } : {}) }
    await store.setJSON(key, reaction)
    return json({ ok: true, reaction: { r, note, at: reaction.at } })
  }

  return json({ error: "Method not allowed" }, 405)
}

export const config: Config = {
  path: "/api/reactions", method: ["GET", "POST"],
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
