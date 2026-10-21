// Adds link-preview tags (what iMessage, Slack, etc. show when a page link is texted) to every
// homes/*.html page, built from its window.HOMES block. The tags sit between the
// <!-- preview:start --> / <!-- preview:end --> markers in <head> and are rewritten each run.
// Also writes homes/<page>.ics for every tour (the "Add to my calendar" button on the page),
// and deletes .ics files whose tour page is gone.
// Runs on every Netlify deploy (netlify.toml) and in tests/run.py (--check fails if stale).
// Run by hand with: node scripts/build-previews.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAll } from './build-directory.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SITE = 'https://joeibarra.com'
const START = '<!-- preview:start -->', END = '<!-- preview:end -->'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const niceDate = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` }
const niceTime = hm => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}` }
const homes = n => `${n} home${n === 1 ? '' : 's'}`

export function preview(D, slug) {
  const L = D.listings || [], who = D.client ? `${D.client}'s` : 'Your'
  let title, desc, photo
  if (D.mode === 'tour') {
    const stops = L.filter(h => h.time).sort((a, b) => a.time.localeCompare(b.time))
    const first = stops[0] || L[0]
    title = `${who} home tour${D.date ? ', ' + niceDate(D.date) : ''}`
    desc = `${homes(L.length)}${first?.time ? ' starting at ' + niceTime(first.time) : ''}${first?.address ? ', first stop ' + first.address : ''}`
    photo = first?.photo
  } else {
    const fresh = L.filter(h => h.added).sort((a, b) => b.added.localeCompare(a.added))
    title = `${who} homes`
    desc = `${homes(L.length)}${D.area ? ' in ' + D.area : ''}, picked by Joseph Ibarra`
    photo = (fresh[0] || L[0])?.photo
  }
  const url = `${SITE}/homes/${slug}`
  const tags = [
    ['og:type', 'website'], ['og:site_name', 'Joseph Ibarra · First Team Real Estate'],
    ['og:title', title], ['og:description', desc], ['og:url', url],
    ...(photo ? [['og:image', photo]] : [])
  ].map(([p, c]) => `<meta property="${p}" content="${esc(c)}">`)
  tags.push(`<meta name="twitter:card" content="${photo ? 'summary_large_image' : 'summary'}">`)
  return `${START}\n${tags.join('\n')}\n${END}`
}

// Page HTML with its preview block inserted or refreshed (right before </head>)
export function withPreview(html, D, slug) {
  const block = preview(D, slug)
  const i = html.indexOf(START), j = html.indexOf(END)
  if (i >= 0 && j > i) return html.slice(0, i) + block + html.slice(j + END.length)
  return html.replace('</head>', block + '\n</head>')
}

// ---- Calendar file for tours (.ics) ----
// Pacific wall time -> UTC "YYYYMMDDTHHMMSSZ"
function pacificUtc(ymd, hm) {
  const guess = Date.parse(`${ymd}T${hm}:00Z`)
  const off = at => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at)).map(x => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at }
  let utc = guess - off(guess); utc = guess - off(utc)
  return new Date(utc).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
const addMin = (hm, n) => { const [h, m] = hm.split(':').map(Number), t = h * 60 + m + n; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
const icsText = v => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
// Fold lines to 75 octets (RFC 5545)
const fold = line => { const out = []; let cur = '', bytes = 0
  for (const ch of line) { const b = Buffer.byteLength(ch); if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0 } cur += ch; bytes += b }
  out.push(cur); return out.join('\r\n ') }

export function calendar(D, slug) {
  const L = D.listings || []
  if (D.mode !== 'tour' || !D.date || !L.length || !L[0].time) return null
  const start = L[0].time, end = addMin(L[L.length - 1].time || start, 30)
  const where = h => [h.address, h.city].filter(Boolean).join(', ')
  const url = `${SITE}/homes/${slug}`
  const desc = `Showing details: ${url}\n\n` + L.map((h, i) => `${i + 1}. ${niceTime(h.time || start)}  ${where(h)}`).join('\n') + '\n\nJoseph Ibarra · (714) 507-5438'
  const alarm = (trigger, text) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(text)}`, trigger, 'END:VALARM']
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//joeibarra.com//Home tours//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${slug}-${D.date}@joeibarra.com`, `DTSTAMP:${pacificUtc(D.created || D.date, '00:00')}`,
    `DTSTART:${pacificUtc(D.date, start)}`, `DTEND:${pacificUtc(D.date, end)}`,
    `SUMMARY:${icsText('Home tour with Joseph Ibarra')}`, `LOCATION:${icsText(where(L[0]))}`,
    `DESCRIPTION:${icsText(desc)}`, `URL:${url}`,
    // the morning of (8am), unless the tour starts before 9, then 1 hour before
    ...(start >= '09:00' ? alarm(`TRIGGER;VALUE=DATE-TIME:${pacificUtc(D.date, '08:00')}`, 'Home tour today with Joseph Ibarra') : []),
    ...alarm('TRIGGER:-PT1H', 'Home tour with Joseph Ibarra in 1 hour'),
    'END:VEVENT', 'END:VCALENDAR'
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'), stale = [], keep = new Set()
  for (const { file, slug, D } of loadAll()) {
    const p = path.join(root, file), html = fs.readFileSync(p, 'utf8'), next = withPreview(html, D, slug)
    if (next !== html) { if (check) stale.push(file); else fs.writeFileSync(p, next) }
    const ics = calendar(D, slug)
    if (!ics) continue
    const ip = path.join(root, 'homes', slug + '.ics'); keep.add(slug + '.ics')
    if (fs.existsSync(ip) && fs.readFileSync(ip, 'utf8') === ics) continue
    if (check) stale.push('homes/' + slug + '.ics'); else fs.writeFileSync(ip, ics)
  }
  for (const f of fs.readdirSync(path.join(root, 'homes')).filter(f => f.endsWith('.ics') && !keep.has(f))) {
    if (check) stale.push('homes/' + f + ' (page is gone)'); else fs.unlinkSync(path.join(root, 'homes', f))
  }
  if (check && stale.length) { console.error('Link previews / calendar files out of date: ' + stale.join(', ')); process.exit(1) }
  console.log(check ? 'link previews + calendar files up to date' : 'link previews + calendar files written')
}
