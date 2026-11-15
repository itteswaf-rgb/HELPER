/* HELPER web app (the website version of ResQ).
   One page (app/index.html), several views chosen by the URL hash:
   #/login  #/register  #/dashboard  #/report  #/map  #/incident/<id>  #/authority
   Staff (admin / reviewer) sign in with your REAL backend; citizens use the demo layer (demo.js).
   All text from users is inserted with el()/textContent, never innerHTML, so it cannot inject HTML. */
(function () {
  'use strict';
  const { api, el, fill, badge, fmtDateTime } = window.HELPER;
  const D = window.HELPER_DEMO;
  const view = document.getElementById('view');
  const navBox = document.getElementById('nav');
  const authBox = document.getElementById('auth');

  const TYPES = {
    sos: ['SOS', '!'], medical: ['Medical', '\u271A'], fire: ['Fire', '\u2668'], crime: ['Crime', '\u25C8'],
    accident: ['Accident', '\u26A0'], disaster: ['Natural disaster', '\u2691'], other: ['Other', '\uFF0B'],
  };
  const STATUS = { pending: 'Pending', dispatched: 'Responders dispatched', on_the_way: 'Help on the way', resolved: 'Resolved', false_alarm: 'False alarm' };
  const STEPS = ['pending', 'dispatched', 'on_the_way', 'resolved'];
  const HINTS = { // tiny "auto-categorise" helper; a real AI model replaces this later
    fire: /fire|smoke|burn|flame/i, medical: /injur|bleed|unconscious|heart|ambulance|collapse/i,
    accident: /crash|accident|collision|hit by/i, crime: /rob|theft|steal|attack|weapon|knife|gun|assault/i,
    disaster: /flood|earthquake|landslide|storm|cyclone/i,
  };

  let user = null;          // { id, name, role: 'citizen' | 'admin' | 'reviewer' }
  let center = D.HOME;      // map centre; becomes the user's GPS position when allowed
  let stop = null;          // cleanup function of the current view
  let sosTimer = null;
  let token = 0;

  const isStaff = () => !!user && user.role !== 'citizen';
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
  const guess = (t) => Object.keys(HINTS).find((k) => HINTS[k].test(t)) || null;
  const shorten = (t) => (t.length > 90 ? t.slice(0, 90) + '\u2026' : t);
  const field = (text, node) => el('label', { class: 'f' }, text, node);
  const reporter = (i) => (isStaff() ? i.reporterName + (i.anonymous ? ' (anonymous to the public)' : '') : (i.anonymous ? 'Anonymous' : i.reporterName));

  async function whoAmI() {
    const c = D.me();
    if (c) return c;
    try { return (await api.get('/api/auth/me')).user; } catch (e) { return null; }
  }
  const locate = () => new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok(null), { timeout: 8000 });
  });
  function live(render) { render(); return D.onChange(render); } // draw now, redraw whenever data changes (any tab)

  // ------------------------------------------------------------ map widget
  // CSP blocks outside map tiles, so this is a schematic map: markers are placed by latitude/longitude.
  function mapView(items, opts) {
    const c = opts.center || center, W = 0.12, H = 0.075;
    const box = el('div', { class: 'map', role: 'img', 'aria-label': 'Schematic map of incidents' });
    const place = (node, p) => { node.style.left = ((p.lng - c.lng) / W + 0.5) * 100 + '%'; node.style.top = (0.5 - (p.lat - c.lat) / H) * 100 + '%'; return node; };
    items.forEach((i) => box.append(place(el('button', {
      type: 'button', class: 'pin t-' + i.type + (D.isOpen(i) ? '' : ' done'),
      title: TYPES[i.type][0] + ' \u00B7 ' + STATUS[i.status], 'aria-label': TYPES[i.type][0] + ', ' + STATUS[i.status],
      onclick: () => opts.onPick && opts.onPick(i),
    }, TYPES[i.type][1]), i)));
    if (opts.me) box.append(place(el('span', { class: 'me', title: 'Your position' }), opts.me));
    let sel = null;
    box.pick = (p) => { sel = sel || box.appendChild(el('span', { class: 'pin picked', title: 'Selected location' }, '\u2316')); place(sel, p); };
    if (opts.picker) {
      box.classList.add('pickable');
      box.addEventListener('click', (e) => {
        if (e.target !== box) return;
        const r = box.getBoundingClientRect();
        const p = { lat: c.lat + (0.5 - (e.clientY - r.top) / r.height) * H, lng: c.lng + ((e.clientX - r.left) / r.width - 0.5) * W };
        box.pick(p); opts.picker(p);
      });
    }
    return box;
  }
  const incidentCard = (i) => el('div', { class: 'record' },
    el('b', { class: 'ico t-' + i.type, text: TYPES[i.type][1] }),
    el('div', null, el('h3', null, TYPES[i.type][0] + ' ', badge(i.label)),
      el('p', null, shorten(i.description)), el('small', null, STATUS[i.status] + ' \u00B7 ' + fmtDateTime(i.created))),
    el('a', { class: 'btn outline small', href: '#/incident/' + i.id }, 'Open'));
  const listOf = (items, empty) => (items.length ? items.map(incidentCard) : el('div', { class: 'state' }, empty));

  // ------------------------------------------------------------------- SOS
  function sosButton() {
    const note = el('p', { class: 'who', role: 'status' });
    const btn = el('button', { type: 'button', class: 'sos', 'aria-label': 'Send SOS alert' }, 'SOS');
    btn.addEventListener('click', () => {
      if (sosTimer) { clearInterval(sosTimer); sosTimer = null; btn.textContent = 'SOS'; note.textContent = 'SOS cancelled.'; return; }
      let n = 5;
      btn.textContent = 'Cancel ' + n;
      note.textContent = 'Sending your SOS with your location. Tap again to cancel.';
      sosTimer = setInterval(async () => {
        n -= 1; btn.textContent = 'Cancel ' + n;
        if (n > 0) return;
        clearInterval(sosTimer); sosTimer = null; btn.textContent = 'SOS';
        const p = (await locate()) || center;
        try { go('#/incident/' + D.create({ type: 'sos', description: 'SOS: immediate help requested.', lat: p.lat, lng: p.lng, sos: true }, user).id); }
        catch (ex) { note.textContent = ex.message; }
      }, 1000);
    });
    return el('div', { class: 'sos-box' }, btn, note);
  }

  // ----------------------------------------------------------------- login
  function login() {
    const err = el('div', { class: 'form-error', role: 'alert' });
    const email = el('input', { type: 'email', autocomplete: 'username', required: true });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', required: true });
    const form = el('form', { class: 'card narrow-form', novalidate: true }, el('small', null, 'SIGN IN'),
      el('h1', null, 'Welcome to HELPER'), el('p', { class: 'who' }, 'Citizens and staff (admin / reviewer) sign in here.'),
      field('Email address', email), field('Password', pw), err,
      el('button', { class: 'btn', type: 'submit' }, 'Sign in \u2192'),
      el('p', { class: 'who' }, 'No account? ', el('a', { class: 'src-link', href: '#/register' }, 'Create a citizen account')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        let u = await D.login(email.value, pw.value);                                                // 1) demo citizen
        if (!u) u = (await api.post('/api/auth/login', { email: email.value.trim(), password: pw.value })).user; // 2) real staff
        go(u.role === 'citizen' ? '#/dashboard' : '#/authority');
      } catch (ex) { err.textContent = (ex.details && Object.values(ex.details)[0]) || ex.message; pw.value = ''; }
    });
    fill(view, form);
  }

  // -------------------------------------------------------------- register
  function register() {
    const a = 2 + Math.floor(Math.random() * 7), b = 2 + Math.floor(Math.random() * 7); // placeholder human check
    const err = el('div', { class: 'form-error', role: 'alert' });
    const i = {
      name: el('input', { autocomplete: 'name', maxlength: 80 }), phone: el('input', { type: 'tel', autocomplete: 'tel', placeholder: '01XXXXXXXXX' }),
      email: el('input', { type: 'email', autocomplete: 'email' }), password: el('input', { type: 'password', autocomplete: 'new-password' }),
      idno: el('input', { maxlength: 30, placeholder: 'NID / passport / birth certificate number' }), cap: el('input', { inputmode: 'numeric' }),
    };
    const problem = () =>
      !i.name.value.trim() ? 'Enter your full name.'
        : !/^\+?\d{8,15}$/.test(i.phone.value.replace(/[\s-]/g, '')) ? 'Enter a valid phone number.'
          : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.value.trim()) ? 'Enter a valid email address.'
            : i.password.value.length < 10 || !/[A-Za-z]/.test(i.password.value) || !/\d/.test(i.password.value) ? 'Password needs 10+ characters with letters and numbers.'
              : i.idno.value.trim().length < 5 ? 'Enter your NID, passport or birth certificate number.'
                : Number(i.cap.value) !== a + b ? 'The human check answer is wrong.' : null;
    const form = el('form', { class: 'card narrow-form', novalidate: true }, el('small', null, 'CITIZEN REGISTRATION'), el('h1', null, 'Create your account'),
      field('Full name', i.name), field('Phone number', i.phone), field('Email', i.email), field('Password', i.password),
      field('Identity document number', i.idno), field('Human check: what is ' + a + ' + ' + b + '?', i.cap), err,
      el('button', { class: 'btn', type: 'submit' }, 'Continue \u2192'),
      el('p', { class: 'who' }, 'Already registered? ', el('a', { class: 'src-link', href: '#/login' }, 'Sign in')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      const p = problem();
      if (p) { err.textContent = p; return; }
      try {
        const r = await D.register({ name: i.name.value, phone: i.phone.value.replace(/[\s-]/g, ''), email: i.email.value, password: i.password.value, idno: i.idno.value.trim() });
        verifyStep(i.email.value.trim(), r.demoCode);
      } catch (ex) { err.textContent = ex.message; }
    });
    fill(view, form);
  }
  function verifyStep(email, code) {
    const err = el('div', { class: 'form-error', role: 'alert' });
    const box = el('input', { inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' });
    const form = el('form', { class: 'card narrow-form', novalidate: true }, el('small', null, 'VERIFY YOUR ACCOUNT'), el('h1', null, 'Enter the 6-digit code'),
      el('p', { class: 'notice' }, el('b', null, 'Demo mode: '), 'no SMS or email is sent. Your code is ', el('b', null, code), '. It expires in 15 minutes.'),
      field('Code', box), err, el('button', { class: 'btn', type: 'submit' }, 'Verify \u2192'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      try { D.verifyOtp(email, box.value); fill(view, el('div', { class: 'card narrow-form' }, el('h1', null, 'Account verified'), el('a', { class: 'btn', href: '#/login' }, 'Sign in \u2192'))); }
      catch (ex) { err.textContent = ex.message; }
    });
    fill(view, form);
  }

  // ------------------------------------------------------------- dashboard
  function dashboard() {
    const alerts = el('div'), mine = el('div');
    fill(view, el('small', null, 'DASHBOARD'), el('h1', null, 'Hello, ' + user.name),
      el('div', { class: 'row' }, el('a', { class: 'btn', href: '#/report' }, 'Report an emergency'),
        el('a', { class: 'btn outline', href: 'tel:999' }, 'Call 999'), sosButton()),
      el('h2', null, 'Active alerts near you'), alerts, el('h2', null, 'My reports'), mine);
    return live(() => {
      const all = D.list();
      fill(alerts, listOf(all.filter((i) => D.isOpen(i) && D.km(center, i) < 5).slice(0, 5), 'No active alerts within 5 km.'));
      fill(mine, listOf(all.filter((i) => i.reporter === user.id), 'You have not submitted any reports yet.'));
    });
  }

  // ---------------------------------------------------------------- report
  function report() {
    let pos = null, touched = false, map;
    const err = el('div', { class: 'form-error', role: 'alert' });
    const where = el('p', { class: 'who', role: 'status' }, 'No location yet. Use GPS or click the map.');
    const hint = el('small', { class: 'who' });
    const type = el('select', null, Object.keys(TYPES).filter((k) => k !== 'sos').map((k) => el('option', { value: k }, TYPES[k][0])));
    type.addEventListener('change', () => { touched = true; });
    const desc = el('textarea', { rows: 4, maxlength: 1000, placeholder: 'What is happening? Who needs help?' });
    desc.addEventListener('input', () => {
      const g = guess(desc.value);
      if (g && !touched) { type.value = g; hint.textContent = 'Suggested type: ' + TYPES[g][0] + ' (automatic, you can change it).'; }
    });
    const people = el('input', { type: 'number', min: 0, max: 999, value: 0 });
    const anon = el('input', { type: 'checkbox' });
    const setPos = (p, how) => { pos = p; where.textContent = how + ': ' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5); };
    const draw = () => { const m = mapView([], { picker: (p) => setPos(p, 'Manual location') }); if (map) map.replaceWith(m); map = m; if (pos) m.pick(pos); return m; };
    map = draw();
    const gps = el('button', { type: 'button', class: 'btn outline small' }, 'Use my GPS');
    gps.addEventListener('click', async () => {
      const p = await locate();
      if (!p) { err.textContent = 'Could not read your GPS. Allow location access, or click the map instead.'; return; }
      err.textContent = ''; center = p; setPos(p, 'GPS location'); draw();
    });
    const form = el('form', { class: 'card', novalidate: true }, field('Type of emergency', type), hint,
      field('Description', desc), field('Number of people affected (if known)', people),
      el('label', { class: 'check' }, anon, ' Report anonymously (only authorities can see who reported)'),
      el('h3', null, 'Location'), el('div', { class: 'row' }, gps, where), map, err,
      el('div', { class: 'row' }, el('button', { class: 'btn', type: 'submit' }, 'Submit report'), el('a', { class: 'btn outline', href: 'tel:999' }, 'Call 999')));
    form.addEventListener('submit', (e) => {
      e.preventDefault(); err.textContent = '';
      if (!pos) { err.textContent = 'Please set a location (GPS or click the map).'; return; }
      try { go('#/incident/' + D.create({ type: type.value, description: desc.value, lat: pos.lat, lng: pos.lng, people: Number(people.value) || 0, anonymous: anon.checked }, user).id); }
      catch (ex) { err.textContent = ex.message; }
    });
    fill(view, el('small', null, 'INCIDENT REPORT'), el('h1', null, 'Report an emergency'),
      el('p', { class: 'notice' }, el('b', null, 'In immediate danger? '), 'Call 999 first. This form is for sharing details with responders and nearby people.'), form);
  }

  // ------------------------------------------------------------ one report
  function incident(id) {
    return live(() => {
      const i = D.list().find((x) => x.id === id);
      if (!i) { fill(view, el('div', { class: 'state error' }, 'Report not found.')); return; }
      const mine = !!user && user.id === i.reporter, idx = STEPS.indexOf(i.status);
      const btn = (text, fn, cls) => el('button', { type: 'button', class: 'btn small ' + (cls === undefined ? 'outline' : cls), onclick: fn }, text);
      const acts = [];
      if (mine && D.isOpen(i)) {
        acts.push(btn('Situation worsened', () => D.addUpdate(i.id, user.name, 'Reporter: the situation worsened.')),
          btn('Someone is injured', () => D.addUpdate(i.id, user.name, 'Reporter: someone is injured.')),
          btn('Help arrived: mark resolved', () => D.setStatus(i.id, 'resolved', user.name, 'Reporter marked this as resolved.'), ''),
          btn('False alarm', () => D.setStatus(i.id, 'false_alarm', user.name, 'Reporter says this was a false alarm.')));
      }
      if (isStaff()) {
        STEPS.concat('false_alarm').forEach((s) => acts.push(btn(STATUS[s], () => D.setStatus(i.id, s, user.name, 'Authority set status: ' + STATUS[s]), i.status === s ? '' : 'outline')));
        acts.push(btn('Confirm as verified', () => D.setLabel(i.id, 'verified', user.name, 'Authority verified this report.'), ''),
          btn('Mark unverified', () => D.setLabel(i.id, 'unverified', user.name, 'Authority marked this report unverified.')));
      }
      fill(view, el('a', { class: 'src-link', href: isStaff() ? '#/authority' : '#/dashboard' }, '\u2190 Back'),
        el('h1', null, TYPES[i.type][0] + ' ', badge(i.label)),
        el('p', null, i.description),
        i.status === 'false_alarm' ? el('div', { class: 'flag-banner' }, 'This report was marked as a false alarm.')
          : el('ol', { class: 'steps' }, STEPS.map((s, n) => el('li', { class: n <= idx ? 'on' : null }, STATUS[s]))),
        el('div', { class: 'facts' }, el('div', null, 'Reported', el('strong', null, fmtDateTime(i.created))),
          el('div', null, 'Reporter', el('strong', null, reporter(i))), el('div', null, 'People affected', el('strong', null, String(i.people))),
          el('div', null, 'Location', el('strong', null, i.lat.toFixed(4) + ', ' + i.lng.toFixed(4)))),
        mapView([i], { center: { lat: i.lat, lng: i.lng } }),
        acts.length ? el('div', { class: 'row actions' }, acts) : null,
        el('h2', null, 'Updates'),
        el('ul', { class: 'timeline' }, i.updates.slice().reverse().map((u) => el('li', null, el('b', null, u.by), ' \u00B7 ' + fmtDateTime(u.t), el('br'), u.text))));
    });
  }

  // -------------------------------------------------------------- live map
  function liveMap() {
    const f = { type: '', time: '', open: '1' };
    const sel = (key, opts) => el('select', { 'aria-label': key, onchange: (e) => { f[key] = e.target.value; draw(); } }, opts.map(([v, t]) => el('option', { value: v }, t)));
    const out = el('div');
    const bar = el('div', { class: 'toolbar' },
      sel('type', [['', 'All types']].concat(Object.keys(TYPES).map((k) => [k, TYPES[k][0]]))),
      sel('time', [['', 'Any time'], ['86400000', 'Last 24 hours'], ['604800000', 'Last 7 days']]),
      sel('open', [['1', 'Active only'], ['', 'Active and resolved']]));
    function draw() {
      const items = D.list().filter((i) => (!f.type || i.type === f.type) && (!f.time || Date.now() - Date.parse(i.created) < Number(f.time)) && (!f.open || D.isOpen(i)));
      fill(out, mapView(items, { me: center, onPick: (i) => go('#/incident/' + i.id) }),
        el('div', { class: 'legend-row' }, Object.keys(TYPES).map((k) => el('span', { class: 'chipkey' }, el('b', { class: 'ico t-' + k, text: TYPES[k][1] }), ' ' + TYPES[k][0]))),
        el('h2', null, 'Incidents ', el('span', { class: 'count' }, items.length)), listOf(items, 'No incidents match these filters.'));
    }
    fill(view, el('small', null, 'LIVE MAP'), el('h1', null, 'Live incident map'), bar, out);
    return live(draw);
  }

  // ----------------------------------------------------- authority console
  function authority() {
    const out = el('div');
    fill(view, el('small', null, 'AUTHORITY CONSOLE'), el('h1', null, 'Incident console'),
      el('p', null, 'Verify reports, update their status and keep citizens informed. ', el('a', { class: 'src-link', href: '../pages/admin-dashboard.html' }, 'Contact-record dashboard \u2192')), out);
    return live(() => {
      const all = D.list(), n = (fn) => String(all.filter(fn).length);
      const rows = all.map((i) => el('tr', null, el('td', null, TYPES[i.type][0]), el('td', null, shorten(i.description)), el('td', null, badge(i.label)),
        el('td', null, STATUS[i.status]), el('td', null, reporter(i)), el('td', null, fmtDateTime(i.created)), el('td', null, el('a', { href: '#/incident/' + i.id }, 'Manage'))));
      fill(out,
        el('div', { class: 'stats' }, [['Active', n(D.isOpen)], ['Unverified', n((i) => i.label === 'unverified' && D.isOpen(i))], ['Resolved', n((i) => i.status === 'resolved')], ['Total', String(all.length)]]
          .map(([t, v]) => el('article', null, t, el('strong', null, v)))),
        all.length ? el('div', { class: 'table-scroll' }, el('table', null, el('thead', null, el('tr', null, ['Type', 'Description', 'Verification', 'Status', 'Reporter', 'Reported', ''].map((h) => el('th', null, h)))), el('tbody', null, rows)))
          : el('div', { class: 'state' }, 'No incidents yet. ', el('button', { type: 'button', class: 'btn small', onclick: () => D.seedSamples() }, 'Add 3 sample incidents')),
        mapView(all, { onPick: (i) => go('#/incident/' + i.id) }));
    });
  }

  // ---------------------------------------------------------------- router
  const routes = { login, register, dashboard, report, map: liveMap, incident, authority };

  function chrome(name) {
    const a = (h, t, key) => el('a', { href: h, class: key === name ? 'active' : null }, t);
    fill(navBox, user
      ? [isStaff() ? a('#/authority', 'Console', 'authority') : a('#/dashboard', 'Dashboard', 'dashboard'), a('#/report', 'Report', 'report'), a('#/map', 'Live map', 'map'), el('a', { href: '../pages/directory.html' }, 'Directory')]
      : [el('a', { href: '../index.html' }, 'Home'), el('a', { href: '../pages/directory.html' }, 'Directory')]);
    fill(authBox, user
      ? [el('span', { class: 'who' }, user.name + ' \u00B7 ' + user.role + ' '), el('button', { class: 'btn small outline', type: 'button', onclick: signOut }, 'Sign out')]
      : el('a', { class: 'btn small', href: '#/login' }, 'Sign in'));
  }
  async function signOut() {
    const staff = isStaff();
    D.logout();
    if (staff) { try { await api.post('/api/auth/logout'); } catch (e) { /* cookie is cleared server-side anyway */ } }
    go('#/login');
  }

  async function route() {
    const mine = ++token;
    if (stop) { stop(); stop = null; }
    clearInterval(sosTimer); sosTimer = null;
    user = await whoAmI();
    if (mine !== token) return; // a newer navigation replaced this one
    const [name, arg] = location.hash.replace(/^#\//, '').split('/');
    const open = name === 'login' || name === 'register';
    let n = routes[name] ? name : (user ? (isStaff() ? 'authority' : 'dashboard') : 'login');
    if (!user && !open) n = 'login';
    if (user && open) n = isStaff() ? 'authority' : 'dashboard';
    if (n === 'authority' && !isStaff()) n = 'dashboard';
    chrome(n);
    try { stop = routes[n](arg) || null; } catch (e) { fill(view, el('div', { class: 'state error', role: 'alert' }, e.message)); }
  }

  window.addEventListener('hashchange', route);
  route();
})();
