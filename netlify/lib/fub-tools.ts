// Follow Up Boss tools for Joseph's Claude connector (/mcp).
// Rule of thumb Joseph chose: read anything; ADD notes, appointments and tasks; never edit, delete,
// or send texts/emails. There is deliberately no tool that does PUT/DELETE or messaging.
// API: https://api.followupboss.com/v1, HTTP Basic with the key as the username (FUB_API_KEY in Netlify).
// Optional FUB_SYSTEM / FUB_SYSTEM_KEY (registered system) double FUB's rate limits.

import { getStore } from "@netlify/blobs"

const BASE = "https://api.followupboss.com/v1"
const TZ = "America/Los_Angeles"

type Args = Record<string, any>
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: unknown }
class ToolError extends Error {}

/* ---------- FUB HTTP ---------- */
async function fub(path: string, init: { method?: string; query?: Record<string, unknown>; body?: unknown } = {}) {
  const key = Netlify.env.get("FUB_API_KEY") || ""
  if (!key) throw new ToolError("Follow Up Boss isn't connected yet: FUB_API_KEY still needs to be added in Netlify.")
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(init.query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
  const headers: Record<string, string> = {
    authorization: "Basic " + Buffer.from(key + ":").toString("base64"),
    accept: "application/json",
  }
  const sys = Netlify.env.get("FUB_SYSTEM"), sysKey = Netlify.env.get("FUB_SYSTEM_KEY")
  if (sys && sysKey) { headers["x-system"] = sys; headers["x-system-key"] = sysKey }
  if (init.body !== undefined) headers["content-type"] = "application/json"
  const res = await fetch(url, { method: init.method || "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined })
  if (res.status === 401) throw new ToolError("Follow Up Boss rejected the API key (401). Check FUB_API_KEY in Netlify.")
  if (res.status === 429) throw new ToolError(`Follow Up Boss rate limit hit; try again in ${res.headers.get("retry-after") || "a few"} seconds.`)
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 500) } }
  if (!res.ok) throw new ToolError(`Follow Up Boss error ${res.status}: ${data?.errorMessage || data?.message || text.slice(0, 300)}`)
  return data
}

// Add a note to a FUB contact (used by /api/reactions for client tour notes). Add-only, like everything here.
export async function addFubNote(personId: number, subject: string, body: string) {
  return fub("/notes", { method: "POST", body: { personId, subject, body, isHtml: false } })
}

let meCache: { id: number; name: string } | null = null
async function me() {
  if (!meCache) { const m = await fub("/me"); meCache = { id: m.id, name: m.name } }
  return meCache
}

/* ---------- Helpers ---------- */
const int = (v: unknown, name: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new ToolError(`${name} must be a Follow Up Boss id (a positive number). Use find_contacts first.`)
  return n
}
const clampLimit = (v: unknown, d: number, max = 100) => Math.min(Math.max(Number(v) || d, 1), max)

// Offset (minutes) of Pacific time at a given UTC instant
function tzOffsetMinutes(utcMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs)).reduce((o: any, p) => (o[p.type] = p.value, o), {})
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return Math.round((asUtc - utcMs) / 60000)
}
// "2026-10-25T10:00" (Pacific) or any ISO with offset/Z -> Date
export function parseWhen(s: unknown, name: string): Date {
  const str = String(s || "").trim()
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(str)) {
    const d = new Date(str); if (isNaN(+d)) throw new ToolError(`${name} isn't a valid date/time`); return d
  }
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?$/.exec(str)
  if (!m) throw new ToolError(`${name} must look like 2026-10-25T10:00 (Pacific time)`)
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  let utc = guess - tzOffsetMinutes(guess) * 60000
  utc = guess - tzOffsetMinutes(utc) * 60000             // settle across DST changes
  return new Date(utc)
}
// Date -> "2026-10-25T10:00:00-07:00" in Pacific (what FUB accepts, and readable)
export function pacificIso(d: Date) {
  const off = tzOffsetMinutes(+d), local = new Date(+d + off * 60000)
  const pad = (n: number) => String(n).padStart(2, "0")
  const sign = off < 0 ? "-" : "+", a = Math.abs(off)
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
}
const pacificDay = (d: Date) => pacificIso(d).slice(0, 10)
// FUB ignores a "-07:00" offset and reads the wall time as UTC, so always send it plain UTC
const fubUtc = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z")
// FUB times come back as UTC ("...Z"); show them in Pacific
const fromFub = (v: any) => { if (!v) return v; const d = new Date(v); return isNaN(+d) ? v : pacificIso(d) }

