/* Client homes pages (/homes/*.html)
   Each page sets window.HOMES and loads this file, which renders everything into #app.

   window.HOMES = {
     mode:       "showcase" | "tour",
     page:       "dolce-ibarra",        // fixed id for saved reactions; matches the file name
     fubId:      8050,                  // optional: client's Follow Up Boss person id. Notes the client
                                        //   leaves on a home (tour or homes page) are added to their FUB profile
     client:     "Dolce",               // first name, used in headings and reaction badges
     created:    "2026-10-16",          // showcase: expires 30 days after this (or the newest `added`)
     expiresDays: 30,                   // optional override
     date:       "2026-10-17",          // tour only: the tour day (page shuts off 2 days after)
     homesPage:  "dolce-ibarra",        // tour only: the client's homes page -> "See all your homes" link
     confirmed:  true,                  // tour only: showings confirmed with the listing agents (drafts leave it off)
     cancelled:  true,                  // tour only: the tour is off -> "This tour was cancelled" page, no calendar file
     sample:     true,                  // sample pages: banner, no expiry, no reactions
     title, note, area, whyLabel,
     checked:    "2026-10-18",          // showcase: day the daily refresh last checked prices/open houses
     listings: [{ address, city, mls, price, status, beds, baths, sqft, lot, year, hoa,
                  photo, url (RealScout listing link; Zillow as a fallback), why, headsUp,
                  added: "2026-10-18T14:20",   // showcase: added after the link went out -> Fresh pick
                  openHouses: [{ date: "2026-10-18", start: "13:00", end: "16:00" }],  // past ones hide themselves
                  saved: true,                                  // the client saved it (vs. Joseph shared it) -> "You saved" filter
                  was: 1290000, priceChanged: "2026-10-12",   // previous price -> "Price drop" / "Price up" tag
                  status: "Pending" | "Sold" | ...             // pending/sold/off market get flagged on the card and tile
                  time: "10:35", drive: "..."  // tour: arrival time + drive note
                }]
   }
   All dates/times are read in the viewer's local time zone (clients are local to Pacific time). */
