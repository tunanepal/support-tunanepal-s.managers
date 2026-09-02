/* Tunanepal support desk.
   Left: the queue. Right: the conversation, with everything about the player
   already on screen so an agent never has to go asking the admin. */

import { rpc, rpcAuth, upload, getToken, setToken, clearToken, getAgent, setAgent } from './support-api.js';
import {
  $, $$, esc, money, when, ago, avatar, toast, busy, openModal, closeModal,
  empty, skeleton, applyTheme, savedTheme, CATEGORIES, ESC_CATEGORIES
} from './support-ui.js';
import { showMyWork } from './support-work.js';

applyTheme(savedTheme());

/* The module is running, so the "could not start" banner is wrong by
   definition. Remove it outright rather than relying on a flag the checker
   might read before this line lands. */
window.__tunaBooted = true;
document.getElementById('bootfail')?.remove();

let view = 'queue';            // queue | tickets | canned
let filter = 'open';           // open (unclaimed) | pending (mine) | solved (mine)
let search = '';
let openReport = null;
let canned = [];
let pollTimer = null;

/* ═══════════════════════════════════════════════════════════ sign in ══ */
$('#loginForm')?.addEventListener('submit', async (e) => {
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
  const l = $('#login'); if (l) l.hidden = true;
  const dk = $('#desk'); if (dk) dk.hidden = false;
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
$('#logoutBtn')?.addEventListener('click', signOut);

/* ══════════════════════════════════════════════════════════ chrome ══ */
$('#nav')?.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  view = b.dataset.v;
  document.body.classList.remove('reading');
  $$('#nav button').forEach((x) => x.setAttribute('aria-current', x.dataset.v === view ? 'page' : 'false'));
  refresh();
});

$('#themeBtn')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  $('#themeLabel').textContent = next === 'dark' ? 'Dark' : 'Light';
});

$('#pwBtn')?.addEventListener('click', () => {
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
  if (view === 'work') return showMyWork();
  if (view === 'queue') await loadQueue(quiet);
  if (view === 'tickets') await loadTickets();
  if (view === 'canned') paintCanned();
}

function paintStats(s) {
  $('#statOpen').textContent = s.open;
  $('#statPending').textContent = s.pending;
  $('#statSolved').textContent = s.solved_today;
  $('#statOpen').className = s.open > 0 ? 'stat__v stat__v--bad' : 'stat__v';

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
$('#qFilter')?.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  document.body.classList.remove('reading');
  syncFilter();
  loadQueue();
});

function syncFilter() {
  $$('#qFilter button').forEach((x) =>
    x.setAttribute('aria-pressed', String(x.dataset.f === filter)));
}
$('#qSearch')?.addEventListener('input', debounce(() => { search = $('#qSearch').value; loadQueue(); }, 300));

async function loadQueue(quiet = false) {
  $('#panelTitle').textContent = 'Conversations';
  $('#queueTools').hidden = false;
  const list = $('#queueList');
  if (!quiet && !list.children.length) list.innerHTML = skeleton(66, 4);
  let rows = [];
  try { rows = await rpcAuth('tuna_support_queue', { p_status: filter, p_q: search }) || []; }
  catch (e) { list.innerHTML = `<div class="alert alert--bad">${esc(e.message)}</div>`; return; }

  const blank = {
    open:    ['Nothing waiting', 'New messages from players appear here to be claimed.'],
    pending: ['No open chats', 'Claim something from the Open tab to start.'],
    solved:  ['Nothing solved yet', 'Chats you close appear here.']
  }[filter] || ['Nothing here', ''];

  list.innerHTML = rows.length ? rows.map(queueRow).join('')
    : empty(blank[0], blank[1]);

  $$('#queueList [data-open]').forEach((el) =>
    el.addEventListener('click', () => openThread(Number(el.dataset.open))));

  /* an unclaimed chat cannot be read until it is picked up */
  $$('#queueList [data-claim]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await busy(b, 'Claiming…', () =>
        rpcAuth('tuna_support_claim', { p_report: Number(b.dataset.claim) }));
      filter = 'pending';
      syncFilter();
      await loadQueue();
      openThread(Number(b.dataset.claim));
      loadStats();
      toast('Chat is yours. It has moved to Pending.', 'good');
    } catch (ex) { toast(ex.message, 'bad'); loadQueue(); }
  }));

  if (openReport && rows.some((r) => r.id === openReport)) markActive(openReport);
}

function queueRow(r) {
  const waitingOnUs = r.last_sender === 'player';
  const unclaimed = !r.assigned_to;
  return `
  <div class="qrow ${r.id === openReport ? 'qrow--on' : ''} ${unclaimed ? 'qrow--new' : ''}"
       ${unclaimed ? '' : `data-open="${r.id}"`} ${unclaimed ? '' : 'role="button" tabindex="0"'}>
    ${avatar(r)}
    <span class="qrow__body">
      <span class="qrow__top">
        <b>${esc(r.name)}</b>
        <span class="qrow__time">${esc(ago(r.updated_at))}</span>
      </span>
      <span class="qrow__msg">${esc(r.last_message || 'No messages yet')}</span>
      <span class="qrow__tags">
        ${r.open_escalations > 0 ? '<span class="tag tag--esc">ticket open</span>' : ''}
        ${r.blocked ? '<span class="tag tag--bad">blocked</span>' : ''}
        ${waitingOnUs && !unclaimed ? '<span class="tag tag--wait">needs reply</span>' : ''}
        ${r.messages > 1 ? `<span class="tag">${r.messages} messages</span>` : ''}
      </span>
    </span>
    ${unclaimed
      ? `<button class="btn btn--xs qrow__claim" data-claim="${r.id}">Claim</button>`
      : ''}
  </div>`;
}

