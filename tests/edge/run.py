"""Edge-case browser tests for the client homes pages, using the fake clients in tests/edge/fixtures/.
Run from the repo root:   python3 tests/edge/run.py      (also runs node tests/edge/run.mjs at the end)
Needs: pip install playwright && python -m playwright install chromium

Same setup as tests/run.py: a local static server, /api/reactions and /api/admin faked in the browser,
every outside request blocked, the clock pinned. Nothing talks to the real site, FUB, or Netlify.

check(): must pass.  bug(): documents a known problem; it is listed as KNOWN BUG and does not fail the run
until it's fixed (then it prints FIXED? so it can be turned into a plain check).
"""
import asyncio, datetime as dt, functools, glob, http.server, json, os, re, socketserver, subprocess, sys, threading

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FX = '/tests/edge/fixtures/'
FAILS, KNOWN, PASSES = [], [], 0
NOW = dt.datetime(2026, 10, 21, 15, 0)      # Wed Oct 21 2026, 3pm Pacific


def check(cond, msg):
    global PASSES
    if cond:
        PASSES += 1
    else:
        FAILS.append(msg); print('  FAIL', msg)


def bug(cond, msg):
    global PASSES
    if cond:
        PASSES += 1; print('  FIXED? (now passes)', msg)
    else:
        KNOWN.append(msg)


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:%d' % srv.server_address[1]


PAGE_RE, HOME_RE = re.compile(r'^[a-z0-9-]{1,80}$'), re.compile(r'^[A-Za-z0-9-]{1,60}$')


class FakeApi:
    """/api/reactions stand-in with the same validation as netlify/functions/reactions.mts."""
    def __init__(self, fail=False, removed_at=None, delay=0, db=None):
        self.db, self.fail, self.removed_at, self.delay, self.posts = dict(db or {}), fail, removed_at, delay, []

    async def handle(self, route):
        req = route.request
        if req.method == 'GET':
            from urllib.parse import unquote
            page = unquote(re.search(r'page=([^&]*)', req.url).group(1))
            if not PAGE_RE.match(page):
                return await route.fulfill(status=400, content_type='application/json', body='{"error":"Bad page"}')
            out = {k.split('/', 1)[1]: v for k, v in self.db.items() if k.startswith(page + '/')}
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'reactions': out, 'removedAt': self.removed_at, 'tourPicks': []}))
        b = json.loads(req.post_data); self.posts.append(b)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            return await route.fulfill(status=500, body='{}')
        if not PAGE_RE.match(b.get('page', '')) or not HOME_RE.match(b.get('home', '')) or b.get('r') not in ('love', 'pass', ''):
            return await route.fulfill(status=400, content_type='application/json', body='{"error":"Bad request"}')
        key, note = b['page'] + '/' + b['home'], (b.get('note') or '').strip()[:300]
        if not b['r'] and not note:
            self.db.pop(key, None)
            return await route.fulfill(status=200, content_type='application/json', body='{"ok":true,"reaction":null}')
        v = {'r': b['r'], 'note': note, 'at': '2026-10-21T20:00:00Z'}
        self.db[key] = v
        await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'reaction': v}))


DEVICES = {
    'phone360': dict(viewport={'width': 360, 'height': 740}, has_touch=True, is_mobile=True),
    'phone': dict(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True),
    'tablet': dict(viewport={'width': 768, 'height': 1024}, has_touch=True, is_mobile=True),
    'desktop': dict(viewport={'width': 1280, 'height': 900}),
}


async def open_page(browser, base, name, when=None, device='desktop', api=None, owner=False, tz=None, init=None, ctx_opts=None):
    opts = dict(DEVICES[device]); opts.update(ctx_opts or {})
    if tz: opts['timezone_id'] = tz
    ctx = await browser.new_context(**opts)
    if owner: await ctx.add_init_script("localStorage.setItem('joeibarra-admin-key','test-password')")
    if init: await ctx.add_init_script(init)
    page = await ctx.new_page()
    page.errors, page.warnings = [], []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.on('console', lambda m: page.warnings.append(m.text) if m.type == 'warning' else None)
    page.api = api or FakeApi()
    await page.route('**/api/reactions**', page.api.handle)
    await page.route('**/api/admin', lambda r: r.fulfill(status=200, content_type='application/json', body='{"ok":true}'))
    await page.route(lambda u: not u.startswith(base), lambda r: r.abort())
    await page.clock.set_fixed_time(when or NOW)
    await page.goto(base + (name if name.startswith('/') else FX + name + '.html'))
    await page.wait_for_timeout(300)
    return page


async def text(p):
    return (await p.evaluate("document.getElementById('app').innerText")).lower()


async def ev(p, js):
    return await p.evaluate(js)


