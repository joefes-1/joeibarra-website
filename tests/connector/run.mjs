// Tests for the Follow Up Boss connector: OAuth sign-in (admin password + PKCE), /mcp, and the tools.
// Run by tests/run.py. Functions are bundled with esbuild against an in-memory Blobs store and a fake FUB API.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..')
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'conn-'))
for (const f of ['oauth', 'mcp', 'admin', 'leads', 'reactions']) {
  execFileSync('npx', ['--yes', 'esbuild@0.24.0', `netlify/functions/${f}.mts`, '--bundle', '--platform=node', '--format=esm',
    `--alias:@netlify/blobs=${path.join(here, 'fake-blobs.mjs')}`, `--outfile=${path.join(out, f + '.mjs')}`, '--log-level=warning'], { cwd: root, stdio: 'inherit' })
}
const ENV = { ADMIN_PASSWORD: 'pw', FUB_API_KEY: 'fubkey' }
globalThis.Netlify = { env: { get: (k) => ENV[k] } }

// Fake Follow Up Boss
const calls = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET'
  calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization })
  const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } })
  const p = u.pathname.replace('/v1', '')
  if (p === '/me') return J({ id: 7, name: 'Joseph Ibarra' })
  if (p === '/stages') return J({ stages: [{ name: 'Lead' }, { name: 'Active Client' }, { name: 'Trash' }] })
  if (p === '/people' && method === 'GET' && u.searchParams.get('fields')?.includes('created') && globalThis.__leadsMode) {
    let all = globalThis.__people
    if (u.searchParams.get('stage')) all = all.filter((x) => x.stage === u.searchParams.get('stage'))
    const off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 10)
    return J({ _metadata: { total: all.length }, people: all.slice(off, off + lim) })
  }
  if (p === '/people' && method === 'GET') return J({ _metadata: { total: 1 }, people: [{ id: 42, name: 'Dolce Ibarra', stage: 'Active Client', emails: [{ value: 'd@x.com' }], phones: [{ value: '555' }], lastActivity: '2026-10-20 10:00:00' }] })
  if (p === '/people/42') return J({ id: 42, name: 'Dolce Ibarra', emails: [{ value: 'd@x.com' }] })
  if (p === '/events') return J({ events: [{ created: '2026-10-19', type: 'Saved Property', property: { street: '1215 Vassar Ln', city: 'Walnut', state: 'CA', code: '91789', mlsNumber: 'CV26223436', price: 1070000, url: 'https://x/listing/1' } }] })
  if (p === '/textMessages') return J({ textmessages: [{ created: '2026-10-18', isIncoming: false, message: 'Check this one https://www.zillow.com/homedetails/20774-Timberline-Ln/123_zpid/' }] })
  if (p === '/notes' && method === 'GET') return J({ notes: [] })
  if (['/notes', '/appointments', '/tasks'].includes(p) && method === 'POST') return J({ id: 900 })
  return J({})
}

let pass = 0, fail = 0
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log('  FAIL ' + msg) } }

const { default: oauth } = await import(path.join(out, 'oauth.mjs'))
const { default: mcp } = await import(path.join(out, 'mcp.mjs'))
const { default: admin } = await import(path.join(out, 'admin.mjs'))
const B = 'https://joeibarra.com'
const CB = 'https://claude.ai/api/mcp/auth_callback'
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() })

// discovery
let r = await oauth(new Request(B + '/.well-known/oauth-protected-resource/mcp'))
check((await r.json()).resource === B + '/mcp', 'protected resource metadata names /mcp')
r = await oauth(new Request(B + '/.well-known/oauth-authorization-server'))
const meta = await r.json()
check(meta.code_challenge_methods_supported.includes('S256') && meta.registration_endpoint === B + '/oauth/register', 'auth server metadata')
r = await mcp(new Request(B + '/mcp', { method: 'POST', body: '{}' }))
check(r.status === 401 && /resource_metadata=/.test(r.headers.get('www-authenticate') || ''), 'no token -> 401 with resource_metadata pointer')

// registration
r = await oauth(new Request(B + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }) }))
check(r.status === 400, 'registration refuses non-Claude callbacks')
r = await oauth(new Request(B + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CB], client_name: 'Claude' }) }))
const { client_id } = await r.json()
check(r.status === 201 && client_id, 'registration works for Claude')

