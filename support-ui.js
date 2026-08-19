/* Tunanepal support desk — shared helpers. */

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN')}`;

export const initials = (n) =>
  String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const avatar = (r, cls = '') => r?.avatar_url
  ? `<span class="ava ${cls}"><img src="${esc(r.avatar_url)}" alt=""></span>`
  : `<span class="ava ${cls}">${esc(initials(r?.name))}</span>`;

export function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('en-GB',
    { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

let toastTimer;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.className = `toast ${kind ? 'toast--' + kind : ''}`;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

export function openModal(html) {
  closeModal();
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.id = 'modalScrim';
  scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeModal(); });
  document.body.appendChild(scrim);
  const f = scrim.querySelector('input, select, textarea, button');
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 70);
  return scrim;
}
export function closeModal() { $('#modalScrim')?.remove(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

export async function busy(btn, label, task) {
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { return await task(); } finally { btn.disabled = false; btn.textContent = original; }
}

export const empty = (title, note) =>
  `<div class="empty"><div class="display">${esc(title)}</div><p>${esc(note)}</p></div>`;

export const skeleton = (h = 70, n = 3) =>
  Array.from({ length: n }, () => `<div class="skeleton" style="height:${h}px;margin-bottom:10px"></div>`).join('');

export function applyTheme(t) {
  const theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('tuna.support.theme', theme);
  return theme;
}
export const savedTheme = () => localStorage.getItem('tuna.support.theme') || 'dark';

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const CATEGORIES = ['payment', 'cheating', 'match', 'account', 'other'];
export const ESC_CATEGORIES = ['refund', 'cheating', 'fine', 'payout', 'account', 'other'];
