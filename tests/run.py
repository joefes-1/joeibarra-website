"""Automatic checks for the client homes pages (homes/*.html + homes/homes.js).

Run from the repo root:   python3 tests/run.py
Needs: pip install playwright && python -m playwright install chromium

Checks every real page in homes/ on a phone (touch), a narrow mouse window and a desktop:
no script errors, no sideways scrolling, no "undefined"/"Invalid Date"/"NaN" text, and every
listing rendered. Then uses the fixtures in tests/fixtures/ to check fresh-pick ordering,
expiry, the live tour, edge cases and the reactions flow (with /api/reactions faked).
Nothing here talks to the real site or saves real reactions.
"""
import asyncio, datetime as dt, functools, glob, http.server, json, os, re, socketserver, subprocess, sys, threading

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS, PASSES = [], 0


def check(cond, msg):
    global PASSES
    if cond:
        PASSES += 1
    else:
        FAILS.append(msg)
        print('  FAIL', msg)


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:%d' % srv.server_address[1]


class FakeApi:
    """In-memory stand-in for /api/reactions, same contract as netlify/functions/reactions.mts."""
    def __init__(self, fail=False):
        self.db, self.fail = {}, fail

    async def handle(self, route):
        req = route.request
        if self.fail and req.method == 'POST':
            return await route.fulfill(status=500, body='{}')
        if req.method == 'GET':
            page = re.search(r'page=([^&]*)', req.url).group(1)
            out = {k.split('/', 1)[1]: v for k, v in self.db.items() if k.startswith(page + '/')}
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'reactions': out}))
        b = json.loads(req.post_data)
        key = b['page'] + '/' + b['home']
        if not b['r'] and not b.get('note'):
            self.db.pop(key, None)
            return await route.fulfill(status=200, content_type='application/json', body='{"ok":true,"reaction":null}')
        v = {'r': b['r'], 'note': b.get('note', ''), 'at': '2026-10-16T20:00:00Z'}
        self.db[key] = v
        return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'reaction': v}))


async def open_page(browser, base, path, when=None, device='desktop', api=None):
    opts = {'desktop': dict(viewport={'width': 1280, 'height': 900}),
            'mouse-narrow': dict(viewport={'width': 390, 'height': 844}),
            'phone': dict(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)}[device]
    ctx = await browser.new_context(**opts)
    page = await ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    api = api or FakeApi()
    await page.route('**/api/reactions**', api.handle)
    await page.route(lambda u: not u.startswith(base), lambda r: r.abort())   # no outside requests (listing photos, fonts)
    await page.clock.set_fixed_time(when or dt.datetime(2026, 10, 16, 18, 0))
    await page.goto(base + path)
    await page.wait_for_timeout(300)
    return page


async def text(page):
    # lower-cased: some labels are shown in capitals by CSS
    return (await page.evaluate("document.getElementById('app').innerText")).lower()


async def real_pages(browser, base):
    print('Real pages (every homes/*.html, phone + narrow mouse window + desktop)')
    for f in sorted(glob.glob(os.path.join(ROOT, 'homes', '*.html'))):
        name = os.path.basename(f)
        src = open(f).read()
        listings = len(re.findall(r'^\s*address:', src, re.M))
        for device in ('phone', 'mouse-narrow', 'desktop'):
            p = await open_page(browser, base, '/homes/' + name, device=device)
            t = await text(p)
            check(not p.errors, f'{name} [{device}] script errors: {p.errors}')
            if 'expired' in t or 'wrapped up' in t:   # page already past its date; nothing else to check
                await p.context.close(); continue
            wide = await p.evaluate('document.documentElement.scrollWidth - innerWidth')
            check(wide <= 0, f'{name} [{device}] scrolls sideways by {wide}px')
            bad = re.findall(r'undefined|invalid date|\bnan\b', t)
            check(not bad, f'{name} [{device}] shows {set(bad)}')
            shown = await p.evaluate("document.querySelectorAll('#app .home:not(.tile-pop .home), #app .tile').length")
            check(shown == listings, f'{name} [{device}] shows {shown} homes, expected {listings}')
            await p.context.close()


