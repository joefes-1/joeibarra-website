"""Writes the fake client pages in tests/edge/fixtures/ (all data is made up: 555-01xx phones,
@example.com, FUB ids 990001+, TST mls numbers, photos from /images/).
Run: python3 tests/edge/make_fixtures.py   (the generated files are committed; re-run after editing this)"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures')
PHOTOS = ['/images/willow.jpg', '/images/el-paso.jpg', '/images/mockingbird.jpg', '/images/baltimore.jpg']


def page(D, comment='edge-case fixture'):
    data = json.dumps(D, indent=1, ensure_ascii=False).replace('</', '<\\/')
    return ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="robots" content="noindex, nofollow"><title>Test fixture</title><link rel="stylesheet" href="/homes/homes.css"></head>\n'
            '<body><div id="app"></div>\n<script>\n/* Fake client for tests/edge (%s) */\nwindow.HOMES = %s;\n</script>\n'
            '<script src="/homes/homes.js"></script>\n</body></html>\n' % (comment, data))


def home(n, **kw):
    h = {'address': '%d Testy Ln' % n, 'city': 'Huntington Beach, CA 92648', 'mls': 'TST%04d' % n, 'price': 900000 + n * 10000,
         'status': 'For sale', 'beds': 3, 'baths': 2, 'sqft': 1500 + n, 'year': 1990, 'photo': PHOTOS[n % 4],
         'url': 'https://www.realscout.com/listing/tst%d' % n, 'why': 'Fake write-up for home %d.' % n}
    h.update(kw)
    return h


AGENT_LEAK = 'Listing agent: Agent Smith (714) 555-0199 agent.smith@example.com'
F = {}

# Names with apostrophes, accents, emoji; fubId; ampersand/quote in area + title (link previews)
F['tst-names'] = {'mode': 'showcase', 'page': 'tst-names', 'client': "D'Angelo José Zoë 🏡", 'fubId': 990001, 'created': '2026-10-16',
    'title': 'Homes for "D\'Angelo" & family', 'area': 'Huntington Beach & Seacliff', 'note': 'Hi D\'Angelo! Ça va? Here are a few 🏡 picks.',
    'listings': [home(1, address="1 O'Hare Ct", why='Great “curb” appeal & yard.', headsUp=AGENT_LEAK),
                 home(2, address='2 Calle Ñandú #5; Bldg, A', city='Seacliff, CA', saved=True, why=AGENT_LEAK)]}

# Script injection in every free-text field
X = '<img src=x onerror="window.__xss=(window.__xss||[]).concat(\'%s\')">'
F['tst-xss'] = {'mode': 'showcase', 'page': 'tst-xss', 'client': X % 'client', 'fubId': 990002, 'created': '2026-10-16',
    'title': X % 'title', 'note': X % 'note', 'area': X % 'area', 'whyLabel': X % 'whyLabel', 'checked': '2026-10-18',
    'listings': [home(1, address=X % 'address', city=X % 'city', status=X % 'status', why=X % 'why', headsUp=X % 'headsUp',
                      beds=X % 'beds', baths=X % 'baths', lot=X % 'lot', hoa=X % 'hoa', year=X % 'year', price=X % 'price',
                      url='javascript:window.__xss=["url"]', photo='" onerror="window.__xss=[\'photo\']'),
                 home(2, status='Pending', added='2026-10-18T09:00', mls='"><svg onload=window.__xss=["mls"]>',
                      openHouses=[{'date': '2026-10-24', 'start': '10:00', 'end': X % 'oh'}]),
                 home(3, url='//evil.example/phish', photo='//evil.example/x.jpg')]}
F['tst-xss-tour'] = {'mode': 'tour', 'page': 'tst-xss-tour', 'client': X % 'client', 'date': '2026-10-24', 'created': '2026-10-21',
    'listings': [home(1, time='10:<img src=x onerror="window.__xss=[\'time\']">'), home(2, time='10:30', drive=X % 'drive')]}

# Very long unbroken text everywhere
LONG = 'Wolfeschlegelsteinhausenbergerdorffvoralternwarengewissenhaftschaferswessenschafewarenwohlgepflegeundsorgfaltigkeitbeschutzen'
F['tst-long'] = {'mode': 'showcase', 'page': 'tst-long', 'client': LONG, 'fubId': 990004, 'created': '2026-10-16', 'title': LONG,
    'note': 'See https://www.example.com/' + LONG + LONG, 'area': LONG,
    'listings': [home(1, address='1 ' + LONG + ' Boulevard', why='x' * 2000, headsUp=LONG * 3, city=LONG),
                 home(2, why=' '.join(['long why'] * 400), headsUp=' '.join(['heads up'] * 200), added='2026-10-18T09:00')]}
F['tst-long-tour'] = {'mode': 'tour', 'page': 'tst-long-tour', 'client': LONG, 'date': '2026-10-24', 'created': '2026-10-21', 'title': LONG,
    'note': LONG, 'listings': [home(1, address='1 ' + LONG, time='10:00', drive=LONG), home(2, time='10:30', drive=LONG)]}

# Realistic: a note/why holding a long listing URL (no other long words)
URL = 'https://www.zillow.com/homedetails/1234-Testy-Ln-Huntington-Beach-CA-92648/99999999_zpid/?utm_source=share&utm_campaign=tst'
F['tst-longurl'] = {'mode': 'showcase', 'page': 'tst-longurl', 'client': 'Lu', 'created': '2026-10-16', 'note': 'Here is the one I mentioned: ' + URL,
    'listings': [home(1, why='Compare with ' + URL), home(2)]}

# 40 homes: mixed saved/shared, 3 fresh batches (two on one day), removed home with pinned numbers,
# pending/sold/off-market/back on market, price drop then back up
forty = []
for n in range(1, 41):
    kw = {'saved': n % 3 == 0}
    if n == 5: continue                                  # home #5 was taken off the page: 6..34 pin their numbers
    if 5 < n <= 34: kw['num'] = n
    if n > 34: kw['added'] = ['2026-10-18T09:15', '2026-10-20T08:00', '2026-10-20T17:45'][(n - 35) % 3]
    if n == 7: kw['status'] = 'Pending'
    if n == 8: kw['status'] = 'Sold'
    if n == 9: kw['status'] = 'Off market'
    if n == 10: kw['status'] = 'Back on market'
    if n == 11: kw['status'] = 'Active Under Contract'
    if n == 12: kw.update(price=950000, was=1000000, priceChanged='2026-10-17')       # drop
    if n == 13: kw.update(price=1000000, was=950000, priceChanged='2026-10-19')       # back up
    forty.append(home(n, **kw))
F['tst-forty'] = {'mode': 'showcase', 'page': 'tst-forty', 'client': 'Testy', 'fubId': 990005, 'created': '2026-10-16', 'checked': '2026-10-21',
                  'listings': forty}

F['tst-one'] = {'mode': 'showcase', 'page': 'tst-one', 'client': 'Uno', 'created': '2026-10-16', 'listings': [home(1, saved=True)]}
F['tst-allsaved'] = {'mode': 'showcase', 'page': 'tst-allsaved', 'client': 'Sal', 'created': '2026-10-16',
                     'listings': [home(i, saved=True) for i in range(1, 4)]}
F['tst-empty'] = {'mode': 'showcase', 'page': 'tst-empty', 'client': 'Ned', 'created': '2026-10-16', 'fubId': 990006, 'listings': []}

# Open houses: past, today-ongoing, later today, future, crossing midnight, no end, no start, bad date
F['tst-openhouse'] = {'mode': 'showcase', 'page': 'tst-openhouse', 'client': 'Opal', 'created': '2026-10-16', 'listings': [
    home(1, openHouses=[{'date': '2026-10-20', 'start': '13:00', 'end': '16:00'}, {'date': '2026-10-21', 'start': '13:00', 'end': '16:00'},
                        {'date': '2026-10-25', 'start': '11:00', 'end': '14:00'}]),
    home(2, openHouses=[{'date': '2026-10-21', 'start': '22:00', 'end': '01:00'}]),        # late open house that runs past midnight
    home(3, openHouses=[{'date': '2026-10-21', 'start': '18:00'}, {'date': '2026-10-22'}, {'date': '10/23/2026', 'start': '10:00'}])]}

# Missing fields, Zillow vs RealScout, site-relative photo (link preview), sqft/price as strings
F['tst-missing'] = {'mode': 'showcase', 'page': 'tst-missing', 'client': 'Mia', 'created': '2026-10-16', 'listings': [
    {'address': '1 Nophoto Rd', 'city': 'Irvine, CA', 'mls': 'TST1001', 'price': 800000, 'url': 'https://www.zillow.com/homedetails/tst/1_zpid/'},
    {'address': '2 Nourl Rd', 'mls': 'TST1002', 'price': 810000, 'photo': '/images/willow.jpg'},
    {'address': '3 Zillow Rd', 'mls': 'TST1003', 'price': 820000, 'photo': '/images/el-paso.jpg', 'url': 'https://www.zillow.com/homedetails/tst/3_zpid/'},
    {'address': '4 Realscout Rd', 'mls': 'TST1004', 'price': 830000, 'photo': '/images/mockingbird.jpg', 'url': 'https://www.realscout.com/listing/tst4'},
    {'address': '5 Strings Rd', 'mls': 'TST1005', 'price': '$1.2M', 'sqft': '1,850', 'beds': 3, 'baths': 2.5, 'photo': '/images/baltimore.jpg'},
    {'mls': 'TST1006', 'price': 840000},
    {'address': '7 Dupe Rd', 'price': 850000}, {'address': '7 Dupe Rd', 'price': 860000}]}

# Expiry: expiresDays override (number and the string a hand edit might produce)
F['tst-expiry'] = {'mode': 'showcase', 'page': 'tst-expiry', 'client': 'Evy', 'created': '2026-10-01', 'expiresDays': 7, 'listings': [home(1)]}
F['tst-expiry-str'] = {'mode': 'showcase', 'page': 'tst-expiry-str', 'client': 'Evy', 'created': '2026-10-01', 'expiresDays': '10', 'listings': [home(1)]}

# Page ids that don't match /api/reactions rules (upper case / accents), fubId as a string
F['tst-upper'] = {'mode': 'showcase', 'page': 'Testy-McTestface', 'client': 'Testy', 'fubId': 990007, 'created': '2026-10-16', 'listings': [home(1), home(2)]}
F['tst-accent'] = {'mode': 'showcase', 'page': 'zoë-tëst', 'client': 'Zoë', 'fubId': 990008, 'created': '2026-10-16', 'listings': [home(1)]}
F['tst-fubstr'] = {'mode': 'showcase', 'page': 'tst-fubstr', 'client': 'Stringy', 'fubId': '990009', 'created': '2026-10-16', 'listings': [home(1)]}
F['tst-nofub'] = {'mode': 'showcase', 'page': 'tst-nofub', 'client': 'Nofub', 'created': '2026-10-16', 'listings': [home(1)]}
F['tst-firstonly'] = {'mode': 'showcase', 'page': 'tst-firstonly', 'client': 'Cher', 'created': '2026-10-16', 'listings': [home(1)]}
F['tst-similar'] = {'mode': 'showcase', 'page': 'tst-similar', 'client': 'Sam', 'created': '2026-10-16', 'listings': [home(1)]}
F['tst-similar-2'] = {'mode': 'showcase', 'page': 'tst-similar-2', 'client': 'Sam', 'created': '2026-10-16', 'listings': [home(1)]}

# Tours
def tour(page, date, times, **kw):
    D = {'mode': 'tour', 'page': page, 'client': 'Testy', 'fubId': 990010, 'created': '2026-10-21', 'date': date, 'homesPage': 'tst-forty',
         'listings': [home(i + 1, time=t, drive='About %d minutes.' % (i + 3)) if t else home(i + 1) for i, t in enumerate(times)]}
    D.update(kw)
    return D
F['tst-tour-one'] = tour('tst-tour-one', '2026-10-24', ['11:00'])
F['tst-tour-ten'] = tour('tst-tour-ten', '2026-11-01', ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30'],
                         client="D'Angelo José 🏡")
F['tst-tour-ten']['listings'][0].update(address='1 Calle Ñandú #5; Bldg, A 🏡', city='Huntington Beach, CA')
F['tst-tour-dststart'] = tour('tst-tour-dststart', '2027-03-14', ['10:00', '11:00'])
F['tst-tour-unsorted'] = tour('tst-tour-unsorted', '2026-10-24', ['11:00', '09:30', '10:15'])
F['tst-tour-late'] = tour('tst-tour-late', '2026-10-24', ['21:30', '23:00', '23:50'])
F['tst-tour-early'] = tour('tst-tour-early', '2026-10-24', ['07:30', '08:15'])
F['tst-tour-nine'] = tour('tst-tour-nine', '2026-10-24', ['09:00', '09:45'])
F['tst-tour-notime'] = tour('tst-tour-notime', '2026-10-24', ['10:00', None, '11:00'])
F['tst-tour-firstnotime'] = tour('tst-tour-firstnotime', '2026-10-24', [None, '10:30'])
F['tst-tour-nodate'] = tour('tst-tour-nodate', None, ['10:00', '10:30']); del F['tst-tour-nodate']['date']
F['tst-tour-missinghomes'] = tour('tst-tour-missinghomes', '2026-10-24', ['10:00'], homesPage='tst-does-not-exist')
F['tst-tour-pagemismatch'] = tour('tst-tour-renamed', '2026-10-24', ['10:00', '10:45'])      # page id != file name
F['tst-tour-badtime'] = tour('tst-tour-badtime', '2026-10-24', ['9:30', '10:15'])            # hand-typed time without a leading zero
F['tst-tour-removed'] = tour('tst-tour-removed', '2026-10-24', ['10:00', '10:45'])


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, D in F.items():
        with open(os.path.join(OUT, name + '.html'), 'w', encoding='utf-8') as f:
            f.write(page(D))
    print('wrote %d fixtures to %s' % (len(F), os.path.relpath(OUT)))


if __name__ == '__main__':
    main()
