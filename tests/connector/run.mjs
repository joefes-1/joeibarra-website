// Tests for the Follow Up Boss connector: OAuth sign-in (admin password + PKCE), /mcp, and the tools.
// Run by tests/run.py. Functions are bundled with esbuild against an in-memory Blobs store and a fake FUB API.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..')
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'conn-'))
for (const f of ['oauth', 'mcp', 'admin']) {
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
check(tools.length === 9 && tools.every((t) => t.inputSchema && t.annotations && !('run' in t)), 'tools/list returns 9 tools with schemas + annotations')
check(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort().join() === 'add_note,create_appointment,create_task', 'only add_note/create_appointment/create_task write')
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
check(ap.path === '/v1/appointments' && ap.body.start === '2026-10-25T10:00:00-07:00' && ap.body.end === '2026-10-25T11:00:00-07:00' && ap.query.sendInvitation === 'false', 'appointment in Pacific (PDT), 1h default, no invite')
check(ap.body.invitees.some((i) => i.userId === 7) && ap.body.invitees.some((i) => i.personId === 42), 'appointment invites Joseph + the contact')
x = await rpc('tools/call', { name: 'create_appointment', arguments: { title: 'Listing appt', start: '2026-11-05T15:30', end: '2026-11-05T16:30' } })
check(calls.at(-1).body.start === '2026-11-05T15:30:00-08:00', 'after DST ends, Pacific is -08:00')
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

globalThis.fetch = realFetch
fs.rmSync(out, { recursive: true, force: true })
console.log(`connector: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