# ---------------------------------------------------------------- every fixture, every size
async def all_fixtures(browser, base):
    print('Every fake client page at 360 / 390 / 768 / 1280: no errors, no sideways scroll, no undefined/NaN/Invalid Date')
    names = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(HERE, 'fixtures', '*.html')))
    overflow = {}
    for name in names:
        for device in ('phone360', 'phone', 'tablet', 'desktop'):
            p = await open_page(browser, base, name, device=device)
            t = await text(p)
            check(not p.errors, f'{name} [{device}] script errors: {p.errors}')
            xss = await ev(p, 'window.__xss || null')
            check(not xss, f'{name} [{device}] injected script ran: {xss}')
            wide = await ev(p, 'document.documentElement.scrollWidth - innerWidth')
            if wide > 0: overflow.setdefault(name, []).append(f'{device}+{wide}px')
            bad = sorted(set(re.findall(r'undefined|invalid date|\bnan\b|\[object object\]', t)))
            if name != 'tst-missing':
                check(not bad, f'{name} [{device}] shows {bad}')
            await p.context.close()
    for name in names:
        if name in ('tst-long', 'tst-long-tour', 'tst-longurl'): continue
        check(name not in overflow, f'{name} scrolls sideways: {overflow.get(name)}')
    check('tst-longurl' not in overflow, f'a long listing URL in the intro note or a why does not make the page scroll sideways: {overflow.get("tst-longurl")}')
    bug('tst-long' not in overflow and 'tst-long-tour' not in overflow,
        f'one very long word (client name/title/address/note/why) makes the page scroll sideways: {overflow.get("tst-long")} / {overflow.get("tst-long-tour")}')


# ---------------------------------------------------------------- XSS / escaping
async def escaping(browser, base):
    print('Script injection: every field is escaped')
    for name in ('tst-xss', 'tst-xss-tour', 'tst-names'):
        for device in ('desktop', 'phone'):
            p = await open_page(browser, base, name, device=device)
            if device == 'phone':      # open every tile so the cards render
                for t in await p.locator('.tile:not(.is-unavailable)').all():
                    await t.click(position={'x': 10, 'y': 10}); await p.wait_for_timeout(50)
            else:
                for t in await p.locator('.tile:not(.is-unavailable)').all():
                    await t.hover(); await p.wait_for_timeout(50)
            await p.wait_for_timeout(200)
            xss = await ev(p, 'window.__xss || null')
            injected = await ev(p, "document.querySelectorAll('#app img[src=\"x\"], #app svg[onload]').length")
            check(not xss and not injected, f'{name} [{device}]: injected markup rendered/ran: {xss} {injected}')
            await p.context.close()
    p = await open_page(browser, base, 'tst-xss')
    hrefs = await ev(p, "[...document.querySelectorAll('#app a, #app img')].map(a=>a.getAttribute('href')||a.getAttribute('src'))")
    check(not any((h or '').lower().startswith('javascript:') for h in hrefs), 'no javascript: links/photos')
    bug(not any((h or '').startswith('//') for h in hrefs), f'safeUrl() lets protocol-relative links through (//evil.example/...): {[h for h in hrefs if (h or "").startswith("//")]}')
    await p.context.close()
    # notes coming back from the server with markup (another viewer, or Joseph's view-only)
    api = FakeApi(db={'tst-names/TST0001': {'r': 'love', 'note': '<img src=x onerror="window.__xss=[\'note\']"> & “quotes” 😍', 'at': '2026-10-21T20:00:00Z'}})
    for owner in (False, True):
        p = await open_page(browser, base, 'tst-names', api=api, owner=owner)
        await p.locator('.tile').first.hover(); await p.wait_for_timeout(200)
        said = await p.locator('.tile').first.locator('.react-said').inner_text()
        check(not await ev(p, 'window.__xss || null') and '<img src=x' in said and '😍' in said, f'stored note with markup shows as text (owner={owner}): {said!r}')
        badge = await p.locator('.tile').first.locator('.tile-photo .react-badge').get_attribute('title')
        check(badge == "D'Angelo José Zoë 🏡 loved it", f'badge with apostrophe/accents/emoji: {badge!r}')
        await p.context.close()


