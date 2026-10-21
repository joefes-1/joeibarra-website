// Leads tab on /admin: Joseph's Follow Up Boss contacts with filters, plus "Make client page" requests.
// GET  /api/admin/leads?stage=&source=&createdDays=&activityDays=&sort=created|lastActivity&q=&cursor=
//      -> { leads, stages, nextCursor, total }   (newest first; "Load more" passes nextCursor back)
// POST /api/admin/leads { action: "request-page" | "cancel-request", personId, name }
// Both need "Authorization: Bearer <admin password>". Page requests are read by Claude through the
// Follow Up Boss connector (page_requests tool); Claude builds the page, then clears the request.
import { getStore } from "@netlify/blobs"
import type { Config } from "@netlify/functions"
import { createHash, timingSafeEqual } from "node:crypto"

const BASE = "https://api.followupboss.com/v1"
const FIELDS = "id,name,firstName,lastName,stage,source,created,lastActivity,tags,price,assignedTo"
const PAGE = 100          // FUB max per request
const MAX_SCAN = 10       // at most 10 FUB pages (1,000 contacts) per load

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } })

function passwordOk(req: Request) {
  const expected = Netlify.env.get("ADMIN_PASSWORD") || ""
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  if (!expected || !given) return false
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest())
}

async function fub(path: string, query: Record<string, unknown> = {}) {
  const key = Netlify.env.get("FUB_API_KEY") || ""
  if (!key) throw Object.assign(new Error("FUB_API_KEY isn't set in Netlify"), { status: 503 })
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
  const headers: Record<string, string> = { authorization: "Basic " + Buffer.from(key + ":").toString("base64"), accept: "application/json" }
  const sys = Netlify.env.get("FUB_SYSTEM"), sysKey = Netlify.env.get("FUB_SYSTEM_KEY")
  if (sys && sysKey) { headers["x-system"] = sys; headers["x-system-key"] = sysKey }
  const res = await fetch(url, { headers })
  if (res.status === 429) throw Object.assign(new Error("Follow Up Boss is busy, try again in a few seconds"), { status: 429 })
  if (!res.ok) throw Object.assign(new Error(`Follow Up Boss error ${res.status}`), { status: 502 })
  return res.json()
}

// FUB has no created-date filter and no documented descending sort, so walk the list from the end
// (newest) backwards and stop once we're past the date cutoff. cursor = the next offset to read below.
export async function listLeads(p: URLSearchParams) {
  const sort = p.get("sort") === "lastActivity" ? "lastActivity" : "created"
  const createdDays = Number(p.get("createdDays")) || 0
  const activityDays = Number(p.get("activityDays")) || 0
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)
  const filters: Record<string, unknown> = {
    stage: p.get("stage") || undefined, source: p.get("source") || undefined, name: p.get("q") || undefined,
    lastActivityAfter: activityDays ? daysAgo(activityDays).toISOString().replace("T", " ").slice(0, 19) : undefined,
    sort, fields: FIELDS,
  }
  const createdCutoff = createdDays ? +daysAgo(createdDays) : 0
  const want = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 200)

  let end: number
  if (p.get("cursor") !== null && p.get("cursor") !== "") end = Math.max(0, Number(p.get("cursor")) || 0)
  else end = Number((await fub("/people", { ...filters, limit: 1 }))?._metadata?.total || 0)
  const total0 = end
  const leads: any[] = []
  let done = false, scans = 0
  while (end > 0 && leads.length < want && !done && scans < MAX_SCAN) {
    const offset = Math.max(0, end - PAGE)
    const d = await fub("/people", { ...filters, limit: end - offset, offset })
    const page = (d?.people || []).slice().reverse()      // newest first
    scans++
    let used = 0
    for (const person of page) {
      used++
      if (createdCutoff && sort === "created" && +new Date(person.created) < createdCutoff) { done = true; break }
      if (createdCutoff && +new Date(person.created) < createdCutoff) continue
      leads.push(person)
      if (leads.length >= want) break
    }
    end = end - used
  }
  return {
    leads: leads.map((x) => ({
      id: x.id, name: x.name, stage: x.stage, source: x.source, created: x.created, lastActivity: x.lastActivity,
      tags: x.tags || [], price: x.price ?? null,
    })),
    nextCursor: !done && end > 0 ? end : null,
    total: p.get("cursor") ? undefined : total0,
  }
}

export default async (req: Request) => {
  if (!Netlify.env.get("ADMIN_PASSWORD")) return json({ error: "setup" }, 503)
  if (!passwordOk(req)) return json({ error: "locked" }, 401)
  const admin = getStore({ name: "client-admin", consistency: "strong" })

  if (req.method === "POST") {
    let b: any
    try { b = await req.json() } catch { return json({ error: "Bad JSON" }, 400) }
    const id = Number(b?.personId)
    if (!Number.isInteger(id) || id <= 0) return json({ error: "Bad personId" }, 400)
    if (b?.action === "request-page") {
      await admin.setJSON(`pagerequests/${id}`, { personId: id, name: String(b?.name || "").slice(0, 120), at: new Date().toISOString() })
      return json({ ok: true })
    }
    if (b?.action === "cancel-request") { await admin.delete(`pagerequests/${id}`); return json({ ok: true }) }
    return json({ error: "Unknown action" }, 400)
  }

  try {
    const url = new URL(req.url)
    const [list, stages, reqs] = await Promise.all([
      listLeads(url.searchParams),
      url.searchParams.get("cursor") ? null : fub("/stages", { limit: 100 }).catch(() => null),
      admin.list({ prefix: "pagerequests/" }),
    ])
    const requested: number[] = reqs.blobs.map((b) => Number(b.key.split("/")[1])).filter(Boolean)
    return json({ ...list, requested, stages: stages ? (stages.stages || []).map((s: any) => s.name).filter(Boolean) : undefined })
  } catch (e: any) {
    return json({ error: e?.message || "Something went wrong" }, e?.status || 500)
  }
}

export const config: Config = {
  path: "/api/admin/leads",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