// authorize
const verifier = randomBytes(40).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url')
const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: B + '/mcp' })
r = await oauth(new Request(B + '/oauth/authorize?' + q))
check(r.status === 200 && (await r.text()).includes('Admin password'), 'sign-in page asks for the admin password')
check(/form-action 'self' https:\/\/claude\.ai https:\/\/claude\.com;/.test(r.headers.get('content-security-policy') || ''),
  'sign-in page is allowed to hand off to Claude after the password (browsers block the redirect otherwise)')
r = await oauth(new Request(B + '/oauth/authorize?' + new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: 'https://evil.example/cb' })))
check(r.status === 400 && !r.headers.get('location'), 'unregistered redirect never redirects')
r = await oauth(new Request(B + '/oauth/authorize?' + new URLSearchParams({ ...Object.fromEntries(q), code_challenge_method: 'plain' })))
check(r.status === 302 && r.headers.get('location').includes('error=invalid_request'), 'PKCE S256 required')
r = await oauth(new Request(B + '/oauth/authorize', form({ ...Object.fromEntries(q), password: 'wrong' })))
check(r.status === 401 && !r.headers.get('location'), 'wrong password: no code')
r = await oauth(new Request(B + '/oauth/authorize', form({ ...Object.fromEntries(q), password: 'pw' })))
const loc = new URL(r.headers.get('location') || 'http://x')
check(r.status === 302 && loc.origin + loc.pathname === CB && loc.searchParams.get('state') === 'xyz' && loc.searchParams.get('code'), 'right password sends a code back to Claude')
const code = loc.searchParams.get('code')