# ---------------------------------------------------------------- showcase data cases
async def showcase(browser, base):
    print('Showcase: 40 homes, filter counts, numbers, status, price changes, fresh batches')
    p = await open_page(browser, base, 'tst-forty')
    nums = await ev(p, "[...document.querySelectorAll('#app .tile')].map(t=>+t.querySelector('.tile-num').textContent)")
    check(len(nums) == 39 and len(set(nums)) == 39 and 5 not in nums and max(nums) == 40, f'39 homes, unique numbers, #5 stays retired: {sorted(nums)}')
    addr_num = await ev(p, "Object.fromEntries([...document.querySelectorAll('#app .tile')].map(t=>[t.querySelector('.tile-addr').textContent, +t.querySelector('.tile-num').textContent]))")
    check(all(addr_num['%d Testy Ln' % n] == n for n in range(1, 35) if n != 5) and sorted(addr_num['%d Testy Ln' % n] for n in range(35, 41)) == list(range(35, 41)), 'originals keep their numbers (pinned after the removed #5), fresh picks count on from 35')
    labels = await ev(p, "[...document.querySelectorAll('.origin-filter button')].map(b=>b.textContent)")
    saved = sum(1 for n in range(1, 41) if n != 5 and n % 3 == 0)
    check(labels == ['All 39', 'You saved %d' % saved, 'From Joseph %d' % (39 - saved)], f'filter counts: {labels}')
    heads = await ev(p, "[...document.querySelectorAll('.group-head')].map(h=>h.innerText.replace(/\\n/g,' '))")
    check(heads == ['FRESH PICKS Added Tue, Oct 20 at 5:45 PM', 'FRESH PICKS Added Tue, Oct 20 at 8:00 AM', 'FRESH PICKS Added Sun, Oct 18', 'PAST PICKS Sent Fri, Oct 16'], f'fresh batches newest first, times only when 2 batches share a day: {heads}')
    flags = await ev(p, "Object.fromEntries([...document.querySelectorAll('.tile')].filter(t=>t.querySelector('.tile-status')).map(t=>[t.querySelector('.tile-addr').textContent, t.className.match(/is-(pending|sold|off)/)[1] + (t.classList.contains('is-unavailable')?'/gone':'')]))")
    check(flags == {'7 Testy Ln': 'pending', '8 Testy Ln': 'sold/gone', '9 Testy Ln': 'off/gone', '11 Testy Ln': 'pending'}, f'status flags (Back on market = active, Active Under Contract = pending): {flags}')
    tags = await ev(p, "[...document.querySelectorAll('.price-tag')].map(e=>e.textContent)")
    check(sorted(tags) == ['Price drop Oct 17', 'Price up Oct 19'], f'drop then back up: {tags}')
    await p.click('.origin-filter [data-origin=saved]'); await p.wait_for_timeout(100)
    vis = await ev(p, "[...document.querySelectorAll('#app .tile')].filter(t=>!t.hidden).length")
    check(vis == saved, f'"You saved" shows {saved}, got {vis}')
    # a pinned number lower than an unpinned home's -> duplicate numbers?
    await p.context.close()
    p = await browser.new_page()
    async def dup(route):
        html = open(os.path.join(HERE, 'fixtures', 'tst-one.html'), encoding='utf-8').read()
        html = html.replace('"listings": [', '"listings": [ {"address": "0 Unpinned Ct", "mls": "TSTPIN", "price": 1},', 1).replace('"saved": true', '"saved": true, "num": 1')
        await route.fulfill(status=200, content_type='text/html', body=html)
    await p.route('**/tst-one.html', dup); await p.route('**/api/**', FakeApi().handle)
    await p.route(lambda u: not u.startswith(base), lambda r: r.abort()); await p.clock.set_fixed_time(NOW)
    await p.goto(base + FX + 'tst-one.html'); await p.wait_for_timeout(300)
    nums = await ev(p, "[...document.querySelectorAll('.tile-num')].map(e=>e.textContent)")
    bug(len(set(nums)) == len(nums), f'a pinned `num` placed before unpinned homes gives two homes the same number: {nums}')
    await p.close()

    p = await open_page(browser, base, 'tst-one')
    check('1 home to look through' in await text(p) and await p.locator('.tile-saved').count() == 0, '1 home: singular, no filter, no "You saved" tag')
    await p.context.close()
    p = await open_page(browser, base, 'tst-allsaved')
    check(await p.locator('.origin-filter').count() == 0, 'all saved: no filter')
    await p.context.close()
    p = await open_page(browser, base, 'tst-empty')
    t = await text(p)
    check('no homes here yet' in t and '0 homes' not in t, 'empty page message')
    await p.context.close()

    print('Open houses: past / ongoing / future / crossing midnight / no end')
    p = await open_page(browser, base, 'tst-openhouse', dt.datetime(2026, 10, 21, 15, 0))
    oh = await ev(p, "[...document.querySelectorAll('.tile-pop .open-house')].map(e=>e.closest('.home').querySelector('.addr').childNodes[0].textContent + ' | ' + e.textContent)")
    check(any(s.startswith('1 Testy Ln | Open house Wed, Oct 21, 1 to 4 PM · Sun, Oct 25, 11 AM to 2 PM') for s in oh), f'yesterday hidden, ongoing + future shown: {oh}')
    bug(any(s.startswith('2 Testy Ln') for s in oh), f'open house 10pm-1am (crosses midnight) is hidden before it even starts (end read as 1am the same day): {oh}')
    check(any(s.startswith('3 Testy Ln | Open house Wed, Oct 21, 6 PM · Thu, Oct 22') for s in oh), f'no end / no start time: {oh}')
    check(any('open house without a YYYY-MM-DD date' in w for w in p.warnings), 'bad open-house date warns in the console')
    await p.context.close()
    p = await open_page(browser, base, 'tst-openhouse', dt.datetime(2026, 10, 21, 23, 0))
    oh = await ev(p, "[...document.querySelectorAll('.tile-pop .open-house')].map(e=>e.textContent)")
    bug(any('10 PM to 1 AM' in s for s in oh), f'at 11pm, during the 10pm-1am open house, it is not shown: {oh}')
    await p.context.close()

    print('Missing fields, Zillow vs RealScout, odd values')
    p = await open_page(browser, base, 'tst-missing', device='phone')
    t = await text(p)
    check('undefined' not in t and 'invalid date' not in t, 'no undefined with missing fields')
    bug('nan' not in re.findall(r'\bnan\b', t), 'sqft typed as "1,850" shows "NaN sq ft"')
    for tl in await p.locator('.tile').all():
        await tl.click(position={'x': 10, 'y': 10}); await p.wait_for_timeout(30)
    hints = await ev(p, "Object.fromEntries([...document.querySelectorAll('.tile-pop .home')].map(h=>[h.querySelector('.addr').childNodes[0]?.textContent||'(none)', (h.querySelector('.photo-hint')||{}).textContent || ([...h.querySelectorAll('.actions a')].find(a=>/full listing/i.test(a.textContent))||{}).textContent || '-']))")
    check(hints.get('3 Zillow Rd', '').startswith('View on Zillow') and hints.get('4 Realscout Rd', '').startswith('See full listing')
          and hints.get('1 Nophoto Rd', '').startswith('Full listing') and hints.get('2 Nourl Rd') == '-', f'photo-link hints: {hints}')
    ids = await ev(p, "[...document.querySelectorAll('.tile')].map(t=>t.dataset.home)")
    bug(len(set(ids)) == len(ids), f'two listings with the same address and no mls share a home id: {ids}')
    # reacting to one of the duplicates marks both
    d1 = p.locator('.tile[data-home="7-Dupe-Rd"]').nth(0)
    await d1.locator('.tile-pop .react-btn[data-r=love]').click(); await p.wait_for_timeout(200)
    both = await ev(p, "[...document.querySelectorAll('.tile[data-home=\"7-Dupe-Rd\"]')].map(t=>t.classList.contains('rx-love'))")
    bug(both == [True, False], f'Love it on one "7 Dupe Rd" also marks the other one: {both}')
    await p.context.close()

    print('Expiry')
    for name, when, off in [('tst-expiry', dt.datetime(2026, 10, 7, 23, 59), False), ('tst-expiry', dt.datetime(2026, 10, 8, 0, 0), True)]:
        p = await open_page(browser, base, name, when)
        check(('this page has expired' in await text(p)) == off, f'{name} at {when}: expired should be {off}')
        await p.context.close()
    p = await open_page(browser, base, 'tst-expiry-str', dt.datetime(2026, 10, 21, 9, 0))
    bug('this page has expired' in await text(p), 'expiresDays: "10" (string) -> page stays live until Jan 2027 instead of Oct 11 ("1"+"10" day math)')
    await p.context.close()
    # exactly 30 days, no expiresDays
    p = await open_page(browser, base, 'tst-one', dt.datetime(2026, 11, 15, 0, 0))
    check('this page has expired' in await text(p), 'created Oct 16: expired at midnight starting Nov 15 (30 days)')
    await p.context.close()
    p = await open_page(browser, base, 'tst-one', dt.datetime(2026, 11, 14, 23, 59))
    check('this page has expired' not in await text(p), '...and still live at 11:59pm Nov 14')
    await p.context.close()

    print('Zillow-heart tip')
    for name, want in [('tst-names', True), ('tst-nofub', False), ('tst-tour-one', False)]:
        p = await open_page(browser, base, name)
        check((await p.locator('.zillow-tip').count() == 1) == want, f'{name}: Zillow tip {want}')
        await p.context.close()
    p = await open_page(browser, base, 'tst-fubstr')
    bug(await p.locator('.zillow-tip').count() == 0, 'fubId as a string shows the Zillow-heart tip, but the directory drops the id, so saves/notes never sync to FUB')
    await p.context.close()


