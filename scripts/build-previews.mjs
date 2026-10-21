// Adds link-preview tags (what iMessage, Slack, etc. show when a page link is texted) to every
// homes/*.html page, built from its window.HOMES block. The tags sit between the
// <!-- preview:start --> / <!-- preview:end --> markers in <head> and are rewritten each run.
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'), stale = []
  for (const { file, slug, D } of loadAll()) {
    const p = path.join(root, file), html = fs.readFileSync(p, 'utf8'), next = withPreview(html, D, slug)
    if (next === html) continue
    if (check) stale.push(file); else fs.writeFileSync(p, next)
  }
  if (check && stale.length) { console.error('Link previews out of date: ' + stale.join(', ')); process.exit(1) }
  console.log(check ? 'link previews up to date' : 'link previews written')
}
