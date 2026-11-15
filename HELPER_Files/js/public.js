/* HELPER - public pages: home, directory (search/filter) and contact details. */
(function () {
  'use strict';
  const { api, el, fill, badge, icon, fmtDate, safeUrl, CATEGORY_LABELS } = window.HELPER;
  const $ = (id) => document.getElementById(id);
  const page = document.body.dataset.page;

  // ---- Home: smooth scroll for the "How it works" button
  document.querySelectorAll('a[href="#how"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const target = $('how');
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // ================================================================ DIRECTORY
  function initDirectory() {
    const box = $('records');
    const count = $('count');
    const input = $('q');
    const area = $('area');
    const more = $('more');
    const chips = Array.from(document.querySelectorAll('.chips button'));
    const state = { category: '', page: 1, total: 0, shown: 0, timer: null, run: 0 };
    const PAGE_SIZE = 20;

    function card(r) {
      const meta = [CATEGORY_LABELS[r.category] || r.category];
      if (r.organization) meta.unshift(r.organization);
      const source = r.source_name ? 'Source: ' + r.source_name : 'Source details not yet confirmed';
      return el('div', { class: 'record' },
        icon(r.category),
        el('div', null,
          el('h3', null, r.service_name + ' ', badge(r.status), r.flag ? el('i', { class: 'outdated', text: ' ' + r.flag }) : null),
          el('p', null, r.phone_number ? 'Contact number: ' + r.phone_number : 'No contact number on file'),
          el('small', null, meta.join(' \u00B7 ') + ' \u00B7 ' + source + ' \u00B7 Last checked: ' + fmtDate(r.last_checked_at))),
        el('a', { class: 'btn outline small', href: 'contact-details.html?id=' + encodeURIComponent(r.id) }, 'Details'));
    }

    function message(text, isError) {
      box.replaceChildren(el('div', { class: 'state' + (isError ? ' error' : ''), role: isError ? 'alert' : 'status' }, text));
      more.hidden = true;
    }

    async function load(append) {
      const run = ++state.run;
      if (!append) { state.page = 1; state.shown = 0; message('Loading contacts\u2026'); }
      const qs = new URLSearchParams({ page: state.page, pageSize: PAGE_SIZE });
      if (input.value.trim()) qs.set('q', input.value.trim());
      if (area.value.trim()) qs.set('area', area.value.trim());
      if (state.category) qs.set('category', state.category);
      try {
        const data = await api.get('/api/records?' + qs);
        if (run !== state.run) return; // a newer search replaced this one
        state.total = data.total;
        state.shown += data.items.length;
        count.textContent = data.total + (data.total === 1 ? ' record' : ' records');
        if (!append) box.replaceChildren();
        if (!data.total) {
          message('No matching contacts found. We never guess a number: if it is not listed, it is not on file.');
          return;
        }
        data.items.forEach((r) => box.append(card(r)));
        more.hidden = state.shown >= state.total;
      } catch (err) {
        if (run === state.run) { count.textContent = ''; message(err.message, true); }
      }
    }

    chips.forEach((chip) => chip.addEventListener('click', () => {
      chips.forEach((c) => { c.classList.toggle('active', c === chip); c.setAttribute('aria-pressed', c === chip); });
      state.category = chip.dataset.category || '';
      load(false);
    }));
    [input, area].forEach((f) => f.addEventListener('input', () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => load(false), 250);
    }));
    more.addEventListener('click', () => { state.page += 1; load(true); });

    // plain-language label explanations (from the API, so they never drift from the rules)
    api.get('/api/meta').then((m) => {
      const dl = $('legend-list');
      m.statuses.forEach((s) => dl.append(el('dt', null, badge(s)), el('dd', null, m.explanations[s])));
    }).catch(() => {});

    load(false);
  }

  // ============================================================ CONTACT DETAILS
  function initDetails() {
    const id = new URLSearchParams(location.search).get('id');
    const title = $('d-title');
    const box = $('detail');

    function fail(text) {
      title.textContent = 'Contact not found';
      box.replaceChildren(el('p', { class: 'state error', role: 'alert' }, text));
    }
    if (!/^\d+$/.test(id || '')) return fail('No contact was selected. Go back to the directory and choose one.');

    api.get('/api/records/' + id).then(({ record: r }) => {
      document.title = r.service_name + ' | HELPER';
      title.textContent = r.service_name;
      $('d-lead').textContent = 'Source details and review status for this contact.';
      const url = safeUrl(r.source_url);
      fill(box,
        badge(r.status),
        el('h2', null, r.organization ? r.organization : (CATEGORY_LABELS[r.category] || r.category) + ' service'),
        el('p', null, r.phone_number ? 'Contact number: ' + r.phone_number : 'Contact number: not on file'),
        r.flag ? el('div', { class: 'flag-banner', role: 'alert' },
          r.flag === 'disputed' ? 'This contact is disputed: its details are under review.' : 'This contact has been reported as unavailable.') : null,
        el('div', { class: 'reason' }, el('b', null, 'Why this label: '), r.status_reason),
        el('div', { class: 'facts' },
          el('div', null, 'Service category', el('strong', null, CATEGORY_LABELS[r.category] || r.category)),
          el('div', null, 'Coverage area', el('strong', null, r.coverage_area || 'To be confirmed')),
          el('div', null, 'Last checked', el('strong', null, fmtDate(r.last_checked_at))),
          el('div', null, 'Source trust tier', el('strong', null, r.source_tier === 'unknown' ? 'Not rated' : r.source_tier))),
        r.operating_notes ? el('p', null, r.operating_notes) : null,
        el('h3', null, 'Source evidence'),
        el('ul', null,
          el('li', null, 'Source name: ' + (r.source_name || 'Not recorded')),
          el('li', null, 'Source link: ', url ? el('a', { class: 'src-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, url) : 'Not recorded'),
          el('li', null, 'Evidence date: ' + fmtDate(r.last_checked_at))),
        el('p', { class: 'notice' }, el('b', null, 'Reminder: '),
          'A label shows what evidence we hold. It does not guarantee that a number is active. Confirm emergency numbers with official authorities.'));
    }).catch((err) => fail(err.status === 404 ? 'This contact does not exist or has been withdrawn.' : err.message));
  }

  if (page === 'directory') initDirectory();
  if (page === 'details') initDetails();
})();
