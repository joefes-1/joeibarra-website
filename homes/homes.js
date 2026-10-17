/* Client homes pages (/homes/*.html)
   Each page sets window.HOMES and loads this file, which renders everything into #app.

   window.HOMES = {
     mode:       "showcase" | "tour",
     page:       "dolce-ibarra",        // fixed id for saved reactions; matches the file name
     client:     "Dolce",               // first name, used in headings and reaction badges
     created:    "2026-10-16",          // showcase: expires 30 days after this (or the newest `added`)
     expiresDays: 30,                   // optional override
     date:       "2026-10-17",          // tour only: the tour day (page shuts off 2 days after)
     sample:     true,                  // sample pages: banner, no expiry, no reactions
     title, note, area, whyLabel,
     listings: [{ address, city, mls, price, status, beds, baths, sqft, lot, year, hoa,
                  photo, url (RealScout listing link; Zillow as a fallback), why, headsUp,
                  added: "2026-10-18T14:20",   // showcase: added after the link went out -> Fresh pick
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
  var REACT = !TOUR && !D.sample;            // Love it / Not for me buttons on real showcase pages
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
  function clock(t){ if(!t) return ''; var p = t.split(':'), h = +p[0]; return (h % 12 || 12) + ':' + p[1] + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function localDate(ymd, hm){ return new Date(ymd + 'T' + (hm || '00:00') + ':00'); }       // "2026-10-18", "14:20"
  function stampDate(s){ return localDate(s.slice(0, 10), s.length > 10 ? s.slice(11, 16) : null); }  // "2026-10-18[T14:20]"
  function dayLabel(s){ return stampDate(s).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'}); }
  function timeLabel(s){ return s.length > 10 ? clock(s.slice(11, 16)) : ''; }
  function homeId(h, i){ return String(h.mls || h.address || ('home-' + (i + 1))).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
  homes.forEach(function(h, i){ h._id = homeId(h, i); });
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
  function textButton(){ return '<a class="btn btn-solid" href="sms:' + AGENT.phone + '">' + ICON.msg + 'Text ' + AGENT.phoneText + '</a>'; }
  function footer(){
    return '<footer><div class="wrap"><div class="logos"><img src="/images/moein-group.png" alt="Moein Group Real Estate"><i aria-hidden="true"></i><img src="/images/first-team.jpg" alt="First Team Real Estate"></div>' +
      '<p class="legal">' + AGENT.name + ', REALTOR® · DRE #' + AGENT.dre + ' · First Team Real Estate · Moein Group. Listing information is deemed reliable but not guaranteed and should be independently verified.</p></div></footer>';
  }
  function mapButtons(dest){
    return '<a class="btn btn-solid" href="' + gmaps(dest) + '" target="_blank" rel="noopener">' + ICON.pin + 'Google Maps</a>' +
           '<a class="btn btn-ghost" href="' + apple(dest) + '" target="_blank" rel="noopener">' + ICON.pin + 'Apple Maps</a>';
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

  function reactBlock(h){
    if(!REACT) return '';
    return '<div class="react" data-home="' + h._id + '"><span class="react-q">What do you think?</span>' +
      '<div class="react-btns">' + ['love', 'pass'].map(function(k){
        return '<button type="button" class="react-btn" data-r="' + k + '" aria-pressed="false"><span aria-hidden="true">' + REACTION[k].icon + '</span>' + REACTION[k].label + '</button>';
      }).join('') + '</div>' +
      '<form class="react-note" hidden><input type="text" maxlength="300" placeholder="Want to tell me why? (optional)" aria-label="Note for Joseph"><button type="submit" class="btn btn-soft">Send</button></form>' +
      '<p class="react-said" hidden></p><p class="react-err" hidden>That didn’t save. Check your connection and try again.</p></div>';
  }

  // Full listing card. opts.inPop: the copy shown inside a past-pick tile (no reveal animation, no id).
  function card(h, i, opts){
    opts = opts || {};
    var url = safeUrl(h.url), photo = safeUrl(h.photo), fresh = !TOUR && !!h.added;
    var img = photo ? '<img src="' + esc(photo) + '" alt="' + esc(h.address) + '"' + (i > 0 ? ' loading="lazy"' : '') + '>' : '';
    if(img && !TOUR && url){   // showcase: the whole photo opens the full listing (Joseph's RealScout, or Zillow)
      var hint = /zillow\.com/i.test(url) ? 'View on Zillow' : 'See full listing';
      img = '<a class="photo-link" href="' + esc(url) + '" target="_blank" rel="noopener" aria-label="' + hint + ': ' + esc(h.address) + '">' + img +
            '<span class="photo-hint">' + hint + ' ' + ICON.out + '</span></a>';
    }
    var acts = (TOUR ? '' : mapButtons(fullAddress(h))) +
      (url ? '<a class="btn btn-soft" href="' + esc(url) + '" target="_blank" rel="noopener">Full listing ' + ICON.out + '</a>' : '') +
      '<a class="btn btn-soft" href="' + sms(h) + '">' + ICON.msg + 'Text me about it</a>';
    var cls = 'home' + (opts.inPop ? '' : ' reveal') + (fresh ? ' is-fresh' : '');
    return '<article class="' + cls + '"' + (REACT ? ' data-home="' + h._id + '"' : '') + (opts.inPop ? '' : ' id="stop-' + (i + 1) + '"') + '>' +
      '<div class="photo">' + img +
        (TOUR ? '<span class="badge" aria-label="Stop ' + h._num + ' of ' + homes.length + '"><b>' + h._num + '</b>of ' + homes.length + '</span>'
               : '<span class="badge solo" aria-label="Home ' + h._num + '"><b>' + h._num + '</b></span>') +
        (h.status ? '<span class="status">' + esc(h.status) + '</span>' : '') +
        (REACT ? '<span class="react-badge" hidden></span>' : '') +
      '</div>' +
      '<div class="body">' +
        '<div class="headline"><span class="price">' + money(h.price) + '</span>' +
          (fresh ? '<span class="fresh-pill">Fresh pick</span>' : '') +
          (TOUR && h.time ? '<span class="time"><span class="now-pill">Now</span>' + clock(h.time) + '</span>' : '') + '</div>' +
        '<div class="addr">' + esc(h.address) + (h.city ? '<span>' + esc(h.city) + '</span>' : '') + '</div>' +
        specsList(h) +
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
    var photo = safeUrl(h.photo);
    return '<article class="tile reveal"' + (REACT ? ' data-home="' + h._id + '"' : '') + ' tabindex="0" aria-label="' + esc(h.address) + ', ' + money(h.price) + '. Show details">' +
      '<div class="tile-photo">' + (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy">' : '') + '<span class="tile-num">' + h._num + '</span>' +
        (REACT ? '<span class="react-badge" hidden></span>' : '') + '</div>' +
      '<div class="tile-body"><span class="tile-price">' + money(h.price) + '</span><span class="tile-addr">' + esc(h.address) + '</span>' +
        '<span class="tile-specs">' + bits.join(' · ') + '</span><span class="tile-more">See details</span></div>' +
      '<div class="tile-pop"><button class="tile-close" type="button">Close</button>' + card(h, i, {inPop:true}) + '</div>' +
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

  /* ---------- Page sections ---------- */
  function intro(){
    var meta;
    if(TOUR){
      meta = (D.date ? '<span><strong>' + localDate(D.date, '12:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'}) + '</strong></span>' : '') +
        (homes[0] && homes[0].time ? '<span>Starts <strong>' + clock(homes[0].time) + '</strong></span>' : '') +
        '<span><strong>' + homes.length + '</strong> ' + (homes.length === 1 ? 'stop' : 'stops') + '</span>';
    } else {
      meta = '<span><strong>' + homes.length + (homes.length === 1 ? ' home' : ' homes') + '</strong> to look through</span>' + (D.area ? '<span>' + esc(D.area) + '</span>' : '');
    }
    var routeAll = '';
    if(TOUR && homes.length > 1){
      var last = fullAddress(homes[homes.length - 1]), way = homes.slice(0, -1).map(fullAddress).join('|');
      routeAll = '<div class="route-all"><a class="btn btn-ghost" href="https://www.google.com/maps/dir/?api=1&destination=' + enc(last) + '&waypoints=' + enc(way) + '&travelmode=driving" target="_blank" rel="noopener">' + ICON.route + 'See the whole route</a></div>';
    }
    return '<section class="intro"><div class="wrap">' +
      '<div class="eyebrow">' + (TOUR ? 'Your home tour' : (D.client ? 'Picked for ' + esc(D.client) : 'Homes picked for you')) + '</div>' +
      '<h1>' + esc(D.title || (TOUR ? 'Here\'s the plan for today' : 'A few homes I think you\'ll love')) + '</h1>' +
      (homes.length ? '<div class="meta">' + meta + '</div>' : '') +
      (D.note ? '<div class="note"><img src="' + AGENT.photo + '" alt="' + AGENT.name + '"><p>' + esc(D.note) + '<span class="sig">' + AGENT.name + ' · ' + AGENT.phoneText + '</span></p></div>' : '') +
      routeAll + '</div></section>';
  }

  // Showcase order: homes with an `added` stamp (sent after the link went out) float to the top,
  // newest batch first, each under a dated header. Originals become the "Past picks" tile grid.
  function showcaseList(){
    var keys = [], byKey = {};
    homes.forEach(function(h){ var k = h.added || ''; if(!byKey[k]){ byKey[k] = []; keys.push(k); } byKey[k].push(h); });
    keys.sort(function(a, b){ return a === b ? 0 : (a < b ? 1 : -1); });    // newest first; '' (originals) sorts last
    var hasFresh = keys.some(Boolean);
    var batchesPerDay = {};
    keys.forEach(function(k){ if(k){ var d = k.slice(0, 10); batchesPerDay[d] = (batchesPerDay[d] || 0) + 1; } });
    homes = [].concat.apply([], keys.map(function(k){ return byKey[k]; }));   // display order (numbers stay fixed, see _num)

    var html = '', n = 0;
    keys.forEach(function(k){
      if(!hasFresh){ byKey[k].forEach(function(h){ html += card(h, n++); }); return; }
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
      if(k){
        byKey[k].forEach(function(h){ html += card(h, n++); });
      } else {
        html += '<div class="past-grid">';
        byKey[k].forEach(function(h){ html += tile(h, n++); });
        html += '</div>';
      }
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
    var copy = removed
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
      '<div class="actions">' + textButton() + '<a class="btn btn-ghost" href="/">Visit my site</a></div>' +
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
        form.hidden = editing ? false : (!s.r || !!s.note);
        if(document.activeElement !== input) input.value = s.note || '';
        said.hidden = !s.note || editing;
        if(s.note) said.innerHTML = '“' + esc(s.note) + '” <span>— ' + esc(D.client || 'You') +
          (s.at ? ', ' + new Date(s.at).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '') + '</span> <button type="button" class="react-edit">Edit</button>';
      });
    }
    function save(id, r, note){
      var prev = state[id], mine = seq[id] = (seq[id] || 0) + 1;    // newest tap wins if replies arrive out of order
      state[id] = (r || note) ? {r:r, note:note, at:new Date().toISOString()} : undefined;
      paint();
      var errs = document.querySelectorAll('.react[data-home="' + id + '"] .react-err');
      errs.forEach(function(e){ e.hidden = true; });
      fetch('/api/reactions', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({page:PAGE, home:id, r:r, note:note})})
        .then(function(res){ if(!res.ok) throw new Error(res.status); return res.json(); })
        .then(function(d){ if(mine !== seq[id]) return; state[id] = d.reaction || undefined; paint(); })
        .catch(function(){ if(mine !== seq[id]) return; state[id] = prev; paint(); errs.forEach(function(e){ e.hidden = false; }); });
    }
    document.addEventListener('click', function(e){
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
    document.addEventListener('submit', function(e){
      var form = e.target.closest('.react-note'); if(!form) return;
      e.preventDefault();
      var box = form.closest('.react'), id = box.dataset.home, input = form.querySelector('input');
      box.classList.remove('editing'); input.blur();
      save(id, (state[id] || {}).r || '', input.value.trim().slice(0, 300));
    });
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
      });
  }

  /* ---------- Past-pick tiles ---------- */
  function initTiles(){
    var tiles = document.querySelectorAll('.tile');
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

  /* ---------- Go ---------- */
  validate();
  var exp = expiresAt();
  if(exp && new Date() >= exp){ renderClosed(false); return; }
  renderPage();
  loadStatus();
  initTiles();
  initLiveTour();
  initReveal();
})();