function slimPerson(p: any) {
  if (!p) return p
  return {
    id: p.id, name: p.name, stage: p.stage, source: p.source, tags: p.tags,
    emails: (p.emails || []).map((e: any) => e.value), phones: (p.phones || []).map((e: any) => e.value),
    assignedTo: p.assignedTo, price: p.price, lastActivity: p.lastActivity, created: p.created,
  }
}
const slimProperty = (pr: any) => pr && {
  address: [pr.street, pr.city, pr.state, pr.code].filter(Boolean).join(", "), mls: pr.mlsNumber, price: pr.price,
  beds: pr.bedrooms, baths: pr.bathrooms, sqft: pr.area, url: pr.url,
}
const LISTING_URL = /https?:\/\/[^\s"'<>]*(?:zillow\.com|redfin\.com|realscout\.com|realtor\.com|homes\.com|trulia\.com|compass\.com|\/listing|\/homedetails|\/property)[^\s"'<>]*/gi

/* ---------- Tools ---------- */
type Tool = {
  name: string; title: string; description: string; inputSchema: any
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
  run: (a: Args) => Promise<unknown>
}
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const obj = (properties: any, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false })

export const TOOLS: Tool[] = [
  {
    name: "find_contacts", title: "Find contacts", annotations: READ,
    description: "Search Follow Up Boss contacts by name, email, phone, stage or tag. Returns ids needed by the other tools.",
    inputSchema: obj({
      name: { type: "string", description: "Full or partial name" }, email: { type: "string" }, phone: { type: "string" },
      stage: { type: "string", description: "e.g. Lead, Active Client, Under Contract, Closed" }, tag: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    }),
    run: async (a) => {
      if (!a.name && !a.email && !a.phone && !a.stage && !a.tag) throw new ToolError("Give at least one of name, email, phone, stage or tag.")
      const d = await fub("/people", { query: { name: a.name, email: a.email, phone: a.phone, stage: a.stage, tags: a.tag, limit: clampLimit(a.limit, 10, 50) } })
      return { total: d?._metadata?.total, contacts: (d?.people || []).map(slimPerson) }
    },
  },
  {
    name: "get_contact", title: "Contact details + recent activity", annotations: READ,
    description: "Everything about one contact: details, recent notes, calls, texts, website/property events, open tasks and appointments.",
    inputSchema: obj({ personId: { type: "integer" } }, ["personId"]),
    run: async (a) => {
      const id = int(a.personId, "personId")
      const [person, notes, calls, texts, events, tasks, appts] = await Promise.all([
        fub(`/people/${id}`, { query: { fields: "allFields" } }),
        fub("/notes", { query: { personId: id, limit: 5 } }).catch(() => null),
        fub("/calls", { query: { personId: id, limit: 5 } }).catch(() => null),
        fub("/textMessages", { query: { personId: id, limit: 5 } }).catch(() => null),
        fub("/events", { query: { personId: id, limit: 10 } }).catch(() => null),
        fub("/tasks", { query: { personId: id, isCompleted: false, limit: 10 } }).catch(() => null),
        fub("/appointments", { query: { personId: id, limit: 10 } }).catch(() => null),
      ])
      const p = person?.person || person
      return {
        contact: { ...slimPerson(p), addresses: p?.addresses, collaborators: p?.collaborators },
        notes: (notes?.notes || []).map((n: any) => ({ created: n.created, by: n.createdBy, subject: n.subject, body: String(n.body || "").slice(0, 800) })),
        calls: (calls?.calls || []).map((c: any) => ({ created: c.created, incoming: c.isIncoming, duration: c.duration, outcome: c.outcome, note: c.note })),
        texts: (texts?.textmessages || texts?.textMessages || []).map((t: any) => ({ created: t.created, incoming: t.isIncoming, message: t.message })),
        events: (events?.events || []).map((e: any) => ({ created: e.created, type: e.type, message: e.message, property: slimProperty(e.property) })),
        openTasks: (tasks?.tasks || []).map((t: any) => ({ id: t.id, name: t.name, type: t.type, due: t.dueDateTime ? fromFub(t.dueDateTime) : t.dueDate })),
        appointments: (appts?.appointments || []).map((x: any) => ({ id: x.id, title: x.title, start: fromFub(x.start), end: fromFub(x.end), location: x.location })),
      }
    },
  },
  {
    name: "contact_properties", title: "Homes a contact saved, viewed, asked about or was sent", annotations: READ,
    description: "Listings tied to a contact: properties they saved, viewed or inquired about (website events), plus listing links found in their texts and notes (how homes Joseph shared usually show up). Use this to build their homes page.",
    inputSchema: obj({ personId: { type: "integer" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, ["personId"]),
    run: async (a) => {
      const id = int(a.personId, "personId")
      const [events, texts, notes] = await Promise.all([
        fub("/events", { query: { personId: id, hasProperty: true, limit: clampLimit(a.limit, 50) } }),
        fub("/textMessages", { query: { personId: id, limit: 100 } }).catch(() => null),
        fub("/notes", { query: { personId: id, limit: 100 } }).catch(() => null),
      ])
      const fromEvents = (events?.events || []).filter((e: any) => e.property)
        .map((e: any) => ({ when: e.created, how: e.type, ...slimProperty(e.property) }))
      const links: { when: string; how: string; url: string }[] = []
      for (const t of texts?.textmessages || texts?.textMessages || []) for (const u of String(t.message || "").match(LISTING_URL) || []) links.push({ when: t.created, how: t.isIncoming ? "Text from contact" : "Text to contact", url: u })
      for (const n of notes?.notes || []) for (const u of String(n.body || "").match(LISTING_URL) || []) links.push({ when: n.created, how: "Note", url: u })
      return { properties: fromEvents, listingLinks: links, note: "Homes shared from Follow Up Boss by text/email only appear here if the message text is visible to the API." }
    },
  },
  {
    name: "recent_activity", title: "Recent activity", annotations: READ,
    description: "Contacts with activity in the last N days (newest first), with their stage, so Joseph can see who's engaging.",
    inputSchema: obj({ days: { type: "integer", minimum: 1, maximum: 60, default: 1 }, limit: { type: "integer", minimum: 1, maximum: 100, default: 25 } }),
    run: async (a) => {
      const since = new Date(Date.now() - clampLimit(a.days, 1, 60) * 86400000)
      const fmt = since.toISOString().replace("T", " ").slice(0, 19)
      const q = { lastActivityAfter: fmt, sort: "-lastActivity", limit: clampLimit(a.limit, 25) }
      // newest-first sort isn't documented by FUB; fall back to default order and sort here
      const d = await fub("/people", { query: q }).catch(() => fub("/people", { query: { ...q, sort: "lastActivity" } }))
      d.people = (d?.people || []).sort((x: any, y: any) => String(y.lastActivity || "").localeCompare(String(x.lastActivity || "")))
      return { since: pacificIso(since), contacts: (d?.people || []).map(slimPerson) }
    },
  },
  {
    name: "my_tasks", title: "Joseph's open tasks", annotations: READ,
    description: "Joseph's incomplete tasks: due today, overdue, or upcoming (optionally for one contact).",
    inputSchema: obj({ due: { type: "string", enum: ["today", "overdue", "upcoming"] }, personId: { type: "integer" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 25 } }),
    run: async (a) => {
      const u = await me()
      const d = await fub("/tasks", { query: { assignedUserId: u.id, isCompleted: false, due: a.due, personId: a.personId, limit: clampLimit(a.limit, 25) } })
      return { tasks: (d?.tasks || []).map((t: any) => ({ id: t.id, personId: t.personId, name: t.name, type: t.type, due: t.dueDateTime ? fromFub(t.dueDateTime) : t.dueDate })) }
    },
  },
  {
    name: "my_appointments", title: "Joseph's appointments", annotations: READ,
    description: "Appointments between two dates (Pacific). Defaults to today through the next 7 days.",
    inputSchema: obj({ start: { type: "string", description: "YYYY-MM-DD" }, end: { type: "string", description: "YYYY-MM-DD" }, personId: { type: "integer" } }),
    run: async (a) => {
      const start = a.start ? parseWhen(a.start, "start") : parseWhen(pacificDay(new Date()), "start")
      const end = a.end ? parseWhen(a.end + (String(a.end).length === 10 ? "T23:59" : ""), "end") : new Date(+start + 8 * 86400000 - 60000)
      const d = await fub("/appointments", { query: { start: start.toISOString(), end: end.toISOString(), personId: a.personId, limit: 100 } })
      return { appointments: (d?.appointments || []).map((x: any) => ({ id: x.id, title: x.title, start: fromFub(x.start), end: fromFub(x.end), location: x.location, type: x.type, invitees: (x.invitees || []).map((i: any) => i.name) })) }
    },
  },
  {
    name: "add_note", title: "Add a note", annotations: ADD,
    description: "Add a note to a contact's timeline (e.g. a call or showing recap). Adds only; never edits existing notes.",
    inputSchema: obj({ personId: { type: "integer" }, subject: { type: "string", maxLength: 200 }, body: { type: "string", maxLength: 10000 } }, ["personId", "body"]),
    run: async (a) => {
      const personId = int(a.personId, "personId")
      const body = String(a.body || "").trim()
      if (!body) throw new ToolError("body can't be empty")
      const n = await fub("/notes", { method: "POST", body: { personId, subject: String(a.subject || "").slice(0, 200) || undefined, body, isHtml: false } })
      return { created: true, noteId: n?.id, personId }
    },
  },
  {
    name: "create_appointment", title: "Create an appointment", annotations: ADD,
    description: "Put an appointment on Joseph's Follow Up Boss calendar (e.g. a showing or listing appointment), optionally with contacts. Times are Pacific unless an offset is given. No invitation email is sent.",
    inputSchema: obj({
      title: { type: "string", maxLength: 200 }, start: { type: "string", description: "2026-10-25T10:00 (Pacific)" },
      end: { type: "string", description: "Defaults to 1 hour after start" }, personIds: { type: "array", items: { type: "integer" }, maxItems: 10 },
      location: { type: "string", maxLength: 300 }, description: { type: "string", maxLength: 5000 },
    }, ["title", "start"]),
    run: async (a) => {
      const title = String(a.title || "").trim(); if (!title) throw new ToolError("title can't be empty")
      const start = parseWhen(a.start, "start")
      const end = a.end ? parseWhen(a.end, "end") : new Date(+start + 3600000)
      if (+end <= +start) throw new ToolError("end must be after start")
      const u = await me()
      const people = await Promise.all((a.personIds || []).map(async (pid: unknown) => {
        const id = int(pid, "personIds"); const p = await fub(`/people/${id}`); const person = p?.person || p
        return { personId: id, name: person?.name || "", email: person?.emails?.[0]?.value }
      }))
      const x = await fub("/appointments", { method: "POST", query: { sendInvitation: false }, body: {
        title, start: fubUtc(start), end: fubUtc(end), allDay: false,
        location: a.location || undefined, description: a.description || undefined,
        invitees: [{ userId: u.id, name: u.name }, ...people],
      } })
      return { created: true, appointmentId: x?.id, title, start: pacificIso(start), end: pacificIso(end), with: people.map((p) => p.name) }
    },
  },
  {
    name: "create_task", title: "Create a task", annotations: ADD,
    description: "Create a follow-up task for Joseph on a contact. Adds only.",
    inputSchema: obj({
      personId: { type: "integer" }, name: { type: "string", maxLength: 200 },
      type: { type: "string", enum: ["Follow Up", "Call", "Text", "Email", "Appointment", "Showing", "Closing", "Open House", "Thank You"], default: "Follow Up" },
      due: { type: "string", description: "YYYY-MM-DD, or 2026-10-25T10:00 (Pacific) for a set time" },
    }, ["personId", "name", "due"]),
    run: async (a) => {
      const personId = int(a.personId, "personId")
      const name = String(a.name || "").trim(); if (!name) throw new ToolError("name can't be empty")
      const u = await me()
      const due = String(a.due || "").trim()
      const when = /^\d{4}-\d\d-\d\d$/.test(due) ? { dueDate: due } : { dueDateTime: fubUtc(parseWhen(due, "due")) }
      const t = await fub("/tasks", { method: "POST", body: { personId, name, type: a.type || "Follow Up", assignedUserId: u.id, ...when } })
      return { created: true, taskId: t?.id, personId, name, ...when }
    },
  },
  // Joseph's "Make client page" requests from the Leads tab on /admin (stored on his site, not in FUB)
  {
    name: "page_requests", title: "Client page requests", annotations: READ,
    description: "Contacts Joseph marked on his /admin Leads tab with \"Make client page\". Build their homes page with the client-homes-pages workflow, then call clear_page_request.",
    inputSchema: obj({}),
    run: async () => {
      const s = getStore({ name: "client-admin", consistency: "strong" })
      const { blobs } = await s.list({ prefix: "pagerequests/" })
      const reqs = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))
      return { requests: reqs.filter(Boolean).sort((x: any, y: any) => String(x.at).localeCompare(String(y.at))) }
    },
  },
  {
    name: "clear_page_request", title: "Clear a client page request", annotations: { ...ADD, idempotentHint: true },
    description: "Remove a request from the /admin Leads tab once that contact's homes page is built (or Joseph changes his mind).",
    inputSchema: obj({ personId: { type: "integer" } }, ["personId"]),
    run: async (a) => {
      const id = int(a.personId, "personId")
      await getStore({ name: "client-admin", consistency: "strong" }).delete(`pagerequests/${id}`)
      return { cleared: true, personId: id }
    },
  },
]

export async function runTool(name: string, args: Args): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name)!
  try {
    const data = await tool.run(args || {})
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }
  } catch (e: any) {
    const msg = e instanceof ToolError ? e.message : `Something went wrong: ${e?.message || e}`
    return { content: [{ type: "text", text: msg }], isError: true }
  }
}
