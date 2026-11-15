/* HELPER demo data layer (runs in the browser only).
   It stands in for the REST API that does not exist yet (citizen accounts + incidents).
   Each function maps to a future endpoint, e.g. create() -> POST /api/incidents.
   NOT SECURE: data lives in this browser's localStorage. Replace with real API calls later. */
(function () {
  'use strict';
  const KEY = 'helper_demo_v1';
  const SESSION = 'helper_demo_session';
  const HOME = { lat: 24.8949, lng: 91.8687 }; // Sylhet
  const listeners = [];
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('helper') : null; // live updates across tabs

  const now = () => new Date().toISOString();
  const uid = () => Math.random().toString(36).slice(2, 10);
  const emit = () => listeners.forEach((f) => f());
  if (bc) bc.onmessage = emit;
  window.addEventListener('storage', (e) => { if (e.key === KEY) emit(); });

  function read() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.users && d.incidents) return d; } catch (e) { /* start fresh */ }
    return { users: [], incidents: [] };
  }
  function write(d) {
    localStorage.setItem(KEY, JSON.stringify(d));
    if (bc) bc.postMessage('change');
    emit();
  }

  // Passwords are salted + hashed (never stored as text). The real server uses bcrypt like your staff login.
  async function hash(password, salt) {
    if (!window.crypto || !crypto.subtle) throw new Error('Demo accounts need HTTPS or http://localhost.');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + password));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------------------------------------------------------------- accounts
  const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: 'citizen' });

  async function register(f) {
    const d = read();
    const email = f.email.trim().toLowerCase();
    if (d.users.some((u) => u.email === email || u.phone === f.phone)) {
      throw new Error('This email or phone number is already registered.'); // SRS: duplicate check
    }
    const salt = uid() + uid();
    const user = {
      id: uid(), name: f.name.trim(), email, phone: f.phone, idno: f.idno, salt, pw: await hash(f.password, salt),
      verified: false, otp: String(100000 + Math.floor(Math.random() * 900000)), otpExpires: Date.now() + 15 * 60000,
      fails: 0, lockedUntil: 0,
    };
    d.users.push(user);
    write(d);
    return { demoCode: user.otp }; // a real server would send this by SMS / email instead of returning it
  }

  function verifyOtp(email, code) {
    const d = read();
    const u = d.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u || !u.otp || u.otp !== String(code).trim() || Date.now() > u.otpExpires) throw new Error('Wrong or expired code.');
    u.verified = true; u.otp = null;
    write(d);
  }

  /** Returns the user, or null when the e-mail is not a demo account (caller then tries the real staff login). */
  async function login(email, password) {
    const d = read();
    const u = d.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u) return null;
    if (u.lockedUntil > Date.now()) throw new Error('Account locked for 15 minutes after too many failed attempts.');
    if (u.pw !== await hash(password, u.salt)) {
      u.fails += 1;
      if (u.fails >= 5) { u.lockedUntil = Date.now() + 15 * 60000; u.fails = 0; }
      write(d);
      throw new Error('Invalid email or password.');
    }
    if (!u.verified) throw new Error('This account is not verified yet. Register again with a new e-mail to get a fresh code.');
    u.fails = 0; write(d);
    localStorage.setItem(SESSION, u.id);
    return pub(u);
  }

  const me = () => { const u = read().users.find((x) => x.id === localStorage.getItem(SESSION)); return u ? pub(u) : null; };
  const logout = () => localStorage.removeItem(SESSION);

  // --------------------------------------------------------------- incidents
  function km(a, b) { // distance in km (small-area approximation)
    const r = Math.PI / 180;
    return Math.hypot((b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) * r) / 2), (b.lat - a.lat) * r) * 6371;
  }
  const isOpen = (i) => i.status !== 'resolved' && i.status !== 'false_alarm';

  function create(o, user) {
    const d = read();
    const text = String(o.description || '').trim();
    if (!o.sos && (text.length < 10 || /(.)\1{5,}/.test(text))) {
      throw new Error('Please describe what is happening (at least 10 characters, no repeated characters).'); // basic spam filter
    }
    if (user && !o.sos) { // SRS: limit reports per user in a short time (SOS is never blocked)
      const recent = d.incidents.filter((i) => i.reporter === user.id && Date.now() - Date.parse(i.created) < 10 * 60000);
      if (recent.length >= 3) throw new Error('Too many reports in 10 minutes. Please wait, or use SOS / call 999 for a real emergency.');
    }
    // A matching open report within 500 m raises both reports to "partially verified" (corroboration)
    const near = d.incidents.filter((i) => i.type === o.type && isOpen(i) && km(i, o) < 0.5);
    near.forEach((i) => { if (i.label === 'unverified') i.label = 'partially_verified'; });
    const inc = {
      id: uid(), type: o.type, description: text, lat: o.lat, lng: o.lng, people: o.people || 0,
      anonymous: !!o.anonymous, reporter: user ? user.id : null, reporterName: user ? user.name : 'Unknown',
      status: 'pending', label: near.length ? 'partially_verified' : 'unverified', created: now(),
      updates: [{ t: now(), by: 'System', text: near.length ? 'Report received. A nearby report matches it.' : 'Report received. Waiting for an authority to verify it.' }],
    };
    d.incidents.unshift(inc);
    write(d);
    return inc;
  }

  function patch(id, fn) {
    const d = read();
    const i = d.incidents.find((x) => x.id === id);
    if (!i) throw new Error('Report not found.');
    fn(i);
    write(d);
    return i;
  }
  const addUpdate = (id, by, text) => patch(id, (i) => { i.updates.push({ t: now(), by, text }); });
  const setStatus = (id, status, by, text) => patch(id, (i) => { i.status = status; i.updates.push({ t: now(), by, text }); });
  const setLabel = (id, label, by, text) => patch(id, (i) => { i.label = label; i.updates.push({ t: now(), by, text }); });

  function seedSamples() {
    const d = read();
    [['fire', 'Smoke and flames coming from a shop near the market.', 0.004, 0.006, 'dispatched', 'partially_verified'],
      ['accident', 'Two motorbikes collided at the crossing, one rider is hurt.', -0.012, -0.015, 'pending', 'unverified'],
      ['medical', 'Elderly man collapsed outside the bus stand, not responding.', 0.02, -0.01, 'resolved', 'verified']]
      .forEach(([type, description, dLat, dLng, status, label]) => d.incidents.push({
        id: uid(), type, description, lat: HOME.lat + dLat, lng: HOME.lng + dLng, people: 1, anonymous: false,
        reporter: null, reporterName: 'Sample citizen', status, label, created: now(),
        updates: [{ t: now(), by: 'System', text: 'Sample incident for demonstration.' }],
      }));
    write(d);
  }

  window.HELPER_DEMO = {
    HOME, km, isOpen, register, verifyOtp, login, me, logout,
    list: () => read().incidents, create, addUpdate, setStatus, setLabel, seedSamples,
    onChange: (fn) => { listeners.push(fn); return () => { const n = listeners.indexOf(fn); if (n > -1) listeners.splice(n, 1); }; },
  };
})();