async def fresh_picks(browser, base):
    print('Fresh picks: order, batch headers, past-pick grid, expiry reset')
    p = await open_page(browser, base, '/tests/fixtures/fresh.html', dt.datetime(2026, 10, 21, 10, 0))
    order = await p.evaluate("""[...document.querySelectorAll('#app .group-head, #app .home:not(.tile-pop .home), #app .tile')]
        .map(e=>e.classList.contains('group-head') ? '# '+e.innerText.replace(/\\n/g,' ') : e.querySelector('.addr, .tile-addr').childNodes[0].textContent)""")
    want = ['# FRESH PICKS Added Tue, Oct 20 at 4:40 PM', '5 Fresh Ave', '# FRESH PICKS Added Tue, Oct 20 at 9:15 AM', '4 Fresh Ave',
            '# FRESH PICKS Added Sun, Oct 18', '3 Fresh Ave', '# PAST PICKS Sent Fri, Oct 16', '1 Original Ln', '2 Original Ln']
    check(order == want, f'fresh-pick order wrong:\n    got  {order}\n    want {want}')
    check(await p.evaluate("document.querySelectorAll('.past-grid .tile').length") == 2, 'originals should be 2 past-pick tiles')
    check(await p.evaluate("document.querySelectorAll('.fresh-pill').length") == 3, 'each fresh pick should have a Fresh pick tag')
    await p.context.close()
    for when, expired in [((2026, 11, 18, 23, 59), False), ((2026, 11, 19, 0, 1), True)]:   # newest add Oct 20 + 30 days
        p = await open_page(browser, base, '/tests/fixtures/fresh.html', dt.datetime(*when))
        check(('this page has expired' in await text(p)) == expired, f'fresh fixture at {when}: expired should be {expired}')
        await p.context.close()


async def tours(browser, base):
    print('Tours: live stop, shutoff 2 days after (even with no created date)')
    p = await open_page(browser, base, '/tests/fixtures/tour.html', dt.datetime(2026, 10, 17, 10, 40))
    states = await p.evaluate("[...document.querySelectorAll('.home')].map(e=>e.classList.contains('now')?'now':e.classList.contains('done')?'done':'-')")
    check(states == ['done', 'now', '-'], f'tour at 10:40 should be done/now/-, got {states}')
    await p.context.close()
    for when, ended in [((2026, 10, 19, 23, 59), False), ((2026, 10, 20, 0, 1), True)]:
        p = await open_page(browser, base, '/tests/fixtures/tour.html', dt.datetime(*when))
        check(('thanks for coming out' in await text(p)) == ended, f'tour at {when}: wrapped-up should be {ended}')
        await p.context.close()
    p = await open_page(browser, base, '/tests/fixtures/tour-nodate.html')
    t = await text(p)
    check('invalid date' not in t and not p.errors, 'tour with no date should render without "Invalid Date"')
    await p.context.close()


async def edge_cases(browser, base):
    print('Edge cases: missing fields, unsafe links, empty page')
    p = await open_page(browser, base, '/tests/fixtures/edge.html')
    t = await text(p)
    check('undefined' not in t and not p.errors, f'edge fixture shows "undefined" or errors: {p.errors}')
    links = await p.evaluate("[...document.querySelectorAll('#app a')].map(a=>a.getAttribute('href'))")
    check(not any('undefined' in (l or '') for l in links), 'a map link contains "undefined"')
    check(not any((l or '').lower().startswith('javascript:') for l in links), 'javascript: link got through')
    srcs = await p.evaluate("[...document.querySelectorAll('#app img')].map(i=>i.getAttribute('src'))")
    check(not any((s or '').lower().startswith('javascript:') for s in srcs), 'javascript: photo got through')
    ids = await p.evaluate("[...document.querySelectorAll('.home[data-home]')].map(e=>e.dataset.home)")
    check(all(ids) and len(set(ids)) == len(ids), f'every home needs its own id, got {ids}')
    await p.context.close()
    p = await open_page(browser, base, '/tests/fixtures/empty.html')
    t = await text(p)
    check('no homes here yet' in t and '0 homes' not in t, 'empty page should show a friendly message')
    await p.context.close()


