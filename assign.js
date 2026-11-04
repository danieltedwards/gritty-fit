// GRIT: one-off workouts. The coach sends a client a workout outside their normal plan (picked from any
// plan in the library or typed out quickly); the client sees it on Today / Train / the calendar, does it in
// the normal workout logger, and it lands in their history (optionally counting as a day of their plan).
(function () {
  let C, sb = null;
  const st = { list: [], loaded: false, draft: null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getSb = () => sb || (sb = window.Cloud && Cloud._sb ? Cloud._sb() : null);
  const me = () => window.Cloud && Cloud.user && Cloud.user.id;
  const isCoach = () => !!(window.Cloud && Cloud.profile && Cloud.profile.role === 'coach');
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

  // ---------- client: load + show ----------
  async function load() {
    if (!getSb() || !me() || isCoach()) { st.list = []; st.loaded = true; return; }
    const since = new Date(Date.now() - 45 * 864e5).toISOString();
    const { data, error } = await sb.from('assigned_workouts').select('id,title,day,note,for_date,replaces,status,done_at,created_at').eq('client_id', me()).gte('created_at', since).order('created_at', { ascending: false }).limit(50);
    if (!error) st.list = (data || []).map((a) => Object.assign(a, { for_date: a.for_date ? String(a.for_date).slice(0, 10) : null }));
    st.loaded = true;
  }
  const today = () => C.todayISO();
  // pending workouts that belong on a date: dated ones on their date; undated (and overdue within a week) on today
  function pendingOn(iso) {
    const t = today();
    return st.list.filter((a) => a.status === 'pending' && (a.for_date ? a.for_date === iso || (iso === t && a.for_date < t && C.daysBetween(a.for_date, t) <= 7) : iso === t));
  }
  const dateLbl = (a) => (a.for_date ? (a.for_date === today() ? 'Today' : a.for_date < today() ? `Was for ${C.prettyDate(a.for_date, { weekday: 'short', month: 'short', day: 'numeric' })}` : C.prettyDate(a.for_date, { weekday: 'short', month: 'short', day: 'numeric' })) : 'Any day');
  function itemHTML(a) {
    const names = ((a.day && a.day.blocks) || []).flatMap((b) => (b.exercises || []).map((e) => e.name));
    return `<div class="entry planned assign-item"><div class="row" style="flex-wrap:nowrap"><div style="flex:1;min-width:0"><div class="meta">From your coach · ${esc(dateLbl(a))}${a.replaces ? ' · counts as ' + esc(a.replaces.label || 'a plan day') : ''}</div>
      <strong>${esc(a.title)}</strong></div>
      <button class="btn small primary" style="flex:none" data-action="assign-start" data-id="${a.id}">Start</button></div>
      ${a.note ? `<p class="sub" style="margin:4px 0 0">“${esc(a.note)}”</p>` : ''}
      ${names.length ? `<p class="sub" style="margin:4px 0 0">${esc(names.slice(0, 8).join(' · '))}${names.length > 8 ? ' …' : ''}</p>` : a.day && a.day.instructions ? `<p class="sub" style="margin:4px 0 0">${esc(String(a.day.instructions).slice(0, 140))}</p>` : ''}
      <button class="link-btn" data-action="assign-skip" data-id="${a.id}" style="padding:4px 0 0;font-size:13px">Not today</button></div>`;
  }
  function card() {
    if (!st.loaded) { if (getSb() && me() && !isCoach()) load().then(() => { if (st.list.length) C.render(); }); return ''; }
    const t = today();
    const items = st.list.filter((a) => a.status === 'pending' && (!a.for_date || a.for_date <= t) && !(a.for_date && C.daysBetween(a.for_date, t) > 7));
    const upcoming = st.list.filter((a) => a.status === 'pending' && a.for_date && a.for_date > t);
    if (!items.length && !upcoming.length) return '';
    return `<div class="card assign-card"><div class="card-head"><h2>From your coach</h2></div>${items.map(itemHTML).join('')}
      ${upcoming.length ? `<p class="sub" style="margin:8px 0 0">Coming up: ${upcoming.map((a) => `${esc(a.title)} (${esc(dateLbl(a))})`).join(', ')}</p>` : ''}</div>`;
  }

  // ---------- coach: quick text → workout ----------
  // "3 rounds for time" / "AMRAP 12 min" lines start a block; "Back Squat 5x5 @ 225", "3x12 goblet squat",
  // "10 push-ups", "400m run" become exercises; anything else is kept as instructions.
  const HEAD = /\b(amrap|emom|e\dmom|for time|rounds?|tabata|every\s+\d|sets? of|circuit|superset|finisher|warm.?up|cool.?down|chipper|ladder)\b/i;
  function parseText(text) {
    const blocks = [], instr = [];
    let cur = null, rounds = 1;
    const used = {};
    const uid = (n) => { let id = slug(n); used[id] = (used[id] || 0) + 1; return used[id] > 1 ? `${id}-${used[id]}` : id; };
    String(text || '').split(/\n/).map((l) => l.trim().replace(/^[-•*]\s*/, '')).forEach((l) => {
      if (!l) { cur = null; rounds = 1; return; }                       // a blank line ends a section
      if (/^(warm.?up|cool.?down|notes?|rest)\b[^:]*:\s*\S/i.test(l)) { instr.push(l); return; }
      l = l.replace(/^(?:min(?:ute)?\s*\d+|\d+(?:st|nd|rd|th)\s*min(?:ute)?)\s*[:\-–.)]\s*/i, '');
      const isEx = /^\d+\s*[x×]\s*\d/.test(l) || /\s\d+\s*[x×]\s*\d/.test(l) || /^(\d+(?:[/:.\-–]\d+)*|:\d\d)\s*(cal|m|km|mi|sec|s|min|reps?|'|ft|yd|x)?\s+[a-z]/i.test(l);
      if (HEAD.test(l) && !/\d+\s*[x×]\s*\d/.test(l) && !(isEx && !/\b(rounds?|sets?|amrap|emom|e\dmom|tabata|every|for time)\b/i.test(l))) {
        const m = l.match(/(\d+)\s*(?:-\s*\d+\s*)?(rounds?|sets?)\b/i);
        rounds = m ? +m[1] : 1;
        cur = { type: 'superset', name: l.replace(/:$/, ''), exercises: [] }; blocks.push(cur);
        const sch = l.match(/\b(\d+(?:\s*[-–]\s*\d+){2,})\b/); cur.scheme = sch ? sch[1].replace(/\s+/g, '') : null;
        return;
      }
      let name, sets = cur ? rounds : 3, reps = 'as written', notes = '';
      const at = l.match(/\s@\s*(.+)$/); if (at) { notes = '@ ' + at[1]; l = l.slice(0, at.index).trim(); }
      let m;
      if ((m = l.match(/^(\d+)\s*[x×]\s*([\d\-–/]+\+?\s*(?:reps?|sec|s|min|m|cal|each)?)\s+(.+)$/i))) { sets = +m[1]; reps = m[2].trim(); name = m[3]; }
      else if ((m = l.match(/^(.+?)\s+(\d+)\s*[x×]\s*([\d\-–/]+\+?\s*(?:reps?|sec|s|min|m|cal|each)?)\s*(.*)$/i))) { name = m[1]; sets = +m[2]; reps = m[3].trim(); if (m[4]) notes = (m[4] + ' ' + notes).trim(); }
      else if ((m = l.match(/^((?:\d+(?:[/:.\-–]\d+)*|:\d\d)\s*(?:cal|m|km|mi|sec|s|min|reps?|'|ft|yd)?)\s+(.+)$/i))) { reps = m[1].replace(/\s+/g, ' ').trim(); name = m[2]; if (!cur) sets = 1; }
      else if (cur) { name = l; if (cur.scheme) { reps = cur.scheme; sets = 1; } }
      else { instr.push(l); return; }
      name = name.replace(/\s+/g, ' ').trim();
      const each = /\b(each|per side|\/side|l\/r)\b/i.test(reps + ' ' + name);
      reps = reps.replace(/\s*\b(each|per side)\b/i, '').trim() || 'as written';
      name = name.replace(/\s*\b(each( side| arm| leg)?|per side)\b\s*$/i, '').trim();
      name = name.charAt(0).toUpperCase() + name.slice(1);
      const ex = { id: uid(name), name, sets, reps: reps.replace(/-/g, '–'), role: 'accessory' };
      if (each) ex.each = true;
      if (notes) ex.notes = notes;
      if (cur) cur.exercises.push(ex); else blocks.push({ type: 'single', exercises: [ex] });
    });
    blocks.forEach((b) => delete b.scheme);
    const kept = blocks.filter((b) => b.exercises.length);
    blocks.filter((b) => !b.exercises.length).forEach((b) => instr.push(b.name));
    return { blocks: kept, instructions: instr.join('\n') };
  }
  const previewHTML = (day) => ((day.blocks || []).length ? day.blocks.map((b) => `${b.name ? `<div class="res-head">${esc(b.name)}</div>` : ''}<ul class="list">${b.exercises.map((e) => `<li><div class="grow"><div class="title">${esc(e.name)}</div>${e.notes ? `<div class="meta">${esc(e.notes)}</div>` : ''}</div><span class="num">${e.sets > 1 ? e.sets + ' × ' : ''}${esc(e.reps)}</span></li>`).join('')}</ul>`).join('') : '<p class="sub">No exercises recognised; the client will see your text as instructions and log freely.</p>')
    + (day.instructions ? `<p class="sub" style="white-space:pre-wrap">${esc(day.instructions)}</p>` : '');

  // ---------- coach: send flow ----------
  function clientInfo(id) {
    const cd = Cloud.coachData && Cloud.coachData();
    return cd && cd.clients ? cd.clients.find((c) => c.client_id === id) : null;
  }
  function coachPlans() { const cd = Cloud.coachData && Cloud.coachData(); return ((cd && cd.plans) || []).filter((p) => p.data && (p.data.days || p.data.schedule)); }
  // the client's current-week plan days, for "counts as"
  function replaceOptions(clientId) {
    const c = clientInfo(clientId); const out = [];
    const progs = (c && c.program && c.program.planId) ? [c.program] : [];
    progs.forEach((pr) => {
      const row = coachPlans().find((p) => p.id === pr.planId); if (!row) return;
      const plan = row.data;
      const wk = window.Training && Training.programWeek ? Training.programWeek(pr, plan) : { week: 1 };
      const days = (Training.atWeek ? Training.atWeek(plan, wk.week) : plan).days || [];
      days.forEach((d) => out.push({ planId: row.id, dayId: d.id, week: wk.week, label: `${plan.name} · ${d.label}: ${d.name}` }));
    });
    return out;
  }
  function sendForm(clientId, name, day, title, sourceLabel) {
    const opts = replaceOptions(clientId);
    const t = C.todayISO();
    st.draft = { clientId, name, day, opts };
    C.openModal(`<h2>Send ${esc(name || 'client')} a workout</h2>
      <p class="sub" style="margin-top:0">${esc(sourceLabel)}</p>
      ${C.field('Title', `<input type="text" name="title" required maxlength="120" value="${esc(title || '')}" placeholder="Hotel room workout">`)}
      <div class="fields-2">${C.field('For', `<select name="when"><option value="${t}">Today</option><option value="${C.addDays(t, 1)}">Tomorrow</option><option value="">Any day</option><option value="pick">Pick a date…</option></select>`)}
        ${C.field('Date (if picking)', `<input type="date" name="date" value="${t}">`)}</div>
      ${C.field('Counts as (optional)', `<select name="replaces"><option value="">Extra workout (doesn't replace a plan day)</option>${opts.map((o, i) => `<option value="${i}">${esc(o.label)}</option>`).join('')}</select>`)}
      ${C.field('Note to them (optional)', '<textarea name="note" rows="2" placeholder="No barbell today? Do this instead. Keep it moving."></textarea>')}
      <div class="res-head">Workout</div>${previewHTML(day)}`, async (fd) => {
      const when = fd.get('when'); const for_date = when === 'pick' ? (fd.get('date') || null) : (when || null);
      const ri = fd.get('replaces'); const replaces = ri !== '' && ri != null ? opts[+ri] : null;
      const row = { client_id: clientId, title: String(fd.get('title') || '').trim() || 'Workout', day: Object.assign({}, day, { name: String(fd.get('title') || '').trim() || day.name }), note: String(fd.get('note') || '').trim() || null, for_date, replaces };
      const { error } = await sb.from('assigned_workouts').insert(row);
      if (error) { C.toast(/assigned_workouts|schema cache|does not exist/i.test(error.message) ? 'Run the latest SQL in Supabase first (one-off workouts).' : 'Couldn\'t send: ' + error.message); return false; }
      C.toast(`Sent to ${name || 'client'} 💪`);
    }, { saveLabel: 'Send workout' });
  }
  async function history(clientId) {
    const { data } = await sb.from('assigned_workouts').select('title,status,for_date,created_at,done_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(8);
    return data || [];
  }
  async function chooseSource(clientId, name) {
    const past = await history(clientId).catch(() => []);
    C.openModal(`<h2>Send ${esc(name || 'client')} a workout</h2>
      <p class="sub" style="margin-top:0">For a day they can't follow their plan (short on time, no equipment, travelling). It shows up on their Today screen and calendar, and when they finish it you get a notification.</p>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:8px">
        <button class="btn primary block" data-modal-action="assign-write" data-id="${clientId}" data-name="${esc(name || '')}">✍️ Write it out</button>
        <button class="btn block" data-modal-action="assign-pick" data-id="${clientId}" data-name="${esc(name || '')}">📋 Pick a day from a plan</button></div>
      ${past.length ? `<div class="res-head">Recently sent</div><ul class="list">${past.map((a) => `<li><div class="grow"><div class="title">${esc(a.title)}</div><div class="meta">${a.for_date ? esc(C.prettyDate(a.for_date, { month: 'short', day: 'numeric' })) : 'Any day'} · sent ${esc(C.relDay(a.created_at.slice(0, 10)))}</div></div><span class="num">${a.status === 'done' ? '✓ Done' : a.status === 'skipped' ? 'Skipped' : 'Waiting'}</span></li>`).join('')}</ul>` : ''}`, null, { hideSave: true });
  }
  function writeForm(clientId, name, text) {
    C.openModal(`<h2>Write the workout</h2>
      <p class="sub" style="margin-top:0">One line per exercise. Lines like <em>3 rounds for time</em>, <em>AMRAP 12 min</em> or <em>EMOM 10</em> start a section (it's scored and timed automatically).</p>
      <textarea name="wtext" rows="10" required placeholder="Warm-up: 5 min easy bike&#10;3 rounds for time&#10;400m run&#10;15 KB swings @ 53/35&#10;10 push-ups&#10;&#10;Goblet squat 3x12&#10;DB row 3x10 each">${esc(text || '')}</textarea>`, (fd) => {
      const txt = String(fd.get('wtext') || '');
      const p = parseText(txt);
      const first = txt.split(/\n/).find((l) => l.trim()) || 'Workout';
      setTimeout(() => sendForm(clientId, name, { name: 'Workout', blocks: p.blocks, instructions: p.instructions, freeform: !p.blocks.length }, '', 'Check it looks right, then send.'), 0);
      st.lastText = txt;
    }, { saveLabel: 'Next' });
  }
  function pickPlanForm(clientId, name) {
    const plans = coachPlans().filter((p) => !p.data.forClient);
    if (!plans.length) { C.toast('No plans in your library yet'); return; }
    C.openModal(`<h2>Pick a plan</h2>${C.field('Plan', `<select name="plan">${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.data.name)}</option>`).join('')}</select>`)}`, (fd) => {
      const row = plans.find((p) => p.id === fd.get('plan'));
      setTimeout(() => pickDayForm(clientId, name, row), 0);
    }, { saveLabel: 'Next' });
  }
  function pickDayForm(clientId, name, row) {
    const plan = row.data, list = [];
    const weeks = plan.schedule && plan.schedule.length ? Array.from({ length: plan.weeks || 1 }, (_, i) => i + 1) : [1];
    weeks.forEach((w) => ((Training.atWeek ? Training.atWeek(plan, w) : plan).days || []).forEach((d) => list.push({ w, d })));
    // collapse identical weeks
    const seen = new Set(), uniq = list.filter((x) => { const k = JSON.stringify(x.d.blocks); if (seen.has(k)) return false; seen.add(k); return true; });
    C.openModal(`<h2>${esc(plan.name)}</h2>${C.field('Day', `<select name="day">${uniq.map((x, i) => `<option value="${i}">${weeks.length > 1 ? `Week ${x.w} · ` : ''}${esc(x.d.label)}: ${esc(x.d.name)}</option>`).join('')}</select>`)}`, (fd) => {
      const x = uniq[+fd.get('day')]; if (!x) return false;
      const day = JSON.parse(JSON.stringify(x.d));
      if (day.warmup && plan.warmups && plan.warmups[day.warmup]) {
        const wu = plan.warmups[day.warmup];
        day.instructions = [`Warm-up: ${wu.items.map((i) => `${i.dose ? i.dose + ' ' : ''}${i.name}`).join(', ')}`, day.instructions].filter(Boolean).join('\n');
      }
      delete day.warmup;
      setTimeout(() => sendForm(clientId, name, day, `${x.d.name}`, `From ${plan.name}${weeks.length > 1 ? ` · Week ${x.w}` : ''}`), 0);
    }, { saveLabel: 'Next' });
  }

  const actions = {
    'assign-start': (el) => { const a = st.list.find((x) => x.id === el.dataset.id); if (a && window.Training) Training.startOneOff(a); },
    'assign-skip': async (el) => {
      const a = st.list.find((x) => x.id === el.dataset.id); if (!a) return;
      if (!confirm(`Skip "${a.title}"? Your coach will see it as skipped.`)) return;
      a.status = 'skipped'; C.render();
      await sb.rpc('finish_assigned', { p_id: a.id, p_status: 'skipped' });
    },
    'coach-send-workout': (el) => chooseSource(el.dataset.id, el.dataset.name),
  };
  const modalActions = {
    'assign-write': (b) => { C.closeModal(); setTimeout(() => writeForm(b.dataset.id, b.dataset.name, ''), 0); },
    'assign-pick': (b) => { C.closeModal(); setTimeout(() => pickPlanForm(b.dataset.id, b.dataset.name), 0); },
  };

  window.Assign = {
    init(ctx) {
      C = ctx;
      Object.assign(ctx.actions, actions);
      Object.assign(ctx.modalActions, modalActions);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me() && !isCoach()) load().then(() => C.softRender ? C.softRender() : null); });
      if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'grit-push' && me() && !isCoach()) load().then(() => { if (['today', 'train'].includes(C.ui.tab)) C.render(); }); });
    },
    onSignedIn() { st.loaded = false; st.list = []; load().then(() => { if (st.list.length) C.render(); }); },
    onSignedOut() { st.list = []; st.loaded = false; },
    card,
    pendingOn,
    itemHTML,
    async complete(id, workoutId) {
      const a = st.list.find((x) => x.id === id); if (a) { a.status = 'done'; a.done_at = new Date().toISOString(); }
      if (getSb()) { try { await sb.rpc('finish_assigned', { p_id: id, p_status: 'done', p_workout: workoutId }); } catch (_) { /* offline: stays pending */ } }
    },
    parseText,
  };
})();