# ---------------------------------------------------------------- removal timing
async def removal(browser, base):
    print('Removed from /admin: before/after the latest update')
    cases = [('tst-forty', '2026-10-21T01:00:00Z', True, 'removed after the newest fresh pick'),
             ('tst-forty', '2026-10-20T10:00:00Z', False, 'a fresh pick was added after the removal'),
             ('tst-tour-removed', '2026-10-24T16:00:00Z', True, 'tour removed on tour day')]
    for name, at, gone, why in cases:
        p = await open_page(browser, base, name, api=FakeApi(removed_at=at))
        check(('this page is no longer available' in await text(p)) == gone, f'{name}: {why} -> removed {gone}')
        await p.context.close()
    # removedAt is UTC, `added` is Pacific wall time: added at 5:45pm Oct 20 Pacific (00:45Z Oct 21);
    # a removal at 5:00pm Pacific (00:00Z Oct 21) happened BEFORE the add, so the page should come back
    p = await open_page(browser, base, 'tst-forty', api=FakeApi(removed_at='2026-10-21T00:00:00Z'))
    bug('this page is no longer available' not in await text(p), 'removal at 5pm Pacific, fresh pick added 5:45pm Pacific: page stays removed (UTC removedAt compared with Pacific `added`)')
    await p.context.close()
    # re-sending the same day: Joseph removes at 9am, then sets created to today at noon to re-send
    p = await browser.new_page()
    async def resend(route):
        html = open(os.path.join(HERE, 'fixtures', 'tst-one.html'), encoding='utf-8').read().replace('"created": "2026-10-16"', '"created": "2026-10-21"')
        await route.fulfill(status=200, content_type='text/html', body=html)
    await p.route('**/tst-one.html', resend); await p.route('**/api/reactions**', FakeApi(removed_at='2026-10-21T16:00:00Z').handle)
    await p.route(lambda u: not u.startswith(base), lambda r: r.abort()); await p.clock.set_fixed_time(NOW)
    await p.goto(base + FX + 'tst-one.html'); await p.wait_for_timeout(300)
    bug('this page is no longer available' not in await text(p), 're-sending a removed page the same day (new `created` = today) does not bring it back (date-only created < same-day removedAt)')
    await p.close()


