// GRIT: coach calendar. One screen with every client's training for a day: what they logged, what their
// plan has them doing, and anything you sent. "Adjust" lets the coach change a client's plan day for that
// date (swap/remove/add exercises, change sets and reps); the client gets the coach's version on that day
// and it counts as that plan day when they finish it.
(function () {
  let C;
  const st = { clients: null, loading: false, err: null, sent: [], loadedAt: 0, edit: null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = () => (window.Cloud && Cloud._sb ? Cloud._sb() : null);
  const cd = () => (window.Cloud && Cloud.coachData ? Cloud.coachData() : null);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

  async function load() {
    const data = cd(); if (!data || !data.clients || !sb()) return;
    st.loading = true; st.err = null;
    try {
      const ids = data.clients.map((c) => c.client_id);
      const by = new Map(data.clients.map((c) => [c.client_id, { c, state: { workouts: [], programs: [], program: null, settings: { units: 'lb' } }, body: [], nutrition: null, targets: null }]));
      if (ids.length) {
        for (let from = 0; ; from += 1000) {
          const { data: rows, error } = await sb().from('entries').select('user_id,kind,id,data').in('user_id', ids).in('kind', ['workouts', 'program', 'settings', 'body', 'nutrition']).eq('deleted', false).range(from, from + 999);
          if (error) throw error;
          rows.forEach((r) => {
            const x = by.get(r.user_id); if (!x || !r.data) return;
            if (r.kind === 'workouts') x.state.workouts.push(r.data);
            else if (r.kind === 'program') { x.state.programs = Array.isArray(r.data.programs) ? r.data.programs.slice(0, 3) : (r.data.program ? [r.data.program] : []); x.state.program = x.state.programs[0] || null; }
            else if (r.kind === 'settings' && r.data.units) x.state.settings.units = r.data.units;
            else if (r.kind === 'body') x.body.push(r.data);
            else if (r.kind === 'nutrition') x.nutrition = r.data;
          });
          if (rows.length < 1000) break;
        }
        const { data: tg } = await sb().from('profiles').select('id,targets').in('id', ids);
        (tg || []).forEach((r) => { const x = by.get(r.id); if (x) x.targets = r.targets || null; });
        const since = new Date(Date.now() - 60 * 864e5).toISOString();
        const { data: sent } = await sb().from('assigned_workouts').select('id,client_id,title,day,note,for_date,replaces,status,done_at,created_at').in('client_id', ids).gte('created_at', since).order('created_at', { ascending: true });
        st.sent = (sent || []).map((a) => Object.assign(a, { for_date: a.for_date ? String(a.for_date).slice(0, 10) : null }));
      }
      // plans: your library is already loaded on the dashboard; bundled plans load on demand
      (data.plans || []).forEach((p) => { if (p.data && p.data.days) Training.cachePlan(p.id, p.data); });
      const need = new Set(); by.forEach((x) => x.state.programs.forEach((p) => need.add(p.planId)));
      await Promise.all([...need].map((id) => Training.loadPlan(id).catch(() => null)));
      st.clients = [...by.values()];
      st.loadedAt = Date.now();
    } catch (e) { st.err = e.message || String(e); }
    st.loading = false;
    if (C.ui.tab === 'coach') C.render();
  }

  // everything for one client on one date
  function dayFor(x, d) {
    const t = C.todayISO();
    const done = x.state.workouts.filter((w) => w.date === d);
    const sent = st.sent.filter((a) => a.client_id === x.c.client_id && a.status === 'pending' && (a.for_date ? a.for_date === d : d === t));
    const sentDone = st.sent.filter((a) => a.client_id === x.c.client_id && a.status !== 'pending' && a.for_date === d && !done.some((w) => w.oneOff && w.oneOff.id === a.id));
    let planned = [];
    if (d >= t && x.state.programs.length) {
      try { planned = Training.withState(x.state, () => Training.plannedOn(d)); } catch (_) { planned = []; }
      planned = planned.filter((p) => !(d === t && done.some((w) => w.planId === p.plan.id)) && !sent.some((a) => a.replaces && a.replaces.planId === p.plan.id && a.replaces.dayId === p.day.id));
    }
    return { done, sent, sentDone, planned };
  }
  function mark(d) {
    if (!st.clients) return null;
    let n = 0, ok = 0;
    st.clients.forEach((x) => { const r = dayFor(x, d); if (r.done.length) ok++; else if (r.planned.length || r.sent.length) n++; });
    if (!ok && !n) return null;
    return { html: ok ? `${ok}✓` : `${n}`, cls: ok ? 'good' : '' };
  }

  // ---------- nutrition check-ins (every 2 weeks, coach approves) ----------
  function checkinFor(x) {
    const n = x.nutrition; if (!n || !n.profile || !window.Nutrition || !Nutrition.checkin) return null;
    const t = C.todayISO(), rev = ((C.getState().settings || {}).nutReviewed || {})[x.c.client_id];
    const tc = x.targets && x.targets.checkin;
    const since = [n.profile.updated, rev, tc].filter(Boolean).sort().pop();
    return Nutrition.checkin({ profile: n.profile, coach: { kcalAdjust: x.targets && x.targets.kcalAdjust != null ? x.targets.kcalAdjust : (n.coach || {}).kcalAdjust },
      body: x.body, units: x.state.settings.units, since, today: t, foodDays: x.c.food_days_7d });
  }
  function checkinsCard() {
    if (!st.clients) return '';
    const rows = st.clients.map((x) => ({ x, ci: checkinFor(x) })).filter((r) => r.ci);
    if (!rows.length) return '';
    const due = rows.filter((r) => r.ci.due), later = rows.filter((r) => !r.ci.due);
    const cls = { ok: 'good', slow: 'accent', fast: 'accent', nodata: '' }, tag = { ok: 'On track', slow: 'Adjust', fast: 'Adjust', nodata: 'No data' };
    let h = `<div class="card"><div class="card-head"><h2>Nutrition check-ins${due.length ? ' · ' + due.length + ' due' : ''}</h2></div>`;
    h += due.length ? due.map(({ x, ci }) => {
      const name = x.c.full_name || x.c.email, id = x.c.client_id;
      const btns = ci.status === 'nodata' ? `<button class="btn small" data-action="chat-with" data-id="${id}" data-name="${esc(name)}">💬 Ask them</button><button class="btn small" data-action="ci-skip" data-id="${id}">Skip</button>`
        : ci.status === 'ok' ? `<button class="btn small primary" data-action="ci-skip" data-id="${id}">✓ Keep as is</button><button class="btn small" data-action="ci-edit" data-id="${id}">Change…</button>`
        : `<button class="btn small primary" data-action="ci-approve" data-id="${id}">Approve ${ci.change > 0 ? '+' : '−'}${Math.abs(ci.change)} kcal</button><button class="btn small" data-action="ci-edit" data-id="${id}">Edit</button><button class="btn small" data-action="ci-skip" data-id="${id}">Keep as is</button>`;
      return `<div class="ccal-client"><div class="ccal-item"><span class="ccal-tag ${cls[ci.status]}">${tag[ci.status]}</span><div class="grow"><strong>${esc(name)}</strong>
        <div class="meta">${esc(ci.text)}</div>
        ${ci.lowLog && ci.status !== 'ok' && ci.status !== 'nodata' ? `<div class="meta"><strong>Food logged ${ci.foodDays}/7 days.</strong> A stall can be tracking, not the plan. Worth a chat first.</div>` : ''}
        ${ci.kcalAdjust ? `<div class="meta">Current adjustment: ${ci.kcalAdjust > 0 ? '+' : ''}${ci.kcalAdjust} kcal/day</div>` : ''}</div></div>
        <div class="row" style="gap:6px;margin-top:4px">${btns}</div></div>`;
    }).join('') : '<div class="meta">Nobody is due. Each client gets one every 2 weeks.</div>';
    if (later.length) h += `<p class="hint" style="margin:8px 0 0">Next: ${later.sort((a, b) => a.ci.nextOn.localeCompare(b.ci.nextOn)).map(({ x, ci }) => `${esc((x.c.full_name || x.c.email).split(/[ @]/)[0])} ${esc(C.prettyDate(ci.nextOn, { month: 'short', day: 'numeric' }))}`).join(' · ')}</p>`;
    return h + '</div>';
  }
  async function applyAdjust(id, newAdjust) {
    const x = st.clients.find((y) => y.c.client_id === id); if (!x) return false;
    const t = Object.assign({}, x.targets || {}, { kcalAdjust: Math.round(newAdjust), v: Date.now(), checkin: C.todayISO() });
    const { error } = await sb().from('profiles').update({ targets: t }).eq('id', id);
    if (error) { C.toast('Couldn\'t save: ' + error.message); return false; }
    x.targets = t; markReviewed(id);
    C.toast(`Saved. ${x.c.full_name || 'Their'} targets update on their next sync`); C.render(); return true;
  }
  function markReviewed(id) { const s2 = C.getState().settings; s2.nutReviewed = Object.assign({}, s2.nutReviewed, { [id]: C.todayISO() }); C.save(); }

  function card() {
    const data = cd(); if (!data || !data.clients || !data.clients.length) return '';
    if (!st.clients && !st.loading && !st.err) load();
    const d = C.ui.coachDate, t = C.todayISO();
    let h = `${checkinsCard()}<div class="coach-cal">${C.calendar('coach', d, { mark })}<div class="card"><div class="card-head"><h2>${d === t ? 'Today' : esc(C.prettyDate(d, { weekday: 'long', month: 'short', day: 'numeric' }))}</h2><button class="btn small" data-action="ccal-reload">↻</button></div>`;
    if (st.err) return h + `<p class="bad">${esc(st.err)}</p></div></div>`;
    if (!st.clients) return h + '<div class="empty">Loading your clients\' training…</div></div></div>';
    h += st.clients.map((x) => {
      const name = x.c.full_name || x.c.email, r = dayFor(x, d);
      let rows = '';
      rows += r.done.map((w) => `<div class="ccal-item done"><span class="ccal-tag good">✓ Done</span><div class="grow"><strong>${esc(w.type)}</strong>
        <div class="meta">${w.sets ? Training.summary(w) : esc(w.exercises || '')}${w.minutes ? ' · ' + w.minutes + ' min' : ''}${w.notes ? ' · “' + esc(w.notes) + '”' : ''}</div></div></div>`).join('');
      rows += r.sentDone.map((a) => `<div class="ccal-item"><span class="ccal-tag">${a.status === 'skipped' ? 'Skipped' : '✓ Done'}</span><div class="grow"><strong>${esc(a.title)}</strong><div class="meta">Sent by you</div></div></div>`).join('');
      rows += r.sent.map((a) => `<div class="ccal-item"><span class="ccal-tag accent">Sent</span><div class="grow"><strong>${esc(a.title)}</strong>
        <div class="meta">${a.replaces ? 'Replaces ' + esc(a.replaces.label || 'a plan day') : 'Extra workout'}${a.for_date ? '' : ' · any day'}</div></div>
        <div class="ccal-btns"><button class="btn small" data-action="ccal-adjust-sent" data-id="${a.id}">Adjust</button><button class="del" data-action="ccal-remove" data-id="${a.id}" aria-label="Remove">×</button></div></div>`).join('');
      rows += r.planned.map((p, i) => `<div class="ccal-item"><span class="ccal-tag">Plan</span><div class="grow"><strong>${esc(p.day.label)}: ${esc(p.day.name)}</strong>
        <div class="meta">${esc(p.plan.name)} · Week ${p.week}${p.guide && p.guide.deload ? ' · deload' : ''}</div></div>
        <div class="ccal-btns"><button class="btn small primary" data-action="ccal-adjust" data-client="${x.c.client_id}" data-i="${i}">Adjust</button></div></div>`).join('');
      const ci = d === t ? checkinFor(x) : null;
      if (ci && ci.due) rows += `<div class="ccal-item"><span class="ccal-tag accent">Check-in</span><div class="grow"><strong>Nutrition check-in due</strong><div class="meta">${esc(ci.text)}</div></div></div>`;
      if (!rows) rows = `<div class="meta" style="padding:4px 0">${d < t ? 'Nothing logged' : x.state.programs.length ? 'Rest day' : 'No plan'}</div>`;
      return `<div class="ccal-client"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><strong>${esc(name)}</strong>
        <button class="link-btn" data-action="coach-send-workout" data-id="${x.c.client_id}" data-name="${esc(name)}" style="font-size:13px">+ Send workout</button></div>${rows}</div>`;
    }).join('');
    return h + '</div></div>';
  }

  // ---------- adjust a day ----------
  const cloneDay = (day, plan) => {
    const dd = JSON.parse(JSON.stringify(day));
    if (dd.warmup && plan && plan.warmups && plan.warmups[dd.warmup]) {
      const wu = plan.warmups[dd.warmup];
      dd.instructions = [`Warm-up: ${wu.items.map((i) => `${i.dose ? i.dose + ' ' : ''}${i.name}`).join(', ')}`, dd.instructions].filter(Boolean).join('\n');
    }
    delete dd.warmup;
    (dd.blocks || []).forEach((b) => { b.exercises = b.exercises || []; });
    dd.blocks = dd.blocks || [];
    return dd;
  };
  function adjustForm(o) {
    // o: { clientId, name, date, day, title, note, replaces, existingId }
    st.edit = o;
    const day = o.day;
    const exRow = (e, bi, ei) => `<div class="adj-ex"><input type="text" name="n_${bi}_${ei}" value="${esc(e.name)}" placeholder="Exercise (clear to remove)">
      <div class="adj-nums"><input type="number" name="s_${bi}_${ei}" value="${esc(e.sets || '')}" min="1" max="20" placeholder="sets" aria-label="Sets"><span class="sub">×</span><input type="text" name="r_${bi}_${ei}" value="${esc(e.reps || '')}" placeholder="reps" aria-label="Reps"></div>
      <input type="text" name="o_${bi}_${ei}" value="${esc(e.notes || '')}" placeholder="Notes / load (optional)" class="adj-notes"></div>`;
    C.openModal(`<h2>Adjust ${esc(o.name)}'s workout</h2>
      <p class="sub" style="margin-top:0">${esc(C.prettyDate(o.date, { weekday: 'long', month: 'short', day: 'numeric' }))}${o.replaces ? ' · replaces ' + esc(o.replaces.label) : ''}. They'll see your version that day, and finishing it counts as that plan day.</p>
      ${C.field('Title', `<input type="text" name="title" value="${esc(o.title || day.name || 'Workout')}" maxlength="120" required>`)}
      ${day.blocks.map((b, bi) => `<div class="adj-block">${b.name ? `<div class="res-head">${esc(b.name)}</div>` : ''}${b.exercises.map((e, ei) => exRow(e, bi, ei)).join('')}</div>`).join('')}
      <div class="adj-block"><div class="res-head">Add exercises</div>${[0, 1, 2].map((k) => exRow({ name: '', sets: '', reps: '' }, 'x', k)).join('')}</div>
      ${C.field('Instructions', `<textarea name="instr" rows="2" placeholder="Warm-up, rest, tempo…">${esc(day.instructions || '')}</textarea>`)}
      ${C.field('Note to them (optional)', `<textarea name="note" rows="2" placeholder="Swapped squats for leg press while your knee settles.">${esc(o.note || '')}</textarea>`)}`, async (fd) => {
      const nd = JSON.parse(JSON.stringify(day));
      const read = (bi, ei, base) => {
        const nm = String(fd.get(`n_${bi}_${ei}`) || '').trim(); if (!nm) return null;
        const e = Object.assign({}, base || {});
        if (!base || base.name !== nm) { e.name = nm; e.id = base && base.id && slug(base.name) === slug(nm) ? base.id : slug(nm) + '-' + Math.random().toString(36).slice(2, 6); delete e.alts; delete e.pct; delete e.lift; }
        e.sets = Math.max(1, Math.min(20, +fd.get(`s_${bi}_${ei}`) || 1));
        e.reps = String(fd.get(`r_${bi}_${ei}`) || '').trim() || 'as written';
        const notes = String(fd.get(`o_${bi}_${ei}`) || '').trim(); if (notes) e.notes = notes; else delete e.notes;
        return e;
      };
      nd.blocks = day.blocks.map((b, bi) => Object.assign({}, b, { exercises: b.exercises.map((e, ei) => read(bi, ei, e)).filter(Boolean) })).filter((b) => b.exercises.length);
      const added = [0, 1, 2].map((k) => read('x', k, null)).filter(Boolean);
      if (added.length) nd.blocks.push({ type: 'straight', name: 'Added by coach', exercises: added });
      nd.instructions = String(fd.get('instr') || '').trim();
      const title = String(fd.get('title') || '').trim() || 'Workout';
      nd.name = title;
      if (!nd.blocks.length && !nd.instructions) { C.toast('Add at least one exercise'); return false; }
      const row = { title, day: nd, note: String(fd.get('note') || '').trim() || null, for_date: o.date, replaces: o.replaces || null };
      const q = o.existingId ? sb().from('assigned_workouts').update(row).eq('id', o.existingId) : sb().from('assigned_workouts').insert(Object.assign({ client_id: o.clientId }, row));
      const { error } = await q;
      if (error) { C.toast(/assigned_workouts|schema cache|does not exist/i.test(error.message) ? 'Run the latest SQL in Supabase first.' : 'Couldn\'t save: ' + error.message); return false; }
      C.toast(o.existingId ? 'Updated' : `Saved. ${o.name} will see your version`);
      load();
    }, { saveLabel: o.existingId ? 'Save changes' : 'Save for ' + (o.name || 'client') });
  }

  const nameOf = (id) => { const x = st.clients && st.clients.find((y) => y.c.client_id === id); return x ? x.c.full_name || x.c.email : 'client'; };
  const actions = {
    'ci-approve': (el) => { const x = st.clients.find((y) => y.c.client_id === el.dataset.id); const ci = x && checkinFor(x); if (ci) applyAdjust(el.dataset.id, ci.newAdjust); },
    'ci-skip': (el) => { markReviewed(el.dataset.id); C.toast('Marked reviewed. Next check-in in 2 weeks'); C.render(); },
    'ci-edit': (el) => {
      const x = st.clients.find((y) => y.c.client_id === el.dataset.id); const ci = x && checkinFor(x); if (!ci) return;
      C.openModal(`<h2>Adjust ${esc(x.c.full_name || x.c.email)}'s calories</h2><p class="sub" style="margin-top:0">${esc(ci.text || '')}</p>
        ${C.field('Change per day (kcal)', `<input type="number" name="chg" step="25" value="${ci.change || 0}">`, `Current adjustment ${ci.kcalAdjust > 0 ? '+' : ''}${ci.kcalAdjust} kcal. Negative takes calories off (mostly carbs); positive adds.`)}`, (fd) => {
        const chg = Number(fd.get('chg')) || 0;
        if (!chg) { markReviewed(x.c.client_id); C.toast('No change. Marked reviewed'); C.render(); return; }
        applyAdjust(x.c.client_id, ci.kcalAdjust + chg);
      }, { saveLabel: 'Save' });
    },
    'ccal-reload': () => { st.clients = null; st.err = null; load(); C.render(); },
    'ccal-adjust': (el) => {
      const x = st.clients.find((y) => y.c.client_id === el.dataset.client); if (!x) return;
      const d = C.ui.coachDate, p = dayFor(x, d).planned[+el.dataset.i]; if (!p) return;
      adjustForm({ clientId: x.c.client_id, name: nameOf(x.c.client_id), date: d, day: cloneDay(p.day, p.plan), title: p.day.name,
        replaces: { planId: p.plan.id, dayId: p.day.id, week: p.week, label: `${p.plan.name} · ${p.day.label}: ${p.day.name}` } });
    },
    'ccal-adjust-sent': (el) => {
      const a = st.sent.find((y) => y.id === el.dataset.id); if (!a) return;
      adjustForm({ clientId: a.client_id, name: nameOf(a.client_id), date: a.for_date || C.ui.coachDate, day: cloneDay(a.day || { blocks: [] }), title: a.title, note: a.note, replaces: a.replaces, existingId: a.id });
    },
    'ccal-remove': async (el) => {
      const a = st.sent.find((y) => y.id === el.dataset.id); if (!a) return;
      if (!confirm(`Remove "${a.title}"? ${a.replaces ? 'They\'ll go back to their normal plan day.' : ''}`)) return;
      const { error } = await sb().from('assigned_workouts').delete().eq('id', a.id);
      if (error) { C.toast('Couldn\'t remove: ' + error.message); return; }
      st.sent = st.sent.filter((y) => y.id !== a.id); C.render();
    },
  };

  window.CoachCal = {
    init(ctx) { C = ctx; Object.assign(ctx.actions, actions); },
    card,
    reset() { st.clients = null; st.err = null; st.sent = []; },
    reload: load,
  };
})();
