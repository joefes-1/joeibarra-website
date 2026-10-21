# Joseph Ibarra Real Estate website

Static site on Netlify (joeibarra.com). Every push to `main` publishes.

## Pages
- `index.html` – home page with the free home value form
- `book.html` – book a consultation form
- `homes/` – private client pages (hidden from search engines):
  - `homes/homes.js` + `homes/homes.css` – the shared template. All layout and behavior lives here.
  - `homes/<first-last>.html` – one client's showcase page: just a `window.HOMES` data block (format documented at the top of `homes.js`)
  - `homes/<first-last>-tour.html` – that client's buyer tour page (reused for each new tour)
  - `homes/sample.html`, `homes/tour-sample.html` – examples
- `images/` – headshot, logos, sold-home photos

Form submissions go to Netlify Forms and to the "Website Leads" Google Sheet.

## Private admin page (joeibarra.com/admin)
Password-locked dashboard for Joseph: every client reaction (newest first) and every client page
with its expiry and reaction counts. Data comes from `netlify/functions/admin.mts` (`/api/admin`),
which only answers with the password stored in the Netlify environment variable `ADMIN_PASSWORD`.
The client list is `netlify/data/client-pages.json`, rebuilt from `homes/*.html` by
`scripts/build-directory.mjs` on every deploy (and checked by the tests).

## Client reactions
`netlify/functions/reactions.mts` (served at `/api/reactions`) saves each client's
Love it / Not for me taps and notes in Netlify Blobs, one entry per page + home.
Each client page sets a fixed `page:` name so its reactions survive URL changes.

## Tests
After adding or changing client pages, refresh the directory, then run the tests:

```
node scripts/build-directory.mjs
pip install playwright && python -m playwright install chromium
python3 tests/run.py
```

Checks every `homes/*.html` page on phone, narrow and desktop windows, plus the
fixtures in `tests/fixtures/` (fresh-pick order, expiry, live tour, edge cases,
reactions with a fake API, tile pop-ups, the admin page). `tests/` and the function source are
blocked from the public site in `_redirects`.

## Daily listing refresh
A scheduled Claude task checks every home on active client showcase pages once a day
(tours, samples, expired pages and pages removed from /admin are skipped).
`node scripts/daily-targets.mjs` lists what to check. For each home it updates `price`
(keeping the old one in `was` + `priceChanged` so the card shows "Price drop"), `status`
(pending/sold get flagged on the card and tile) and `openHouses` (past ones hide themselves),
then sets the page's `checked` date. Updates never change `created`/`added`, so they don't
extend a page's 30 days.

## Claude ↔ Follow Up Boss connector
`https://joeibarra.com/mcp` is a private MCP server Joseph adds to Claude as a custom connector.
- Sign-in: OAuth 2.1 (PKCE S256 + dynamic registration, Claude callback URLs only) where the
  login step is the admin password (`netlify/functions/oauth.mts`, `netlify/lib/connector-auth.ts`).
  Tokens are stored hashed in the Blobs store `connector`; /admin has "Disconnect Claude".
- Tools (`netlify/lib/fub-tools.ts`): find_contacts, get_contact, contact_properties, recent_activity,
  my_tasks, my_appointments (read) and add_note, create_appointment, create_task (add only).
  No editing, deleting or sending texts/emails. Times are Pacific.
- Needs `FUB_API_KEY` in Netlify env (Functions scope). Optional `FUB_SYSTEM`/`FUB_SYSTEM_KEY`.
- Tests: `node tests/connector/run.mjs` (also run by `python3 tests/run.py`).

## Leads tab (/admin)
`netlify/functions/leads.mts` (`/api/admin/leads`, admin password) lists Follow Up Boss contacts newest
first with stage/source/added/active/name filters and "Load more". "Make client page" stores a request in
Blobs (`client-admin` → `pagerequests/<personId>`); Claude reads them with the connector's `page_requests`
tool, builds the page, then calls `clear_page_request`.
