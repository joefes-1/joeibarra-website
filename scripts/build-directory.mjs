// Builds netlify/data/client-pages.json: the private list of client pages shown on /admin.
// Reads the window.HOMES block from every homes/*.html (samples skipped).
// Runs on every Netlify deploy (netlify.toml) and in tests/run.py, which fails if the
// committed copy is out of date. Run by hand with: node scripts/build-directory.mjs
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(root, 'netlify', 'data', 'client-pages.json')

// Same id rule as homes.js homeId(), so reactions line up with homes.
const homeId = (h, i) => String(h.mls || h.address || `home-${i + 1}`).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

// Same expiry rule as homes.js expiresAt(): returns the local date the page switches off ("YYYY-MM-DD").
function expires(D) {
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  if (D.mode === 'tour') return D.date ? addDays(D.date, 3) : null
  if (!D.created) return null
  let base = D.created
  for (const h of D.listings || []) if (h.added && h.added.slice(0, 10) > base) base = h.added.slice(0, 10)
  return addDays(base, D.expiresDays || 30)
}

// Every homes/*.html page with its window.HOMES data: [{ file, slug, D }]
export function loadAll() {
  const dir = path.join(root, 'homes')
  return fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort().map(file => {
    const html = fs.readFileSync(path.join(dir, file), 'utf8')
    const m = html.match(/window\.HOMES\s*=\s*(\{[\s\S]*?\});\s*<\/script>/)
    if (!m) throw new Error(`${file}: no window.HOMES block`)
    const D = vm.runInNewContext('(' + m[1] + ')')   // our own repo files, not user input
    return { file: path.join('homes', file), slug: file.replace(/\.html$/, ''), D }
  })
}
export { expires }

export function readPages() {
  const pages = []
  for (const { slug, D } of loadAll()) {
    if (D.sample) continue
    const listings = (D.listings || []).map((h, i) => ({
      id: homeId(h, i), address: h.address || '', city: h.city || '', price: h.price ?? null,
      photo: h.photo || '', added: h.added || null, time: h.time || null
    }))
    const added = listings.map(h => h.added).filter(Boolean).sort()
    pages.push({
      page: D.page || slug, path: `/homes/${slug}`, mode: D.mode === 'tour' ? 'tour' : 'showcase',
      client: D.client || '', fubId: Number.isInteger(D.fubId) ? D.fubId : null, title: D.title || '', created: D.created || null, date: D.date || null,
      lastAdded: added.length ? added[added.length - 1] : null, expires: expires(D), listings
    })
  }
  return pages
}

export const render = pages => JSON.stringify({ pages }, null, 1) + '\n'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = render(readPages())
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (cur !== out) { console.error('netlify/data/client-pages.json is out of date: run node scripts/build-directory.mjs'); process.exit(1) }
    console.log('client-pages.json is up to date')
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, out)
    console.log(`wrote ${path.relative(root, OUT)} (${JSON.parse(out).pages.length} pages)`)
  }
}
