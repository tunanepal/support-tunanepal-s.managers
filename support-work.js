/* Tunanepal support desk — My work.
   Attendance, what the agent has earned, and the two money buttons. Kept in
   its own module so the conversation queue stays untouched. */

import { rpcAuth } from './support-api.js';
import { $, $$, esc, when, toast, busy, openModal, closeModal, skeleton } from './support-ui.js';

const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN')}`;

const clock = (iso) => iso
  ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  : '—';

const monthName = (d) =>
  new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

let work = null;

/* ─────────────────────────────────────────────────── clock in and out ── */
export async function autoClockPrompt() {
  /* Called once after sign-in. If today is unmarked, offer it straight away
     rather than making them hunt for the button. */
  try {
    const w = await rpcAuth('tuna_support_my_work');
    if (!w.today) toast('Remember to mark yourself present in My work.');
  } catch {}
}

export async function showMyWork() {
  const body = $('#queueList');
  $('#panelTitle').textContent = 'My work';
  const tools = $('#queueTools');
  if (tools) tools.hidden = true;
  body.innerHTML = skeleton(80, 3);

  try { work = await rpcAuth('tuna_support_my_work'); }
  catch (e) { body.innerHTML = `<div class="alert alert--bad">${esc(e.message)}</div>`; return; }

  const t = work.today;
  const inNow = t && !t.clock_out;

  body.innerHTML = `
    <!-- attendance -->
    <div class="wcard">
      <div class="wcard__head">
        <h3>Attendance</h3>
        <span class="xs muted">${esc(monthName(work.month))}</span>
      </div>

      <div class="today ${t ? (inNow ? 'today--in' : 'today--done') : ''}">
        <div class="grow">
          <b>${t ? (inNow ? 'You are clocked in' : 'Shift finished') : 'Not marked today'}</b>
          <small>${t
            ? `In ${clock(t.clock_in)}${t.clock_out ? ` · Out ${clock(t.clock_out)} · ${t.minutes} min` : ''}`
            : `Mark present to earn today's ${rs(work.daily_rate)}`}</small>
        </div>
        ${!t
          ? `<button class="btn btn--win btn--xs" id="wIn">Mark present</button>`
          : inNow
            ? `<button class="btn btn--ghost btn--xs" id="wOut">Clock out</button>`
            : `<span class="donetag">Done</span>`}
      </div>

      <div class="wgrid">
        <div><small>Days present</small><b>${work.days_present}</b></div>
        <div><small>Daily rate</small><b>${rs(work.daily_rate)}</b></div>
        <div><small>Monthly</small><b>${rs(work.monthly_salary)}</b></div>
      </div>

      <div class="calstrip">
        ${(work.calendar || []).map((d) => `
          <span class="calday ${d.present ? 'calday--on' : ''}"
                title="${esc(d.d)}${d.present ? ' · present' : ' · absent'}">
            ${new Date(d.d).getDate()}
          </span>`).join('')}
      </div>
    </div>

    <!-- money -->
    <div class="wcard">
      <div class="wcard__head"><h3>This month</h3></div>
      <div class="money">
        <div class="money__row"><span>Earned · ${work.days_present} days</span>
          <b class="up">+ ${rs(work.earned)}</b></div>
        <div class="money__row"><span>Fines</span>
          <b class="${work.fines ? 'down' : ''}">− ${rs(work.fines)}</b></div>
        <div class="money__row"><span>Advance taken</span>
          <b class="${work.advance_taken ? 'down' : ''}">− ${rs(work.advance_taken)}</b></div>
        <div class="money__row money__row--total"><span>Total</span>
          <b>${rs(work.net)}</b></div>
      </div>
      <p class="xs muted" style="margin-top:8px">
        Status: <b>${work.payment_status === 'paid' ? 'Paid by admin' : 'Not paid yet'}</b>
      </p>

      <div class="row" style="margin-top:12px">
        <button class="btn grow" id="wForm">Get salary here</button>
        <button class="btn btn--ghost" id="wAdv">Request advance</button>
      </div>
    </div>

    ${work.fine_list?.length ? `
    <div class="wcard">
      <div class="wcard__head"><h3>Fines this month</h3></div>
      ${work.fine_list.map((f) => `
        <div class="money__row">
          <span>${esc(f.reason)}<br><span class="xs muted">${esc(when(f.created_at))}</span></span>
          <b class="down">− ${rs(f.amount)}</b>
        </div>`).join('')}
    </div>` : ''}

    ${work.advances?.length ? `
    <div class="wcard">
      <div class="wcard__head"><h3>Advance requests</h3></div>
      ${work.advances.map((s) => `
        <div class="money__row">
          <span>${rs(s.amount)}${s.reason ? ' · ' + esc(s.reason) : ''}
            <br><span class="xs muted">${esc(when(s.created_at))}</span>
            ${s.admin_note ? `<br><span class="xs">${esc(s.admin_note)}</span>` : ''}
            ${s.status === 'approved' && s.form_link
              ? `<br><a href="${esc(s.form_link)}" target="_blank" rel="noopener">Open the form</a>` : ''}
          </span>
          <span class="tag tag--${esc(s.status)}">${esc(s.status)}</span>
        </div>`).join('')}
    </div>` : ''}

    <!-- work done -->
    <div class="wcard">
      <div class="wcard__head"><h3>My progress</h3></div>
      <div class="wgrid wgrid--4">
        <div><small>Solved this month</small><b>${work.stats.solved_month}</b></div>
        <div><small>Solved all time</small><b>${work.stats.solved_total}</b></div>
        <div><small>Handling now</small><b>${work.stats.handling}</b></div>
        <div><small>Tickets raised</small><b>${work.stats.tickets}</b></div>
      </div>
    </div>`;

  $('#wIn')?.addEventListener('click', async (e) => {
    try {
      const out = await busy(e.currentTarget, 'Marking…', () => rpcAuth('tuna_support_clock_in'));
      toast(out.already ? 'Already marked today.' : `Present. ${rs(out.earned_today)} added.`, 'good');
      showMyWork();
    } catch (ex) { toast(ex.message, 'bad'); }
  });

  $('#wOut')?.addEventListener('click', async (e) => {
    try {
      const out = await busy(e.currentTarget, 'Saving…', () => rpcAuth('tuna_support_clock_out'));
      toast(`Clocked out after ${out.minutes} minutes.`, 'good');
      showMyWork();
    } catch (ex) { toast(ex.message, 'bad'); }
  });

  $('#wForm').addEventListener('click', () => {
    if (!work.salary_form) {
      return toast('No salary form has been set up yet. Ask the admin.', 'bad');
    }
    window.open(work.salary_form, '_blank', 'noopener');
  });

  $('#wAdv').addEventListener('click', advanceModal);
}

/* ───────────────────────────────────────────────── request an advance ── */
function advanceModal() {
  const pending = (work.advances || []).find((a) => a.status === 'pending');
  const thisMonth = (work.advances || []).some((a) =>
    a.status !== 'rejected' &&
    new Date(a.created_at).getMonth() === new Date().getMonth());

  openModal(`
    <h2>Request an advance</h2>
    <p class="sub">Once a month, up to ${rs(work.advance_max)}.</p>
    <div class="alert alert--bad" id="avErr" hidden></div>

    ${pending ? `<div class="alert alert--good">
      You already have ${rs(pending.amount)} waiting for a decision.</div>`
    : thisMonth ? `<div class="alert alert--good">
      You have already taken an advance this month.</div>` : `
    <label class="field"><span class="label">Amount</span>
      <input type="number" id="avAmt" max="${work.advance_max}" placeholder="e.g. 1000"></label>
    <label class="field"><span class="label">Reason</span>
      <input type="text" id="avWhy" placeholder="Why do you need it early?"></label>
    <p class="xs muted">It comes off this month's total. If it is approved you
      get a form link here; if not, you are told why.</p>`}

    <div class="row" style="margin-top:14px">
      ${pending || thisMonth ? '' : '<button class="btn grow" id="avGo">Send request</button>'}
      <button class="btn btn--ghost" id="avX">Close</button>
    </div>`);

  $('#avX').addEventListener('click', closeModal);
  $('#avGo')?.addEventListener('click', async (e) => {
    const err = $('#avErr'); err.hidden = true;
    try {
      await busy(e.currentTarget, 'Sending…', () => rpcAuth('tuna_support_request_advance', {
        p_amount: parseInt($('#avAmt').value, 10),
        p_reason: $('#avWhy').value
      }));
      closeModal();
      toast('Request sent. You will hear back here.', 'good');
      showMyWork();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}
