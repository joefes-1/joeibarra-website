// Lists what the daily listing refresh should check: every home on a client showcase page
// that hasn't expired yet. Tours and samples are skipped. Pages Joseph removed from /admin
// are NOT known here (that's stored on the live site): the refresh checks each page's
// /api/reactions?page=<page> `removedAt` and skips removed ones.
// Usage: node scripts/daily-targets.mjs [YYYY-MM-DD]   (defaults to today in Pacific time)
import { loadAll, expires } from './build-directory.mjs'

const today = process.argv[2] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
const pages = loadAll()
  .filter(({ D }) => !D.sample && D.mode !== 'tour')
  .map(({ file, slug, D }) => ({ file, page: D.page || slug, expires: expires(D), latestUpdate: [D.created || '', ...(D.listings || []).map(h => h.added || '')].sort().pop(), D }))
  .filter(p => !p.expires || today < p.expires)
  .map(({ file, page, expires, latestUpdate, D }) => ({
    file, page, client: D.client, expires, latestUpdate, checked: D.checked || null,
    listings: (D.listings || []).map(h => ({
      address: h.address, city: h.city, mls: h.mls, price: h.price, was: h.was ?? null,
      priceChanged: h.priceChanged || null, status: h.status || '', openHouses: h.openHouses || []
    }))
  }))
console.log(JSON.stringify({ today, pages }, null, 1))