async def reactions(browser, base):
    print('Reactions: love, note, edit, undo keeps note, grey-out, error rollback, saved for the next viewer')
    api = FakeApi()
    p = await open_page(browser, base, '/tests/fixtures/fresh.html', dt.datetime(2026, 10, 21, 10, 0), api=api)
    F = '.home.is-fresh >> nth=0'
    card = p.locator(F)
    check(await card.locator('.react-note').is_hidden(), 'note box should be hidden before a tap')
    await card.locator('.react-btn[data-r=love]').click(); await p.wait_for_timeout(150)
    check(await card.locator('.react-note').is_visible(), 'note box should appear after Love it')
    await card.locator('.react-note input').fill('Great yard'); await card.locator('.react-note button').click(); await p.wait_for_timeout(150)
    check(api.db.get('test-fresh/' + await card.get_attribute('data-home'), {}).get('note') == 'Great yard', 'note should be saved')
    check('Great yard' in await card.locator('.react-said').inner_text(), 'saved note should show as a quote')
    await card.locator('.react-edit').click()
    await card.locator('.react-note input').fill('Great yard and kitchen'); await card.locator('.react-note input').press('Enter'); await p.wait_for_timeout(150)
    check('kitchen' in await card.locator('.react-said').inner_text(), 'edited note should replace the old one')
    await card.locator('.react-btn[data-r=love]').click(); await p.wait_for_timeout(150)      # undo
    saved = api.db.get('test-fresh/' + await card.get_attribute('data-home'), {})
    check(saved.get('r') == '' and 'kitchen' in saved.get('note', ''), f'undoing Love it should keep the note, got {saved}')
    await card.locator('.react-edit').click(); await p.wait_for_timeout(150)                # note kept, no reaction: Edit still opens the box
    check(await card.locator('.react-note').is_visible(), 'Edit should open the note box even with no Love it / Not for me selected')
    await card.locator('.react-note input').fill('Changed my mind'); await card.locator('.react-note input').press('Enter'); await p.wait_for_timeout(150)
    check('Changed my mind' in await card.locator('.react-said').inner_text() and await card.locator('.react-note').is_hidden(),
          'saving an edit with no reaction should show the new note and close the box')
    await card.locator('.react-btn[data-r=pass]').click(); await p.wait_for_timeout(150)
    check('grayscale' in await card.locator('.photo img').evaluate('e=>getComputedStyle(e).filter'), 'Not for me should grey out the photo')
    await p.context.close()
    # next visitor (Joseph) sees it
    p = await open_page(browser, base, '/tests/fixtures/fresh.html', dt.datetime(2026, 10, 21, 10, 0), api=api)
    check(await p.locator('.home.is-fresh >> nth=0').get_attribute('class') and 'rx-pass' in await p.locator('.home.is-fresh >> nth=0').get_attribute('class'),
          'a reaction should show for the next person who opens the page')
    await p.context.close()
    # save fails -> rolls back and shows the error
    p = await open_page(browser, base, '/tests/fixtures/fresh.html', dt.datetime(2026, 10, 21, 10, 0), api=FakeApi(fail=True))
    c = p.locator('.home.is-fresh >> nth=0')
    await c.locator('.react-btn[data-r=love]').click(); await p.wait_for_timeout(200)
    check(await c.locator('.react-err').is_visible(), 'failed save should show the error message')
    check(await c.locator('.react-btn[data-r=love]').get_attribute('aria-pressed') == 'false', 'failed save should undo the button')
    await p.context.close()


async def tiles(browser, base):
    print('Past-pick tiles: hover pop-up stays on screen, tap opens/closes on phones')
    p = await open_page(browser, base, '/tests/fixtures/fresh.html', dt.datetime(2026, 10, 21, 10, 0))
    for i in range(2):
        t = p.locator('.tile').nth(i)
        await t.scroll_into_view_if_needed(); await t.hover(); await p.wait_for_timeout(350)
        box = await t.locator('.tile-pop').bounding_box()
        vw, vh = await p.evaluate('[innerWidth, innerHeight]')
        check(box['x'] >= 0 and box['x'] + box['width'] <= vw and box['y'] >= 0 and box['y'] + box['height'] <= vh, f'hover pop-up {i} goes off screen: {box}')
    await p.context.close()
    p = await open_page(browser, base, '/tests/fixtures/fresh.html', dt.datetime(2026, 10, 21, 10, 0), device='phone')
    t = p.locator('.tile').first
    await t.tap(); await p.wait_for_timeout(300)
    check('open' in await t.get_attribute('class'), 'tapping a tile should open it')
    await t.locator('.tile-close').tap(); await p.wait_for_timeout(200)
    check('open' not in await t.get_attribute('class'), 'Close should collapse the tile')
    await p.context.close()


async def directory(browser, base):
    print('Admin directory: up to date with homes/*.html, expiry dates match the pages')
    r = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'build-directory.mjs'), '--check'], capture_output=True, text=True)
    check(r.returncode == 0, 'netlify/data/client-pages.json is out of date: run node scripts/build-directory.mjs')
    pages = json.load(open(os.path.join(ROOT, 'netlify', 'data', 'client-pages.json')))['pages']
    files = {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(ROOT, 'homes', '*.html'))
             if 'sample: true' not in open(f).read()}
    check({p['path'].split('/')[-1] for p in pages} == files, 'directory should list every non-sample client page')
    # the page itself must switch off on the directory's expiry date
    for p in pages:
        if not p['expires']:
            continue
        y, m, d = map(int, p['expires'].split('-'))
        before = dt.datetime(y, m, d) - dt.timedelta(minutes=1)
        for when, off in [(before, False), (dt.datetime(y, m, d, 0, 1), True)]:
            pg = await open_page(browser, base, p['path'] + '.html', when)
            t = await text(pg)
            check((('this page has expired' in t) or ('thanks for coming out' in t)) == off,
                  f"{p['page']} at {when}: directory says expires {p['expires']}, page disagrees")
            await pg.context.close()


