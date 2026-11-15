/* HELPER - shared helpers: API calls + safe DOM building.
   Data from the server is ALWAYS inserted as text (never innerHTML), so it cannot inject HTML. */
(function () {
  'use strict';

  async function request(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'HELPER' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      const err = new Error('Cannot reach the server. Please check your connection and try again.');
      err.status = 0;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed (' + res.status + ').');
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }

  const api = {
    get: (u) => request('GET', u),
    post: (u, b) => request('POST', u, b === undefined ? {} : b),
    put: (u, b) => request('PUT', u, b),
    patch: (u, b) => request('PATCH', u, b),
  };

  /** el('div', {class:'x', onclick: fn}, 'text', childNode) */
  function el(tag, attrs) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    Array.prototype.slice.call(arguments, 2).flat(Infinity).forEach((kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }

  /** Replace a node's children, skipping null/false (replaceChildren would print "null"). */
  function fill(node) {
    const kids = Array.prototype.slice.call(arguments, 1).flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
    node.replaceChildren(...kids);
    return node;
  }

  const ICONS = {
    medical: ['\u271A', 'ico'], fire: ['\u2302', 'ico fire'], police: ['\u25C8', 'ico police'],
    disaster: ['\u2691', 'ico fire'], other: ['\uFF0B', 'ico'],
  };
  const CATEGORY_LABELS = { medical: 'Medical', fire: 'Fire', police: 'Police', disaster: 'Disaster response', other: 'Other' };
  const STATUS_CLASS = { verified: 'verified', partially_verified: 'review', unverified: 'unverified', outdated: 'outdated' };
  const STATUS_LABELS = { verified: 'Verified', partially_verified: 'Partially verified', unverified: 'Unverified', outdated: 'Outdated' };

  const badge = (status) => el('i', { class: STATUS_CLASS[status] || 'unverified', text: STATUS_LABELS[status] || status });
  const icon = (category) => { const i = ICONS[category] || ICONS.other; return el('b', { class: i[1], text: i[0] }); };

  function fmtDate(v) {
    if (!v) return 'Not available';
    const d = new Date(v.length === 10 ? v + 'T00:00:00Z' : v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function fmtDateTime(v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

  window.HELPER = { api, el, fill, badge, icon, fmtDate, fmtDateTime, safeUrl, CATEGORY_LABELS, STATUS_LABELS };
})();
