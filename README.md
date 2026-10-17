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

## Client reactions
`netlify/functions/reactions.mts` (served at `/api/reactions`) saves each client's
Love it / Not for me taps and notes in Netlify Blobs, one entry per page + home.
Each client page sets a fixed `page:` name so its reactions survive URL changes.

## Tests
Run before pushing changes to the template:

```
pip install playwright && python -m playwright install chromium
python3 tests/run.py
```

Checks every `homes/*.html` page on phone, narrow and desktop windows, plus the
fixtures in `tests/fixtures/` (fresh-pick order, expiry, live tour, edge cases,
reactions with a fake API, tile pop-ups). `tests/` and the function source are
blocked from the public site in `_redirects`.