ADMIN_DATA = {
    'pages': [
        {'page': 'test-fresh', 'path': '/tests/fixtures/fresh', 'mode': 'showcase', 'client': 'Tess', 'created': '2026-10-16',
         'date': None, 'lastAdded': '2026-10-20T16:40', 'expires': '2026-11-19',
         'listings': [{'id': 'A1', 'address': '1 Original Ln', 'price': 1000000, 'photo': '/images/willow.jpg'},
                      {'id': 'B2', 'address': '3 Fresh Ave', 'price': 1200000, 'photo': '/images/el-paso.jpg'}]},
        {'page': 'test-tour', 'path': '/tests/fixtures/tour', 'mode': 'tour', 'client': 'Tess', 'created': None,
         'date': '2026-10-17', 'lastAdded': None, 'expires': '2026-10-20', 'listings': [{'id': 'C3', 'address': '1 Stop Rd'}]},
        {'page': 'test-old', 'path': '/tests/fixtures/edge', 'mode': 'showcase', 'client': 'Old', 'created': '2026-09-01',
         'date': None, 'lastAdded': None, 'expires': '2026-10-01', 'listings': []},
    ],
    'reactions': {
        'test-fresh': {'A1': {'r': 'love', 'note': 'Love the yard', 'at': '2026-10-21T17:00:00Z'},
                       'B2': {'r': 'pass', 'note': '', 'at': '2026-10-21T18:30:00Z'}},
        'zz-live-test': {'X': {'r': 'love', 'note': '', 'at': '2026-10-21T19:00:00Z'}},   # not a client page: must be skipped
    },
}


async def admin(browser, base):
    print('Admin page: locked without the password, shows reactions + pages when unlocked')
    async def page_with(status, body=None, stored=None):
        ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        if stored:
            await ctx.add_init_script("localStorage.setItem('joeibarra-admin-key', %s)" % json.dumps(stored))
        pg = await ctx.new_page()
        pg.errors = []
        pg.on('pageerror', lambda e: pg.errors.append(str(e)))
        seen = []
        async def handle(route):
            seen.append(route.request.headers.get('authorization'))
            await route.fulfill(status=status, content_type='application/json', body=json.dumps(body or {}))
        await pg.route('**/api/admin', handle)
        await pg.route(lambda u: not u.startswith(base), lambda r: r.abort())
        await pg.clock.set_fixed_time(dt.datetime(2026, 10, 22, 9, 0))
        await pg.goto(base + '/admin.html')
        await pg.wait_for_timeout(300)
        pg.seen = seen
        return pg
    # no password saved: login form, nothing private on screen
    pg = await page_with(401)
    check(await pg.locator('#pw').is_visible(), 'admin should ask for the password first')
    check('Tess' not in await pg.inner_text('body'), 'admin must not show client data before unlocking')
    await pg.fill('#pw', 'test-password'); await pg.click('#login button'); await pg.wait_for_timeout(200)
    check(pg.seen[-1] == 'Bearer test-password', f'admin should send the password as a Bearer token, sent {pg.seen[-1]}')
    check('didn’t work' in await pg.inner_text('body'), 'wrong password should say so')
    await pg.context.close()
    # unlocked
    pg = await page_with(200, ADMIN_DATA, stored='test-password')
    body = await pg.inner_text('body')
    check(not pg.errors, f'admin script errors: {pg.errors}')
    feed = await pg.evaluate("[...document.querySelectorAll('.rx .rx-what')].map(e=>e.textContent)")
    check(len(feed) == 2 and 'Not for Tess' in feed[0] and 'Tess loved it' in feed[1], f'feed should be newest first and skip test pages, got {feed}')
    check('Love the yard' in body, 'notes should show in the feed')
    names = await pg.evaluate("[...document.querySelectorAll('.panel .pg .pg-name')].map(e=>e.textContent)")
    check(len(names) == 1, f'only unexpired pages under Active, got {names}')
    check('Live through Nov 18' in body, 'page card should show its last live day')
    check(await pg.locator('details.expired').count() == 1, 'expired pages should be tucked into their own section')
    wide = await pg.evaluate('document.documentElement.scrollWidth - innerWidth')
    check(wide <= 0, f'admin scrolls sideways on a phone by {wide}px')
    link = await pg.locator('.copy').first.get_attribute('data-link')
    check(link and not link.endswith('.html'), f'copied links should not end in .html, got {link}')
    await pg.context.close()
    # setup message when the password hasn't been added in Netlify yet
    pg = await page_with(503, {'error': 'setup'}, stored='x')
    check('ADMIN_PASSWORD' in await pg.inner_text('body'), 'admin should explain when the password is not set up yet')
    await pg.context.close()


async def main():
    base = serve()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        for suite in (real_pages, fresh_picks, tours, edge_cases, reactions, tiles, directory, admin):
            await suite(browser, base)
        await browser.close()
    print('\n%d checks passed, %d failed' % (PASSES, len(FAILS)))
    sys.exit(1 if FAILS else 0)


asyncio.run(main())