# ---------------------------------------------------------------- tours
async def tours(browser, base):
    print('Tours: calendar links, ordering, DST, evening/early, missing times, homes link')
    async def gcal(name, when=None):
        p = await open_page(browser, base, name, when or dt.datetime(2026, 10, 21, 9, 0))
        g = await ev(p, "(document.querySelector('.cal-menu a[href*=\"calendar.google\"]')||{}).href || ''")
        ics = await ev(p, "(document.querySelector('.cal-menu a[href$=\".ics\"]')||{}).href || ''")
        return p, g, ics
    p, g, ics = await gcal('tst-tour-ten')
    check('dates=20261101T100000/20261101T150000' in g and 'ctz=America/Los_Angeles' in g, f'DST-ending day Google link: {g[:140]}')
    check('Calle%20%C3%91and%C3%BA' in g and '%F0%9F%8F%A1' in g, 'Google link carries accents/emoji URL-encoded')
    check(await p.locator('.home').count() == 10 and await p.locator('.leg').count() == 10, '10 stops + 10 legs')
    route = await ev(p, "[...document.querySelectorAll('.route-all a')].map(a=>a.textContent)")
    check(route == ['See the whole route', 'See all your homes'], f'route + homes buttons: {route}')
    wp = await ev(p, "decodeURIComponent((document.querySelector('.route-all a').href.match(/waypoints=([^&]*)/)||[])[1]||'')")
    check(wp.count('|') == 8, f'whole-route link has 9 waypoints + destination: {wp.count("|")+1} waypoints')
    await p.context.close()
    # Tours never start after 9pm or run past midnight (Joseph): the latest real case is a last stop at 9pm
    p, g, ics = await gcal('tst-tour-evening')
    check('dates=20261024T193000/20261024T213000' in g, f'evening tour (7:30pm, last stop 9pm): Google event 7:30-9:30pm same day ({re.search(r"dates=[^&]*", g).group(0) if g else g})')
    await p.context.close()
    p = await open_page(browser, base, 'tst-tour-evening', dt.datetime(2026, 10, 24, 21, 10))
    st = await ev(p, "[...document.querySelectorAll('.home')].map(e=>e.classList.contains('now')?'now':e.classList.contains('done')?'done':'-')")
    check(st == ['done', 'done', 'now'], f'evening tour at 9:10pm: last stop (9pm) is "now": {st}')
    await p.context.close()
    p, g, ics = await gcal('tst-tour-unsorted')
    m = re.search(r'dates=(\d+T\d+)/(\d+T\d+)', g)
    bug(m and m.group(2) > m.group(1), f'stops out of time order: Google event ends before it starts ({m.group(0) if m else g})')
    await p.context.close()
    p = await open_page(browser, base, 'tst-tour-unsorted', dt.datetime(2026, 10, 24, 9, 40))
    st = await ev(p, "[...document.querySelectorAll('.home')].map(e=>e.classList.contains('now')?'now':e.classList.contains('done')?'done':'-')")
    bug(st == ['-', 'now', '-'], f'out-of-order stops: at 9:40 the 9:30 stop (2nd card) should be "now", got {st}')
    await p.context.close()
    p, g, ics = await gcal('tst-tour-badtime')
    check('dates=20261024T093000/20261024T104500' in g, f'stop time typed "9:30": Google link dates read as 9:30am ({re.search(r"dates=[^&]*", g).group(0) if g else g})')
    await p.context.close()
    p = await open_page(browser, base, 'tst-tour-badtime', dt.datetime(2026, 10, 24, 9, 35))
    check(await p.locator('.home.now').count() == 1, 'stop time "9:30": live "Now" highlight appears')
    await p.context.close()
    p, g, ics = await gcal('tst-tour-pagemismatch')
    bug(ics.endswith('/homes/tst-tour-pagemismatch.ics'), f'page id differs from file name: Apple/Outlook button points at {ics.split("/")[-1]} but the build writes tst-tour-pagemismatch.ics (404)')
    await p.context.close()
    p, g, ics = await gcal('tst-tour-firstnotime')
    check(not g and not ics, 'no calendar button when the first stop has no time')
    await p.context.close()
    p, g, ics = await gcal('tst-tour-notime')
    check('dates=20261024T100000/20261024T113000' in g, f'missing middle time: event still first->last+30 ({g[:120]})')
    await p.context.close()
    p = await open_page(browser, base, 'tst-tour-missinghomes')
    href = await ev(p, "(([...document.querySelectorAll('a')].find(a=>/all your homes/i.test(a.textContent)))||{}).href||''")
    bug(not href, f'"See all your homes" links to a page that does not exist ({href.replace(base, "")}): 404 for the client (no check in the build)')
    await p.context.close()
    # wrapped up
    for when, ended in [((2026, 10, 26, 23, 59), False), ((2026, 10, 27, 0, 0), True)]:
        p = await open_page(browser, base, 'tst-tour-one', dt.datetime(*when))
        t = await text(p)
        check(('thanks for coming out' in t) == ended, f'tour Oct 24 at {when}: wrapped up {ended}')
        if ended:
            check(await p.locator('a', has_text='See all your homes').count() == 1, 'wrapped-up tour links to the homes page')
        await p.context.close()
    p = await open_page(browser, base, 'tst-tour-ten', dt.datetime(2026, 11, 3, 23, 59))
    check('thanks for coming out' not in await text(p), 'Nov 1 tour still up at 11:59pm Nov 3')
    await p.context.close()
    p = await open_page(browser, base, 'tst-tour-ten', dt.datetime(2026, 11, 1, 10, 20))
    st = await ev(p, "[...document.querySelectorAll('.home')].slice(0,3).map(e=>e.classList.contains('now')?'now':e.classList.contains('done')?'done':'-')")
    check(st == ['done', 'now', '-'], f'live stop on DST-ending day at 10:20: {st}')
    await p.context.close()
    p = await open_page(browser, base, 'tst-tour-nodate')
    check(await p.locator('.cal-pick').count() == 0 and 'invalid date' not in await text(p), 'no date: no calendar button, no Invalid Date')
    await p.context.close()
    # viewer outside Pacific (client traveling): live highlight + expiry use their clock
    p = await open_page(browser, base, 'tst-tour-one', dt.datetime(2026, 10, 24, 18, 10), tz='America/New_York')   # 11:10am Pacific
    bug(await p.locator('.home.now').count() == 1, 'client viewing from another time zone: the live "Now" stop is off by the time difference (dates/times read in the viewer\'s zone)')
    await p.context.close()
    # tour picks never on tours; view-only on tours for Joseph
    p = await open_page(browser, base, 'tst-tour-one', owner=True)
    check(await p.locator('.pick-bar').count() == 0 and await p.locator('.react-btn[disabled]').count() == 2, 'Joseph on a tour: view-only reactions, no tour-pick bar')
    await p.context.close()


