/* Tunanepal support desk.
   Left: the queue. Right: the conversation, with everything about the player
   already on screen so an agent never has to go asking the admin. */

import { rpc, rpcAuth, upload, getToken, setToken, clearToken, getAgent, setAgent } from './support-api.js';
import {
  $, $$, esc, money, when, ago, avatar, toast, busy, openModal, closeModal,
  empty, skeleton, applyTheme, savedTheme, PRIORITIES, CATEGORIES, ESC_CATEGORIES
} from './support-ui.js';

applyTheme(savedTheme());

let view = 'queue';            // queue | tickets | canned
let filter = 'open';
let mine = false;
let search = '';
let openReport = null;
let canned = [];
let pollTimer = null;

/* ═══════════════════════════════════════════════════════════ sign in ══ */
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#loginErr');
  err.hidden = true;
  try {
    const out = await busy($('#loginBtn'), 'Checking…', () =>
      rpc('tuna_support_login', { p_id: $('#agentId').value, p_password: $('#agentPass').value }));
    setToken(out.token);
    setAgent(out.agent);
    await enter();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

async function enter() {
  $('#login').hidden = true;
  $('#desk').hidden = false;
  const a = getAgent();
  $('#agentName').textContent = a?.name || '—';
  $('#agentTag').textContent = a?.id || '';
  canned = await rpcAuth('tuna_support_canned').catch(() => []);
  await refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh(true);
  }, 20000);
}

function signOut() {
  clearToken();
  clearInterval(pollTimer);
  location.reload();
}
$('#logoutBtn').addEventListener('click', signOut);

/* ══════════════════════════════════════════════════════════ chrome ══ */
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  view = b.dataset.v;
  $$('#nav button').forEach((x) => x.setAttribute('aria-current', x.dataset.v === view ? 'page' : 'false'));
  refresh();
});

$('#themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  $('#themeLabel').textContent = next === 'dark' ? 'Dark' : 'Light';
});

