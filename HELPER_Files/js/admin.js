/* HELPER - admin pages: login and read-only dashboard (Phase 1).
   This file is NOT what protects the data. The server checks the session cookie on every
   /api/admin request and before serving any admin page. This script only builds the screens. */
(function () {
  'use strict';
  const { api, el, badge, fmtDate, CATEGORY_LABELS } = window.HELPER;
  const $ = (id) => document.getElementById(id);
  const page = document.body.dataset.page;

  const goLogin = () => { location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop())); };

  async function requireSession() {
    try { return (await api.get('/api/auth/me')).user; } catch (e) { goLogin(); return new Promise(() => {}); }
  }

  function wireSignOut() {
    const btn = $('signout');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await api.post('/api/auth/logout'); } catch (err) { /* cookie is cleared server-side anyway */ }
      location.replace('login.html');
    });
  }

  // ================================================================== LOGIN
  function initLogin() {
    const form = $('login-form');
    const err = $('login-error');
    const next = new URLSearchParams(location.search).get('next');
    // only allow redirects to our own admin pages
    const target = /^admin-[A-Za-z0-9_-]+\.html$/.test(next || '') ? next : 'admin-dashboard.html';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await api.post('/api/auth/login', { email: $('email').value.trim(), password: $('password').value });
        location.replace(target);
      } catch (ex) {
        err.textContent = (ex.details && Object.values(ex.details)[0]) || ex.message;
        $('password').value = '';
        btn.disabled = false;
      }
    });
  }

  // ============================================================== DASHBOARD
  async function initDashboard() {
    const me = await requireSession();
    wireSignOut();
    $('who').replaceChildren(el('b', null, me.name), ' \u00B7 ' + me.role);

    const state = { status: '', q: '', timer: null };
    const cell = (...c) => el('td', null, ...c);
    const pad = (n) => String(n || 0).padStart(2, '0');

    async function loadStats() {
      const s = await api.get('/api/admin/stats');
      const st = s.by_status;
      $('st-total').textContent = pad(s.total);
      $('st-verified').textContent = pad(st.verified);
      $('st-partial').textContent = pad(st.partially_verified);
      $('st-unver').textContent = pad((st.unverified || 0) + (st.outdated || 0));
    }

    async function loadRecords() {
      const qs = new URLSearchParams({ pageSize: 100 });
      if (state.status) qs.set('status', state.status);
      if (state.q) qs.set('q', state.q);
      const data = await api.get('/api/admin/records?' + qs);
      $('rec-count').textContent = data.total;
      const body = $('rec-body');
      body.replaceChildren();
      if (!data.items.length) { body.append(el('tr', null, el('td', { colspan: 5 }, 'No records match.'))); return; }
      data.items.forEach((r) => body.append(el('tr', null,
        cell(r.service_name),
        cell(CATEGORY_LABELS[r.category] || r.category),
        cell(badge(r.status)),
        cell(r.phone_number || '\u2014'),
        cell(r.last_checked_at ? fmtDate(r.last_checked_at) : '\u2014'))));
    }

    const fail = (e) => { if (e.status === 401) goLogin(); else $('dash-error').textContent = e.message; };

    $('f-status').addEventListener('change', (e) => { state.status = e.target.value; loadRecords().catch(fail); });
    $('f-q').addEventListener('input', (e) => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => { state.q = e.target.value.trim(); loadRecords().catch(fail); }, 250);
    });

    Promise.all([loadStats(), loadRecords()]).catch(fail);
  }

  if (page === 'login') initLogin();
  if (page === 'dashboard') initDashboard();
})();