(function(){
  'use strict';
  document.documentElement.classList.add('js');

  var AGENT = {
    name: 'Joseph Ibarra', phone: '+17145075438', phoneText: '(714) 507-5438',
    email: 'josephibarra@firstteam.com', dre: '02244753', photo: '/images/joseph-ibarra.jpg'
  };
  var D = window.HOMES || {};
  var TOUR = D.mode === 'tour';
  var REACT = !D.sample;                     // Love it / Not for me buttons on real showcase and tour pages
  // Joseph's own browser (signed in on /admin) can tap a home's number to pick it for the next buyer tour.
  // Clients never have this key, so they never see it; saving picks also needs the password on the server.
  var OWNER_KEY = (function(){ try{ return localStorage.getItem('joeibarra-admin-key') || ''; }catch(e){ return ''; } })();
  var OWNER = REACT && !TOUR && !!OWNER_KEY;   // tour picks live on showcase pages only
  // Joseph sees his clients' reactions and notes but can't change them (notes on tours also go to FUB),
  // except that he can mark a home Not for me for a client who told him so (saves with his password).
  var VIEW_ONLY = REACT && !!OWNER_KEY;
  var PAGE = String(D.page || location.pathname.replace(/\/+$/, '').split('/').pop().replace(/\.html$/, '')).toLowerCase();
  var root = document.getElementById('app');
  var homes = (D.listings || []).slice();

  /* ---------- Small helpers ---------- */
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function enc(s){ return encodeURIComponent(s); }
  function safeUrl(u){ return /^(https?:\/\/|\/)/i.test(String(u || '')) ? String(u) : ''; }   // only http(s) or site paths
  function fullAddress(h){ return [h.address, h.city].filter(Boolean).join(', '); }
  function gmaps(dest){ return 'https://www.google.com/maps/dir/?api=1&destination=' + enc(dest) + '&travelmode=driving'; }
  function apple(dest){ return 'https://maps.apple.com/?daddr=' + enc(dest) + '&dirflg=d'; }
  function sms(h){ return 'sms:' + AGENT.phone + '?&body=' + enc('Hi Joseph, about ' + (h.address || 'this home') + ': '); }
  function money(n){ return typeof n === 'number' ? '$' + n.toLocaleString('en-US') : esc(n); }
  // Stop times are "HH:MM" (24h). Be forgiving about how they were typed ("9:30", "9:30 am", "21:15") and
  // drop anything else, so a typo can't break the page, the calendar link or the "Now" highlight.
  function normTime(t){
    var m = /^\s*(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?\s*$/i.exec(String(t == null ? '' : t));
    if(!m) return '';
    var h = +m[1], min = +m[2], ap = (m[3] || '').toLowerCase();
    if(ap){ if(h < 1 || h > 12) return ''; h = h % 12 + (ap === 'p' ? 12 : 0); }
    if(h > 23 || min > 59) return '';
    return (h < 10 ? '0' : '') + h + ':' + m[2];
  }
  function clock(t){ t = normTime(t); if(!t) return ''; var p = t.split(':'), h = +p[0]; return (h % 12 || 12) + ':' + p[1] + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function localDate(ymd, hm){ return new Date(ymd + 'T' + (hm || '00:00') + ':00'); }       // "2026-10-18", "14:20"
  function stampDate(s){ return localDate(s.slice(0, 10), s.length > 10 ? s.slice(11, 16) : null); }  // "2026-10-18[T14:20]"
  function dayLabel(s){ return stampDate(s).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'}); }
  function timeLabel(s){ return s.length > 10 ? clock(s.slice(11, 16)) : ''; }
  function homeId(h, i){ return String(h.mls || h.address || ('home-' + (i + 1))).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
  homes.forEach(function(h, i){
    h._id = homeId(h, i);
    if(h.time != null){ var nt = normTime(h.time); if(!nt && window.console) console.warn('[homes] ignoring bad time "' + h.time + '" on ' + h.address); h.time = nt; }
  });
  // Each home keeps its number for good, so "#3" means the same house next week:
  // tours count stops in route order; showcases count in the order homes were sent
  // (originals in file order, then each fresh batch by its `added` stamp).
  // A home can pin its number with `num` (used after a home is taken off the page, so the rest don't shift).
  (function(){
    if(TOUR){ homes.forEach(function(h, i){ h._num = i + 1; }); return; }
    var order = homes.map(function(h, i){ return {h:h, i:i}; });
    order.sort(function(a, b){ var x = a.h.added || '', y = b.h.added || ''; return x === y ? a.i - b.i : (x < y ? -1 : 1); });
    var n = 0;
    order.forEach(function(o){ var pin = +o.h.num; n = pin > 0 ? Math.max(n, pin) : n + 1; o.h._num = pin > 0 ? pin : n; });
  })();

  var ICON = {
    pin:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    out:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    msg:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    car:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14M6 17v2M18 17v2M4 13l2-5a2 2 0 0 1 2-1.3h8a2 2 0 0 1 2 1.3l2 5v4H4z"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/></svg>',
    grid:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    cal:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    route:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/></svg>'
  };
  var REACTION = {
    love: {icon:'❤️', label:'Love it',    badge: (D.client || 'You') + ' loved it'},
    pass: {icon:'👎', label:'Not for me', badge: 'Not for ' + (D.client || 'you')}
  };

  /* ---------- Data checks (console warnings only, so a typo never blanks the page) ---------- */
  function validate(){
    function warn(m){ if(window.console) console.warn('[homes] ' + m); }
    if(REACT && !D.page) warn('add page: "' + PAGE + '" so saved reactions survive URL changes');
    if(TOUR && !D.date) warn('tour has no date: no schedule or shutoff');
    if(!TOUR && !D.sample && !D.created) warn('showcase has no created date: it will never expire');
    homes.forEach(function(h, i){
      ['address', 'city', 'price'].forEach(function(k){ if(h[k] == null || h[k] === '') warn('listing ' + (i + 1) + ' is missing ' + k); });
      if(h.url && !safeUrl(h.url)) warn('listing ' + (i + 1) + ' has an unsafe url');
      (h.openHouses || []).forEach(function(o){ if(!o || !/^\d{4}-\d\d-\d\d$/.test(o.date || '')) warn('listing ' + (i + 1) + ' has an open house without a YYYY-MM-DD date'); });
    });
  }

  /* ---------- Expiry ---------- */
  // Showcase: 30 days after `created` or the newest `added`, whichever is later.
  // Tour: the day after the tour + 2 days (midnight local). Samples never expire.
  function expiresAt(){
    if(D.sample) return null;
    var exp;
    if(TOUR){
      if(!D.date) return null;
      exp = localDate(D.date); exp.setDate(exp.getDate() + 3);
      return exp;
    }
    if(!D.created) return null;
    var base = D.created;
    homes.forEach(function(h){ if(h.added && h.added.slice(0, 10) > base) base = h.added.slice(0, 10); });
    exp = localDate(base); exp.setDate(exp.getDate() + (D.expiresDays || 30));
    return exp;
  }

  /* ---------- Shared page chrome ---------- */
  function header(withCall){
    return '<header class="top"><div class="wrap"><a class="brand" href="/">' + AGENT.name + '<small>REALTOR® · First Team Real Estate</small></a>' +
      (withCall ? '<a class="btn btn-solid" href="tel:' + AGENT.phone + '">Call or text</a>' : '') + '</div></header>';
  }
  // Tours link back to the client's homes page (every home they've been sent), on the page and after it wraps up
  var HOMES_LINK = TOUR && /^[a-z0-9-]{1,80}$/.test(String(D.homesPage || '')) ? '/homes/' + D.homesPage : '';
  function homesButton(){ return HOMES_LINK ? '<a class="btn btn-ghost" href="' + HOMES_LINK + '">' + ICON.grid + 'See all your homes</a>' : ''; }
  function textButton(){ return '<a class="btn btn-solid" href="sms:' + AGENT.phone + '">' + ICON.msg + 'Text ' + AGENT.phoneText + '</a>'; }
  function footer(){
    return '<footer><div class="wrap"><div class="logos"><img src="/images/moein-group.png" alt="Moein Group Real Estate"><i aria-hidden="true"></i><img src="/images/first-team.jpg" alt="First Team Real Estate"></div>' +
      '<p class="legal">' + AGENT.name + ', REALTOR® · DRE #' + AGENT.dre + ' · First Team Real Estate · Moein Group. Listing information is deemed reliable but not guaranteed and should be independently verified.</p></div></footer>';
  }
  function mapButtons(dest){
    return '<a class="btn btn-solid" data-map="google" href="' + gmaps(dest) + '" target="_blank" rel="noopener">' + ICON.pin + 'Google Maps</a>' +
           '<a class="btn btn-ghost" data-map="apple" href="' + apple(dest) + '" target="_blank" rel="noopener">' + ICON.pin + 'Apple Maps</a>';
  }
  // Directions start from wherever the person is at the moment they tap: grab a fresh location (no cached
  // fix) and pass it as the starting point. If location is off/denied/slow, the plain link opens and the map
  // app picks the start itself. The new tab is opened right away so popup blockers don't stop it.
  function withOrigin(href, kind, lat, lng){
    var o = lat.toFixed(6) + ',' + lng.toFixed(6);
    return kind === 'apple' ? href + '&saddr=' + o : href + '&origin=' + o;
  }
  function initMapLinks(){
    document.addEventListener('click', function(e){
      var a = e.target.closest && e.target.closest('a[data-map]');
      if(!a || !navigator.geolocation || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      var href = a.getAttribute('href'), kind = a.dataset.map, done = false;
      var win = null; try { win = window.open('', '_blank'); } catch(err){}
      function go(url){
        if(done) return; done = true;
        if(win && !win.closed){ try { win.opener = null; win.location.replace(url); return; } catch(err){} }
        location.href = url;
      }
      navigator.geolocation.getCurrentPosition(
        function(pos){ go(withOrigin(href, kind, pos.coords.latitude, pos.coords.longitude)); },
        function(){ go(href); },
        {enableHighAccuracy: true, maximumAge: 0, timeout: 6000});
      setTimeout(function(){ go(href); }, 7000);
    });
  }

  /* ---------- Listing pieces ---------- */
  function specsList(h){
    var s = [];
    if(h.beds != null) s.push('<li><strong>' + esc(h.beds) + '</strong> bd</li>');
    if(h.baths != null) s.push('<li><strong>' + esc(h.baths) + '</strong> ba</li>');
    if(h.sqft) s.push('<li><strong>' + Number(h.sqft).toLocaleString('en-US') + '</strong> sq ft</li>');
    if(h.lot) s.push('<li><strong>' + esc(h.lot) + '</strong> lot</li>');
    if(h.year) s.push('<li>Built <strong>' + esc(h.year) + '</strong></li>');
    if(h.hoa) s.push('<li>HOA <strong>' + esc(h.hoa) + '</strong></li>');
    return s.length ? '<ul class="specs">' + s.join('') + '</ul>' : '';
  }

  // Listing status buckets: "Pending"/"In escrow" -> pending, "Sold" -> sold, "Withdrawn"/"Off market" -> off
  function statusKind(h){
    var s = String(h.status || '');
    if(/sold|closed/i.test(s)) return 'sold';
    if(/pending|escrow|contingent|under contract/i.test(s)) return 'pending';
    if(/off.?market|withdrawn|expired|cancel/i.test(s)) return 'off';
    return '';
  }
  function hm(t){ var p = t.split(':'), h = +p[0], m = p[1]; return (h % 12 || 12) + (m !== '00' ? ':' + m : ''); }
  function timeRange(o){
    if(!o.start) return '';
    var ap = function(t){ return +t.split(':')[0] < 12 ? 'AM' : 'PM'; };
    if(!o.end) return hm(o.start) + ' ' + ap(o.start);
    return hm(o.start) + (ap(o.start) === ap(o.end) ? '' : ' ' + ap(o.start)) + ' to ' + hm(o.end) + ' ' + ap(o.end);
  }
  // Upcoming open houses only: one that has ended drops off by itself.
  function upcomingOpenHouses(h){
    var now = new Date();
    return (h.openHouses || []).filter(function(o){ return o && o.date && localDate(o.date, o.end || '23:59') > now; });
  }
  function openHouseLine(h){
    if(TOUR) return '';
    var list = upcomingOpenHouses(h);
    if(!list.length) return '';
    return '<p class="open-house"><strong>Open house</strong> ' + list.map(function(o){
      return '<span class="oh">' + esc(dayLabel(o.date) + (o.start ? ', ' + timeRange(o) : '')) + '</span>';
    }).join(' · ') + '</p>';
  }
  function priceChange(h){
    if(typeof h.was !== 'number' || typeof h.price !== 'number' || h.was === h.price) return '';
    var drop = h.price < h.was;
    var when = h.priceChanged ? ' ' + localDate(h.priceChanged.slice(0, 10)).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '';
    return '<span class="price-was">' + money(h.was) + '</span><span class="price-tag' + (drop ? ' drop' : '') + '">' + (drop ? 'Price drop' : 'Price up') + esc(when) + '</span>';
  }

  function reactBlock(h){
    if(!REACT) return '';
    return '<div class="react' + (VIEW_ONLY ? ' view-only' : '') + '" data-home="' + h._id + '"><span class="react-q">' +
        (VIEW_ONLY ? esc(D.client ? D.client + '\u2019s reaction' : 'Client reaction') + ' <small>You can mark Not for me</small>' : 'What do you think?') + '</span>' +
      '<div class="react-btns">' + ['love', 'pass'].map(function(k){
        return '<button type="button" class="react-btn" data-r="' + k + '" aria-pressed="false"' + (VIEW_ONLY && k === 'love' ? ' disabled' : '') + '><span aria-hidden="true">' + REACTION[k].icon + '</span>' + REACTION[k].label + '</button>';
      }).join('') + '</div>' +
      '<p class="react-by" hidden></p>' +
      '<form class="react-note" hidden><input type="text" maxlength="300" placeholder="Want to tell me why? (optional)" aria-label="Note for Joseph"><button type="submit" class="btn btn-soft">Send</button></form>' +
      '<p class="react-said" hidden></p><p class="react-err" hidden>That didn’t save. Check your connection and try again.</p></div>';
  }

  // Full listing card. opts.inPop: the copy shown inside a past-pick tile (no reveal animation, no id).
  function card(h, i, opts){
    opts = opts || {};
    var url = safeUrl(h.url), photo = safeUrl(h.photo), fresh = !TOUR && !!h.added;
    var img = photo ? '<img src="' + esc(photo) + '" alt="' + esc(h.address) + '"' + (i > 0 ? ' loading="lazy"' : '') + '>' : '';
    if(img && url){   // the whole photo opens the full listing (Joseph's RealScout, or Zillow), on showcases and tours
      var hint = /zillow\.com/i.test(url) ? 'View on Zillow' : 'See full listing';
      img = '<a class="photo-link" href="' + esc(url) + '" target="_blank" rel="noopener" aria-label="' + hint + ': ' + esc(h.address) + '">' + img +
            '<span class="photo-hint">' + hint + ' ' + ICON.out + '</span></a>';
    }
    var acts = (TOUR ? '' : mapButtons(fullAddress(h))) +
      (url && !photo ? '<a class="btn btn-soft" href="' + esc(url) + '" target="_blank" rel="noopener">Full listing ' + ICON.out + '</a>' : '') +   // only when there's no photo to tap
      '<a class="btn btn-soft" href="' + sms(h) + '">' + ICON.msg + 'Text me about it</a>';
    var kind = statusKind(h);
    var cls = 'home' + (opts.inPop ? '' : ' reveal') + (fresh ? ' is-fresh' : '') + (kind ? ' is-' + kind : '');
    return '<article class="' + cls + '"' + (REACT ? ' data-home="' + h._id + '"' : '') + (opts.inPop ? '' : ' id="stop-' + (i + 1) + '"') + '>' +
      '<div class="photo">' + img +
        (TOUR ? '<span class="badge" aria-label="Stop ' + h._num + ' of ' + homes.length + '"><b>' + h._num + '</b>of ' + homes.length + '</span>'
               : '<span class="badge solo" aria-label="Home ' + h._num + '"><b>' + h._num + '</b></span>') +
        (h.status ? '<span class="status' + (kind ? ' ' + kind : '') + '">' + esc(h.status) + '</span>' : '') +
        (REACT ? '<span class="react-badge" hidden></span>' : '') +
      '</div>' +
      '<div class="body">' +
        '<div class="headline"><span class="price-group"><span class="price">' + money(h.price) + '</span>' + priceChange(h) + '</span>' +
          (fresh ? '<span class="fresh-pill">Fresh pick</span>' : '') +
          (TOUR && h.time ? '<span class="time"><span class="now-pill">Now</span>' + clock(h.time) + '</span>' : '') + '</div>' +
        '<div class="addr">' + esc(h.address) + (h.city ? '<span>' + esc(h.city) + '</span>' : '') + '</div>' +
        specsList(h) + openHouseLine(h) +
        (h.why ? '<div class="why"><span class="eyebrow">' + esc(D.whyLabel || 'Why I picked this one') + '</span><p>' + esc(h.why) + '</p></div>' : '') +
        (h.headsUp ? '<p class="heads-up"><strong>Heads up:</strong> ' + esc(h.headsUp) + '</p>' : '') +
        reactBlock(h) +
        '<div class="actions">' + acts + '</div>' +
      '</div></article>';
  }

  // Compact past-pick tile; the full card pops up on hover (computer) or opens on tap (phone).
  function tile(h, i){
    var bits = [];
    if(h.beds != null) bits.push(esc(h.beds) + ' bd');
    if(h.baths != null) bits.push(esc(h.baths) + ' ba');
    if(h.sqft) bits.push(Number(h.sqft).toLocaleString('en-US') + ' sq ft');
    var photo = safeUrl(h.photo), kind = statusKind(h);
    var drop = typeof h.was === 'number' && typeof h.price === 'number' && h.price < h.was;
    // Sold / off market: stays on the page (numbers don't shift) but greyed out, with no card, reactions or links.
    var gone = kind === 'sold' || kind === 'off';
    return '<article class="tile reveal' + (h.added ? ' is-fresh' : '') + (kind ? ' is-' + kind : '') + (gone ? ' is-unavailable' : '') + '"' +
      (REACT && !gone ? ' data-home="' + h._id + '"' : '') + ' data-origin="' + (h.saved ? 'saved' : 'shared') + '"' +
      (gone ? ' aria-disabled="true" aria-label="' + esc(h.address) + ', ' + esc(h.status) + '. No longer available">'
            : ' tabindex="0" aria-label="' + esc(h.address) + ', ' + money(h.price) + '. Show details">') +
      '<div class="tile-photo">' + (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy">' : '') + '<span class="tile-num">' + h._num + '</span>' +
        (kind ? '<span class="tile-status ' + kind + '">' + esc(h.status) + '</span>' : '') +
        (REACT && !gone ? '<span class="react-badge" hidden></span>' : '') + '</div>' +
      '<div class="tile-body">' + (h.added ? '<span class="tile-fresh">Fresh pick</span>' : '') + (h.saved && hasBoth() ? '<span class="tile-saved">You saved</span>' : '') + '<span class="tile-price">' + money(h.price) + (drop ? '<span class="tile-drop">Price drop</span>' : '') + '</span><span class="tile-addr">' + esc(h.address) + '</span>' +
        '<span class="tile-specs">' + bits.join(' · ') + '</span><span class="tile-more">' + (gone ? 'No longer available' : 'See details') + '</span></div>' +
      (gone ? '' : '<div class="tile-pop"><button class="tile-close" type="button">Close</button>' + card(h, i, {inPop:true}) + '</div>') +
    '</article>';
  }

  // Tour: the drive note + map buttons before each stop. No origin on purpose, so maps start
  // from wherever the client actually is (handles detours and skipped stops).
  function leg(i){
    var to = homes[i];
    var head = i === 0
      ? '<p><strong>Getting to the first stop.</strong> Tap a map below for directions from wherever you are.</p>'
      : '<p><strong>Next up: Stop ' + (i + 1) + '</strong>, ' + esc(to.address) + '.' + (to.time ? ' We\'re aiming to be there by ' + clock(to.time) + '.' : '') + '</p>';
    return '<div class="leg reveal"><div class="line"><span class="car">' + ICON.car + '</span></div><div class="leg-copy">' + head +
      (to.drive ? '<p>' + esc(to.drive) + '</p>' : '') +
      '<div class="actions">' + mapButtons(fullAddress(to)) + '</div></div></div>';
  }

  /* ---------- Add to calendar (tours) ----------
     Apple / Outlook get /homes/<page>.ics (built on deploy by scripts/build-previews.mjs, with reminders the
     morning of and 1 hour before); Google gets a prefilled event link. Times are Pacific. */
  function calTimes(){
    if(!TOUR || !D.date || !homes.length || !homes[0].time) return null;
    var last = homes[homes.length - 1].time || homes[0].time, p = last.split(':'), m = +p[0] * 60 + +p[1] + 30;
    var pad = function(n){ return (n < 10 ? '0' : '') + n; };
    return {start: homes[0].time, end: pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60)};
  }
  function calButton(){
    var t = calTimes(); if(!t) return '';
    var day = D.date.replace(/-/g, ''), stamp = function(hm){ return day + 'T' + hm.replace(':', '') + '00'; };
    var link = location.origin + '/homes/' + PAGE;
    var details = 'Showing details: ' + link + '\n\n' + homes.map(function(h){ return h._num + '. ' + clock(h.time) + '  ' + fullAddress(h); }).join('\n') +
      '\n\n' + AGENT.name + ' · ' + AGENT.phoneText;
    var google = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + enc('Home tour with ' + AGENT.name) +
      '&dates=' + stamp(t.start) + '/' + stamp(t.end) + '&ctz=America/Los_Angeles&location=' + enc(fullAddress(homes[0])) + '&details=' + enc(details);
    return '<details class="cal-pick"><summary class="btn btn-solid">' + ICON.cal + 'Add to my calendar</summary><div class="cal-menu">' +
      '<a class="btn btn-ghost" href="/homes/' + enc(PAGE) + '.ics">Apple or Outlook</a>' +
      '<a class="btn btn-ghost" href="' + google + '" target="_blank" rel="noopener">Google Calendar</a></div></details>';
  }

  /* ---------- Page sections ---------- */
  function intro(){
    var meta;
    if(TOUR){
      meta = (D.date ? '<span><strong>' + localDate(D.date, '12:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'}) + '</strong></span>' : '') +
        (homes[0] && homes[0].time ? '<span>Starts <strong>' + clock(homes[0].time) + '</strong></span>' : '') +
        '<span><strong>' + homes.length + '</strong> ' + (homes.length === 1 ? 'stop' : 'stops') + '</span>';
    } else {
      meta = '<span><strong>' + homes.length + (homes.length === 1 ? ' home' : ' homes') + '</strong> to look through</span>' + (D.area ? '<span>' + esc(D.area) + '</span>' : '') +
        (D.checked ? '<span class="checked">Prices &amp; open houses updated ' + esc(localDate(D.checked.slice(0, 10)).toLocaleDateString('en-US', {month:'short', day:'numeric'})) + '</span>' : '');
    }
    var routeAll = '', route = '';
    if(TOUR && homes.length > 1){
      var last = fullAddress(homes[homes.length - 1]), way = homes.slice(0, -1).map(fullAddress).join('|');
      route = '<a class="btn btn-ghost" href="https://www.google.com/maps/dir/?api=1&destination=' + enc(last) + '&waypoints=' + enc(way) + '&travelmode=driving" target="_blank" rel="noopener">' + ICON.route + 'See the whole route</a>';
    }
    if(route || HOMES_LINK) routeAll = '<div class="route-all">' + route + homesButton() + '</div>';
    return '<section class="intro"><div class="wrap">' +
      '<div class="eyebrow">' + (TOUR ? 'Your home tour' : (D.client ? 'Picked for ' + esc(D.client) : 'Homes picked for you')) + '</div>' +
      '<h1>' + esc(D.title || (TOUR ? 'Here\'s the plan for today' : 'A few homes I think you\'ll love')) + '</h1>' +
      (homes.length ? '<div class="meta">' + meta + '</div>' : '') +
      (TOUR ? calButton() : '') +
      (D.note ? '<div class="note"><img src="' + AGENT.photo + '" alt="' + AGENT.name + '"><p>' + esc(D.note) + '<span class="sig">' + AGENT.name + ' · ' + AGENT.phoneText + '</span></p></div>' : '') +
      (!TOUR && !D.sample && D.fubId ? '<p class="zillow-tip"><span aria-hidden="true">♡</span>Tap the heart on any home on Zillow and it\u2019ll show up here the next morning.</p>' : '') +
      routeAll + '</div></section>';
  }

  // Showcase: every home is a tile in a grid. Homes with an `added` stamp (sent after the link went out)
  // float to the top, newest batch first, each under a dated "Fresh picks" header; originals follow as "Past picks".
  // Saved-vs-shared filter only makes sense when the page has both kinds
  function hasBoth(){ var s = homes.filter(function(h){ return h.saved; }).length; return s > 0 && s < homes.length; }
  function initOriginFilter(){
    var bar = document.querySelector('.origin-filter'); if(!bar) return;
    bar.addEventListener('click', function(e){
      var b = e.target.closest('button[data-origin]'); if(!b) return;
      var want = b.dataset.origin;
      bar.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      document.querySelectorAll('#app .tile').forEach(function(t){ t.hidden = want !== 'all' && t.dataset.origin !== want; });
      // hide a group's header + grid when none of its homes are showing
      document.querySelectorAll('#app .past-grid').forEach(function(g){
        var any = [].some.call(g.querySelectorAll('.tile'), function(t){ return !t.hidden; });
        g.hidden = !any;
        var head = g.previousElementSibling;
        if(head && head.classList.contains('group-head')) head.hidden = !any;
      });
    });
  }

  function showcaseList(){
    var keys = [], byKey = {};
    homes.forEach(function(h){ var k = h.added || ''; if(!byKey[k]){ byKey[k] = []; keys.push(k); } byKey[k].push(h); });
    keys.sort(function(a, b){ return a === b ? 0 : (a < b ? 1 : -1); });    // newest first; '' (originals) sorts last
    var hasFresh = keys.some(Boolean);
    var batchesPerDay = {};
    keys.forEach(function(k){ if(k){ var d = k.slice(0, 10); batchesPerDay[d] = (batchesPerDay[d] || 0) + 1; } });
    homes = [].concat.apply([], keys.map(function(k){ return byKey[k]; }));   // display order (numbers stay fixed, see _num)

    var html = '', n = 0;
    if(hasBoth()){
      var nSaved = homes.filter(function(h){ return h.saved; }).length, nShared = homes.length - nSaved;
      html += '<div class="origin-filter reveal" role="group" aria-label="Show homes">' +
        '<button type="button" data-origin="all" aria-pressed="true">All <span>' + homes.length + '</span></button>' +
        '<button type="button" data-origin="saved" aria-pressed="false">You saved <span>' + nSaved + '</span></button>' +
        '<button type="button" data-origin="shared" aria-pressed="false">From ' + esc(AGENT.name.split(' ')[0]) + ' <span>' + nShared + '</span></button></div>';
    }
    keys.forEach(function(k){
      // Every home is a compact tile; the full card pops up on hover (computer) or opens on tap (phone).
      if(!hasFresh){ html += '<div class="past-grid">'; byKey[k].forEach(function(h){ html += tile(h, n++); }); html += '</div>'; return; }
      var stamp;
      if(k){
        // show the time when it helps tell batches apart (two adds that day, or added the day the link was sent)
        var showTime = batchesPerDay[k.slice(0, 10)] > 1 || k.slice(0, 10) === D.created;
        stamp = 'Added ' + dayLabel(k) + (showTime && timeLabel(k) ? ' at ' + timeLabel(k) : '');
      } else {
        stamp = D.created ? 'Sent ' + dayLabel(D.created) : '';
      }
      html += '<div class="group-head reveal' + (k ? ' is-fresh' : '') + '"><span class="eyebrow">' + (k ? 'Fresh picks' : 'Past picks') + '</span>' +
              (stamp ? '<span class="stamp">' + stamp + '</span>' : '') + '</div>';
      html += '<div class="past-grid' + (k ? ' fresh-grid' : '') + '">';
      byKey[k].forEach(function(h){ html += tile(h, n++); });
      html += '</div>';
    });
    return html;
  }

  function contact(){
    return '<section class="contact"><div class="wrap"><div class="eyebrow">Questions?</div>' +
      '<h2>' + (TOUR ? 'Running late or want to swap a stop?' : 'See one you like? Let\'s go take a look.') + '</h2>' +
      '<p>' + (TOUR ? 'Just call or text me and I\'ll adjust the plan.' : 'Text me which ones caught your eye and I\'ll set up a time to see them in person.') + '</p>' +
      '<div class="actions">' + textButton() + '<a class="btn btn-ghost" href="mailto:' + AGENT.email + '">Email me</a></div>' +
      '</div></section>';
  }

  // Shown instead of the page once it has expired, or after Joseph removes it from /admin.
  function renderClosed(removed){
    var copy = removed === 'cancelled'
      ? {title:'Tour cancelled', eyebrow:'This tour was cancelled', h1:'This tour is off.',
         lede:'If you added it to your calendar, you can delete it. Text me whenever you\'d like to set up a new time.'}
      : removed
      ? {title:'Page no longer available', eyebrow:'This page is no longer available', h1:'Thanks for looking!',
         lede:'Text me if you\'d like an updated list of homes, or to set up a time to see some in person.'}
      : TOUR
      ? {title:'Tour wrapped up', eyebrow:'This tour has wrapped up', h1:'Thanks for coming out!',
         lede:'Text me what you thought of the homes, or if you want to set up another tour.'}
      : {title:'Page expired', eyebrow:'This page has expired', h1:'These homes may have sold or changed price.',
         lede:'Text me and I\'ll send over an updated list with what\'s available right now.'};
    document.title = copy.title + ' · ' + AGENT.name;
    root.innerHTML = header(false) +
      '<main><section class="intro"><div class="wrap"><div class="eyebrow">' + copy.eyebrow + '</div>' +
      '<h1>' + copy.h1 + '</h1>' +
      '<p class="lede">' + copy.lede + '</p>' +
      '<div class="actions">' + textButton() + ((!removed || removed === 'cancelled') && HOMES_LINK ? homesButton() : '<a class="btn btn-ghost" href="/">Visit my site</a>') + '</div>' +
      '</div></section></main>';
  }

  function renderPage(){
    var list;
    if(!homes.length){
      list = '<p class="empty">No homes here yet. I\'ll add some soon, or text me what you\'re looking for.</p>';
    } else if(TOUR){
      list = homes.map(function(h, i){ return leg(i) + card(h, i); }).join('');
    } else {
      list = showcaseList();
    }
    root.innerHTML =
      (D.sample ? '<div class="sample-flag">Sample page. Homes shown are past Moein Group sales used as examples.</div>' : '') +
      header(true) +
      '<main>' + intro() + '<section class="list"><div class="wrap">' + list + '</div></section>' + contact() + '</main>' +
      footer();
  }

  /* ---------- Reactions: saved on the site via /api/reactions, so Joseph sees what the client tapped ---------- */
  function initReactions(saved){
    var state = saved || {}, seq = {};
    function paint(){
      document.querySelectorAll('.home[data-home], .tile[data-home]').forEach(function(el){
        var s = state[el.dataset.home] || {}, rx = REACTION[s.r];
        el.classList.toggle('rx-love', s.r === 'love');
        el.classList.toggle('rx-pass', s.r === 'pass');
        var b = el.querySelector('.react-badge');
        if(!b) return;
        b.hidden = !rx;
        b.title = rx ? rx.badge : '';
        if(rx) b.innerHTML = '<span aria-hidden="true">' + rx.icon + '</span><em>' + esc(rx.badge) + '</em>';
      });
      document.querySelectorAll('.react[data-home]').forEach(function(box){
        var s = state[box.dataset.home] || {}, editing = box.classList.contains('editing');
        box.querySelectorAll('.react-btn').forEach(function(btn){ btn.setAttribute('aria-pressed', String(btn.dataset.r === s.r)); });
        var form = box.querySelector('.react-note'), input = form.querySelector('input'), said = box.querySelector('.react-said');
        // note box: always open while editing; otherwise only after Love it / Not for me, until a note is saved
        form.hidden = VIEW_ONLY ? true : editing ? false : (!s.r || !!s.note);
        if(document.activeElement !== input) input.value = s.note || '';
        var by = box.querySelector('.react-by');
        by.hidden = s.by !== 'joseph';
        by.textContent = VIEW_ONLY ? 'You marked this one' : 'Joseph marked this one';
        said.hidden = !s.note || editing;
        if(s.note) said.innerHTML = '“' + esc(s.note) + '” <span>— ' + esc(D.client || 'You') +
          (s.at ? ', ' + new Date(s.at).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '') + '</span>' +
          (VIEW_ONLY ? '' : ' <button type="button" class="react-edit">Edit</button>');
      });
    }
    // asJoseph: his Not for me (or undo) from a device signed in on /admin; the client's note is left alone.
    function save(id, r, note, asJoseph){
      var prev = state[id], mine = seq[id] = (seq[id] || 0) + 1;    // newest tap wins if replies arrive out of order
      state[id] = (r || note) ? {r:r, note:note, at:new Date().toISOString(), by: asJoseph && r ? 'joseph' : prev && prev.r === r ? prev.by : undefined} : undefined;
      paint();
      var errs = document.querySelectorAll('.react[data-home="' + id + '"] .react-err');
      errs.forEach(function(e){ e.hidden = true; });
      var headers = {'Content-Type':'application/json'}, body = {page:PAGE, home:id, r:r, note:note};
      if(asJoseph){ headers.Authorization = 'Bearer ' + OWNER_KEY; body.by = 'joseph'; }
      fetch('/api/reactions', {method:'POST', headers:headers, keepalive:true, body: JSON.stringify(body)})
        .then(function(res){ if(!res.ok) throw new Error(res.status); return res.json(); })
        .then(function(d){ if(mine !== seq[id]) return; state[id] = d.reaction || undefined; paint(); })
        .catch(function(){ if(mine !== seq[id]) return; state[id] = prev; paint(); errs.forEach(function(e){ e.hidden = false; }); });
    }
    document.addEventListener('click', function(e){
      if(VIEW_ONLY){
        var mark = e.target.closest('.react-btn[data-r=pass]');
        if(mark){ var mid = mark.closest('.react').dataset.home, mcur = state[mid] || {}; save(mid, mcur.r === 'pass' ? '' : 'pass', mcur.note || '', true); }
        return;
      }
      var btn = e.target.closest('.react-btn');
      if(btn){
        var id = btn.closest('.react').dataset.home, cur = state[id] || {};
        save(id, cur.r === btn.dataset.r ? '' : btn.dataset.r, cur.note || '');   // tap again to undo (the note stays)
        return;
      }
      var edit = e.target.closest('.react-edit');
      if(edit){
        var box = edit.closest('.react'); box.classList.add('editing'); paint();
        var input = box.querySelector('.react-note input'); input.focus(); input.select();
      }
    });
    // A typed note saves on Send, and also as soon as the client taps away, closes the home or leaves the
    // page, so a note is never lost because they didn't hit Send. Same text is never sent twice.
    function commitNote(input){
      if(VIEW_ONLY || !input) return;
      var box = input.closest('.react'); if(!box) return;
      var id = box.dataset.home, cur = state[id] || {}, note = input.value.trim().slice(0, 300);
      if(note === (cur.note || '')) { box.classList.remove('editing'); paint(); return; }
      if(!note && !box.classList.contains('editing')) return;     // nothing typed; leave things as they were
      box.classList.remove('editing');
      save(id, cur.r || '', note);
    }
    document.addEventListener('submit', function(e){
      var form = e.target.closest('.react-note'); if(!form || VIEW_ONLY) return;
      e.preventDefault();
      var input = form.querySelector('input');
      commitNote(input); input.blur();
    });
    document.addEventListener('focusout', function(e){
      var input = e.target.closest && e.target.closest('.react-note input'); if(!input) return;
      // tapping this note's own Send button: let submit handle it
      if(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.react-note') === input.closest('.react-note')) return;
      commitNote(input);
    });
    function flushNotes(){ document.querySelectorAll('.react-note input').forEach(function(i){ if(i.value.trim()) commitNote(i); }); }
    window.addEventListener('pagehide', flushNotes);
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden') flushNotes(); });
    paint();
  }

  /* ---------- Page status from the site: saved reactions + whether Joseph removed the page ---------- */
  // A removal only counts if it happened after the page's latest update, so re-sending the
  // page (new `created`) or adding a fresh pick brings it back.
  function latestUpdate(){
    var s = [D.created || '', D.date || ''];
    homes.forEach(function(h){ if(h.added) s.push(h.added); });
    return s.sort().pop();
  }
  function loadStatus(){
    if(D.sample) return;
    fetch('/api/reactions?page=' + enc(PAGE), {cache:'no-store'})
      .then(function(res){ return res.ok ? res.json() : {}; })
      .catch(function(){ return {}; })
      .then(function(d){
        if(d.removedAt && d.removedAt.slice(0, 16) >= latestUpdate()){ renderClosed(true); return; }
        if(REACT) initReactions(d.reactions);
        if(OWNER) verifyOwner(function(){ initTourPicks(d.tourPicks || []); });
      });
  }

  /* ---------- Tour picks (Joseph only) ----------
     Tapping a home's number marks it for the next buyer tour. Picks save to /api/admin (needs his password)
     and Claude reads them back from /api/reactions when building the tour. */
  // Only unlock tour picks after the server confirms the saved password; a client (or anyone
  // poking at localStorage) gets a 401 and never sees the feature.
  function verifyOwner(then){
    fetch('/api/admin', {method:'POST', cache:'no-store',
      headers:{'Content-Type':'application/json', Authorization:'Bearer ' + OWNER_KEY},
      body: JSON.stringify({action:'check'})})
      .then(function(res){ if(res.ok) then(); })
      .catch(function(){});
  }
  function initTourPicks(saved){
    var picks = saved.filter(function(id){ return homes.some(function(h){ return h._id === id; }); });
    var byId = {}; homes.forEach(function(h){ byId[h._id] = h; });
    var timer = null, status = '';
    document.documentElement.classList.add('owner');
    var bar = document.createElement('div');
    bar.className = 'pick-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Tour picks (only you can see this)');
    document.body.appendChild(bar);

    function sorted(){ return picks.slice().sort(function(a, b){ return byId[a]._num - byId[b]._num; }); }
    function paint(){
      document.querySelectorAll('#app [data-home]').forEach(function(el){
        if(!el.matches('.home, .tile')) return;
        var on = picks.indexOf(el.dataset.home) > -1;
        el.classList.toggle('picked', on);
        var b = el.classList.contains('tile') ? el.querySelector(':scope > .tile-photo .tile-num') : el.querySelector('.badge');
        if(b){ b.setAttribute('role', 'button'); b.tabIndex = 0; b.setAttribute('aria-pressed', on ? 'true' : 'false');
               b.setAttribute('aria-label', (on ? 'Remove home ' : 'Add home ') + byId[el.dataset.home]._num + (on ? ' from' : ' to') + ' the tour'); }
      });
      var list = sorted();
      bar.hidden = !list.length;                     // nothing picked: no bar at all
      bar.innerHTML = list.length
        ? '<span class="pick-title">Tour picks</span><span class="pick-list">' + list.map(function(id){ return '#' + byId[id]._num; }).join(' · ') + '</span>' +
          '<button type="button" class="pick-copy">Copy for Claude</button><button type="button" class="pick-clear">Clear</button>' +
          (status ? '<span class="pick-status">' + esc(status) + '</span>' : '')
        : '';
    }
    function save(){
      clearTimeout(timer);
      timer = setTimeout(function(){
        fetch('/api/admin', {method:'POST', cache:'no-store',
          headers:{'Content-Type':'application/json', Authorization:'Bearer ' + OWNER_KEY},
          body: JSON.stringify({action:'tour-picks', page:PAGE, homes:sorted()})})
          .then(function(res){
            status = res.ok ? 'Saved' : res.status === 401 ? 'Sign in on /admin again to save' : 'Didn’t save, try again';
            paint();
          })
          .catch(function(){ status = 'Didn’t save, try again'; paint(); });
      }, 350);
    }
    function toggle(id){
      var i = picks.indexOf(id);
      if(i > -1) picks.splice(i, 1); else picks.push(id);
      status = 'Saving…'; paint(); save();
    }
    function copyText(){
      var name = D.client || PAGE;
      return 'Tour for ' + name + ' (' + location.host + '/homes/' + PAGE + '):\n' +
        sorted().map(function(id){ var h = byId[id]; return '#' + h._num + ' ' + fullAddress(h) + (h.mls ? ' (MLS ' + h.mls + ')' : ''); }).join('\n') +
        '\nDate and start time: ';
    }
    // Capture phase, so tapping a number never opens a tile or follows the photo link underneath.
    document.addEventListener('click', function(e){
      var b = e.target.closest('#app .badge, #app .tile-num');
      if(b){
        var el = b.closest('[data-home]'); if(!el) return;
        e.preventDefault(); e.stopPropagation(); toggle(el.dataset.home); return;
      }
      if(e.target.closest('.pick-clear')){ picks = []; status = 'Saving…'; paint(); save(); }
      if(e.target.closest('.pick-copy')){
        var t = copyText(), btn = e.target.closest('.pick-copy');
        var done = function(){ status = 'Copied, paste it to Claude with the date and time'; paint(); };
        if(navigator.clipboard) navigator.clipboard.writeText(t).then(done, function(){ prompt('Copy this:', t); });
        else prompt('Copy this:', t);
      }
    }, true);
    document.addEventListener('keydown', function(e){
      var b = e.target.closest && e.target.closest('#app .badge, #app .tile-num');
      if(b && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); e.stopPropagation(); var el = b.closest('[data-home]'); if(el) toggle(el.dataset.home); }
    }, true);
    paint();
  }

  /* ---------- Past-pick tiles ---------- */
  function initTiles(){
    var tiles = document.querySelectorAll('.tile:not(.is-unavailable)');
    if(!tiles.length) return;
    // Pop-up position: pick a side so it stays inside the grid, and shift it up if it would run past the bottom.
    function placePop(t){
      var g = t.parentNode.getBoundingClientRect(), r = t.getBoundingClientRect();
      t.dataset.align = (r.left - g.left < 10) ? 'left' : (g.right - r.right < 10 ? 'right' : 'center');
      var h = Math.min(t.querySelector('.tile-pop').scrollHeight, innerHeight - 24), top = -10;
      if(r.top + top + h > innerHeight - 12) top = innerHeight - 12 - h - r.top;
      if(r.top + top < 12) top = 12 - r.top;
      t.style.setProperty('--pop-top', Math.round(top) + 'px');
    }
    if(matchMedia('(hover: hover) and (pointer: fine)').matches){
      var queued = false;
      var placeAll = function(){ tiles.forEach(placePop); };
      var placeHovered = function(){
        if(queued) return; queued = true;
        requestAnimationFrame(function(){ queued = false; var t = document.querySelector('.tile:hover, .tile:focus-within'); if(t) placePop(t); });
      };
      placeAll();                                   // sides set up front, so hidden pop-ups never widen the page
      addEventListener('resize', placeAll);
      addEventListener('scroll', placeHovered, {passive:true});
      tiles.forEach(function(t){
        t.addEventListener('mouseenter', function(){ placePop(t); });
        t.addEventListener('focusin', function(){ placePop(t); });
      });
    } else {
      var toggle = function(t, open){
        t.classList.toggle('open', open);
        if(open) setTimeout(function(){ t.scrollIntoView({behavior:'smooth', block:'start'}); }, 60);
      };
      tiles.forEach(function(t){
        t.addEventListener('click', function(e){
          if(e.target.closest('a')) return;                                   // links inside the card still work
          var open = t.classList.contains('open');
          if(open && !e.target.closest('.tile-close') && e.target.closest('.tile-pop')) return;
          toggle(t, !open);
        });
        t.addEventListener('keydown', function(e){
          if(e.target === t && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); toggle(t, !t.classList.contains('open')); }
        });
      });
    }
  }

  /* ---------- Tour day: highlight the current stop, fade the ones already seen ---------- */
  function initLiveTour(){
    if(!TOUR || !D.date) return;
    function at(t){ return localDate(D.date, t).getTime(); }
    function live(){
      var now = Date.now(), early = 15 * 60000;
      homes.forEach(function(h, i){
        var el = document.getElementById('stop-' + (i + 1)); if(!el || !h.time) return;
        var next = homes[i + 1] && homes[i + 1].time ? at(homes[i + 1].time) - early : at(h.time) + 45 * 60000;
        el.classList.toggle('now', now >= at(h.time) - early && now < next);
        el.classList.toggle('done', now >= next);
      });
    }
    live(); setInterval(live, 60000);
  }

  /* ---------- Fade sections in as they scroll into view ---------- */
  function initReveal(){
    var els = document.querySelectorAll('.reveal');
    if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches){
      els.forEach(function(e){ e.classList.add('in'); }); return;
    }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    }, {threshold:.12, rootMargin:'0px 0px -30px 0px'});
    els.forEach(function(e){ io.observe(e); });
  }

  /* ---------- Deep link: /homes/<page>#h-<homeId> (used by Joseph's /admin reaction feed) ----------
     Scrolls to that home. A Past pick opens its pop-up card (hover view on a computer, tapped-open on a phone);
     a Fresh pick gets a short highlight. */
  function initDeepLink(){
    function go(){
      var m = /^#h-([A-Za-z0-9-]{1,80})$/.exec(location.hash);
      if(!m) return;
      var el = document.querySelector('.tile[data-home="' + m[1] + '"]') ||
               document.querySelector('#app .home[data-home="' + m[1] + '"]:not(.tile-pop .home)');
      if(!el) return;
      el.classList.add('in');
      if(el.classList.contains('tile')){
        if(matchMedia('(hover: hover) and (pointer: fine)').matches){
          el.scrollIntoView({block:'center'});
          setTimeout(function(){ el.focus({preventScroll:true}); }, 80);   // focus opens the pop-up, same as hovering
        } else if(!el.classList.contains('open')){
          el.click();                                                        // same as tapping it
        }
      } else {
        el.scrollIntoView({block:'center'});
        el.classList.remove('spotlight'); void el.offsetWidth; el.classList.add('spotlight');
      }
    }
    setTimeout(go, 150);
    addEventListener('hashchange', go);
  }

  /* ---------- Go ---------- */
  validate();
  if(TOUR && D.cancelled){ renderClosed('cancelled'); return; }
  var exp = expiresAt();
  if(exp && new Date() >= exp){ renderClosed(false); return; }
  renderPage();
  initMapLinks();
  loadStatus();
  initTiles();
  initLiveTour();
  initReveal();
  initDeepLink();
  if(!TOUR) initOriginFilter();
})();
