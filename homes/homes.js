/* Renders a client showcase or buyer tour page from window.HOMES (set in each page).
   mode: "showcase" → list of homes with directions buttons on each
   mode: "tour"     → stops in order with times, a drive leg between each stop,
                      and the current stop highlighted on tour day. */
(function(){
  document.documentElement.classList.add('js');
  var D = window.HOMES || {};
  var tour = D.mode === 'tour';
  var homes = D.listings || [];
  var PHONE = '+17145075438', PHONE_TXT = '(714) 507-5438', EMAIL = 'josephibarra@firstteam.com';
  var root = document.getElementById('app');

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function enc(s){return encodeURIComponent(s)}
  function full(h){return h.address + ', ' + h.city}
  function gmaps(dest, origin){return 'https://www.google.com/maps/dir/?api=1' + (origin?'&origin='+enc(origin):'') + '&destination='+enc(dest) + '&travelmode=driving'}
  function apple(dest, origin){return 'https://maps.apple.com/?' + (origin?'saddr='+enc(origin)+'&':'') + 'daddr='+enc(dest) + '&dirflg=d'}
  function sms(h){return 'sms:'+PHONE+'?&body='+enc('Hi Joseph, about '+h.address+': ')}
  function money(n){return typeof n==='number' ? '$'+n.toLocaleString('en-US') : esc(n)}
  function clock(t){ if(!t) return ''; var p=t.split(':'),h=+p[0],m=p[1]; return (h%12||12)+':'+m+' '+(h<12?'AM':'PM') }
  function when(t){ return new Date(D.date+'T'+t+':00') }

  var I = {
    pin:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    out:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    msg:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    car:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14M6 17v2M18 17v2M4 13l2-5a2 2 0 0 1 2-1.3h8a2 2 0 0 1 2 1.3l2 5v4H4z"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/></svg>',
    route:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/></svg>'
  };

  function mapButtons(dest, origin, small){
    return '<a class="btn btn-solid" href="'+gmaps(dest,origin)+'" target="_blank" rel="noopener">'+I.pin+'Google Maps</a>'+
           '<a class="btn btn-ghost" href="'+apple(dest,origin)+'" target="_blank" rel="noopener">'+I.pin+'Apple Maps</a>';
  }

  function leg(i){
    var to = homes[i], from = homes[i-1];
    var head = i===0
      ? '<p><strong>Getting to the first stop.</strong> Tap a map below for directions from wherever you are.</p>'
      : '<p><strong>Next up: Stop '+(i+1)+'</strong>, '+esc(to.address)+'.'+(to.time?' We\'re aiming to be there by '+clock(to.time)+'.':'')+'</p>';
    return '<div class="leg reveal"><div class="line"><span class="car">'+I.car+'</span></div><div class="leg-copy">'+head+
      (to.drive?'<p>'+esc(to.drive)+'</p>':'')+
      // no origin on purpose: maps start from wherever the client actually is (handles detours/skipped stops)
      '<div class="actions">'+mapButtons(full(to))+'</div></div></div>';
  }

  function card(h,i){
    var specs = [];
    if(h.beds!=null) specs.push('<li><strong>'+esc(h.beds)+'</strong> bd</li>');
    if(h.baths!=null) specs.push('<li><strong>'+esc(h.baths)+'</strong> ba</li>');
    if(h.sqft) specs.push('<li><strong>'+Number(h.sqft).toLocaleString('en-US')+'</strong> sq ft</li>');
    if(h.lot) specs.push('<li><strong>'+esc(h.lot)+'</strong> lot</li>');
    if(h.year) specs.push('<li>Built <strong>'+esc(h.year)+'</strong></li>');
    if(h.hoa) specs.push('<li>HOA <strong>'+esc(h.hoa)+'</strong></li>');
    var acts = '';
    if(!tour) acts += '<a class="btn btn-solid" href="'+gmaps(full(h))+'" target="_blank" rel="noopener">'+I.pin+'Google Maps</a><a class="btn btn-ghost" href="'+apple(full(h))+'" target="_blank" rel="noopener">'+I.pin+'Apple Maps</a>';
    if(h.url) acts += '<a class="btn btn-soft" href="'+esc(h.url)+'" target="_blank" rel="noopener">Full listing '+I.out+'</a>';
    acts += '<a class="btn btn-soft" href="'+sms(h)+'">'+I.msg+'Text me about it</a>';
    return '<article class="home reveal" id="stop-'+(i+1)+'">'+
      '<div class="photo">'+(h.photo?'<img src="'+esc(h.photo)+'" alt="'+esc(h.address)+'"'+(i>0?' loading="lazy"':'')+'>':'')+
        '<span class="badge"><b>'+(i+1)+'</b>'+(tour?'Stop '+(i+1)+' of '+homes.length:'Home '+(i+1)+' of '+homes.length)+'</span>'+
        (h.status?'<span class="status">'+esc(h.status)+'</span>':'')+
      '</div>'+
      '<div class="body">'+
        '<div class="headline"><span class="price">'+money(h.price)+'</span>'+
          (tour&&h.time?'<span class="time"><span class="btn now-pill" style="min-height:24px;padding:0 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-right:8px">Now</span>'+clock(h.time)+'</span>':'')+'</div>'+
        '<div class="addr">'+esc(h.address)+'<span>'+esc(h.city)+'</span></div>'+
        (specs.length?'<ul class="specs">'+specs.join('')+'</ul>':'')+
        (h.why?'<div class="why"><span class="eyebrow">Why I picked this one</span><p>'+esc(h.why)+'</p></div>':'')+
        (h.headsUp?'<p class="heads-up"><strong>Heads up:</strong> '+esc(h.headsUp)+'</p>':'')+
        '<div class="actions">'+acts+'</div>'+
      '</div></article>';
  }

  var html = '';
  if(D.sample) html += '<div class="sample-flag">Sample page. Homes shown are past Moein Group sales used as examples.</div>';
  html += '<header class="top"><div class="wrap"><a class="brand" href="/">Joseph Ibarra<small>REALTOR® · First Team Real Estate</small></a>'+
          '<a class="btn btn-solid" href="tel:'+PHONE+'">Call or text</a></div></header>';

  var count = homes.length + (homes.length===1?' home':' homes');
  var eyebrow = tour ? 'Your home tour' : (D.client ? 'Picked for ' + esc(D.client) : 'Homes picked for you');
  var meta = tour
    ? '<span><strong>'+new Date(D.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+'</strong></span>'+
      (homes[0]&&homes[0].time?'<span>Starts <strong>'+clock(homes[0].time)+'</strong></span>':'')+'<span><strong>'+homes.length+'</strong> stops</span>'
    : '<span><strong>'+count+'</strong> to look through</span>'+(D.area?'<span>'+esc(D.area)+'</span>':'');
  var routeAll = '';
  if(tour && homes.length>1){
    var last = full(homes[homes.length-1]);
    var way = homes.slice(0,-1).map(full).join('|');
    routeAll = '<div class="route-all"><a class="btn btn-ghost" href="https://www.google.com/maps/dir/?api=1&destination='+enc(last)+'&waypoints='+enc(way)+'&travelmode=driving" target="_blank" rel="noopener">'+I.route+'See the whole route</a></div>';
  }
  html += '<main><section class="intro"><div class="wrap">'+
    '<div class="eyebrow">'+eyebrow+'</div>'+
    '<h1>'+esc(D.title || (tour ? 'Here\'s the plan for today' : 'A few homes I think you\'ll love'))+'</h1>'+
    '<div class="meta">'+meta+'</div>'+
    (D.note?'<div class="note"><img src="/images/joseph-ibarra.jpg" alt="Joseph Ibarra"><p>'+esc(D.note)+'<span class="sig">Joseph Ibarra · '+PHONE_TXT+'</span></p></div>':'')+
    routeAll+
    '</div></section>';

  html += '<section class="list"><div class="wrap">';
  homes.forEach(function(h,i){ if(tour) html += leg(i); html += card(h,i); });
  html += '</div></section>';

  html += '<section class="contact"><div class="wrap"><div class="eyebrow" style="color:var(--slate-tint)">Questions?</div>'+
    '<h2>'+(tour?'Running late or want to swap a stop?':'See one you like? Let\'s go take a look.')+'</h2>'+
    '<p>'+(tour?'Just call or text me and I\'ll adjust the plan.':'Text me which ones caught your eye and I\'ll set up a time to see them in person.')+'</p>'+
    '<div class="actions"><a class="btn btn-solid" href="sms:'+PHONE+'">'+I.msg+'Text '+PHONE_TXT+'</a><a class="btn btn-ghost" href="mailto:'+EMAIL+'">Email me</a></div>'+
    '</div></section></main>';
  html += '<footer><div class="wrap"><div class="logos"><img src="/images/moein-group.png" alt="Moein Group Real Estate"><i aria-hidden="true"></i><img src="/images/first-team.jpg" alt="First Team Real Estate"></div>'+
    '<p class="legal">Joseph Ibarra, REALTOR® · DRE #02244753 · First Team Real Estate · Moein Group. Listing information is deemed reliable but not guaranteed and should be independently verified.</p></div></footer>';

  root.innerHTML = html;

  // Tour day: highlight the current stop and fade the ones already seen
  function live(){
    if(!tour || !D.date) return;
    var now = new Date(), early = 15*60000;
    homes.forEach(function(h,i){
      var el = document.getElementById('stop-'+(i+1)); if(!el || !h.time) return;
      var start = when(h.time).getTime() - early;
      var next = homes[i+1] && homes[i+1].time ? when(homes[i+1].time).getTime() - early : when(h.time).getTime() + 45*60000;
      el.classList.toggle('now', now >= start && now < next);
      el.classList.toggle('done', now >= next);
    });
  }
  live(); setInterval(live, 60000);

  // Fade sections in as they scroll into view
  var els = document.querySelectorAll('.reveal');
  if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches){ els.forEach(function(e){e.classList.add('in')}); return; }
  var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } }); }, {threshold:.12, rootMargin:'0px 0px -30px 0px'});
  els.forEach(function(e){ io.observe(e) });
})();