# ---------------------------------------------------------------- reactions in the browser
async def reactions(browser, base):
    print('Reactions: rapid taps, 300-char limit, emoji, offline, page ids the API rejects')
    api = FakeApi(delay=0.15)
    p = await open_page(browser, base, 'tst-tour-one', api=api, device='phone')
    btn = p.locator('.react-btn[data-r=love]')
    for _ in range(5): await btn.click()
    await p.wait_for_timeout(1200)
    shown = await btn.get_attribute('aria-pressed')
    check(shown == 'true' and api.db.get('tst-tour-one/TST0001', {}).get('r') == 'love', f'5 rapid taps (odd): ends on Love it, page and server agree ({shown}, {api.db})')
    inp = p.locator('.react-note input')
    await inp.fill('😍' * 200 + 'x' * 200)
    v = await inp.input_value()
    check(len(v) <= 300, f'note box caps at 300 (UTF-16 units): {len(v)}')
    await p.locator('.react-note button').click(); await p.wait_for_timeout(500)
    saved = api.db.get('tst-tour-one/TST0001', {}).get('note', '')
    check(saved and not re.search(r'[\ud800-\udbff]$', saved), 'emoji note saved without a broken half-emoji at the cut')
    await p.locator('.react-edit').click(); await inp.fill('   '); await inp.press('Enter'); await p.wait_for_timeout(500)
    check(api.db.get('tst-tour-one/TST0001', {}).get('note') == '' and await p.locator('.react-said').is_hidden(), 'clearing a note to blank removes it')
    await p.context.close()
    # offline: fetch rejects entirely
    p = await open_page(browser, base, 'tst-tour-one', device='phone')
    await p.route('**/api/reactions**', lambda r: r.abort('internetdisconnected'))
    await p.locator('.react-btn[data-r=pass]').click(); await p.wait_for_timeout(300)
    check(await p.locator('.react-err').is_visible() and await p.locator('.react-btn[data-r=pass]').get_attribute('aria-pressed') == 'false', 'offline: error shown, tap rolled back')
    await p.context.close()
    # reactions GET failing: page still renders, buttons still work
    p = await browser.new_context(); pg = await p.new_page(); pg.errors = []; pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    await pg.route('**/api/reactions**', lambda r: r.fulfill(status=500, body='oops'))
    await pg.route(lambda u: not u.startswith(base), lambda r: r.abort()); await pg.clock.set_fixed_time(NOW)
    await pg.goto(base + FX + 'tst-tour-one.html'); await pg.wait_for_timeout(300)
    check(not pg.errors and await pg.locator('.react-btn').count() == 2, 'reactions API down on load: page still renders with buttons')
    await p.close()
    # page ids the real API refuses
    for name in ('tst-accent',):
        p = await open_page(browser, base, name)
        await p.locator('.tile').first.hover(); await p.wait_for_timeout(200)
        await p.locator('.tile').first.locator('.react-btn[data-r=love]').click(); await p.wait_for_timeout(300)
        bug(not await p.locator('.tile').first.locator('.react-err').is_visible(), f'{name}: page id with accents -> every reaction fails with "That didn\'t save" (API only accepts a-z0-9-)')
        await p.context.close()
    p = await open_page(browser, base, 'tst-upper')
    await p.locator('.tile').first.hover(); await p.wait_for_timeout(200)
    await p.locator('.tile').first.locator('.react-btn[data-r=love]').click(); await p.wait_for_timeout(300)
    posted = p.api.posts[-1]['page'] if p.api.posts else None
    check(posted == 'testy-mctestface', f'upper-case page id is lower-cased before saving: {posted}')
    await p.context.close()
    # view-only: Joseph can't save even by submitting the note form via script
    p = await open_page(browser, base, 'tst-tour-one', owner=True)
    await ev(p, "(()=>{const f=document.querySelector('.react-note'); f.hidden=false; f.querySelector('input').value='hack'; f.requestSubmit();})()")
    await p.wait_for_timeout(300)
    check(not p.api.posts, 'view-only: forcing the note form open and submitting saves nothing')
    await p.context.close()


