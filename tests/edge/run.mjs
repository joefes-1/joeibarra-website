// Edge-case tests (server side): build scripts, /api/reactions -> FUB notes, FUB connector time handling.
// Uses the fake clients in tests/edge/fixtures/. Everything runs locally against a COPY of the repo in a
// temp folder (product files are never touched); Follow Up Boss and Netlify Blobs are faked.
// Run: node tests/edge/run.mjs        (exit 1 if any check fails; KNOWN-BUG checks are listed separately)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-'))
for (const d of ['homes', 'scripts', 'netlify']) fs.cpSync(path.join(root, d), path.join(tmp, d), { recursive: true })
fs.writeFileSync(path.join(tmp, 'package.json'), fs.readFileSync(path.join(root, 'package.json')))
for (const f of fs.readdirSync(path.join(here, 'fixtures'))) fs.copyFileSync(path.join(here, 'fixtures', f), path.join(tmp, 'homes', f))

let pass = 0
const fails = [], known = []
// check(): must pass. bug(): a check that documents a known problem (reported, doesn't fail the run until fixed;
// once it starts passing, it's flagged so it can be turned into a plain check).
const check = (ok, msg) => { if (ok) pass++; else { fails.push(msg); console.log('  FAIL ' + msg) } }
const bug = (ok, msg) => { if (ok) { pass++; console.log('  FIXED? (now passes) ' + msg) } else known.push(msg) }
const section = (s) => console.log(s)

/* ---------------- Build scripts on the fake pages ---------------- */
section('Build scripts: directory, link previews, tour .ics')
const BD = await import(pathToFileURL(path.join(tmp, 'scripts/build-directory.mjs')))
const BP = await import(pathToFileURL(path.join(tmp, 'scripts/build-previews.mjs')))
const all = BD.loadAll()
const bySlug = Object.fromEntries(all.map((x) => [x.slug, x.D]))
let pages
try { pages = BD.readPages(); check(true, '') } catch (e) { check(false, 'build-directory crashed on the fake pages: ' + e.message) }
const dir = Object.fromEntries((pages || []).map((p) => [p.path.split('/').pop(), p]))
check(dir['tst-names'].client === "D'Angelo José Zoë 🏡" && dir['tst-names'].fubId === 990001, 'directory keeps accented/emoji client names + fubId')
check(!JSON.stringify(dir['tst-names']).includes('555-0199') && !JSON.stringify(pages).includes('agent.smith'), 'directory (used for FUB notes) never carries listing-agent text from why/headsUp')
const ids = dir['tst-missing'].listings.map((l) => l.id)
bug(new Set(ids).size === ids.length, `two listings with the same address and no mls get the same home id (reactions collide): ${ids.join(', ')}`)
bug(dir['tst-fubstr'].fubId === 990009, 'fubId written as a string ("990009") is dropped from the directory (no FUB notes), while the page still shows the Zillow-heart tip')
bug(dir['tst-upper'].page === 'testy-mctestface', `page id with capitals: directory stores "${dir['tst-upper'].page}" but the browser sends "testy-mctestface" -> FUB notes + /admin remove/tour picks never match`)
bug(dir['tst-expiry-str'].expires === '2026-10-11', `expiresDays as a string ("10") gives expiry ${dir['tst-expiry-str'].expires} instead of 2026-10-11`)
check(dir['tst-expiry'].expires === '2026-10-08', 'expiresDays: 7 -> expires 7 days after created')
check(dir['tst-tour-ten'].expires === '2026-11-04', 'tour on DST-ending day expires 3 days later (Nov 4)')