function markActive(id) {
  $$('#queueList .qrow').forEach((el) =>
    el.classList.toggle('qrow--on', Number(el.dataset.open) === id));
}

/* ════════════════════════════════════════════════════ conversation ══ */
async function openThread(id) {
  openReport = id;
  markActive(id);
  document.body.classList.add('reading');   // list slides away, chat fills
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
        <button class="backbtn" id="tBack" aria-label="Back to list">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M15 5 8 12l7 7"/>
          </svg>
        </button>
        ${avatar(p, 'ava--lg')}
        <div class="grow">
          <b class="thead__name">${esc(p.name)}</b>
          <span class="mono xs muted">${esc(p.phone)}</span>
        </div>
        <button class="btn btn--ghost btn--xs" id="ctxToggle">Player info</button>
      </div>

      <div class="tcontrols">
        <select id="tCategory" title="What this is about">${CATEGORIES.map((c) =>
          `<option ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        ${r.status === 'solved' || r.status === 'closed' ? `
          <span class="donetag">Closed</span>`
        : `
          <button class="btn btn--gold btn--xs" id="tEsc">Raise ticket</button>
          <button class="btn btn--win btn--xs" id="tSolve">Mark solved</button>
          <button class="btn btn--ghost btn--xs" id="tRelease">Release</button>`}
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

    ${r.status === 'solved' || r.status === 'closed' ? `
    <div class="composer composer--done">
      <p>This chat is solved and closed for the player.
         Replying reopens it and puts it back in your Pending list.</p>
      <button class="btn btn--ghost btn--xs" id="tReopen">Reply anyway</button>
    </div>` : `
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
    </div>`}`;

  $('#chat').scrollTop = $('#chat').scrollHeight;

  $('#tBack')?.addEventListener('click', closeThread);

  $('#ctxToggle').addEventListener('click', () => {
    const c = $('#ctxCard');
    c.hidden = !c.hidden;
    $('#ctxToggle').textContent = c.hidden ? 'Player info' : 'Hide info';
  });

  const set = (args) => rpcAuth('tuna_support_update', { p_report: id, ...args })
    .then(() => { toast('Updated.'); loadQueue(true); })
    .catch((e) => toast(e.message, 'bad'));

  $('#tCategory')?.addEventListener('change', (e) => set({ p_category: e.target.value }));

  /* hand a chat back if it was picked up by mistake */
  $('#tRelease')?.addEventListener('click', async (e) => {
    try {
      await busy(e.currentTarget, 'Releasing…', () =>
        rpcAuth('tuna_support_release', { p_report: id }));
      openReport = null;
      $('#thread').innerHTML = `<div class="empty">
        <div class="display">Released</div><p>The chat is back in the Open queue.</p></div>`;
      filter = 'open'; syncFilter(); loadQueue(); loadStats();
      toast('Released back to the queue.');
    } catch (ex) { toast(ex.message, 'bad'); }
  });
  $('#tEsc')?.addEventListener('click', () => escalateModal(id, p));
  $('#tSolve')?.addEventListener('click', () => solveModal(id, p));

  $('#tReopen')?.addEventListener('click', () => {
    $('.composer--done').outerHTML = liveComposer();
    wireComposer(id);
  });

  if (!$('#cSend')) return;
  wireComposer(id);
}

function liveComposer() {
  return `
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
}

function wireComposer(id) {
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

function closeThread() {
  document.body.classList.remove('reading');
  openReport = null;
  markActive(null);
  const pane = $('#thread');
  if (pane) pane.innerHTML = `
    <div class="empty">
      <div class="display">Pick a conversation</div>
      <p>Choose someone on the left to see their messages and account.</p>
    </div>`;
}

/* Escape and the phone's back gesture both close the chat first. */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('reading')
      && !document.getElementById('modalScrim')) closeThread();
});

function bubble(m) {
  if (m.sender === 'system') return `
    <div class="sysline">${esc(m.body)}<time>${esc(when(m.created_at))}</time></div>`;
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
  const label = $('#themeLabel');
  if (label) label.textContent = savedTheme() === 'dark' ? 'Dark' : 'Light';

  const showLogin = () => { const l = $('#login'); if (l) l.hidden = false; };

  try {
    if (!getToken()) return showLogin();
    await rpcAuth('tuna_support_stats');
    await enter();
  } catch (e) {
    /* Whatever went wrong, never leave the agent staring at a blank page. */
    clearToken();
    showLogin();
    if (!/session|sign in/i.test(e?.message || '')) {
      toast(e?.message || 'Could not start. Reload the page.', 'bad');
    }
  }
})();