# ---------------------------------------------------------------- map buttons
async def maps(browser, base):
    print('Map buttons: allowed / denied / no answer, Google / Apple, showcase cards')
    async def tap(name, sel, allow=True, hang=False, device='phone', kind='google', wait=1500):
        ctx = await browser.new_context(**DEVICES[device], geolocation={'latitude': 33.6595, 'longitude': -117.9988}, permissions=['geolocation'] if allow else [])
        if hang:
            await ctx.add_init_script("navigator.geolocation.getCurrentPosition = function(){}")
        urls = []
        ctx.on('request', lambda r: urls.append(r.url) if ('google.com/maps' in r.url or 'maps.apple.com' in r.url) else None)
        await ctx.route('**/api/reactions**', FakeApi().handle)
        await ctx.route(lambda u: not u.startswith(base), lambda r: r.abort())
        p = await ctx.new_page(); await p.clock.set_fixed_time(NOW)
        await p.goto(base + FX + name + '.html'); await p.wait_for_timeout(300)
        if name != 'tst-tour-one':
            await p.locator('.tile').first.click(position={'x': 10, 'y': 10}); await p.wait_for_timeout(300)
        await p.locator(sel + f' a[data-map={kind}]').first.click(); await p.wait_for_timeout(wait)
        u = urls[-1] if urls else ''
        await ctx.close()
        return u
    u = await tap('tst-names', '.tile.open .tile-pop .actions', kind='apple')
    check('saddr=33.659500,-117.998800' in u and "O'Hare" in u.replace('%27', "'"), f'showcase card Apple Maps starts from current location: {u}')
    u = await tap('tst-names', '.tile.open .tile-pop .actions', kind='google', device='phone')
    check('origin=33.659500,-117.998800' in u and 'destination=1%20O' in u, f'showcase card Google Maps: {u}')
    u = await tap('tst-tour-one', '.leg', hang=True, wait=7600)
    check(u and 'origin=' not in u and 'Testy%20Ln' in u, f'location never answers: plain link opens after the 7s fallback ({u})')
    u = await tap('tst-tour-one', '.leg', allow=False, kind='apple', wait=1500)
    check(u and 'saddr=' not in u and 'Testy%20Ln' in u, f'location denied: the plain map link opens right away ({u or "nothing"})')