// Link previews
const og = (slug) => Object.fromEntries([...BP.preview(bySlug[slug], slug).matchAll(/property="([^"]+)" content="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const n = og('tst-names')
check(n['og:title'] === 'D&#39;Angelo José Zoë 🏡&#39;s homes' || n['og:title'] === "D'Angelo José Zoë 🏡's homes", `og:title with apostrophe/accents/emoji: ${n['og:title']}`)
check(n['og:description'].includes('Huntington Beach &amp; Seacliff'), 'ampersand in area is escaped in og:description')
const xog = BP.preview(bySlug['tst-xss'], 'tst-xss')
check(!/<img|onerror="/.test(xog.replace(/&lt;img/g, '').replace(/onerror=&quot;/g, '')), 'link preview escapes HTML in client/area')
const mo = og('tst-forty')
bug(/^https:\/\//.test(mo['og:image'] || ''), `og:image from a site-relative photo ("/images/...") is not absolute ("${mo['og:image']}"): iMessage/Slack can't load it`)
const uo = og('tst-tour-unsorted')
const unsortedPageStart = bySlug['tst-tour-unsorted'].listings[0].time
bug(uo['og:description'].includes('starting at 11am'), `stops typed out of time order: preview says "${uo['og:description']}" but the page and calendar start at ${unsortedPageStart} with stop 1 = 1 Testy Ln`)
check(og('tst-tour-nodate')['og:title'] === "Testy's home tour", 'tour with no date: preview title without a date')

// .ics
const ics = (slug) => { try { return BP.calendar(bySlug[slug], slug) } catch (e) { return 'CRASH ' + e.message } }
const field = (s, k) => ((s || '').match(new RegExp('^' + k + '[:;][^\\r]*', 'm')) || [''])[0]
const unfold = (s) => (s || '').replace(/\r\n /g, '')
let c = ics('tst-tour-ten')
check(field(c, 'DTSTART') === 'DTSTART:20261101T180000Z' && field(c, 'DTEND') === 'DTEND:20261101T230000Z', `DST-ending day (Nov 1): 10am PST = 18:00Z, last stop 2:30pm + 30 = 23:00Z (${field(c, 'DTSTART')} ${field(c, 'DTEND')})`)
check(c.includes('TRIGGER;VALUE=DATE-TIME:20261101T160000Z'), '8am morning-of reminder on Nov 1 is 16:00Z (PST)')
check(c.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), '.ics lines with emoji/accents fold at 75 bytes')
check(c.split('\r\n').every((l) => !/[\uD800-\uDBFF]$/.test(l)) && unfold(c).includes('🏡'), 'folding never splits an emoji')
check(unfold(c).includes('LOCATION:1 Calle Ñandú #5\\; Bldg\\, A 🏡\\, Huntington Beach\\, CA'), 'semicolons and commas escaped in LOCATION')
check(c.endsWith('\r\n') && !/[^\r]\n/.test(c), '.ics uses CRLF line endings only')
c = ics('tst-tour-dststart')
check(field(c, 'DTSTART') === 'DTSTART:20270314T170000Z' && c.includes('TRIGGER;VALUE=DATE-TIME:20270314T150000Z'), `DST start (Mar 14 2027): 10am PDT = 17:00Z, 8am alarm = 15:00Z (${field(c, 'DTSTART')})`)
c = ics('tst-tour-early')
check(!c.includes('VALUE=DATE-TIME') && c.includes('TRIGGER:-PT1H'), 'tour before 9am: no 8am alarm, only the 1-hour one')
c = ics('tst-tour-nine')
check(c.includes('TRIGGER;VALUE=DATE-TIME:20261024T150000Z'), 'tour at exactly 9am still gets the 8am alarm')
c = ics('tst-tour-late')
bug(field(c, 'DTEND') > field(c, 'DTSTART').replace('DTSTART', 'DTEND'), `late tour (9:30pm-11:50pm stops): event ends before it starts (${field(c, 'DTSTART')} ${field(c, 'DTEND')})`)
c = ics('tst-tour-unsorted')
bug(field(c, 'DTEND') > field(c, 'DTSTART').replace('DTSTART', 'DTEND'), `stops not in time order: event ends before it starts (${field(c, 'DTSTART')} ${field(c, 'DTEND')})`)
c = ics('tst-tour-badtime')
bug(!c.startsWith('CRASH'), `a stop time typed "9:30" (no leading zero) crashes build-previews -> the Netlify build fails and nothing deploys (${c.slice(0, 60)})`)
c = ics('tst-tour-notime')
bug(!/2\. 10am/.test(unfold(c).replace(/\\n/g, '\n')), 'a stop with no time is listed in the .ics with the first stop\'s time ("2. 10am")')
check(ics('tst-tour-nodate') === null && ics('tst-tour-firstnotime') === null, 'no .ics for a tour with no date or no first-stop time')
check(!ics('tst-names'), 'no .ics for showcase pages')
c = ics('tst-tour-pagemismatch')
bug(bySlug['tst-tour-pagemismatch'].page === 'tst-tour-pagemismatch', 'page id differs from the file name: .ics is written as tst-tour-pagemismatch.ics but the page button links /homes/tst-tour-renamed.ics (404); reactions/FUB also keyed differently')
c = ics('tst-xss-tour')
bug(!c.startsWith('CRASH'), `a malformed stop time crashes build-previews (${c.slice(0, 60)})`)

/* ---------------- /api/reactions -> FUB notes ---------------- */
section('Reactions + FUB notes (fake FUB, fake Blobs)')
fs.writeFileSync(path.join(tmp, 'netlify/data/client-pages.json'), BD.render(pages))
const out = path.join(tmp, 'bundle'); fs.mkdirSync(out)
const fakeBlobs = path.join(root, 'tests/connector/fake-blobs.mjs')
for (const [src, name] of [['netlify/functions/reactions.mts', 'reactions'], ['netlify/lib/fub-tools.ts', 'fubtools']]) {
  execFileSync('npx', ['--yes', 'esbuild@0.24.0', src, '--bundle', '--platform=node', '--format=esm',
    `--alias:@netlify/blobs=${fakeBlobs}`, `--outfile=${path.join(out, name + '.mjs')}`, '--log-level=warning'], { cwd: tmp, stdio: 'inherit' })
}
const ENV = { FUB_API_KEY: 'fake-key' }
globalThis.Netlify = { env: { get: (k) => ENV[k] } }
const calls = []
let fubMode = 'ok', fubDelay = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET'
  if (u.hostname !== 'api.followupboss.com') throw new Error('unexpected outside call ' + url)
  calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null })
  if (fubDelay) await new Promise((r) => setTimeout(r, fubDelay))
  const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'retry-after': '7' } })
  if (fubMode === '500') return J({ errorMessage: 'down' }, 500)
  if (fubMode === '429') return J({}, 429)
  if (fubMode === 'throw') throw new TypeError('fetch failed')
  const p = u.pathname.replace('/v1', '')
  if (p === '/me') return J({ id: 7, name: 'Joseph Ibarra' })
  if (p === '/people/990001') return J({ id: 990001, name: 'Testy McTestface', emails: [{ value: 'testy@example.com' }] })
  if (p === '/appointments' && method === 'GET') return J({ appointments: [{ id: 1, title: 'Showing', start: '2026-11-01T17:30:00Z', end: '2026-11-01T18:30:00Z', invitees: [] }] })
  if (p === '/tasks' && method === 'GET') return J({ tasks: [{ id: 2, name: 'Call', dueDateTime: '2026-03-08T10:30:00Z' }, { id: 3, name: 'All day', dueDate: '2026-11-01' }] })
  return J({ id: 900 })
}
const { default: reactions } = await import(pathToFileURL(path.join(out, 'reactions.mjs')))
const B = 'https://joeibarra.com'
const post = (body, raw) => reactions(new Request(B + '/api/reactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }))
const get = (q) => reactions(new Request(B + '/api/reactions?' + q))
const notes = () => calls.filter((x) => x.method === 'POST' && x.path === '/v1/notes')
const hid = (slug, i = 0) => dir[slug].listings[i].id

calls.length = 0
let r = await post({ page: 'tst-names', home: hid('tst-names'), r: 'love', note: "Love it 😍 — José's fave; \"big\" yard, <b>bold</b>" })
let nn = notes()
check(r.status === 200 && nn.length === 1 && nn[0].body.personId === 990001 && nn[0].body.subject === "Home note: 1 O'Hare Ct", 'note with emoji/quotes/apostrophes goes to FUB once, subject has the address')
check(nn[0].body.body.includes("Note from D'Angelo José Zoë 🏡 on 1 O'Hare Ct, Huntington Beach, CA 92648 (homes page)") && nn[0].body.body.includes('<b>bold</b>') && nn[0].body.isHtml === false,
  'FUB note body: client name, address, plain text (isHtml false)')
check(!/555-0199|agent\.smith|Listing agent|DRE|507-5438/.test(JSON.stringify(nn)), 'no listing-agent (or agent) contact info in the FUB note')
await post({ page: 'tst-names', home: hid('tst-names', 1), r: 'pass', note: 'Too close to the freeway' })
check(!/555-0199|agent\.smith|Listing agent/.test(JSON.stringify(notes())), 'note on a home whose why/headsUp holds listing-agent text: none of it reaches FUB')
r = await post({ page: 'tst-names', home: hid('tst-names'), r: 'love', note: 'x'.repeat(5000) })
check(r.status === 200 && (await r.json()).reaction.note.length === 300 && notes().at(-1).body.body.includes('x'.repeat(300) + '"'), '5000-char note is cut to 300 (page + FUB)')
r = await post({ page: 'tst-names', home: hid('tst-names'), r: 'love', note: '   ' })
check(r.status === 200 && (await r.json()).reaction.note === '', 'whitespace-only note saves as no note')
const before = notes().length
await post({ page: 'tst-names', home: hid('tst-names'), r: '', note: '' })
await post({ page: 'tst-names', home: hid('tst-names'), r: 'love', note: 'x'.repeat(300) })
check(notes().length === before + 1 && notes().at(-1).body.body.startsWith('Note from'), 'after a full clear, the same note is sent again as a new "Note" (not "Updated")')

// tour notes, date in note body
calls.length = 0
await post({ page: 'tst-tour-ten', home: hid('tst-tour-ten'), r: 'love', note: 'Great patio' })
nn = notes()
check(nn.length === 1 && nn[0].body.subject.startsWith('Tour note: ') && nn[0].body.body.includes('(tour Sun, Nov 1)'), `tour note subject + date (Sun, Nov 1): ${nn[0]?.body.body.split('\n')[0]}`)

// ids that don't resolve
calls.length = 0
for (const [pg, hm] of [['tst-nofub', hid('tst-nofub')], ['tst-names', 'NOT-A-HOME'], ['not-a-page', 'X1']]) {
  r = await post({ page: pg, home: hm, r: 'love', note: 'hello' }); check(r.status === 200, `${pg}/${hm}: saved (200)`)
}
check(notes().length === 0, 'no FUB note for a page without fubId, an unknown home, or a page not in the directory')
r = await post({ page: 'testy-mctestface', home: hid('tst-upper'), r: 'love', note: 'Upper-case page id' })
bug(notes().length === 1, 'page id with capitals ("Testy-McTestface"): the browser posts "testy-mctestface", so the note never reaches FUB')
r = await get('page=' + encodeURIComponent('zoë-tëst'))
bug(r.status === 200, `page id with accents ("zoë-tëst"): /api/reactions answers ${r.status}, so every Love it / note on that page fails with "That didn't save"`)
r = await post({ page: 'tst-fubstr', home: hid('tst-fubstr'), r: 'love', note: 'string fub id' })
bug(notes().length === 2, 'fubId given as a string: notes silently never reach FUB')

// hostile input
for (const [b, label] of [
  [{ page: '../admin', home: 'X', r: 'love' }, 'path in page id'], [{ page: 'tst-names', home: '../../x', r: 'love' }, 'path in home id'],
  [{ page: 'tst-names', home: 'A'.repeat(61), r: 'love' }, '61-char home id'], [{ page: 'tst-names', home: hid('tst-names'), r: 'meh' }, 'unknown reaction'],
  [{ page: 'tst-names', home: hid('tst-names'), r: '<script>' }, 'script as reaction'], ]) { r = await post(b); check(r.status === 400, `${label} -> 400 (got ${r.status})`) }
r = await post(null, '{not json'); check(r.status === 400, 'bad JSON -> 400')
let crash = ''
try { r = await post({ page: 'tst-names', home: hid('tst-names'), r: 'love', note: { toString: null } }) } catch (e) { crash = e.message }
bug(!crash, `a crafted body (note = {"toString": null}) throws inside the function (unhandled 500): ${crash}`)
r = await post({ page: 'tst-names', home: hid('tst-names'), r: 'love', note: 'y'.repeat(2_000_000) })
check(r.status === 200 && (await r.json()).reaction.note.length === 300, '2 MB note body is accepted but stored/forwarded as 300 chars')
r = await get('page=' + encodeURIComponent('<script>')); check(r.status === 400, 'GET with a hostile page id -> 400')
r = await reactions(new Request(B + '/api/reactions', { method: 'DELETE' })); check(r.status === 405, 'DELETE -> 405')
const src = fs.readFileSync(path.join(root, 'netlify/functions/reactions.mts'), 'utf8')
check(/rateLimit:\s*\{\s*windowLimit:\s*\d+/.test(src), 'reactions endpoint has a rate limit configured')
r = await get('page=tst-names'); let d = await r.json()
check(Object.values(d.reactions).every((v) => !('fubNote' in v)), 'GET never exposes the internal fubNote field')

// FUB down -> retry
calls.length = 0
for (const mode of ['500', '429', 'throw']) {
  fubMode = mode
  r = await post({ page: 'tst-names', home: hid('tst-names'), r: 'love', note: 'while FUB is ' + mode })
  check(r.status === 200 && (await r.json()).reaction.note === 'while FUB is ' + mode, `FUB ${mode}: reaction still saves`)
  fubMode = 'ok'
  await post({ page: 'tst-names', home: hid('tst-names'), r: 'pass', note: 'while FUB is ' + mode })
  check(notes().filter((x) => x.body.body.includes('while FUB is ' + mode)).length === 2, `FUB ${mode}: note is retried on the client's next save of that home`)
}
bug(false, 'a note that failed to reach FUB is only retried if the client saves that same home again; otherwise it never reaches FUB (no background retry or alert)')

// rapid double-submit of the same note (two tabs / double tap): duplicate FUB notes?
calls.length = 0; fubDelay = 50
await Promise.all([1, 2, 3].map(() => post({ page: 'tst-names', home: hid('tst-names', 1), r: 'love', note: 'Rapid fire note' })))
fubDelay = 0
bug(notes().length === 1, `the same note saved 3 times at once creates ${notes().length} FUB notes (no lock between read and write)`)

// expired / removed pages still forward notes
calls.length = 0
await post({ page: 'tst-expiry', home: hid('tst-expiry'), r: 'love', note: 'on an expired page' })
check(notes().length === 0, 'tst-expiry has no fubId (control)')

/* ---------------- FUB connector time handling ---------------- */
section('FUB connector: Pacific times, DST, offsets, all-day tasks')
const FT = await import(pathToFileURL(path.join(out, 'fubtools.mjs')))
const iso = (s) => FT.parseWhen(s, 'x').toISOString()
check(iso('2026-11-01T00:30') === '2026-11-01T07:30:00.000Z', 'Nov 1 00:30 (before fall-back) = PDT')
check(iso('2026-11-01T10:00') === '2026-11-01T18:00:00.000Z', 'Nov 1 10:00 (after fall-back) = PST')
check(['2026-11-01T08:30:00.000Z', '2026-11-01T09:30:00.000Z'].includes(iso('2026-11-01T01:30')), `ambiguous 1:30am on Nov 1 resolves to one of the two real times (${iso('2026-11-01T01:30')})`)
check(iso('2027-03-14T10:00') === '2027-03-14T17:00:00.000Z' && iso('2026-03-08T10:00') === '2026-03-08T17:00:00.000Z', 'spring-forward day 10am = PDT')
const gap = iso('2026-03-08T02:30')
check(['2026-03-08T09:30:00.000Z', '2026-03-08T10:30:00.000Z'].includes(gap), `nonexistent 2:30am on spring-forward day lands next to it (${gap})`)
check(iso('2026-10-25T10:00Z') === '2026-10-25T10:00:00.000Z' && iso('2026-10-25T10:00-04:00') === '2026-10-25T14:00:00.000Z' && iso('2026-10-25T10:00+0530') === '2026-10-25T04:30:00.000Z', 'explicit Z / offsets are honored')
check(iso('2026-10-25 10:00') === '2026-10-25T17:00:00.000Z' && iso('2026-10-25T10:00:30') === '2026-10-25T17:00:30.000Z', 'space separator and seconds work')
let threw = ''; try { FT.parseWhen('2026-10-25T10:00:00.000', 'x') } catch (e) { threw = e.message }
bug(!threw, `ISO time with milliseconds and no offset ("2026-10-25T10:00:00.000") is rejected: ${threw}`)
threw = ''; try { FT.parseWhen('10/25/2026 10am', 'start') } catch (e) { threw = e.message }
check(/2026-10-25T10:00/.test(threw), 'unparseable time gives a helpful error')
threw = ''; try { FT.parseWhen('2026-02-30T10:00', 'start') } catch (e) { threw = e.message }
bug(!!threw, `impossible date 2026-02-30 is accepted and silently becomes ${threw ? '-' : iso('2026-02-30T10:00')}`)
check(FT.pacificIso(new Date('2026-11-01T18:00:00Z')) === '2026-11-01T10:00:00-08:00' && FT.pacificIso(new Date('2026-11-01T07:30:00Z')) === '2026-11-01T00:30:00-07:00', 'read-back in Pacific across the DST change')

const run = async (name, args) => { const x = await FT.runTool(name, args); return { err: x.isError, data: x.structuredContent, text: x.content[0].text } }
calls.length = 0
let t = await run('create_appointment', { title: 'Showing', start: '2026-11-01T10:00', end: '2026-11-01T11:00', personIds: [990001] })
let ap = calls.at(-1)
check(!t.err && ap.body.start === '2026-11-01T18:00:00Z' && ap.body.end === '2026-11-01T19:00:00Z' && t.data.start === '2026-11-01T10:00:00-08:00', 'appointment on DST-ending day sent as UTC, echoed back in PST')
check(ap.query.sendInvitation === 'false', 'appointments never send an invite')
t = await run('create_appointment', { title: 'Late', start: '2026-10-31T23:30' })
check(calls.at(-1).body.end === '2026-11-01T07:30:00Z' && t.data.end === '2026-11-01T00:30:00-07:00', 'default 1h end crossing midnight into DST-ending day')
t = await run('create_appointment', { title: 'Overnight DST', start: '2026-11-01T00:30', end: '2026-11-01T02:30' })
check(!t.err && calls.at(-1).body.start === '2026-11-01T07:30:00Z' && calls.at(-1).body.end === '2026-11-01T10:30:00Z', 'appointment spanning the fall-back hour is 3 real hours')
t = await run('create_appointment', { title: 'Backwards', start: '2026-11-01T10:00', end: '2026-11-01T09:00' })
check(t.err && /after start/.test(t.text), 'end before start refused')
t = await run('create_appointment', { title: '   ', start: '2026-11-01T10:00' }); check(t.err, 'blank title refused')
t = await run('create_task', { personId: 990001, name: 'All-day', due: '2026-11-01' })
check(calls.at(-1).body.dueDate === '2026-11-01' && !('dueDateTime' in calls.at(-1).body), 'all-day task sends dueDate only')
t = await run('create_task', { personId: 990001, name: 'Spring', due: '2027-03-14T09:00' })
check(calls.at(-1).body.dueDateTime === '2027-03-14T16:00:00Z', 'timed task on spring-forward day: 9am PDT = 16:00Z')
t = await run('create_task', { personId: 990001, name: 'Offset', due: '2026-10-24T11:00-07:00' })
check(calls.at(-1).body.dueDateTime === '2026-10-24T18:00:00Z', 'task with explicit -07:00 offset sent as UTC')
t = await run('my_appointments', { start: '2026-11-01', end: '2026-11-01' })
let q = calls.at(-1).query
check(q.start === '2026-11-01T07:00:00.000Z' && q.end === '2026-11-02T07:59:00.000Z' && t.data.appointments[0].start === '2026-11-01T09:30:00-08:00', `my_appointments for Nov 1 covers the 25-hour Pacific day (${q.start} .. ${q.end}) and reads back in PST`)
bug(q.end === '2026-11-02T07:59:59.999Z' || q.end === '2026-11-02T08:00:00.000Z', 'my_appointments "end" day stops at 11:59pm, so an appointment starting 11:59:30pm or later is missed (minor)')
t = await run('my_tasks', {})
check(t.data.tasks[0].due === '2026-03-08T03:30:00-07:00' && t.data.tasks[1].due === '2026-11-01', `tasks read back in Pacific (DST start), all-day stays a date (${t.data.tasks.map((x) => x.due)})`)
t = await run('add_note', { personId: 990001, body: '  ' }); check(t.err, 'empty note refused')
t = await run('add_note', { personId: -5, body: 'x' }); check(t.err, 'negative personId refused')
check(calls.every((x) => ['GET', 'POST'].includes(x.method)), 'connector never sends PUT/DELETE')

globalThis.fetch = realFetch
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\nedge (node): ${pass} passed, ${fails.length} failed, ${known.length} known bugs still open`)
for (const k of known) console.log('  KNOWN BUG ' + k)
process.exit(fails.length ? 1 : 0)