// token
r = await oauth(new Request(B + '/oauth/token', form({ grant_type: 'authorization_code', code, client_id, redirect_uri: CB, code_verifier: 'x'.repeat(43) })))
check(r.status === 400 && (await r.json()).error === 'invalid_grant', 'bad PKCE verifier refused')
r = await oauth(new Request(B + '/oauth/token', form({ grant_type: 'authorization_code', code, client_id, redirect_uri: CB, code_verifier: verifier })))
check(r.status === 400, 'a code only works once (even after a failed try)')
// fresh code
r = await oauth(new Request(B + '/oauth/authorize', form({ ...Object.fromEntries(q), password: 'pw' })))
const code2 = new URL(r.headers.get('location')).searchParams.get('code')
r = await oauth(new Request(B + '/oauth/token', form({ grant_type: 'authorization_code', code: code2, client_id, redirect_uri: CB, code_verifier: verifier })))
let tok = await r.json()
check(r.status === 200 && tok.access_token && tok.refresh_token && tok.token_type === 'Bearer', 'code + verifier -> tokens')
r = await oauth(new Request(B + '/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id })))
const tok2 = await r.json()
check(r.status === 200 && tok2.access_token !== tok.access_token, 'refresh works')
r = await oauth(new Request(B + '/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id })))
check(r.status === 400, 'old refresh token stops working (rotation)')
r = await oauth(new Request(B + '/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok2.refresh_token, client_id: 'unknownclient123' })))
check(r.status === 401 && (await r.json()).error === 'invalid_client', 'unknown client -> 401 invalid_client')

// MCP
const rpc = async (method, params, token = tok2.access_token, extra = {}) => {
  const res = await mcp(new Request(B + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
  return { status: res.status, body: res.status === 200 ? await res.json() : null }
}
let x = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude' } })
check(x.body?.result?.protocolVersion === '2025-06-18' && x.body.result.capabilities.tools, 'initialize echoes a supported protocol version')
x = await rpc('notifications/initialized')
check(x.status === 202, 'notifications get 202')
x = await rpc('tools/list', {}, tok2.access_token, { origin: 'https://evil.example' })
check(x.status === 403, 'other-site browser origin refused')
x = await rpc('tools/list')
const tools = x.body.result.tools
check(tools.length === 11 && tools.every((t) => t.inputSchema && t.annotations && !('run' in t)), 'tools/list returns 11 tools with schemas + annotations')
check(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort().join() === 'add_note,clear_page_request,create_appointment,create_task', 'only add_note/create_appointment/create_task (+ clearing a site page request) write')
x = await rpc('tools/list', {}, 'not-a-token')
check(x.status === 401, 'bad token -> 401')

calls.length = 0
x = await rpc('tools/call', { name: 'find_contacts', arguments: { name: 'Dolce' } })
check(!x.body.result.isError && JSON.parse(x.body.result.content[0].text).contacts[0].id === 42, 'find_contacts returns contacts')
check(calls[0].auth === 'Basic ' + Buffer.from('fubkey:').toString('base64') && calls[0].query.name === 'Dolce', 'FUB called with Basic auth + name filter')
x = await rpc('tools/call', { name: 'contact_properties', arguments: { personId: 42 } })
const props = JSON.parse(x.body.result.content[0].text)
check(props.properties[0].mls === 'CV26223436' && props.listingLinks[0].url.includes('zillow.com/homedetails'), 'contact_properties finds saved homes + shared links')
calls.length = 0
x = await rpc('tools/call', { name: 'add_note', arguments: { personId: 42, subject: 'Call', body: 'Wants single story' } })
check(calls.at(-1).method === 'POST' && calls.at(-1).path === '/v1/notes' && calls.at(-1).body.personId === 42, 'add_note POSTs a note')
x = await rpc('tools/call', { name: 'create_appointment', arguments: { title: 'Showing', start: '2026-10-25T10:00', personIds: [42] } })
let ap = calls.at(-1)
check(ap.path === '/v1/appointments' && ap.body.start === '2026-10-25T17:00:00Z' && ap.body.end === '2026-10-25T18:00:00Z' && ap.query.sendInvitation === 'false', '10am Pacific (PDT) sent to FUB as UTC (FUB drops offsets), 1h default, no invite')
check(ap.body.invitees.some((i) => i.userId === 7) && ap.body.invitees.some((i) => i.personId === 42), 'appointment invites Joseph + the contact')
x = await rpc('tools/call', { name: 'create_appointment', arguments: { title: 'Listing appt', start: '2026-11-05T15:30', end: '2026-11-05T16:30' } })
check(calls.at(-1).body.start === '2026-11-05T23:30:00Z', 'after DST ends, Pacific is -08:00 (sent as UTC)')
x = await rpc('tools/call', { name: 'create_task', arguments: { personId: 42, name: 'Call back', type: 'Call', due: '2026-10-24T11:00' } })
check(calls.at(-1).body.dueDateTime === '2026-10-24T18:00:00Z', 'timed task due sent to FUB as UTC')
x = await rpc('tools/call', { name: 'create_task', arguments: { personId: 42, name: 'Send comps', type: 'Email', due: '2026-10-23' } })
check(calls.at(-1).body.dueDate === '2026-10-23' && calls.at(-1).body.assignedUserId === 7, 'task assigned to Joseph with a due date')
x = await rpc('tools/call', { name: 'add_note', arguments: { personId: 'abc', body: 'x' } })
check(x.body.result.isError, 'bad input comes back as a tool error, not a crash')
check(calls.every((c) => c.method === 'GET' || c.method === 'POST'), 'connector never edits or deletes in FUB (no PUT/DELETE)')
ENV.FUB_API_KEY = ''
x = await rpc('tools/call', { name: 'find_contacts', arguments: { name: 'x' } })
check(x.body.result.isError && /FUB_API_KEY/.test(x.body.result.content[0].text), 'missing API key explains what to do')
ENV.FUB_API_KEY = 'fubkey'

// /admin "Disconnect Claude"
r = await admin(new Request(B + '/api/admin', { method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'disconnect-claude' }) }))
check(r.status === 401, 'disconnect needs the admin password')
r = await admin(new Request(B + '/api/admin', { method: 'POST', headers: { authorization: 'Bearer pw', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'disconnect-claude' }) }))
x = await rpc('tools/list')
check(r.status === 200 && x.status === 401, 'Disconnect Claude kills its tokens')


// Leads tab (/api/admin/leads)
const { default: leads } = await import(path.join(out, 'leads.mjs'))
const now = Date.now()
globalThis.__people = Array.from({ length: 250 }, (_, i) => ({ id: 1000 + i, name: 'Lead ' + i, stage: i % 2 ? 'Lead' : 'Active Client', source: 'Zillow',
  created: new Date(now - (250 - i) * 86400000 + 43200000).toISOString(), lastActivity: null }))   // oldest first, like FUB
globalThis.__leadsMode = true
const L = (qs = '', auth = 'Bearer pw', init = {}) => leads(new Request(B + '/api/admin/leads' + qs, { headers: { authorization: auth, 'content-type': 'application/json' }, ...init }))
r = await L('', 'Bearer nope')
check(r.status === 401, 'leads need the admin password')
r = await L('?limit=50')
let d = await r.json()
check(d.leads.length === 50 && d.leads[0].id === 1249 && d.leads[49].id === 1200 && d.nextCursor === 200, 'leads come newest first with a cursor for Load more')
check(d.stages.includes('Active Client'), 'stage list comes back for the filter')
r = await L('?limit=50&cursor=' + d.nextCursor); d = await r.json()
check(d.leads[0].id === 1199, 'Load more continues where it left off')
r = await L('?createdDays=10&limit=200'); d = await r.json()
check(d.leads.length === 10 && d.leads.every((x) => +new Date(x.created) >= now - 10 * 86400000 - 1000) && d.nextCursor === null, 'created-in-last-10-days stops at the cutoff')
r = await L('?stage=Lead&limit=5'); d = await r.json()
check(d.leads.every((x) => x.stage === 'Lead'), 'stage filter passes through to FUB')
r = await L('', 'Bearer pw', { method: 'POST', body: JSON.stringify({ action: 'request-page', personId: 1249, name: 'Lead 249' }) })
r = await L('?limit=1'); d = await r.json()
check(d.requested.includes(1249), 'Make client page saves a request that the tab shows')
globalThis.__leadsMode = false
const fresh = async () => {
  const lc = (await oauth(new Request(B + '/oauth/authorize', form({ ...Object.fromEntries(q), password: 'pw' })))).headers.get('location')
  const t = await oauth(new Request(B + '/oauth/token', form({ grant_type: 'authorization_code', code: new URL(lc).searchParams.get('code'), client_id, redirect_uri: CB, code_verifier: verifier })))
  return (await t.json()).access_token
}
const t3 = await fresh()
x = await rpc('tools/call', { name: 'page_requests', arguments: {} }, t3)
check(JSON.parse(x.body.result.content[0].text).requests.some((r) => r.personId === 1249 && r.name === 'Lead 249'), 'Claude can read page requests through the connector')
x = await rpc('tools/call', { name: 'clear_page_request', arguments: { personId: 1249 } }, t3)
globalThis.__leadsMode = true
r = await L('?limit=1'); d = await r.json()
check(!d.requested.includes(1249), 'clearing the request removes it from the Leads tab')
globalThis.__leadsMode = false

// Client tour notes -> FUB notes (page fubId comes from the built directory, never from the browser)
const { default: reactions } = await import(path.join(out, 'reactions.mjs'))
const dirPages = JSON.parse(fs.readFileSync(path.join(root, 'netlify/data/client-pages.json'), 'utf8')).pages
const tourPg = dirPages.find((p) => p.mode === 'tour' && p.fubId)
const showPg = dirPages.find((p) => p.mode === 'showcase' && p.fubId), noFubPg = dirPages.find((p) => !p.fubId)
const tourHome = tourPg.listings[0]
const react = (body) => reactions(new Request(B + '/api/reactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const fubNotes = () => calls.filter((c) => c.method === 'POST' && c.path === '/v1/notes')
calls.length = 0
await react({ page: tourPg.page, home: tourHome.id, r: 'love', note: '' })
check(fubNotes().length === 0, 'tour reaction with no note: nothing sent to FUB')
r = await react({ page: tourPg.page, home: tourHome.id, r: 'love', note: 'Love the patio!' })
let n = fubNotes()
check(r.status === 200 && n.length === 1 && n[0].body.personId === tourPg.fubId && n[0].body.subject === 'Tour note: ' + tourHome.address
  && n[0].body.body.includes('"Love the patio!"') && n[0].body.body.includes('Loved it') && n[0].body.body.includes('https://joeibarra.com' + tourPg.path)
  && !/\(\d{3}\)|DRE/.test(n[0].body.body), 'tour note goes to the client\'s FUB profile (subject, note, reaction, page link; no agent info)')
await react({ page: tourPg.page, home: tourHome.id, r: 'pass', note: 'Love the patio!' })
check(fubNotes().length === 1, 'same note saved again (reaction changed): no duplicate FUB note')
await react({ page: tourPg.page, home: tourHome.id, r: 'pass', note: 'Kitchen felt small' })
n = fubNotes()
check(n.length === 2 && n[1].body.body.startsWith('Updated note from') && n[1].body.body.includes('Not for them'), 'changed note: a new FUB note marked as updated')
r = await reactions(new Request(B + '/api/reactions?page=' + tourPg.page))
d = await r.json()
check(d.reactions[tourHome.id].note === 'Kitchen felt small' && !('fubNote' in d.reactions[tourHome.id]), 'page still gets the note back (internal FUB field hidden)')
await react({ page: tourPg.page, home: 'not-a-real-home', r: 'love', note: 'hi' })
await react({ page: noFubPg.page, home: noFubPg.listings[0].id, r: 'love', note: 'No FUB link' })
check(fubNotes().length === 2, 'no FUB note for unknown homes or pages without a fubId')
await react({ page: showPg.page, home: showPg.listings[0].id, r: 'pass', note: 'Too far from work' })
n = fubNotes()
check(n.length === 3 && n[2].body.personId === showPg.fubId && n[2].body.subject === 'Home note: ' + showPg.listings[0].address
  && n[2].body.body.includes('(homes page)') && n[2].body.body.includes('"Too far from work"'), 'homes-page note goes to FUB as a Home note')
ENV.FUB_API_KEY = ''
r = await react({ page: tourPg.page, home: tourHome.id, r: 'love', note: 'FUB is down' })
check(r.status === 200 && (await r.json()).reaction.note === 'FUB is down', 'reaction still saves when FUB fails')
ENV.FUB_API_KEY = 'fubkey'
r = await react({ page: tourPg.page, home: tourHome.id, r: 'love', note: 'FUB is down' })
check(fubNotes().length === 4, 'a note that failed to reach FUB is retried on the next save')

// Joseph marks a home Not for me for the client (needs his password; keeps their note; nothing to FUB)
const asJoseph = (body, pw = 'pw') => reactions(new Request(B + '/api/reactions', { method: 'POST',
  headers: { 'content-type': 'application/json', ...(pw ? { authorization: 'Bearer ' + pw } : {}) }, body: JSON.stringify({ ...body, by: 'joseph' }) }))
const showHome = showPg.listings[0], before = fubNotes().length
const saved = async () => (await (await reactions(new Request(B + '/api/reactions?page=' + showPg.page))).json()).reactions[showHome.id]
check((await asJoseph({ page: showPg.page, home: showHome.id, r: 'pass' }, '')).status === 401
  && (await asJoseph({ page: showPg.page, home: showHome.id, r: 'pass' }, 'wrong')).status === 401, 'Joseph\'s mark without the right password: 401')
check((await asJoseph({ page: showPg.page, home: showHome.id, r: 'love' })).status === 400, 'Joseph can\'t mark Love it for a client')
r = await asJoseph({ page: showPg.page, home: showHome.id, r: 'pass', note: 'sneaky' })
let sv = await saved()
check(r.status === 200 && sv.r === 'pass' && sv.by === 'joseph' && sv.note === 'Too far from work' && fubNotes().length === before,
  'Joseph\'s Not for me saves as his, keeps the client\'s note, sends nothing to FUB')
await react({ page: showPg.page, home: showHome.id, r: 'pass', note: 'Too far from work, honestly' })
sv = await saved()
check(sv.by === 'joseph' && sv.note === 'Too far from work, honestly', 'client editing only their note keeps it labeled as Joseph\'s mark')
await react({ page: showPg.page, home: showHome.id, r: 'love', note: 'Too far from work, honestly' })
check(!('by' in await saved()), 'client picking a reaction makes it their own')
await asJoseph({ page: showPg.page, home: showHome.id, r: 'pass' })
await asJoseph({ page: showPg.page, home: showHome.id, r: '' })
sv = await saved()
check(sv.r === '' && !('by' in sv) && sv.note === 'Too far from work, honestly', 'Joseph undoing his mark clears it and keeps the note')
const lone = showPg.listings[1]
await asJoseph({ page: showPg.page, home: lone.id, r: 'pass' })
await asJoseph({ page: showPg.page, home: lone.id, r: '' })
check(!(lone.id in (await (await reactions(new Request(B + '/api/reactions?page=' + showPg.page))).json()).reactions), 'undo with no note removes it entirely')

globalThis.fetch = realFetch
fs.rmSync(out, { recursive: true, force: true })
console.log(`connector: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