# ---------------------------------------------------------------- layout details
async def layout(browser, base):
    print('Layout: nothing overlaps; print hides buttons; pick bar fits a 360px phone')
    for name in ('tst-tour-ten', 'tst-names', 'tst-forty'):
        for device in ('phone360', 'phone'):
            p = await open_page(browser, base, name, device=device)
            if name != 'tst-tour-ten':
                await p.locator('.tile').first.click(position={'x': 10, 'y': 10}); await p.wait_for_timeout(300)
            over = await ev(p, """(()=>{const out=[];document.querySelectorAll('#app .btn, #app .react-btn, #app .addr, #app .price, #app h1').forEach(e=>{
                if(!e.offsetParent) return; const r=e.getBoundingClientRect(); if(r.right>innerWidth+1||r.left<-1) out.push(e.className+':'+Math.round(r.right))}); return out})()""")
            check(not over, f'{name} [{device}] elements past the screen edge: {over[:5]}')
            await p.context.close()
    p = await open_page(browser, base, 'tst-forty', device='phone360', owner=True)
    for i in range(6):
        await p.locator('.tile .tile-num').nth(i).tap(); await p.wait_for_timeout(50)
    await p.wait_for_timeout(500)
    box = await p.locator('.pick-bar').bounding_box()
    check(box and box['x'] >= 0 and box['x'] + box['width'] <= 360, f'tour-pick bar with 6 picks fits a 360px phone: {box}')
    await p.context.close()
    p = await open_page(browser, base, 'tst-tour-ten')
    await p.emulate_media(media='print')
    hidden = await ev(p, "[...document.querySelectorAll('.actions, .cal-pick, .route-all, .react-btns')].every(e=>getComputedStyle(e).display==='none')")
    check(hidden, 'print: buttons, calendar, route and reaction buttons are hidden')
    await p.context.close()
    p = await open_page(browser, base, 'tst-names')
    await p.emulate_media(media='print')
    shown = await ev(p, "[...document.querySelectorAll('.tile-pop')].filter(e=>getComputedStyle(e).display!=='none' && getComputedStyle(e).visibility!=='hidden').length")
    bug(shown > 0, 'printing a showcase page prints only the small tiles: no why/heads-up/specs (pop-up cards are hidden in print)')
    await p.context.close()


# ---------------------------------------------------------------- admin with hostile/odd data
async def admin(browser, base):
    print('Admin page with odd client data: escaped, similar names')
    X = '<img src=x onerror="window.__xss=1">'
    data = {'pages': [
        {'page': 'tst-similar', 'path': '/tests/edge/fixtures/tst-similar', 'mode': 'showcase', 'client': 'Sam', 'created': '2026-10-16', 'date': None, 'lastAdded': None, 'expires': '2026-11-15',
         'listings': [{'id': 'TST0001', 'address': X, 'price': 1}]},
        {'page': 'tst-similar-2', 'path': '/tests/edge/fixtures/tst-similar-2', 'mode': 'showcase', 'client': 'Sam', 'created': '2026-10-16', 'date': None, 'lastAdded': None, 'expires': '2026-11-15', 'listings': []},
        {'page': 'tst-xss', 'path': '/tests/edge/fixtures/tst-xss', 'mode': 'showcase', 'client': X, 'created': '2026-10-16', 'date': None, 'lastAdded': None, 'expires': '2026-11-15', 'listings': []}],
        'reactions': {'tst-similar': {'TST0001': {'r': 'love', 'note': X, 'at': '2026-10-21T17:00:00Z'}}}, 'removed': {}, 'hidden': {}}
    ctx = await browser.new_context(viewport={'width': 360, 'height': 740}, has_touch=True, is_mobile=True)
    await ctx.add_init_script("localStorage.setItem('joeibarra-admin-key','test-password')")
    p = await ctx.new_page(); p.errors = []; p.on('pageerror', lambda e: p.errors.append(str(e)))
    await p.route('**/api/admin', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(data)))
    await p.route(lambda u: not u.startswith(base), lambda r: r.abort()); await p.clock.set_fixed_time(dt.datetime(2026, 10, 22, 9, 0))
    await p.goto(base + '/admin.html'); await p.wait_for_timeout(400)
    check(not p.errors and not await ev(p, 'window.__xss || null'), f'admin escapes client name/address/note: {p.errors}')
    names = await ev(p, "[...document.querySelectorAll('.panel .pg .pg-name')].map(e=>e.textContent)")
    bug(names.count('Sam') < 2, f'two clients with the same first name look identical on /admin (only first name shown): {names}')
    wide = await ev(p, 'document.documentElement.scrollWidth - innerWidth')
    check(wide <= 0, f'admin at 360px scrolls sideways by {wide}px')
    await ctx.close()


async def main():
    base = serve()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        for suite in (all_fixtures, escaping, showcase, removal, tours, reactions, maps, layout, admin):
            await suite(browser, base)
        await browser.close()
    print('\nedge (browser): %d checks passed, %d failed, %d known bugs still open' % (PASSES, len(FAILS), len(KNOWN)))
    for k in KNOWN: print('  KNOWN BUG', k)
    print('\nRunning node tests/edge/run.mjs')
    r = subprocess.run(['node', os.path.join(HERE, 'run.mjs')], cwd=ROOT)
    sys.exit(1 if FAILS or r.returncode else 0)


asyncio.run(main())