$('#pwBtn').addEventListener('click', () => {
  openModal(`
    <h2>Change password</h2>
    <p class="sub">You will stay signed in here, other devices are logged out.</p>
    <div class="alert alert--bad" id="pwErr" hidden></div>
    <label class="field"><span class="label">Current password</span>
      <input type="password" id="pwCur"></label>
    <label class="field"><span class="label">New password</span>
      <input type="password" id="pwNew" placeholder="At least 8 characters"></label>
    <div class="row"><button class="btn grow" id="pwGo">Save</button>
      <button class="btn btn--ghost" id="pwX">Cancel</button></div>`);
  $('#pwX').addEventListener('click', closeModal);
  $('#pwGo').addEventListener('click', async (ev) => {
    const err = $('#pwErr'); err.hidden = true;
    try {
      await busy(ev.currentTarget, 'Saving…', () => rpcAuth('tuna_support_change_password',
        { p_current: $('#pwCur').value, p_new: $('#pwNew').value }));
      closeModal(); toast('Password changed.', 'good');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
});

/* ═════════════════════════════════════════════════════════ refresh ══ */
/* Counters only. Kept separate from refresh() so a view can update the
   sidebar without asking refresh() to reload that same view — which is
   exactly the loop that made the tickets tab thrash. */
async function loadStats(quiet = true) {
  try {
    const s = await rpcAuth('tuna_support_stats');
    paintStats(s);
  } catch (e) {
    if (e.expired) return signOut();
    if (!quiet) toast(e.message, 'bad');
  }
}

async function refresh(quiet = false) {
  await loadStats(quiet);
  if (view === 'queue') await loadQueue(quiet);
  if (view === 'tickets') await loadTickets();
  if (view === 'canned') paintCanned();
}

function paintStats(s) {
  $('#statOpen').textContent = s.open;
  $('#statMine').textContent = s.mine;
  $('#statPending').textContent = s.pending;
  $('#statSolved').textContent = s.solved_today;
  const wait = Number(s.waiting_longest || 0);
  $('#statWait').textContent = wait < 60 ? `${wait}m` : `${Math.round(wait / 60)}h`;
  $('#statWait').className = wait > 60 ? 'stat__v stat__v--bad' : 'stat__v';

  const badge = (sel, n) => {
    const el = $(sel);
    el.hidden = !n;
    el.textContent = n > 99 ? '99+' : n;
  };
  badge('#navQueueCount', s.open);
  badge('#navTicketCount', s.esc_open + s.esc_news);
  if (s.esc_news) $('#navTicketCount').classList.add('count--new');
  else $('#navTicketCount').classList.remove('count--new');
}

/* ═══════════════════════════════════════════════════════════ queue ══ */
$('#qFilter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  $$('#qFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.f === filter)));
  loadQueue();
});
$('#qMine').addEventListener('click', () => {
  mine = !mine;
  $('#qMine').setAttribute('aria-pressed', String(mine));
  loadQueue();
});
$('#qSearch').addEventListener('input', debounce(() => { search = $('#qSearch').value; loadQueue(); }, 300));

async function loadQueue(quiet = false) {
  $('#panelTitle').textContent = 'Conversations';
  $('#queueTools').hidden = false;
  const list = $('#queueList');
  if (!quiet && !list.children.length) list.innerHTML = skeleton(66, 4);
  let rows = [];
  try { rows = await rpcAuth('tuna_support_queue', { p_status: filter, p_mine: mine, p_q: search }) || []; }
  catch (e) { list.innerHTML = `<div class="alert alert--bad">${esc(e.message)}</div>`; return; }

  list.innerHTML = rows.length ? rows.map(queueRow).join('')
    : empty('Nothing waiting', 'New messages from players land here.');

  $$('#queueList [data-open]').forEach((el) =>
    el.addEventListener('click', () => openThread(Number(el.dataset.open))));

  if (openReport && rows.some((r) => r.id === openReport)) markActive(openReport);
}

function queueRow(r) {
  const waitingOnUs = r.last_sender === 'player';
  return `
  <button class="qrow ${r.id === openReport ? 'qrow--on' : ''}" data-open="${r.id}">
    ${avatar(r)}
    <span class="qrow__body">
      <span class="qrow__top">
        <b>${esc(r.name)}</b>
        <span class="qrow__time">${esc(ago(r.updated_at))}</span>
      </span>
      <span class="qrow__msg">${esc(r.last_message || 'No messages yet')}</span>
      <span class="qrow__tags">
        <span class="tag tag--${esc(r.priority)}">${esc(r.priority)}</span>
        <span class="tag">${esc(r.category)}</span>
        ${r.open_escalations > 0 ? '<span class="tag tag--esc">ticket open</span>' : ''}
        ${r.blocked ? '<span class="tag tag--bad">blocked</span>' : ''}
        ${waitingOnUs ? '<span class="tag tag--wait">needs reply</span>' : ''}
        ${r.assigned_to ? `<span class="tag">@${esc(r.assigned_to)}</span>` : '<span class="tag tag--free">unassigned</span>'}
      </span>
    </span>
  </button>`;
}

function markActive(id) {
  $$('#queueList .qrow').forEach((el) =>
    el.classList.toggle('qrow--on', Number(el.dataset.open) === id));
}

/* ════════════════════════════════════════════════════ conversation ══ */
async function openThread(id) {
  openReport = id;
  markActive(id);
  const pane = $('#thread');
  pane.innerHTML = skeleton(120, 2);

  let d;
  try { d = await rpcAuth('tuna_support_thread', { p_report: id }); }
  catch (e) { pane.innerHTML = `<div class="alert alert--bad">${esc(e.message)}</div>`; return; }

  const p = d.player;
  const r = d.report;

  pane.innerHTML = `
    <div class="thead">
      <div class="row" style="gap:10px">
        ${avatar(p, 'ava--lg')}
        <div class="grow">
          <b class="thead__name">${esc(p.name)}</b>
          <span class="mono xs muted">${esc(p.phone)}</span>
        </div>
        <button class="btn btn--ghost btn--xs" id="ctxToggle">Player info</button>
      </div>

      <div class="tcontrols">
        <select id="tStatus">${['open','pending','solved','closed'].map((s) =>
          `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select id="tPriority">${PRIORITIES.map((s) =>
          `<option ${r.priority === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select id="tCategory">${CATEGORIES.map((s) =>
          `<option ${r.category === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button class="btn btn--xs" id="tClaim">${r.assigned_to ? 'Unassign' : 'Assign to me'}</button>
        <button class="btn btn--gold btn--xs" id="tEsc">Raise ticket</button>
        <button class="btn btn--win btn--xs" id="tSolve"
          ${r.status === 'solved' || r.status === 'closed' ? 'disabled' : ''}>
          ${r.status === 'solved' || r.status === 'closed' ? 'Already solved' : 'Mark solved'}
        </button>
      </div>
    </div>

    <div class="ctx" id="ctxCard" hidden>
      <div class="ctx__grid">
        <div><small>Balance</small><b>${money(p.points)}</b></div>
        <div><small>Owed in fines</small><b class="${p.owed > 0 ? 'bad' : ''}">${money(p.owed)}</b></div>
        <div><small>Deposited</small><b>${money(p.deposits)}</b></div>
        <div><small>Withdrawn</small><b>${money(p.withdrawals)}</b></div>
        <div><small>Record</small><b>${p.wins}W / ${p.losses}L</b></div>
        <div><small>Account</small><b class="${p.blocked ? 'bad' : ''}">${p.blocked ? 'Blocked' : 'Active'}</b></div>
      </div>
      ${d.recent_matches.length ? `
        <p class="eyebrow">Recent matches</p>
        <div class="ctx__list">${d.recent_matches.map((m) => `
          <div><span>#${m.id} ${esc(m.game === 'pubg' ? 'PUBG' : 'FF')} ${esc(m.team_size)}</span>
            <span class="mono">${money(m.stake)}</span>
            <span class="tag ${m.won ? 'tag--won' : ''}">${m.status === 'settled' ? (m.won ? 'won' : 'lost') : esc(m.status)}</span>
          </div>`).join('')}</div>` : ''}
      ${d.recent_money.length ? `
        <p class="eyebrow">Recent money</p>
        <div class="ctx__list">${d.recent_money.map((t) => `
          <div><span>${esc(t.note || t.kind)}</span>
            <span class="mono ${t.amount > 0 ? 'up' : 'down'}">${t.amount > 0 ? '+' : '−'}${money(Math.abs(t.amount))}</span>
            <span class="xs muted">${esc(ago(t.created_at))}</span>
          </div>`).join('')}</div>` : ''}
      ${d.escalations.length ? `
        <p class="eyebrow">Tickets on this chat</p>
        <div class="ctx__list">${d.escalations.map((e) => `
          <div><span>#${e.id} ${esc(e.subject)}</span>
            <span class="tag tag--${esc(e.status)}">${esc(e.status)}</span>
            ${e.admin_note ? `<span class="xs muted">${esc(e.admin_note)}</span>` : ''}
          </div>`).join('')}</div>` : ''}
    </div>

    <div class="chat" id="chat">
      ${d.messages.map(bubble).join('')}
    </div>

    <div class="composer">
      <div class="composer__tools">
        <select id="cannedPick">
          <option value="">Canned reply…</option>
          ${canned.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}
        </select>
        <label class="filepick filepick--sm">
          <input type="file" id="cFile" accept="image/jpeg,image/png,image/webp">
          <span id="cFileLabel">Attach</span>
        </label>
        <label class="notetoggle">
          <input type="checkbox" id="cNote">
          <span>Internal note</span>
        </label>
      </div>
      <textarea id="cBody" rows="3" placeholder="Write a reply to the player…"></textarea>
      <button class="btn" id="cSend">Send reply</button>
    </div>`;

  $('#chat').scrollTop = $('#chat').scrollHeight;

  $('#ctxToggle').addEventListener('click', () => {
    const c = $('#ctxCard');
    c.hidden = !c.hidden;
    $('#ctxToggle').textContent = c.hidden ? 'Player info' : 'Hide info';
  });

  const set = (args) => rpcAuth('tuna_support_update', { p_report: id, ...args })
    .then(() => { toast('Updated.'); loadQueue(true); })
    .catch((e) => toast(e.message, 'bad'));

  $('#tStatus').addEventListener('change', (e) => set({ p_status: e.target.value }));
  $('#tPriority').addEventListener('change', (e) => set({ p_priority: e.target.value }));
  $('#tCategory').addEventListener('change', (e) => set({ p_category: e.target.value }));
  $('#tClaim').addEventListener('click', () =>
    set({ p_assign: r.assigned_to ? 'none' : 'me' }).then(() => openThread(id)));
  $('#tEsc').addEventListener('click', () => escalateModal(id, p));
  $('#tSolve').addEventListener('click', () => solveModal(id, p));

  $('#cannedPick').addEventListener('change', (e) => {
    const c = canned.find((x) => String(x.id) === e.target.value);
    if (c) { $('#cBody').value = c.body; $('#cBody').focus(); }
    e.target.value = '';
  });
  $('#cFile').addEventListener('change', () => {
    const f = $('#cFile').files[0];
    $('#cFileLabel').textContent = f ? `✓ ${f.name.slice(0, 16)}` : 'Attach';
  });
  $('#cNote').addEventListener('change', () => {
    const on = $('#cNote').checked;
    $('#cBody').placeholder = on
      ? 'Internal note — the player never sees this…'
      : 'Write a reply to the player…';
    $('#cSend').textContent = on ? 'Save note' : 'Send reply';
    $('#cSend').classList.toggle('btn--gold', on);
  });
  $('#cSend').addEventListener('click', (e) => send(e.currentTarget, id));
  $('#cBody').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send($('#cSend'), id);
  });
}

function bubble(m) {
  if (m.sender === 'note') return `
    <div class="note">
      <b>Internal · ${esc(m.author || 'staff')}</b>
      <p>${esc(m.body)}</p>
      <time>${esc(when(m.created_at))}</time>
    </div>`;
  const mine = m.sender !== 'player';
  return `
    <div class="bubble bubble--${mine ? 'us' : 'them'}">
      ${m.body ? `<p>${esc(m.body)}</p>` : ''}
      ${m.media_url ? (m.media_type === 'video'
        ? `<video src="${esc(m.media_url)}" controls playsinline></video>`
        : `<a href="${esc(m.media_url)}" target="_blank" rel="noopener">
             <img src="${esc(m.media_url)}" alt="attachment" loading="lazy"></a>`) : ''}
      <time>${m.author ? esc(m.author) + ' · ' : ''}${esc(when(m.created_at))}</time>
    </div>`;
}

async function send(btn, id) {
  const body = $('#cBody').value.trim();
  const file = $('#cFile').files[0];
  const internal = $('#cNote').checked;
  if (!body && !file) return toast('Write something first.', 'bad');
  try {
    await busy(btn, 'Sending…', async () => {
      let url = null, type = null;
      if (file) { url = await upload(file); type = 'image'; }
      await rpcAuth('tuna_support_reply', {
        p_report: id, p_body: body, p_media_url: url, p_media_type: type, p_internal: internal
      });
    });
    openThread(id);
    loadQueue(true);
  } catch (e) { toast(e.message, 'bad'); }
}

/* ═══════════════════════════════════════════════ raise a ticket ══ */
function escalateModal(reportId, p) {
  openModal(`
    <h2>Raise a ticket</h2>
    <p class="sub">Goes to the admin. You cannot move money yourself — this is how you ask.</p>
    <div class="alert alert--bad" id="esErr" hidden></div>

    <div class="ticketwho">
      ${avatar(p)}
      <div><b>${esc(p.name)}</b><span class="mono xs muted">${esc(p.phone)}</span></div>
      <span class="mono">${money(p.points)}</span>
    </div>

    <label class="field"><span class="label">What kind of issue</span>
      <select id="esCat">${ESC_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
    <label class="field"><span class="label">Subject</span>
      <input type="text" id="esSubject" placeholder="Refund request — match #34"></label>
    <label class="field"><span class="label">What happened</span>
      <textarea id="esIssue" rows="3" placeholder="Explain what the player reported and what you checked."></textarea></label>
    <div class="grid2">
      <label class="field"><span class="label">What you are asking for</span>
        <input type="text" id="esReq" placeholder="Refund the stake"></label>
      <label class="field"><span class="label">Amount (optional)</span>
        <input type="number" id="esAmt" placeholder="30"></label>
    </div>

    <div class="row"><button class="btn grow" id="esGo">Send to admin</button>
      <button class="btn btn--ghost" id="esX">Cancel</button></div>`);

  $('#esX').addEventListener('click', closeModal);
  $('#esGo').addEventListener('click', async (e) => {
    const err = $('#esErr'); err.hidden = true;
    try {
      const out = await busy(e.currentTarget, 'Sending…', () => rpcAuth('tuna_support_escalate', {
        p_report: reportId,
        p_category: $('#esCat').value,
        p_subject: $('#esSubject').value,
        p_issue: $('#esIssue').value,
        p_requested: $('#esReq').value,
        p_amount: parseInt($('#esAmt').value, 10) || null
      }));
      closeModal();
      toast(`Ticket #${out.id} sent to admin.`, 'good');
      openThread(reportId);
      loadStats();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

/* ─────────────────────────────────────────────── close a conversation ── */
function solveModal(reportId, p) {
  openModal(`
    <h2>Mark solved</h2>
    <p class="sub">Closes this chat for ${esc(p.name)}.</p>
    <div class="alert alert--bad" id="svErr" hidden></div>

    <div class="alert alert--info">
      The player is told it is closed. If they reply again the chat reopens
      by itself and comes back to the queue — nothing is lost.
    </div>

    <label class="field"><span class="label">Internal note (optional)</span>
      <input type="text" id="svNote" placeholder="e.g. Refund confirmed, player happy">
    </label>

    <div class="row" style="margin-top:6px">
      <button class="btn btn--win grow" id="svGo">Mark solved</button>
      <button class="btn btn--ghost" id="svX">Cancel</button>
    </div>`);

  $('#svX').addEventListener('click', closeModal);
  $('#svGo').addEventListener('click', async (e) => {
    const err = $('#svErr'); err.hidden = true;
    try {
      await busy(e.currentTarget, 'Closing…', () =>
        rpcAuth('tuna_support_solve', { p_report: reportId, p_note: $('#svNote').value }));
      closeModal();
      toast('Conversation closed.', 'good');
      openThread(reportId);
      loadQueue(true);
      loadStats();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

/* ════════════════════════════════════════════════════════ tickets ══ */
async function loadTickets() {
  $('#panelTitle').textContent = 'My tickets';
  $('#queueTools').hidden = true;
  const list = $('#queueList');
  list.innerHTML = skeleton(80, 3);
  let rows = [];
  try { rows = await rpcAuth('tuna_support_escalations', { p_status: 'all' }) || []; }
  catch (e) { list.innerHTML = `<div class="alert alert--bad">${esc(e.message)}</div>`; return; }

  list.innerHTML = rows.length ? rows.map((e) => `
    <div class="ticket ticket--${esc(e.status)}">
      <div class="ticket__top">
        <b>#${e.id} ${esc(e.subject)}</b>
        <span class="tag tag--${esc(e.status)}">${esc(e.status)}</span>
      </div>
      <p class="ticket__who">${esc(e.name)} · <span class="mono">${esc(e.phone)}</span>
        · ${esc(e.category)}${e.amount ? ' · ' + money(e.amount) : ''}</p>
      <p class="ticket__issue">${esc(e.issue)}</p>
      ${e.requested ? `<p class="xs muted">Asked for: ${esc(e.requested)}</p>` : ''}
      ${e.admin_note ? `<div class="ticket__reply"><b>Admin:</b> ${esc(e.admin_note)}</div>` : ''}
      <div class="ticket__foot">
        <span class="xs muted">raised ${esc(ago(e.created_at))} ago</span>
        <span class="row" style="gap:6px">
          ${e.status === 'open'
            ? `<button class="btn btn--ghost btn--xs" data-wdraw="${e.id}">Withdraw</button>` : ''}
          ${e.status === 'solved' && e.report_id
            ? `<button class="btn btn--win btn--xs" data-close="${e.report_id}">Reply &amp; close</button>` : ''}
          ${e.report_id ? `<button class="btn btn--ghost btn--xs" data-goto="${e.report_id}">Open chat</button>` : ''}
        </span>
      </div>
    </div>`).join('') : empty('No tickets yet', 'Raise one from a conversation when you need an admin.');

  loadStats();

  $$('#queueList [data-wdraw]').forEach((b) => b.addEventListener('click', async () => {
    const why = prompt('Why are you withdrawing this ticket?');
    if (why === null) return;
    try {
      await busy(b, '…', () => rpcAuth('tuna_support_withdraw_ticket',
        { p_id: Number(b.dataset.wdraw), p_reason: why }));
      toast('Ticket withdrawn.');
      loadTickets();
    } catch (e) { toast(e.message, 'bad'); }
  }));

  $$('#queueList [data-close]').forEach((b) => b.addEventListener('click', () => {
    view = 'queue';
    $$('#nav button').forEach((x) => x.setAttribute('aria-current', x.dataset.v === 'queue' ? 'page' : 'false'));
    loadQueue().then(() => openThread(Number(b.dataset.close)));
  }));

  $$('#queueList [data-goto]').forEach((b) => b.addEventListener('click', () => {
    view = 'queue';
    $$('#nav button').forEach((x) => x.setAttribute('aria-current', x.dataset.v === 'queue' ? 'page' : 'false'));
    loadQueue().then(() => openThread(Number(b.dataset.goto)));
  }));
}

/* ═══════════════════════════════════════════════════ canned replies ══ */
function paintCanned() {
  $('#panelTitle').textContent = 'Canned replies';
  $('#queueTools').hidden = true;
  $('#queueList').innerHTML = `
    <button class="btn btn--xs" id="cnNew" style="margin-bottom:10px">New reply</button>
    ${canned.map((c) => `
      <div class="canned">
        <b>${esc(c.title)}</b>
        <p>${esc(c.body)}</p>
        <div class="row">
          <button class="btn btn--ghost btn--xs" data-cned="${c.id}">Edit</button>
          <button class="btn btn--ghost btn--xs" data-cndel="${c.id}">Delete</button>
        </div>
      </div>`).join('')}`;

  $('#cnNew').addEventListener('click', () => cannedModal(null));
  $$('[data-cned]').forEach((b) => b.addEventListener('click', () =>
    cannedModal(canned.find((c) => String(c.id) === b.dataset.cned))));
  $$('[data-cndel]').forEach((b) => b.addEventListener('click', async () => {
    await rpcAuth('tuna_support_canned_delete', { p_id: Number(b.dataset.cndel) });
    canned = await rpcAuth('tuna_support_canned');
    paintCanned();
  }));
}

function cannedModal(c) {
  openModal(`
    <h2>${c ? 'Edit' : 'New'} canned reply</h2>
    <div class="alert alert--bad" id="cnErr" hidden></div>
    <label class="field"><span class="label">Title</span>
      <input type="text" id="cnTitle" value="${esc(c?.title || '')}"></label>
    <label class="field"><span class="label">Message</span>
      <textarea id="cnBody" rows="4">${esc(c?.body || '')}</textarea></label>
    <div class="row"><button class="btn grow" id="cnGo">Save</button>
      <button class="btn btn--ghost" id="cnX">Cancel</button></div>`);
  $('#cnX').addEventListener('click', closeModal);
  $('#cnGo').addEventListener('click', async (e) => {
    const err = $('#cnErr'); err.hidden = true;
    try {
      await busy(e.currentTarget, 'Saving…', () => rpcAuth('tuna_support_canned_save', {
        p_id: c?.id ?? null, p_title: $('#cnTitle').value, p_body: $('#cnBody').value
      }));
      closeModal();
      canned = await rpcAuth('tuna_support_canned');
      paintCanned();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

/* ════════════════════════════════════════════════════════════ boot ══ */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

(async function start() {
  $('#themeLabel').textContent = savedTheme() === 'dark' ? 'Dark' : 'Light';
  if (!getToken()) { $('#login').hidden = false; return; }
  try { await rpcAuth('tuna_support_stats'); await enter(); }
  catch { clearToken(); $('#login').hidden = false; }
})();
