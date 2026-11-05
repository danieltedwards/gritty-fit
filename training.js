/* Training programs: plan library, program guide, set-by-set workout logger, rest timer, progression hints.
   Plans are JSON files in /plans (see plans/README.md). app.js calls Training.init(ctx) before first render. */
(function () {
  'use strict';
  let C; // context from app.js
  const planCache = new Map();
  let planIndex = null, indexPromise = null;
  const loading = new Map();

  // ---------- plan loading ----------
  const staticIndex = () => fetch('plans/index.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((d) => d.plans || []);
  const metaOf = (d) => ({ id: d.id, name: d.name, phase: d.phase, subtitle: d.subtitle, coach: d.coach, weeks: d.weeks, daysPerWeek: d.daysPerWeek, tags: d.tags, summary: d.summary, cloud: true });
  // Signed in with a coach (or as the coach): plans come from the coach's online library.
  // Otherwise the plans bundled with the app.
  function loadIndex() {
    if (planIndex) return Promise.resolve(planIndex);
    if (!indexPromise) {
      const cloud = window.Cloud && Cloud.usesCloudPlans();
      indexPromise = (cloud ? Cloud.fetchPlans().then(async (rows) => {
        const isCoach = Cloud.profile && Cloud.profile.role === 'coach';
        const vis = rows.filter((r) => isCoach || r.published);
        vis.forEach((r) => planCache.set(r.id, r.data));
        // A client whose coach made them a custom version of their current plan switches to it
        // automatically (same start date; history follows the exercise ids).
        const me = Cloud.user && Cloud.user.id;
        const st = S();
        if (!isCoach && me && progs().length) {
          let changed = false;
          setProgs(progs().map((pr) => { const mine = vis.find((r) => r.data.forClient === me && r.data.basedOn === pr.planId); if (mine) { changed = true; return { ...pr, planId: mine.id }; } return pr; }));
          if (changed) { C.save(); C.toast('Your coach customized your plan ✨'); }
        }
        const list = vis.filter((r) => !(isCoach && r.data.forClient)); // coach's own picker: templates only
        if (!list.length && isCoach) return staticIndex(); // coach hasn't added plans yet
        return list.map((r) => Object.assign(metaOf(r.data), { forMe: !!(me && r.data.forClient === me) }))
          .sort((a, b) => (b.forMe ? 1 : 0) - (a.forMe ? 1 : 0));
      }) : staticIndex())
        .then((list) => (planIndex = list))
        .catch((e) => { indexPromise = null; throw e; });
    }
    return indexPromise;
  }
  function loadPlan(id) {
    if (planCache.has(id)) return Promise.resolve(planCache.get(id));
    if (loading.has(id)) return loading.get(id);
    const p = loadIndex().then((idx) => {
      if (planCache.has(id)) return planCache.get(id);
      const meta = idx.find((x) => x.id === id);
      if (meta && meta.file) return fetch('plans/' + meta.file).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      // not in this list (e.g. coach hid it): fall back to the bundled copy if there is one
      return staticIndex().then((si) => { const m = si.find((x) => x.id === id); if (!m) throw new Error('Plan not found'); return fetch('plans/' + m.file).then((r) => r.json()); });
    }).then((plan) => { planCache.set(id, plan); loading.delete(id); return plan; })
      .catch((e) => { loading.delete(id); throw e; });
    loading.set(id, p);
    return p;
  }
  // Views are synchronous: if a plan isn't loaded yet, kick off the load and re-render when it arrives.
  const failedPlans = new Set();
  function planNow(id) {
    if (!id) return null;
    if (planCache.has(id)) return planCache.get(id);
    if (String(id).startsWith('oneoff:')) {
      // a workout the coach sent: its contents travel with the session, so it survives a reload
      const as = S().activeSession;
      if (as && as.oneOff && as.planId === id) { planCache.set(id, as.oneOff.plan); return as.oneOff.plan; }
      return null;
    }
    if (failedPlans.has(id)) return null;
    loadPlan(id).then(() => C.render()).catch(() => { failedPlans.add(id); C.render(); });
    return undefined;
  }
  const stopBtn = (id) => `<button class="btn small" data-action="plan-leave" data-id="${esc(id)}">Stop</button>`;

  // ---------- active programs (a client can run up to 3 plans at once; programs[0] is the primary) ----------
  const MAX_PLANS = 3;
  function progs() {
    const st = S();
    if (!Array.isArray(st.programs)) st.programs = st.program ? [st.program] : [];
    if (st.program && !st.programs.some((p) => p.planId === st.program.planId)) st.programs.unshift(st.program);
    if (!st.program && st.programs.length) st.program = st.programs[0];
    return st.programs;
  }
  function setProgs(arr) { const st = S(); st.programs = arr.slice(0, MAX_PLANS); st.program = st.programs[0] || null; }
  const progFor = (planId) => progs().find((p) => p.planId === planId) || null;

  // ---------- helpers ----------
  let override = null; // coach calendar: compute a client's plan days against their state
  const S = () => override || C.getState();
  const esc = (s) => C.esc(s);
  const allExercises = (day) => day.blocks.flatMap((b) => b.exercises);
  function programWeek(prog, plan, date = C.todayISO()) {
    const days = C.daysBetween(prog.startDate, date);
    const week = Math.floor(days / 7) + 1;
    const cycle = plan.cycleWeeks || plan.weeks || 1;
    const cw = ((Math.max(week, 1) - 1) % cycle) + 1;
    const guide = (plan.weekGuide || []).find((g) => g.weeks.includes(cw)) || null;
    const weekStart = C.addDays(prog.startDate, (Math.max(week, 1) - 1) * 7);
    const block = Math.floor((Math.max(week, 1) - 1) / cycle) + 1;
    return { week, cycleWeek: cw, block, blocks: Math.ceil((plan.weeks || cycle) / cycle), guide, weekStart, weekEnd: C.addDays(weekStart, 6), before: days < 0, done: week > (plan.weeks || 999) };
  }
  // Plans with a week-by-week schedule carry their own days for each week; others use plan.days every week.
  function daysAt(plan, week) {
    if (!plan || !plan.schedule || !plan.schedule.length) return plan ? plan.days : [];
    const w = Math.min(Math.max(week || 1, 1), plan.weeks || 999);
    const e = plan.schedule.find((x) => (x.weeks || []).includes(w))
      || [...plan.schedule].reverse().find((x) => Math.min(...(x.weeks || [1])) <= w) || plan.schedule[0];
    return e.days;
  }
  const atWeek = (plan, week) => (plan && plan.schedule ? Object.assign({}, plan, { days: daysAt(plan, week) }) : plan);
  // ---- percentage-of-max loading (powerlifting, Olympic, tactical plans) ----
  const MAX_KEYS = { squat: 'Back squat', bench: 'Bench press', deadlift: 'Deadlift', press: 'Overhead press', fsquat: 'Front squat', snatch: 'Snatch', clean: 'Clean', jerk: 'Jerk', cj: 'Clean & jerk', pullup: 'Weighted pull-up', g2o: 'Ground to overhead', dbbench: 'Dumbbell bench (per hand)', pclean: 'Power clean', psnatch: 'Power snatch' };
  const pctRange = (p) => (Array.isArray(p) ? p : p != null && p !== '' ? [p, p] : null);
  const pctText = (p) => { const r = pctRange(p); if (!r) return ''; const f = (x) => Math.round(x * 1000) / 10; return r[0] === r[1] ? `${f(r[0])}%` : `${f(r[0])}–${f(r[1])}%`; };
  const roundLoad = (x) => { const step = unit() === 'kg' ? 2.5 : 5; return Math.round(x / step) * step; };
  function targetLoad(ex, plan) {
    if (!ex.pct || !ex.of) return null;
    const m = Number((S().settings.maxes || {})[ex.of]);
    if (!m) return { missing: true };
    const tm = (plan && plan.trainingMax) || 1;
    const r = pctRange(ex.pct).map((x) => roundLoad(m * tm * x));
    return { lo: r[0], hi: r[1], text: r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}` };
  }
  // set schemes: [{sets, reps, pct?}] → one entry per set
  const expandScheme = (ex) => (ex.scheme || []).flatMap((g) => Array.from({ length: g.sets || 1 }, () => g));
  const schemeText = (ex) => ex.scheme.map((g) => `${g.sets}×${g.reps}${g.pct ? ' @ ' + pctText(g.pct) : ''}`).join(', ');
  function loadFor(pct, of, plan) {
    const m = Number((S().settings.maxes || {})[of]);
    if (!pct || !of || !m) return null;
    const r = pctRange(pct).map((x) => roundLoad(m * ((plan && plan.trainingMax) || 1) * x));
    return r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`;
  }
  function maxesNeeded(plan) {
    const keys = new Set();
    (plan.schedule ? plan.schedule.flatMap((e) => e.days || []) : plan.days || []).forEach((d) => (d.blocks || []).forEach((b) => (b.exercises || []).forEach((x) => { if (x.of && (x.pct || (x.scheme || []).some((g) => g.pct))) keys.add(x.of); })));
    return [...keys];
  }
  const instructionsHTML = (t) => (t ? `<div class="day-instr">${String(t).split(/\n+/).map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : '');
  // "8–12" → {min 8, max 12}; pyramids / drop sets ("20/15/10") and mixed schemes ("AMRAP, then 3×1") have no single range
  const repRange = (reps) => { const r = String(reps); if (/[\/,]/.test(r)) return null; const m = r.match(/\d+/g); return m ? { min: +m[0], max: +(m[1] || m[0]) } : null; };
  const restSeconds = (rest) => {
    if (!rest) return 0;
    const s = String(rest).toLowerCase(), n = parseFloat(s);
    if (!n) return 0;
    return /min/.test(s) ? Math.round(n * 60) : Math.round(n);
  };
  const exKey = (name) => String(name).toLowerCase().replace(/\s+/g, ' ').trim();
  const unit = () => S().settings.units;

  // Last logged sets for an exercise (by plan exercise id, falling back to name)
  function lastSets(ex, beforeDate, skipDeload) {
    const list = S().workouts.filter((w) => w.sets && w.date <= (beforeDate || '9999') && !(skipDeload && w.deload) && w.sets.some((s) => s.exId === ex.id || exKey(s.name) === exKey(ex.name)))
      .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
    if (!list.length) return null;
    const w = list[0];
    return { date: w.date, sets: w.sets.filter((s) => s.exId === ex.id || exKey(s.name) === exKey(ex.name)).sort((a, b) => a.set - b.set) };
  }

  // Load jump when progressing: lower body +10 lb / +5 kg, upper body +5 lb / +2.5 kg
  const bumpFor = (ex) => {
    const lower = (ex.region || '') === 'lower' || (!ex.region && /squat|deadlift|rdl|thrust|leg press|lunge|split|step-up|hip|glute|hamstring|calf/i.test(ex.name));
    return unit() === 'kg' ? (lower ? 5 : 2.5) : (lower ? 10 : 5);
  };
  // Double-progression coaching hint
  function hint(ex, last, wk) {
    const u = unit();
    if (wk && wk.newBlock && last && last.sets.length && !ex.bodyweight && ex.role !== 'core') {
      const top = Math.max(...last.sets.map((s) => s.weight || 0));
      if (top) return wk.kb ? `New block 💪 Try the next bell size up from ${top} ${u}.` : `New block 💪 Start heavier than block 1: try ${top + bumpFor(ex)} ${u} (your best before the deload was ${top}).`;
    }
    if (wk && wk.guide && wk.guide.deload) {
      const top = last && Math.max(...last.sets.map((s) => s.weight || 0));
      return top ? `Deload week: about ${Math.round(top * 0.85 / 2.5) * 2.5} ${u} (−15%), finish every set with 3+ reps in reserve.` : 'Deload week: lighter loads, 3+ reps in reserve.';
    }
    if (ex.bodyweight || ex.role === 'core') return last ? `Last time: ${last.sets.map((s) => s.reps ?? '–').join(', ')} reps. Beat it with clean form.` : '';
    if (!last || !last.sets.length) {
      if (wk && wk.week <= 2) return 'First time: pick a weight you could lift a few more reps with. Perfect execution beats load.';
      return 'First time: find a weight that lands in the rep range with good form.';
    }
    const rr = repRange(ex.reps);
    const weights = last.sets.map((s) => s.weight || 0);
    const top = Math.max(...weights);
    // the rep target moved (week-by-week plans): steer the load the right way instead of a small bump
    const avgReps = last.sets.reduce((a, s) => a + (s.reps || 0), 0) / last.sets.length;
    if (rr && top && avgReps >= rr.max + 3) return `Fewer reps today (${ex.reps} vs ${Math.round(avgReps)} last time): go heavier than ${top} ${u}.`;
    if (rr && top && avgReps > 0 && avgReps <= rr.min - 3) return `More reps today (${ex.reps} vs ${Math.round(avgReps)} last time): go lighter than ${top} ${u}.`;
    const sameWeight = weights.every((x) => x === top);
    if (rr && sameWeight && last.sets.length >= ex.sets && last.sets.every((s) => (s.reps || 0) >= rr.max)) {
      if (wk && wk.kb) return `✅ All sets hit ${rr.max} last time. Move up a bell size, or keep the ${top} ${u} bells and lower slower (4 sec) or cut rest by 30 sec.`;
      const bump = bumpFor(ex);
      return `✅ All sets hit ${rr.max} last time. Add weight: try ${top + bump} ${u} and restart at ${rr.min} reps.`;
    }
    if (rr) return wk && wk.kb ? `Stay with the ${top} ${u} bells. Goal: more reps until every set reaches ${rr.max}.` : `Stay at ${top} ${u}. Goal: more reps until every set reaches ${rr.max}.`;
    if (top) return `Heaviest set last time: ${top} ${u}. Beat at least one set from last time (more weight or more reps).`;
    return '';
  }

  // sessions of this plan this program week (a customized plan also counts sessions logged on its template)
  function sessionsThisProgramWeek(prog, wk) {
    const plan = planCache.get(prog.planId);
    const ids = new Set([prog.planId, plan && plan.basedOn].filter(Boolean));
    return S().workouts.filter((w) => ids.has(w.planId) && w.sets && w.date >= wk.weekStart && w.date <= wk.weekEnd);
  }
  function nextDay(plan, prog, wk) {
    const done = new Set(sessionsThisProgramWeek(prog, wk).map((w) => w.dayId));
    const core = plan.days.filter((d) => !d.optional);
    return core.find((d) => !done.has(d.id)) || plan.days.find((d) => d.optional && !done.has(d.id)) || null;
  }
  // ---------- calendar: which plan sessions fall on a date ----------
  // Plans number their days (Day 1, Day 2…) rather than fixing weekdays, so the calendar spreads a week's
  // sessions over a sensible default pattern from the plan's week start. In the current week the sessions
  // still to do are laid out from today onward, so the calendar always shows what's next.
  const SLOTS = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  function plannedOn(iso) {
    const t = C.todayISO();
    if (iso < t) return [];
    const out = [];
    progs().forEach((prog) => {
      const plan = planNow(prog.planId);
      if (!plan) return;
      const wk = programWeek(prog, plan, iso);
      if (wk.before || wk.done) return;
      const wplan = atWeek(plan, wk.week);
      const core = wplan.days.filter((d) => !d.optional);
      if (!core.length) return;
      const slots = SLOTS[Math.min(core.length, 7)];
      const off = C.daysBetween(wk.weekStart, iso);
      let day = null;
      if (t >= wk.weekStart && t <= wk.weekEnd) {
        const doneW = sessionsThisProgramWeek(prog, wk), done = new Set(doneW.map((w) => w.dayId));
        const left = core.filter((d) => !done.has(d.id));
        const tOff = C.daysBetween(wk.weekStart, t) + (doneW.some((w) => w.date === t) ? 1 : 0);
        let free = slots.filter((o) => o >= tOff);
        if (free.length < left.length) free = Array.from({ length: 7 - tOff }, (_, i) => tOff + i);
        const i = free.indexOf(off);
        if (i >= 0 && i < left.length) day = left[i];
        else if (free.length && off === free[free.length - 1] && left.length > free.length) day = left[free.length - 1];
      } else {
        const i = slots.indexOf(off);
        if (i >= 0) day = core[i];
      }
      if (day) out.push({ plan, prog, day, week: wk.week, guide: wk.guide });
    });
    return out;
  }

  const CARDIO_RE = /stair|ruck|incline|hik|walk|run|cycl|bike|elliptical|row(ing|er)|swim|cardio|treadmill/i;
  const isCardio = (w) => w.cardio || (!w.sets && CARDIO_RE.test(w.type || ''));

  // ---------- Train tab: program card ----------
  function trainCard() {
    const st = S();
    const list = progs();
    const as = st.activeSession;
    let h = '';
    if (as) {
      h += `<div class="card" style="border-color:var(--accent)"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>Workout in progress</strong>
        <div class="sub">${esc(as.dayLabel)} · ${esc(as.dayName)} · started ${new Date(as.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div>
        <button class="btn primary" data-action="session-open">Resume</button></div></div>`;
    }
    if (!list.length) {
      return h + `<div class="card"><div class="card-head"><h2>Your program</h2></div><p class="sub" style="margin-top:0">Pick a training plan from your coach. Every session is laid out set by set, with your last numbers and when to add weight.</p>
        <button class="btn primary block" data-action="plans-open">Choose a plan</button></div>`;
    }
    return h + list.map((prog, i) => programCard(prog, i, list.length)).join('');
  }
  function programCard(prog, idx, n) {
    const st = S(), as = st.activeSession;
    let h = '';
    const plan = planNow(prog.planId);
    if (plan === undefined) return h + `<div class="card"><div class="card-head"><h2>${n > 1 ? `Program ${idx + 1} of ${n}` : 'Your program'}</h2>${stopBtn(prog.planId)}</div><div class="empty">Loading your plan…</div></div>`;
    if (!plan) return h + `<div class="card"><div class="card-head"><h2>${n > 1 ? `Program ${idx + 1} of ${n}` : 'Your program'}</h2></div><p class="sub" style="margin-top:0">This plan isn't available anymore (it may have been removed or hidden from the plan library). Stop it to free up the slot; your logged workouts are kept.</p>
      <div class="row"><button class="btn danger" data-action="plan-leave" data-id="${esc(prog.planId)}">Stop this plan</button>${idx === 0 ? '<button class="btn" data-action="plans-open">Plans</button>' : ''}</div></div>`;
    const wk = programWeek(prog, plan);
    const pw = atWeek(plan, wk.week);
    const doneIds = new Set(sessionsThisProgramWeek(prog, wk).map((w) => w.dayId));
    const nd = nextDay(pw, prog, wk);
    const cardioDone = st.workouts.filter((w) => isCardio(w) && w.date >= wk.weekStart && w.date <= wk.weekEnd).length;
    const P = `data-plan="${esc(plan.id)}"`;
    h += `<div class="card"><div class="card-head"><h2>${n > 1 ? `Program ${idx + 1} of ${n}` : 'Your program'}</h2><span class="row" style="gap:6px;flex-wrap:nowrap">${idx === 0 ? '<button class="btn small" data-action="plans-open">Plans</button>' : ''}<button class="btn small" data-action="plan-guide" data-id="${esc(plan.id)}">Guide</button>${stopBtn(plan.id)}</span></div>
      <div style="font-weight:800;font-size:18px;line-height:1.2">${esc(plan.name)}</div><div class="sub">${esc(plan.phase || '')}</div>
      ${wk.before ? `<p class="sub">Starts ${C.prettyDate(prog.startDate)}.</p>` : wk.done ? `<p><strong>Program complete 🎉</strong> <span class="sub">Talk to your coach about the next phase.</span></p>` : `
      <div class="week-pill">Week ${wk.week} of ${plan.weeks}${wk.blocks > 1 ? ` · Block ${wk.block}` : ''}${wk.guide ? ` · ${esc(wk.guide.label)}` : ''}</div>
      ${wk.guide ? `<p class="sub" style="margin:6px 0 0"><strong>${esc(wk.guide.effort)}</strong>. ${esc(wk.guide.note || '')}</p>` : ''}`}
      <div class="days">${pw.days.map((d) => `<button class="day ${doneIds.has(d.id) ? 'done' : ''} ${nd && nd.id === d.id ? 'next' : ''}" data-action="session-start" data-day="${d.id}" ${P}>
        <span class="day-label">${esc(d.label)}${d.optional ? ' · optional' : ''}</span><span class="day-name">${esc(d.name)}</span><span class="day-state">${doneIds.has(d.id) ? '✓ Done' : nd && nd.id === d.id ? 'Up next' : ''}</span></button>`).join('')}</div>
      ${maxesRow(plan)}
      ${!as && nd && !wk.done ? `<button class="btn primary block" data-action="session-start" data-day="${nd.id}" ${P} style="margin-top:10px">Start ${esc(nd.label)}: ${esc(nd.name)}</button>` : ''}
      ${!nd && !wk.done && !wk.before ? '<p class="sub">All sessions done this week. Recover well 💪</p>' : ''}
      ${plan.cardio ? `<div class="row" style="justify-content:space-between;margin-top:12px;flex-wrap:nowrap"><div><strong>Cardio</strong> <span class="sub">${cardioDone} / ${plan.cardio.perWeek.join('–')} this week · ${plan.cardio.minutes.join('–')} min</span></div>
        <button class="btn small" data-action="log-cardio" ${P} style="flex:none">+ Cardio</button></div>
        <div class="progress"><i style="width:${Math.min(100, (cardioDone / plan.cardio.perWeek[0]) * 100)}%"></i></div>` : ''}
      ${(plan.extras || []).map((x) => {
        const n = st.workouts.filter((w) => w.extraId === x.id && w.date >= wk.weekStart && w.date <= wk.weekEnd).length;
        return `<div class="row" style="justify-content:space-between;margin-top:12px;flex-wrap:nowrap"><div><strong>${esc(x.name)}</strong> <span class="sub">${n} / ${x.perWeek || 1} this week${x.minutes ? ' · ' + x.minutes + ' min' : ''}</span>${x.notes ? `<div class="sub" style="font-size:12px">${esc(x.notes)}</div>` : ''}</div>
          <button class="btn small" data-action="log-extra" data-id="${esc(x.id)}" ${P} style="flex:none">+ Log</button></div>
          <div class="progress"><i style="width:${Math.min(100, (n / (x.perWeek || 1)) * 100)}%"></i></div>`;
      }).join('')}
    </div>`;
    return h;
  }

  function maxesRow(plan) {
    const keys = maxesNeeded(plan);
    if (!keys.length) return '';
    const mx = S().settings.maxes || {}, u = unit();
    const missing = keys.filter((k) => !Number(mx[k]));
    return `<div class="row maxes-row" style="justify-content:space-between;margin-top:12px;flex-wrap:nowrap"><div class="sub" style="min-width:0">
        ${missing.length ? `<strong class="bad">Enter your maxes</strong> to see target weights` : `<strong>Your maxes</strong> ${keys.map((k) => `${esc(MAX_KEYS[k] || k)} ${mx[k]}`).join(' · ')} ${u}`}
        ${plan.trainingMax ? `<div style="font-size:12px">Weights use a training max of ${Math.round(plan.trainingMax * 100)}%.</div>` : ''}</div>
      <button class="btn small ${missing.length ? 'primary' : ''}" data-action="maxes-edit" data-id="${esc(plan.id)}" style="flex:none">${missing.length ? 'Add' : 'Edit'}</button></div>`;
  }

  // Today screen card
  function todayCard() {
    const st = S();
    if (st.activeSession) return `<div class="card" style="border-color:var(--accent)"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>🏋️ Workout in progress</strong><div class="sub">${esc(st.activeSession.dayName)}</div></div><button class="btn primary" data-action="session-open">Resume</button></div></div>`;
    const rows = progs().map((prog) => {
      const plan = planNow(prog.planId);
      if (!plan) return '';
      const wk = programWeek(prog, plan);
      if (wk.before || wk.done) return '';
      const nd = nextDay(atWeek(plan, wk.week), prog, wk);
      const doneToday = st.workouts.some((w) => w.planId === prog.planId && w.date === C.todayISO() && w.sets);
      const adj = nd && window.Assign && Assign.pendingOn(C.todayISO()).find((a) => a.replaces && a.replaces.planId === prog.planId && a.replaces.dayId === nd.id);
      if (adj) return `<div class="row today-plan" style="flex-wrap:nowrap"><div style="flex:1;min-width:0"><div class="sub">${esc(plan.name)} · Week ${wk.week}</div>
          <strong>${esc(nd.label)}: ${esc(nd.name)}</strong><div class="sub">Your coach adjusted today's session: see <em>From your coach</em> above.</div></div></div>`;
      return `<div class="row today-plan" style="flex-wrap:nowrap"><div style="flex:1;min-width:0"><div class="sub">${esc(plan.name)} · Week ${wk.week}${doneToday ? ' · ✓ trained today' : ''}</div>
          ${nd ? `<strong>${esc(nd.label)}: ${esc(nd.name)}</strong>` : '<span class="sub">All sessions done this week 💪</span>'}</div>
        ${nd ? `<button class="btn ${doneToday ? '' : 'primary'}" data-action="session-start" data-day="${nd.id}" data-plan="${esc(plan.id)}" style="flex:none">Start</button>` : ''}</div>`;
    }).filter(Boolean);
    if (!rows.length) return '';
    return `<div class="card"><div class="card-head"><h2>Training</h2></div>${rows.join('')}</div>`;
  }

  // ---------- plan library ----------
  function viewPlans() {
    if (!planIndex) { loadIndex().then(() => C.render()).catch((e) => C.toast('Couldn\'t load plans: ' + e.message)); return '<div class="empty">Loading plans…</div>'; }
    const active = new Set(progs().map((p) => p.planId)), full = active.size >= MAX_PLANS;
    let h = `<p class="sub" style="margin-top:0">Run up to ${MAX_PLANS} plans at once (for example a lifting plan plus a conditioning or mobility plan). ${active.size ? `You're running ${active.size} of ${MAX_PLANS}.` : ''} Your history stays when you stop a plan.</p>`;
    if (active.size) h += `<div class="card"><div class="card-head"><h2>Your active plans</h2></div><ul class="list">${progs().map((pr) => { const pl = planCache.get(pr.planId); return `<li><div class="grow"><div class="title">${esc(pl ? pl.name : pr.planId)}</div><div class="meta">Started ${esc(C.prettyDate(pr.startDate))}${!pl && failedPlans.has(pr.planId) ? ' · no longer available' : ''}</div></div><button class="btn small danger" data-action="plan-leave" data-id="${esc(pr.planId)}">Stop</button></li>`; }).join('')}</ul></div>`;
    if (!planIndex.length) h += '<div class="card"><div class="empty">Your coach hasn\'t made any plans available to you yet.</div></div>';
    h += planIndex.map((p) => `<div class="card" ${p.forMe ? 'style="border-color:var(--accent)"' : ''}>${p.forMe ? '<div class="week-pill" style="margin:0 0 8px">✨ Made for you</div>' : ''}<div style="font-weight:800;font-size:18px">${esc(p.name)}</div><div class="sub">${esc(p.phase || '')}</div>
      <p class="sub" style="margin:8px 0">${esc(p.summary || '')}</p>
      <div style="margin-bottom:10px">${[`${p.weeks} weeks`, p.daysPerWeek ? p.daysPerWeek + ' days/week' : '', ...(p.tags || [])].filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      <div class="row"><button class="btn" data-action="plan-guide" data-id="${esc(p.id)}">View plan</button>
      ${active.has(p.id) ? `<button class="btn" disabled>✓ Active</button><button class="btn danger" data-action="plan-leave" data-id="${esc(p.id)}">Stop</button>`
        : full ? `<button class="btn" disabled>${MAX_PLANS} plans max</button>` : `<button class="btn primary" data-action="plan-choose" data-id="${esc(p.id)}">${active.size ? 'Add this plan' : 'Start this plan'}</button>`}</div></div>`).join('');
    return h;
  }

  function renderBody(blocks) {
    return blocks.map((b) => {
      if (b.p) return `<p>${esc(b.p)}</p>`;
      if (b.ul) return `<ul>${b.ul.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
      if (b.table) return `<table class="tbl"><thead><tr>${b.table.head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      return '';
    }).join('');
  }
  const prescription = (ex) => (ex.scheme && ex.scheme.length ? esc(schemeText(ex)) : `${ex.sets} × ${esc(ex.reps)}`) + (ex.each ? ' each side' : '');

  function viewGuide() {
    const id = C.ui.guidePlan;
    const plan = planNow(id);
    if (!plan) return '<div class="empty">Loading plan…</div>';
    const cur = progFor(plan.id);
    let h = `<div class="card"><div style="font-weight:800;font-size:20px;line-height:1.2">${esc(plan.name)}</div><div class="sub">${esc(plan.phase || '')}${plan.subtitle ? ' · ' + esc(plan.subtitle) : ''}</div>
      ${plan.coach ? `<div class="sub" style="margin-top:4px">Coach: ${esc(plan.coach)}</div>` : ''}<p>${esc(plan.summary || '')}</p>
      ${cur ? '' : progs().length >= MAX_PLANS ? `<p class="sub">You're running ${MAX_PLANS} plans. Stop one to add this.</p>` : `<button class="btn primary block" data-action="plan-choose" data-id="${esc(plan.id)}">${progs().length ? 'Add this plan' : 'Start this plan'}</button>`}</div>`;
    if (plan.weekGuide) h += `<div class="card"><div class="card-head"><h2>Week by week</h2></div><table class="tbl"><tbody>${plan.weekGuide.map((g) => `<tr><td style="white-space:nowrap"><strong>Wk ${g.weeks.length > 1 ? g.weeks[0] + '–' + g.weeks[g.weeks.length - 1] : g.weeks[0]}</strong></td><td><strong>${esc(g.label)}</strong><br><span class="sub">${esc(g.effort)}</span></td></tr>`).join('')}</tbody></table>
      ${plan.blocksNote ? `<p class="sub">${esc(plan.blocksNote)}</p>` : plan.cycleWeeks && plan.weeks > plan.cycleWeeks ? `<p class="sub">The ${plan.cycleWeeks}-week block repeats through week ${plan.weeks}.</p>` : ''}
      ${plan.progression && plan.progression.kettlebell ? '<p class="sub">Progress by reps, tempo and rest, then move up a bell size.</p>' : plan.progression && plan.progression.loadJumps ? `<p class="sub">Load jumps: lower body ${esc(plan.progression.loadJumps.lower)}, upper body ${esc(plan.progression.loadJumps.upper)}.</p>` : ''}</div>`;
    if ((plan.extras && plan.extras.length) || plan.cardio) {
      h += `<div class="card"><div class="card-head"><h2>Each week</h2></div><ul class="list">
        ${plan.cardio ? `<li><div class="grow"><div class="title">Cardio</div><div class="meta">${esc((plan.cardio.options || []).join(', '))}</div></div><span class="num">${plan.cardio.perWeek.join('–')}× · ${plan.cardio.minutes.join('–')} min</span></li>` : ''}
        ${(plan.extras || []).map((x) => `<li><div class="grow"><div class="title">${esc(x.name)}</div>${x.notes ? `<div class="meta">${esc(x.notes)}</div>` : ''}</div><span class="num">${x.perWeek || 1}×${x.minutes ? ' · ' + x.minutes + ' min' : ''}</span></li>`).join('')}</ul></div>`;
    }
    let gDays = plan.days;
    if (plan.schedule && plan.schedule.length) {
      const nW = plan.weeks || Math.max(...plan.schedule.flatMap((x) => x.weeks || [1]));
      const curW = cur ? programWeek(cur, plan).week : 1;
      const gw = Math.min(Math.max(C.ui.guideWeek || curW, 1), nW);
      gDays = daysAt(plan, gw);
      h += `<div class="card"><div class="card-head"><h2>Week ${gw}</h2><span class="sub">changes week to week</span></div>
        <div class="week-picker">${Array.from({ length: nW }, (_, i) => i + 1).map((w) => `<button class="chip ${w === gw ? 'strong' : ''}" data-action="guide-week" data-w="${w}">${w}</button>`).join('')}</div></div>`;
    }
    h += gDays.map((d) => `<div class="card"><div class="card-head"><h2>${esc(d.label)}${d.optional ? ' · optional' : ''}</h2></div><div style="font-weight:800;font-size:18px">${esc(d.name)}</div>
      ${d.focus ? `<p class="sub"><em>${esc(d.focus)}</em></p>` : ''}${instructionsHTML(d.instructions)}
      ${d.warmup && plan.warmups && plan.warmups[d.warmup] ? `<p class="sub">Starts with the ${esc(plan.warmups[d.warmup].name)}.</p>` : ''}
      ${d.blocks.map((b) => `${b.type === 'superset' || b.name ? `<div class="res-head">${esc(b.name || 'Superset')}</div>` : ''}${b.note ? `<p class="sub" style="margin:2px 0 4px">${esc(b.note)}</p>` : ''}<ul class="list">${b.exercises.map((ex, i) => `<li><div class="grow"><div class="title">${b.type === 'superset' ? String.fromCharCode(65 + i) + '. ' : ''}${esc(ex.name)}</div>
        <div class="meta">${[ex.pct ? `${pctText(ex.pct)} of ${(MAX_KEYS[ex.of] || ex.of || 'max').toLowerCase()}${ex.of ? ' max' : ''}` : '', ex.tempo ? 'Tempo ' + ex.tempo : '', ex.rest ? 'Rest ' + ex.rest : '', ex.effort || ''].filter(Boolean).join(' · ')}</div>${ex.notes ? `<div class="meta ex-guide-note">${esc(ex.notes)}</div>` : ''}</div><span class="num">${prescription(ex)}</span></li>`).join('')}</ul>`).join('')}
      ${d.suggestions ? `<div>${d.suggestions.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}</div>`).join('');
    h += (plan.sections || []).map((s) => `<details class="card guide-sec"><summary><strong>${esc(s.title)}</strong></summary><div class="guide-body">${renderBody(s.body)}</div></details>`).join('');
    return h;
  }

  // ---------- conditioning pieces (metcons, AMRAP, for time, EMOM, Tabata) ----------
  // A block is scored as a whole instead of set by set. The type comes from block.score when the plan
  // sets it, otherwise it is worked out from the block's name and notes ("AMRAP x 12 min", "Score: Time"…).
  const SCORE_LABEL = { time: 'For time', rounds: 'AMRAP', reps: 'Total reps', emom: 'EMOM', intervals: 'Time each set' };
  const LOADED = /rx|@|\blb\b|\bkg\b|\bkb\b|\bdb\b|barbell|dumbbell|kettlebell|clean|snatch|jerk|press|squat|deadlift|thruster|swing|wall ?ball|slam|lunge|carry|sled|sandbag|\bdb row|barbell row/i;
  function scoreInfo(b) {
    const txt = `${b.name || ''} · ${b.note || ''} · ${b.fmt || ''}`.toLowerCase();
    let type = b.score || null;
    const sc = txt.match(/score:\s*([a-z +]+)/);
    if (!type && sc) {
      const v = sc[1];
      type = /each set/.test(v) ? 'intervals' : /time/.test(v) ? 'time' : /round/.test(v) ? 'rounds' : /rep|cal|distance|meter/.test(v) ? 'reps' : /weight|load/.test(v) ? 'sets' : null;
    }
    if (!type) {
      if (/amrap|as many rounds|as many reps/.test(txt)) type = 'rounds';
      else if (/for time/.test(txt)) type = 'time';
      else if (/tabata/.test(txt) || b.exercises.some((e) => /:20 on/.test(e.reps || ''))) type = 'reps';
      else if (/\bemom\b|\be\dmom\b|every min(ute)? on the min|every\s+\d+(:\d\d)?\s*(min|x)|every \d+:\d\d/.test(txt)) type = 'emom';
    }
    // strength EMOMs (a % of max, or one loaded lift every minute) keep set-by-set logging so each round's weight is saved
    if (type === 'emom' && (b.exercises.some((e) => e.pct || e.scheme) || (b.exercises.length === 1 && (b.exercises[0].role === 'main' || LOADED.test(b.exercises[0].name))))) type = 'sets';
    type = type || 'sets';
    let minutes = null, every = null, rounds = null, cap = null, m;
    if ((m = txt.match(/amrap\s*(?:x\s*)?(\d+)/))) minutes = +m[1];
    if ((m = txt.match(/\bemom\s*(?:x|·|-|for)?\s*(\d+)/) || txt.match(/every min(?:ute)? on the min(?:ute)?\s*(?:for|x)?\s*(\d+)/))) { every = 60; minutes = +m[1]; }
    if ((m = txt.match(/\be(\d)mom\s*(?:x\s*)?(\d+)/))) { every = 60 * +m[1]; minutes = +m[2]; }
    if ((m = txt.match(/every\s*(\d+):(\d\d)\s*(?:x|for)\s*(\d+)\s*(sets?|rounds?|min)/))) { every = +m[1] * 60 + +m[2]; if (/min/.test(m[4])) minutes = +m[3]; else rounds = +m[3]; }
    if ((m = txt.match(/every\s*(\d+)\s*min(?:utes?)?\s*(?:x|for)\s*(\d+)\s*(sets?|rounds?|min)/))) { every = +m[1] * 60; if (/min/.test(m[3])) minutes = +m[2]; else rounds = +m[2]; }
    if ((m = txt.match(/cap[:\s]*(\d+)(?::00)?/) || txt.match(/(\d+)\s*min(?:ute)?s?\s*cap/))) cap = +m[1];
    if (/tabata/.test(txt) || b.exercises.some((e) => /:20 on/.test(e.reps || ''))) { every = 30; rounds = 8; minutes = 4; }
    if (every && minutes && !rounds) rounds = Math.max(1, Math.round(minutes * 60 / every));
    if (every && rounds && !minutes) minutes = Math.round(every * rounds / 60);
    const maxSets = Math.max(1, ...b.exercises.map((e) => +e.sets || 1));
    if ((type === 'emom' || type === 'intervals') && !rounds) rounds = maxSets;
    if (type === 'time' && !cap && minutes) cap = minutes;
    return { type, minutes, every, rounds, cap, roundsOf: type === 'time' || type === 'rounds' ? maxSets : 1 };
  }
  const blockSig = (b) => b.exercises.map((e) => e.name).join('|');
  const fmtSec = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  function scoreText(type, v, info) {
    if (!v) return '';
    const t = (mm, ss) => (mm || ss ? `${+mm || 0}:${String(+ss || 0).padStart(2, '0')}` : '');
    if (type === 'time') return v.capped ? `Capped${v.rounds || v.reps ? ` · ${+v.rounds || 0} rounds + ${+v.reps || 0} reps` : ''}` : t(v.mm, v.ss);
    if (type === 'rounds') return v.rounds != null || v.reps != null ? `${+v.rounds || 0} rounds + ${+v.reps || 0} reps` : '';
    if (type === 'reps') return v.total != null ? `${v.total} ${info && info.every === 30 ? 'reps (lowest round)' : 'reps'}` : '';
    if (type === 'emom') { const n = (v.done || []).filter(Boolean).length; return n ? `${n}/${info ? info.rounds : '?'} rounds` : ''; }
    if (type === 'intervals') { const ts = (v.sets || []).map((x) => x && t(x.mm, x.ss)).filter(Boolean); return ts.join(', '); }
    return '';
  }
  function lastScore(as, b) {
    const sig = blockSig(b);
    const w = [...S().workouts].filter((x) => x.scores && x.date <= as.date && x.id !== as.id).sort((a, z) => (z.date + (z.time || '')).localeCompare(a.date + (a.time || ''))).find((x) => x.scores.some((s) => s.sig === sig));
    return w ? { date: w.date, text: w.scores.find((s) => s.sig === sig).text } : null;
  }
  function wodCard(b, bi, day, as) {
    const info = scoreInfo(b), bk = 'b' + bi, v = (as.scores || {})[bk] || {};
    const last = lastScore(as, b);
    const clockable = info.minutes || info.every || info.type === 'time';
    const clockLbl = info.type === 'time' ? `Start clock${info.cap ? ` (cap ${info.cap} min)` : ''}` : info.every ? `Start ${info.every === 30 ? 'Tabata' : 'EMOM'} clock · ${info.rounds} × ${info.every >= 60 && info.every % 60 === 0 ? (info.every / 60) + ' min' : fmtSec(info.every)}` : `Start ${info.minutes}:00 countdown`;
    const head = `${info.roundsOf > 1 ? `${info.roundsOf} rounds` : ''}`;
    let h = `<div class="card block-card wod" id="wod-${bk}"><div class="card-head" style="margin-bottom:4px"><h2>${esc(b.name || SCORE_LABEL[info.type])}</h2><span class="chip strong">${SCORE_LABEL[info.type]}</span></div>
      ${b.note ? `<p class="sub" style="margin-top:0">${esc(b.note)}</p>` : ''}${head ? `<p class="wod-rounds">${head}</p>` : ''}
      <ul class="wod-moves">${b.exercises.map((ex) => `<li><div class="wod-move"><span class="wod-reps">${esc(String(ex.reps || '').replace(/^as written$|^see notes$/, ''))}${ex.each ? ' each' : ''}</span><span class="wod-name">${esc(ex.name)}</span></div>
        ${ex.notes ? `<div class="sub wod-note">${esc(ex.notes)}</div>` : ''}
        ${LOADED.test(ex.name + ' ' + (ex.notes || '')) ? `<label class="wod-wt"><span>Weight used</span><input type="number" inputmode="decimal" step="any" data-wk="${bk}" data-wf="w_${esc(ex.id)}" value="${v.w && v.w[ex.id] != null ? v.w[ex.id] : ''}" placeholder="${unit()}"></label>` : ''}</li>`).join('')}</ul>
      ${last ? `<p class="sub ex-note">Last time (${C.relDay(last.date)}): <strong>${esc(last.text)}</strong></p>` : ''}
      ${clockable ? `<button class="btn block" data-action="wod-clock" data-bk="${bk}">⏱ ${clockLbl}</button>` : ''}
      <div class="wod-score"><div class="wod-score-lbl">Your score</div>`;
    const num = (f, val, ph, w) => `<input type="number" inputmode="numeric" min="0" step="1" data-wk="${bk}" data-wf="${f}" value="${val ?? ''}" placeholder="${ph}" style="width:${w || 80}px">`;
    if (info.type === 'time') {
      h += `<div class="row wod-inputs">${num('mm', v.mm, 'min')}<span>:</span>${num('ss', v.ss, 'sec')}</div>
        <label class="ed-check"><input type="checkbox" data-wk="${bk}" data-wf="capped" ${v.capped ? 'checked' : ''}><span>Hit the time cap</span></label>
        ${v.capped ? `<div class="row wod-inputs">${num('rounds', v.rounds, 'rounds')}<span>+</span>${num('reps', v.reps, 'reps')}</div>` : ''}`;
    } else if (info.type === 'rounds') {
      h += `<div class="row wod-inputs">${num('rounds', v.rounds, 'rounds')}<span>rounds +</span>${num('reps', v.reps, 'reps')}<span>reps</span></div>`;
    } else if (info.type === 'reps') {
      h += `<div class="row wod-inputs">${num('total', v.total, info.every === 30 ? 'lowest' : 'total', 110)}<span>${info.every === 30 ? 'reps in your lowest round' : 'reps'}</span></div>`;
    } else if (info.type === 'emom') {
      h += `<p class="sub" style="margin:0 0 6px">Tap each round you finish inside the minute.</p><div class="wod-rounds-grid">${Array.from({ length: info.rounds }, (_, i) => `<button class="wod-round ${(v.done || [])[i] ? 'done' : ''}" data-action="wod-round" data-bk="${bk}" data-i="${i}">${i + 1}</button>`).join('')}</div>`;
    } else if (info.type === 'intervals') {
      h += Array.from({ length: info.rounds }, (_, i) => `<div class="row wod-inputs"><span style="width:52px">Set ${i + 1}</span>${num(`s${i}_mm`, ((v.sets || [])[i] || {}).mm, 'min', 70)}<span>:</span>${num(`s${i}_ss`, ((v.sets || [])[i] || {}).ss, 'sec', 70)}</div>`).join('');
    }
    return h + '</div></div>';
  }
  function wodInput(t, as) {
    const bk = t.dataset.wk, f = t.dataset.wf;
    as.scores = as.scores || {};
    const v = as.scores[bk] || (as.scores[bk] = {});
    const val = t.type === 'checkbox' ? t.checked : t.value === '' ? null : Number(t.value);
    if (f.startsWith('w_')) { (v.w || (v.w = {}))[f.slice(2)] = val; }
    else if (/^s\d+_/.test(f)) { const [, i, k] = f.match(/^s(\d+)_(\w+)$/); const arr = v.sets || (v.sets = []); (arr[+i] || (arr[+i] = {}))[k] = val; }
    else v[f] = val;
    C.save();
    if (f === 'capped') C.render();
  }
  // workout clock: countdown (AMRAP), interval beeps (EMOM / Tabata) or stopwatch (for time)
  let wodIv = null, audio = null;
  function beep(hi) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = hi ? 1320 : 880; g.gain.value = 0.15; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + (hi ? 0.45 : 0.18));
    } catch (_) { /* no audio */ }
    if (navigator.vibrate) navigator.vibrate(hi ? [300, 100, 300] : 120);
  }
  function clockBar() {
    let el = document.getElementById('wod-clock');
    if (!el) { el = document.createElement('div'); el.id = 'wod-clock'; el.setAttribute('role', 'timer'); document.body.appendChild(el); }
    return el;
  }
  function runClock() {
    clearInterval(wodIv);
    const as = S().activeSession, c = as && as.clock;
    const el = clockBar();
    if (!c) { el.classList.remove('show'); return; }
    let lastSec = null;
    const tick = () => {
      const as2 = S().activeSession;
      if (!as2 || !as2.clock) { clearInterval(wodIv); el.classList.remove('show'); return; }
      const t = (Date.now() - c.start) / 1000 - 5; // 5-second lead-in
      const sec = Math.floor(t);
      let main, sub = '', done = false;
      if (t < 0) { main = `${Math.ceil(-t)}`; sub = 'Get ready'; if (sec !== lastSec && sec >= -3) beep(false); }
      else if (c.every) {
        const k = Math.floor(t / c.every), left = c.every - (t - k * c.every);
        if (k >= c.rounds) done = true;
        main = fmtSec(Math.ceil(left)); sub = `Round ${Math.min(k + 1, c.rounds)} of ${c.rounds}`;
        if (sec !== lastSec && Math.ceil(left) === c.every && sec >= 0) beep(true);
      } else if (c.mode === 'down') {
        const left = c.minutes * 60 - t; if (left <= 0) done = true;
        main = fmtSec(Math.max(0, Math.ceil(left))); sub = 'AMRAP';
        if (sec !== lastSec && sec === 0) beep(true);
      } else {
        main = fmtSec(Math.max(0, t)); sub = c.cap ? `Cap ${c.cap}:00` : 'For time';
        if (sec !== lastSec && sec === 0) beep(true);
        if (c.cap && t >= c.cap * 60) done = true;
      }
      if (sec !== lastSec) lastSec = sec;
      if (done) {
        beep(true); clearInterval(wodIv);
        const bk = c.bk; as2.clock = null; C.save();
        if (c.mode === 'up' && c.cap) { const v = (as2.scores || (as2.scores = {}))[bk] || (as2.scores[bk] = {}); v.capped = true; C.save(); }
        el.innerHTML = `<span><strong>Time!</strong> Enter your score</span><button data-action="wod-clock-close">OK</button>`; el.classList.add('show', 'over');
        if (C.ui.tab === 'session') { C.render(); const card = document.getElementById('wod-' + bk); if (card) card.scrollIntoView({ block: 'center' }); }
        return;
      }
      el.classList.remove('over');
      el.innerHTML = `<div><div class="wod-clock-main">${main}</div><div class="wod-clock-sub">${esc(sub)}</div></div>
        ${c.mode === 'up' && t >= 0 ? '<button class="btn small primary" data-action="wod-clock-stop">Done</button>' : ''}<button class="btn small" data-action="wod-clock-cancel">✕</button>`;
      el.classList.add('show');
    };
    tick(); wodIv = setInterval(tick, 250);
  }

  // ---------- session logger ----------
  function startSession(dayId, planId) {
    const st = S();
    const prog = progFor(planId) || progs()[0], plan = planCache.get(prog && prog.planId);
    if (!plan) { C.toast('Plan still loading, try again'); return; }
    if (st.activeSession) {
      if (st.activeSession.dayId === dayId) { openSession(); return; }
      if (!confirm('You have a workout in progress. Discard it and start this one?')) return;
    }
    const wk = programWeek(prog, plan);
    const day = daysAt(plan, wk.week).find((d) => d.id === dayId) || plan.days.find((d) => d.id === dayId);
    if (!day) { C.toast('That day isn\'t in this week\'s plan'); return; }
    st.activeSession = { id: C.uid(), planId: plan.id, dayId, dayLabel: day.label, dayName: day.name, week: wk.week, date: C.todayISO(),
      startedAt: Date.now(), sets: {}, extraSets: {}, primer: {}, extra: [], notes: '', deload: !!(wk.guide && wk.guide.deload) };
    C.save();
    openSession();
  }
  function openSession() { C.setTab('session'); }
  // ---------- one-off workouts sent by the coach ----------
  function startOneOff(a) {
    const st = S();
    if (st.activeSession) {
      if (st.activeSession.oneOff && st.activeSession.oneOff.id === a.id) { openSession(); return; }
      if (!confirm('You have a workout in progress. Discard it and start this one?')) return;
    }
    const day = Object.assign({ label: 'From your coach', name: a.title, blocks: [] }, a.day || {}, { id: 'oneoff' });
    if (!day.blocks.length) day.freeform = true;
    const plan = { schema: 1, id: 'oneoff:' + a.id, name: a.title, weeks: 1, oneOff: true, days: [day] };
    planCache.set(plan.id, plan);
    st.activeSession = { id: C.uid(), planId: plan.id, dayId: 'oneoff', dayLabel: 'From your coach', dayName: a.title, week: 1, date: C.todayISO(),
      startedAt: Date.now(), sets: {}, extraSets: {}, primer: {}, extra: [], notes: '', deload: false,
      oneOff: { id: a.id, title: a.title, note: a.note || '', replaces: a.replaces || null, plan } };
    C.save();
    openSession();
  }

  function setRows(ex, as, last) {
    const tgt = targetLoad(ex, planCache.get(as.planId));
    const per = ex.scheme ? expandScheme(ex) : null;
    const n = (per ? per.length : ex.sets) + (as.extraSets[ex.id] || 0);
    const u = unit();
    const rr = repRange(ex.reps);
    let h = `<div class="sets"><div class="set-head"><span>Set</span><span>${ex.bodyweight ? '+' + u : u}</span><span>Reps</span><span></span></div>`;
    for (let i = 0; i < n; i++) {
      const v = (as.sets[ex.id] || [])[i] || {};
      const prev = last && last.sets[i];
      const g = per && per[i];
      const gW = g && g.pct ? parseFloat(loadFor(g.pct, ex.of, planCache.get(as.planId)) || '') : NaN;
      const phW = !isNaN(gW) ? gW : tgt && !tgt.missing ? tgt.lo : prev && prev.weight != null ? prev.weight : '';
      const gR = g ? (String(g.reps).match(/\d+/) || [''])[0] : '';
      const phR = g ? gR : prev && prev.reps != null ? prev.reps : rr ? (rr.min === rr.max ? rr.min : `${rr.min}-${rr.max}`) : '';
      h += `<div class="set-row ${v.done ? 'done' : ''}"><span class="set-n">${i + 1}</span>
        <input type="number" inputmode="decimal" step="any" min="0" placeholder="${esc(phW)}" value="${v.weight ?? ''}" data-sx="${ex.id}" data-si="${i}" data-sf="weight" aria-label="Set ${i + 1} weight">
        <input type="number" inputmode="numeric" step="1" min="0" placeholder="${esc(phR)}" value="${v.reps ?? ''}" data-sx="${ex.id}" data-si="${i}" data-sf="reps" aria-label="Set ${i + 1} reps">
        <button class="tick" data-action="set-done" data-sx="${ex.id}" data-si="${i}" aria-label="Set ${i + 1} done">${v.done ? '✓' : ''}</button></div>`;
    }
    return h + `<button class="link-btn" data-action="set-add" data-sx="${ex.id}">+ Add set</button></div>`;
  }

  function exerciseCard(ex, as, wk, letter) {
    const deloadNow = wk.guide && wk.guide.deload;
    const last = lastSets(ex, as.date, !deloadNow) || lastSets(ex, as.date);
    // first time this exercise is trained in a new block → suggest a heavier start
    const blockStart = C.addDays(wk.weekStart, -7 * (wk.cycleWeek - 1));
    const wk2 = Object.assign({}, wk, { newBlock: wk.block > 1 && !deloadNow && !!last && last.date < blockStart });
    const tgt = targetLoad(ex, planCache.get(as.planId));
    const schemeLoads = ex.scheme && ex.of && ex.scheme.some((g) => g.pct) ? ex.scheme.map((g) => ({ g, w: loadFor(g.pct, ex.of, planCache.get(as.planId)) })) : null;
    const hn = schemeLoads ? (schemeLoads.every((x) => x.w || !x.g.pct) ? `Targets: ${schemeLoads.map((x) => `${x.g.sets}×${x.g.reps}${x.w ? ' @ ' + x.w : ''}`).join(', ')} ${unit()}.` : `Enter your ${MAX_KEYS[ex.of] || ex.of} max on the Train tab to see your target weights.`)
      : tgt && !tgt.missing ? `Target today: ${tgt.text} ${unit()} (${pctText(ex.pct)} of your ${MAX_KEYS[ex.of] || ex.of} max${(planCache.get(as.planId) || {}).trainingMax ? ' × training max' : ''}).${ex.of === 'pullup' ? ' That\'s bodyweight + added weight: subtract your bodyweight to get what to hang on the belt.' : ''}`
      : tgt && tgt.missing ? `Enter your ${MAX_KEYS[ex.of] || ex.of} max on the Train tab to see your target weight.` : hint(ex, last, wk2);
    const lastTxt = last ? last.sets.map((s) => (s.weight ? `${s.weight}×${s.reps ?? '–'}` : `${s.reps ?? '–'}`)).join(', ') : '';
    return `<div class="ex-card" id="ex-${ex.id}"><div class="ex-title">${letter ? `<span class="ex-letter">${letter}</span>` : ''}${esc(ex.name)}</div>
      <div class="ex-chips"><span class="chip strong">${prescription(ex)}</span>${ex.pct ? `<span class="chip strong">${pctText(ex.pct)}${tgt && !tgt.missing ? ` · ${tgt.text} ${unit()}` : ''}</span>` : ''}${ex.tempo ? `<span class="chip">Tempo ${esc(ex.tempo)}</span>` : ''}${ex.rest ? `<span class="chip">Rest ${esc(ex.rest)}</span>` : ''}${ex.effort ? `<span class="chip">${esc(ex.effort)}</span>` : ''}
        ${ex.role === 'main' && wk.guide && !ex.effort ? `<span class="chip">${esc(wk.guide.effort.replace('Main lifts ', ''))}</span>` : ''}</div>
      ${ex.notes ? `<p class="sub ex-note">${esc(ex.notes)}</p>` : ''}
      ${lastTxt ? `<p class="sub ex-note">Last (${C.relDay(last.date)}): ${esc(lastTxt)}</p>` : ''}
      ${hn ? `<p class="ex-hint">${esc(hn)}</p>` : ''}
      ${setRows(ex, as, last)}</div>`;
  }

  const withRegion = (ex, day) => (ex.region || !day.region ? ex : Object.assign({}, ex, { region: day.region }));
  function viewSession() {
    const st = S(), as = st.activeSession;
    if (!as) return '<div class="card"><div class="empty">No workout in progress.</div><button class="btn block" data-action="goto" data-tab="train">Back to Training</button></div>';
    const plan = planNow(as.planId);
    if (!plan) return '<div class="empty">Loading plan…</div>';
    const wk = programWeek(progFor(plan.id) || { startDate: as.date }, plan, as.date);
    wk.kb = !!(plan.progression && plan.progression.kettlebell);
    const day = daysAt(plan, as.week || wk.week).find((d) => d.id === as.dayId) || plan.days.find((d) => d.id === as.dayId);
    if (!day) return '<div class="card"><div class="empty">This workout\'s day was removed from the plan.</div><button class="btn danger block" data-action="session-discard">Discard</button></div>';
    let h = `<div class="card session-head"><div class="sub">${as.oneOff ? `From your coach${as.oneOff.replaces ? ' · counts as ' + esc(as.oneOff.replaces.label || 'a plan day') : ''}` : `${esc(day.label)} · Week ${wk.week}${wk.guide ? ' · ' + esc(wk.guide.label) : ''}`}</div>
      ${as.oneOff && as.oneOff.note ? `<p class="focus">“${esc(as.oneOff.note)}”</p>` : ''}
      <div style="font-weight:800;font-size:22px;line-height:1.15">${esc(day.name)}</div>
      ${day.focus ? `<p class="focus">“${esc(day.focus)}”</p>` : ''}${instructionsHTML(day.instructions)}
      ${wk.guide ? `<p class="sub" style="margin:4px 0 0"><strong>${esc(wk.guide.effort)}</strong>${wk.guide.deload ? ' — deload week' : ''}</p>` : ''}
      <div class="row session-date" style="margin-top:6px;gap:8px;flex-wrap:nowrap"><div class="sub" id="session-clock" style="flex:1"></div>
        <label class="sub" style="display:flex;align-items:center;gap:6px;flex:none">Log for <input type="date" data-session-date value="${esc(as.date)}" max="${C.todayISO()}" style="width:auto;padding:4px 6px;min-height:0"></label></div></div>`;
    const wu = day.warmup && plan.warmups && plan.warmups[day.warmup];
    if (wu) {
      const doneN = wu.items.filter((_, i) => as.primer[i]).length;
      h += `<details class="card" ${doneN === wu.items.length ? '' : 'open'}><summary><strong>${esc(wu.name)}</strong> <span class="sub">${doneN}/${wu.items.length}</span></summary>
        ${wu.note ? `<p class="sub">${esc(wu.note)}</p>` : ''}
        ${wu.items.map((it, i) => `<button class="habit ${as.primer[i] ? 'done' : ''}" data-action="primer-toggle" data-i="${i}"><span class="box"></span><span>${esc(it.name)} <span class="sub">${esc(it.dose)}</span></span></button>`).join('')}</details>`;
    }
    day.blocks.forEach((b, bi) => {
      const si = scoreInfo(b);
      if (si.type !== 'sets') { h += wodCard(b, bi, day, as); return; }
      const clk = si.every && si.rounds ? `<button class="btn small block" data-action="wod-clock" data-bk="b${bi}" style="margin:0 0 10px">⏱ Start EMOM clock · ${si.rounds} × ${si.every % 60 === 0 ? si.every / 60 + ' min' : fmtSec(si.every)}</button>` : '';
      if (b.type === 'superset') {
        h += `<div class="card block-card"><div class="card-head" style="margin-bottom:4px"><h2>${esc(b.name || 'Superset')}</h2></div>${b.note ? `<p class="sub" style="margin-top:0">${esc(b.note)}</p>` : ''}${clk}
          ${b.exercises.map((ex, i) => exerciseCard(withRegion(ex, day), as, wk, String.fromCharCode(65 + i))).join('')}</div>`;
      } else {
        h += `<div class="card block-card">${b.name ? `<div class="card-head" style="margin-bottom:4px"><h2>${esc(b.name)}</h2></div>` : ''}${b.note ? `<p class="sub" style="margin-top:0">${esc(b.note)}</p>` : ''}${clk}${b.exercises.map((ex) => exerciseCard(withRegion(ex, day), as, wk)).join('')}</div>`;
      }
    });
    if (day.freeform || as.extra.length) {
      h += `<div class="card">${day.suggestions ? `<p class="sub" style="margin-top:0">Ideas: ${day.suggestions.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</p>` : ''}
        ${as.extra.map((ex) => exerciseCard(ex, as, wk)).join('')}
        <button class="btn block" data-action="session-add-ex">+ Add exercise</button></div>`;
    }
    h += `<div class="card"><label class="field"><span>Session notes</span><textarea data-session-notes placeholder="How it felt, pain, PRs, anything for your coach…">${esc(as.notes)}</textarea></label>
      <button class="btn primary block" data-action="session-finish">Finish workout</button>
      <button class="btn danger block" data-action="session-discard" style="margin-top:8px">Discard</button></div>`;
    return h;
  }

  function findEx(as, exId) {
    const plan = planCache.get(as.planId);
    const day = plan && (daysAt(plan, as.week).find((d) => d.id === as.dayId) || plan.days.find((d) => d.id === as.dayId));
    const blocks = day ? day.blocks : [];
    for (const b of blocks) {
      const i = b.exercises.findIndex((e) => e.id === exId);
      if (i >= 0) return { ex: b.exercises[i], block: b, last: i === b.exercises.length - 1 };
    }
    const ex = as.extra.find((e) => e.id === exId);
    return ex ? { ex, block: null, last: true } : null;
  }

  function finishSession() {
    const st = S(), as = st.activeSession;
    const sets = [];
    Object.entries(as.sets).forEach(([exId, arr]) => {
      const f = findEx(as, exId);
      (arr || []).forEach((v, i) => {
        if (!v || (!v.done && v.reps == null && v.weight == null)) return;
        if (v.reps == null && v.weight == null) return;
        sets.push({ exId, name: f ? f.ex.name : exId, set: i + 1, weight: v.weight ?? null, reps: v.reps ?? null });
      });
    });
    const scores = [];
    { const plan = planCache.get(as.planId);
      const day = plan && (daysAt(plan, as.week).find((d) => d.id === as.dayId) || plan.days.find((d) => d.id === as.dayId));
      ((day && day.blocks) || []).forEach((b, bi) => {
        const info = scoreInfo(b); if (info.type === 'sets') return;
        const v = (as.scores || {})['b' + bi]; if (!v) return;
        const text = scoreText(info.type, v, info);
        if (text) scores.push({ key: 'b' + bi, sig: blockSig(b), name: b.name || SCORE_LABEL[info.type], type: info.type, text, value: v });
        Object.entries(v.w || {}).forEach(([exId, wt]) => {
          if (!wt) return; const ex = b.exercises.find((e) => e.id === exId); if (!ex) return;
          const r = parseInt(ex.reps, 10); sets.push({ exId, name: ex.name, set: 1, weight: wt, reps: Number.isFinite(r) && String(r) === String(ex.reps).trim() ? r : null });
        });
      }); }
    if (!sets.length && !scores.length && !confirm('Nothing logged. Save this workout anyway?')) return;
    const minutes = Math.max(1, Math.min(240, Math.round((Date.now() - as.startedAt) / 60000)));
    const before = C.liftBests();
    const rec = { id: C.uid(), date: as.date, time: new Date(as.startedAt).toTimeString().slice(0, 5), type: `${as.dayLabel} · ${as.dayName}`, minutes,
      planId: as.planId, dayId: as.dayId, week: as.week, deload: !!as.deload, sets, notes: as.notes.trim(), exercises: '', intensity: null };
    if (scores.length) rec.scores = scores;
    if (as.oneOff) {
      // a coach-sent workout: label it, and when it stands in for a plan day count it there
      rec.type = `From coach · ${as.oneOff.title}`;
      rec.oneOff = { id: as.oneOff.id, title: as.oneOff.title };
      const r = as.oneOff.replaces, pr = r && progFor(r.planId), rp = r && planCache.get(r.planId);
      if (r && r.planId && r.dayId) { rec.planId = r.planId; rec.dayId = r.dayId; rec.week = pr && rp ? programWeek(pr, rp, as.date).week : r.week || null; }
      else { rec.planId = null; rec.dayId = null; rec.week = null; }
      if (window.Assign) Assign.complete(as.oneOff.id, rec.id);
    }
    st.workouts.push(rec);
    st.activeSession = null;
    stopTimer(); runClock();
    C.save();
    const prs = [];
    const seen = new Set();
    sets.filter((s) => s.weight && s.reps).sort((a, b) => b.weight - a.weight).forEach((s) => {
      const k = exKey(s.name), b = before.get(k);
      if (b && s.weight > b.weight && !seen.has(k)) { seen.add(k); prs.push(`${s.name} ${s.weight}`); }
    });
    C.toast(prs.length ? `New PR: ${prs.slice(0, 2).join(', ')} 🏆` : scores.length ? `Workout saved · ${scores.length} score${scores.length > 1 ? 's' : ''} logged 💪` : `Workout saved · ${sets.length} sets · ${minutes} min 💪`);
    C.setTab('train');
  }

  // ---------- rest timer ----------
  let timer = null;
  function startTimer(sec, label) {
    stopTimer();
    if (!sec) return;
    const el = document.getElementById('rest-timer');
    timer = { end: Date.now() + sec * 1000, label, iv: null };
    const tick = () => {
      if (!timer) return;
      const left = Math.round((timer.end - Date.now()) / 1000);
      if (left <= 0) {
        el.innerHTML = '<span><strong>Rest over</strong> — next set</span><button data-action="timer-stop">OK</button>';
        el.classList.add('over');
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        clearInterval(timer.iv); timer.iv = null;
        setTimeout(() => { if (timer && !timer.iv) stopTimer(); }, 6000);
        return;
      }
      el.innerHTML = `<span><span>Rest <strong>${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</strong></span>${label ? `<span class="rt-label">${esc(label)}</span>` : ''}</span>
        <span><button data-action="timer-add">+15s</button><button data-action="timer-stop">Skip</button></span>`;
    };
    el.classList.remove('over');
    el.classList.add('show');
    document.body.classList.add('timing');
    tick();
    timer.iv = setInterval(tick, 500);
  }
  function stopTimer() {
    if (timer && timer.iv) clearInterval(timer.iv);
    timer = null;
    const el = document.getElementById('rest-timer');
    if (el) el.classList.remove('show', 'over');
    document.body.classList.remove('timing');
  }
  let clockIv = null;
  function sessionClock() {
    clearInterval(clockIv);
    const tick = () => {
      const el = document.getElementById('session-clock');
      const as = S().activeSession;
      if (!el || !as) { clearInterval(clockIv); return; }
      const m = Math.floor((Date.now() - as.startedAt) / 60000);
      el.textContent = `⏱ ${Math.floor(m / 60) ? Math.floor(m / 60) + 'h ' : ''}${m % 60} min`;
    };
    tick();
    clockIv = setInterval(tick, 15000);
  }

  // ---------- actions ----------
  function setVal(exId, i, field, value) {
    const as = S().activeSession;
    const arr = as.sets[exId] || (as.sets[exId] = []);
    const v = arr[i] || (arr[i] = {});
    v[field] = value;
  }
  const actions = {
    'plans-open': () => C.setTab('plans'),
    'plan-guide': (el) => { C.ui.guidePlan = el.dataset.id; C.ui.guideWeek = el.dataset.week ? +el.dataset.week : null; C.setTab('guide'); },
    'guide-week': (el) => { C.ui.guideWeek = Number(el.dataset.w); C.render(); },
    'plan-choose': async (el) => {
      const plan = await loadPlan(el.dataset.id).catch(() => null);
      if (!plan) { C.toast('Couldn\'t load that plan'); return; }
      const t = C.todayISO();
      C.openModal(`<h2>Start ${esc(plan.name)}</h2><p class="sub" style="margin-top:0">${esc(plan.phase || '')} · ${plan.weeks} weeks</p>
        ${C.field('Week 1 starts', `<select name="start"><option value="${t}">Today, ${C.prettyDate(t)}</option><option value="${C.weekStart(t)}">This Monday, ${C.prettyDate(C.weekStart(t))}</option><option value="${C.addDays(C.weekStart(t), 7)}">Next Monday, ${C.prettyDate(C.addDays(C.weekStart(t), 7))}</option></select>`)}
        <p class="hint">Week numbers, effort targets and the deload week are counted from this date.</p>`, (fd) => {
        const st = S();
        const list = progs().filter((p) => p.planId !== plan.id);
        if (list.length >= MAX_PLANS) { C.toast(`You can run up to ${MAX_PLANS} plans. Stop one first.`); return; }
        setProgs([...list, { planId: plan.id, startDate: fd.get('start') }]);
        C.save(); C.toast(`Started ${plan.name}`);
        setTimeout(() => C.setTab('train'), 0);
      }, { saveLabel: 'Start plan' });
    },
    'maxes-edit': (el) => {
      const plan = planCache.get(el.dataset.id) || {};
      const keys = [...new Set([...maxesNeeded(plan), ...Object.keys(S().settings.maxes || {})])];
      const mx = S().settings.maxes || {}, u = unit();
      C.openModal(`<h2>Your maxes</h2><p class="sub" style="margin-top:0">Your best single rep (or a recent tested max) for each lift, in ${u}. Target weights in your plan are worked out from these.</p>
        ${keys.map((k) => C.field(`${MAX_KEYS[k] || k} (${u})`, `<input type="number" inputmode="decimal" step="any" min="0" name="max_${k}" value="${mx[k] || ''}">`)).join('')}
        <p class="hint">Not sure? Use a weight you can lift about 3 times and multiply by 1.1.</p>`, (fd) => {
        const st = S(); st.settings.maxes = Object.assign({}, st.settings.maxes || {});
        keys.forEach((k) => { const v = Number(fd.get('max_' + k)); if (v > 0) st.settings.maxes[k] = v; else delete st.settings.maxes[k]; });
        C.save(); C.toast('Maxes saved'); C.render();
      }, { saveLabel: 'Save maxes' });
    },
    'plan-leave': (el) => {
      const st = S(), id = el.dataset.id || (progs()[0] && progs()[0].planId), pr = progFor(id);
      if (!pr) return;
      const nm = (planCache.get(id) || {}).name;
      if (!confirm(`Stop following ${nm || 'this plan'}? Your logged workouts are kept.`)) return;
      (st.programHistory || (st.programHistory = [])).push({ ...pr, endDate: C.todayISO() });
      setProgs(progs().filter((p) => p.planId !== id)); C.save(); C.render();
    },
    'session-start': (el) => {
      const pr = progFor(el.dataset.plan) || progs()[0];
      if (!pr) return;
      loadPlan(pr.planId).then(() => startSession(el.dataset.day, pr.planId)).catch(() => C.toast('Couldn\'t load the plan'));
    },
    'session-open': openSession,
    'set-done': (el) => {
      const as = S().activeSession;
      const { sx, si } = el.dataset, i = +si;
      const row = el.closest('.set-row');
      const arr = as.sets[sx] || (as.sets[sx] = []);
      const v = arr[i] || (arr[i] = {});
      if (v.done) { v.done = false; C.save(); C.render(); return; }
      // empty fields → use the placeholders (last time / target) as a one-tap "same as before"
      const [wIn, rIn] = row.querySelectorAll('input');
      if (v.weight == null && wIn.placeholder !== '' && !isNaN(+wIn.placeholder)) v.weight = +wIn.placeholder;
      if (v.reps == null && rIn.placeholder !== '' && /^\d+$/.test(rIn.placeholder)) v.reps = +rIn.placeholder;
      if (v.reps == null) { C.toast('Enter your reps'); rIn.focus(); return; }
      v.done = true;
      C.save();
      const f = findEx(as, sx);
      const restTxt = f && (f.block && f.block.type === 'superset' ? (f.last ? f.block.rest : null) : f.ex.rest);
      C.render();
      if (restTxt) startTimer(restSeconds(restTxt), f.ex.name);
    },
    'set-add': (el) => { const as = S().activeSession; as.extraSets[el.dataset.sx] = (as.extraSets[el.dataset.sx] || 0) + 1; C.save(); C.render(); },
    'primer-toggle': (el) => { const as = S().activeSession; as.primer[el.dataset.i] = !as.primer[el.dataset.i]; C.save(); C.render(); },
    'session-add-ex': () => {
      C.openModal(`<h2>Add exercise</h2>${C.field('Exercise', '<input type="text" name="name" required autofocus placeholder="e.g. Cable Lateral Raise" autocomplete="off">')}
        <div class="fields-2">${C.field('Sets', C.inNum('sets', 3, 'min="1" max="10" step="1" required'))}${C.field('Reps', '<input type="text" name="reps" value="10–15">')}</div>
        ${C.field('Rest', '<input type="text" name="rest" value="60 sec">')}`, (fd) => {
        S().activeSession.extra.push({ id: 'x-' + C.uid(), name: fd.get('name').trim(), sets: Math.max(1, +fd.get('sets') || 3), reps: fd.get('reps') || '', rest: fd.get('rest') || '', role: 'isolation' });
        C.save();
      });
    },
    'wod-round': (el) => {
      const as = S().activeSession; as.scores = as.scores || {};
      const v = as.scores[el.dataset.bk] || (as.scores[el.dataset.bk] = {}); const d = v.done || (v.done = []);
      d[+el.dataset.i] = !d[+el.dataset.i]; C.save(); el.classList.toggle('done', !!d[+el.dataset.i]);
    },
    'wod-clock': (el) => {
      const as = S().activeSession, plan = planCache.get(as.planId);
      const day = plan && (daysAt(plan, as.week).find((d) => d.id === as.dayId) || plan.days.find((d) => d.id === as.dayId));
      const b = day && day.blocks[+el.dataset.bk.slice(1)]; if (!b) return;
      const info = scoreInfo(b);
      if (as.clock && !confirm('Restart the clock?')) return;
      beep(false); stopTimer();
      as.clock = { bk: el.dataset.bk, start: Date.now(), every: info.every || null, rounds: info.rounds || null, minutes: info.minutes || null, cap: info.cap || null,
        mode: info.every ? 'every' : info.type === 'time' ? 'up' : 'down' };
      C.save(); runClock();
    },
    'wod-clock-stop': () => {
      const as = S().activeSession; const c = as && as.clock; if (!c) return;
      const t = Math.max(0, Math.round((Date.now() - c.start) / 1000 - 5));
      as.scores = as.scores || {}; const v = as.scores[c.bk] || (as.scores[c.bk] = {});
      v.mm = Math.floor(t / 60); v.ss = t % 60; v.capped = false; as.clock = null; C.save(); runClock(); C.render();
      C.toast(`Time: ${fmtSec(t)}`);
    },
    'wod-clock-cancel': () => { const as = S().activeSession; if (as && as.clock && !confirm('Stop the clock?')) return; if (as) { as.clock = null; C.save(); } runClock(); },
    'wod-clock-close': () => { clockBar().classList.remove('show', 'over'); },
    'session-finish': () => { if (confirm('Finish and save this workout?')) finishSession(); },
    'session-discard': () => { if (confirm('Discard this workout? Logged sets will be lost.')) { S().activeSession = null; stopTimer(); runClock(); C.save(); C.setTab('train'); } },
    'timer-add': () => { if (timer) timer.end += 15000; },
    'timer-stop': stopTimer,
    'log-cardio': (el) => {
      const st = S(), pr = progFor(el.dataset.plan) || progs()[0], plan = pr && planCache.get(pr.planId);
      const opts = (plan && plan.cardio && plan.cardio.options) || ['Incline Walking', 'StairMaster', 'Cycling', 'Running'];
      C.openModal(`<h2>Log cardio</h2>${C.field('Type', `<select name="type">${opts.map((o) => `<option>${esc(o)}</option>`).join('')}<option>Other</option></select>`)}
        <div class="fields-2">${C.field('Minutes', C.inNum('minutes', (plan && plan.cardio && plan.cardio.minutes[0]) || 30, 'min="1" required'))}${C.field('Date', `<input type="date" name="date" value="${C.todayISO()}" required>`)}</div>
        ${C.field('Notes', '<input type="text" name="notes" placeholder="Incline, ruck weight, distance…">')}`, (fd) => {
        st.workouts.push({ id: C.uid(), type: fd.get('type'), minutes: +fd.get('minutes') || null, date: fd.get('date'), notes: fd.get('notes').trim(), exercises: '', cardio: true, intensity: null });
        C.save(); C.toast('Cardio logged');
      });
    },
    'log-extra': (el) => {
      const st = S(), pr = progFor(el.dataset.plan) || progs()[0], plan = pr && planCache.get(pr.planId);
      const x = plan && (plan.extras || []).find((e) => e.id === el.dataset.id);
      if (!x) return;
      C.openModal(`<h2>Log ${esc(x.name)}</h2>
        <div class="fields-2">${C.field('Minutes', C.inNum('minutes', x.minutes || 30, 'min="1" required'))}${C.field('Date', `<input type="date" name="date" value="${C.todayISO()}" required>`)}</div>
        ${C.field('Notes', '<input type="text" name="notes" placeholder="How it went…">')}`, (fd) => {
        st.workouts.push({ id: C.uid(), type: x.name, minutes: +fd.get('minutes') || null, date: fd.get('date'), notes: fd.get('notes').trim(), exercises: '', extraId: x.id, cardio: !!x.cardio, intensity: null });
        C.save(); C.toast(`${x.name} logged`);
      });
    },
    'view-session': (el) => {
      const w = S().workouts.find((x) => x.id === el.dataset.id);
      if (!w) return;
      const groups = [];
      w.sets.forEach((s) => { let g = groups.find((x) => x.name === s.name); if (!g) groups.push(g = { name: s.name, sets: [] }); g.sets.push(s); });
      C.openModal(`<h2>${esc(w.type)}</h2><p class="sub" style="margin-top:0">${C.prettyDate(w.date, { weekday: 'long', month: 'short', day: 'numeric' })}${w.week ? ' · Week ' + w.week : ''} · ${w.minutes || '?'} min</p>
        ${(w.scores || []).length ? `<ul class="list">${w.scores.map((x) => `<li><div class="grow"><div class="title">${esc(x.name)}</div><div class="meta">${esc(SCORE_LABEL[x.type] || '')}</div></div><span class="num">${esc(x.text)}</span></li>`).join('')}</ul>` : ''}
        <ul class="list">${groups.map((g) => `<li><div class="grow"><div class="title">${esc(g.name)}</div><div class="meta">${g.sets.map((s) => (s.weight ? `${s.weight}×${s.reps ?? '–'}` : `${s.reps ?? '–'} reps`)).join(' · ')}</div></div></li>`).join('')}</ul>
        ${w.notes ? `<p>${esc(w.notes)}</p>` : ''}
        ${C.ui.viewAs ? '' : `<div class="row"><button class="btn small primary" data-modal-action="edit-session" data-id="${w.id}">✎ Edit / move day</button>
        <button class="btn danger small" data-modal-action="del-session" data-id="${w.id}">Delete workout</button></div>`}`, null, { hideSave: true });
    },
  };
  // ---------- edit a logged workout: date (move it), time, minutes, every set, scores, notes ----------
  function editSession(w) {
    const groups = [];
    (w.sets || []).forEach((s) => { let g = groups.find((x) => x.exId === s.exId && x.name === s.name); if (!g) groups.push(g = { exId: s.exId, name: s.name, sets: [] }); g.sets.push(s); });
    const u = unit() || 'lb';
    const inp = (n, v, ph) => `<input type="number" inputmode="decimal" step="any" min="0" name="${n}" value="${v == null ? '' : esc(v)}" placeholder="${ph}">`;
    const setRows = (g, gi) => g.sets.concat([{}]).map((x, j) => `<div class="edit-set"><span class="sub">${j < g.sets.length ? 'Set ' + (j + 1) : '+ set'}</span>${inp(`w_${gi}_${j}`, x.weight, u)}<span class="sub">×</span>${inp(`r_${gi}_${j}`, x.reps, 'reps')}</div>`).join('');
    C.openModal(`<h2>Edit workout</h2><p class="sub" style="margin-top:0">${esc(w.type)}</p>
      <div class="fields-3">${C.field('Date', `<input type="date" name="date" value="${esc(w.date)}" max="${C.todayISO()}" required>`)}${C.field('Time', `<input type="time" name="time" value="${esc(w.time || '')}">`)}${C.field('Minutes', C.inNum('minutes', w.minutes, 'min="1" max="600"'))}</div>
      ${(w.scores || []).map((x, i) => C.field(`${esc(x.name)} (${esc(SCORE_LABEL[x.type] || 'score')})`, `<input type="text" name="sc_${i}" value="${esc(x.text)}">`)).join('')}
      ${groups.map((g, gi) => `<div class="edit-ex"><div class="title" style="font-weight:700">${esc(g.name)}</div>${setRows(g, gi)}</div>`).join('')}
      <div class="edit-ex"><div class="title" style="font-weight:700">Add an exercise</div>${[0, 1].map((k) => `<div class="edit-set"><input type="text" name="nx_${k}" placeholder="Exercise" style="flex:2">${inp(`nw_${k}`, null, u)}<span class="sub">×</span>${inp(`nr_${k}`, null, 'reps')}</div>`).join('')}</div>
      <p class="hint">Clear a set's weight and reps to remove it. Change the date to move this workout to another day.</p>
      ${C.field('Notes', `<textarea name="notes" rows="2">${esc(w.notes || '')}</textarea>`)}`, (fd) => {
      const n = (k) => { const v = fd.get(k); if (v == null || String(v).trim() === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
      const sets = [];
      groups.forEach((g, gi) => { let k = 0; for (let j = 0; j <= g.sets.length; j++) { const wt = n(`w_${gi}_${j}`), r = n(`r_${gi}_${j}`); if (wt == null && r == null) continue; sets.push({ exId: g.exId, name: g.name, set: ++k, weight: wt, reps: r }); } });
      [0, 1].forEach((k) => { const nm = String(fd.get(`nx_${k}`) || '').trim(); const wt = n(`nw_${k}`), r = n(`nr_${k}`); if (!nm || (wt == null && r == null)) return;
        const prev = sets.filter((x) => x.name.toLowerCase() === nm.toLowerCase());
        sets.push({ exId: prev[0] ? prev[0].exId : 'x-' + nm.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: prev[0] ? prev[0].name : nm, set: prev.length + 1, weight: wt, reps: r }); });
      const date = fd.get('date') || w.date;
      const rec = Object.assign({}, w, { date: date > C.todayISO() ? C.todayISO() : date, time: fd.get('time') || w.time || null, minutes: n('minutes') || w.minutes, notes: String(fd.get('notes') || '').trim(), sets });
      if (w.scores) rec.scores = w.scores.map((x, i) => { const t = String(fd.get(`sc_${i}`) || '').trim(); return t ? Object.assign({}, x, { text: t }) : null; }).filter(Boolean);
      if (rec.date !== w.date && rec.planId) { const pr = progFor(rec.planId), pl = planCache.get(rec.planId); if (pr && pl) rec.week = programWeek(pr, pl, rec.date).week; }
      const st = S(); st.workouts = st.workouts.map((x) => (x.id === w.id ? rec : x));
      C.save(); C.toast(rec.date !== w.date ? `Moved to ${C.prettyDate(rec.date, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Workout updated');
    }, { saveLabel: 'Save changes' });
  }
  const modalActions = {
    'edit-session': (b) => { const w = S().workouts.find((x) => x.id === b.dataset.id); if (!w) return; C.closeModal(); setTimeout(() => editSession(w), 0); },
    'del-session': (b) => {
      if (!confirm('Delete this workout?')) return;
      const st = S(); st.workouts = st.workouts.filter((x) => x.id !== b.dataset.id); C.save(); C.closeModal(); C.render();
    },
  };

  function onInput(e) {
    const t = e.target;
    const as = S().activeSession;
    if (!as) return;
    if (t.dataset.wk) { wodInput(t, as); return; }
    if (t.dataset.sx) {
      const v = t.value === '' ? null : Number(t.value);
      setVal(t.dataset.sx, +t.dataset.si, t.dataset.sf, Number.isFinite(v) ? v : null);
      C.save();
    } else if ('sessionNotes' in t.dataset) { as.notes = t.value; C.save(); }
    else if ('sessionDate' in t.dataset && /^\d{4}-\d\d-\d\d$/.test(t.value)) { as.date = t.value > C.todayISO() ? C.todayISO() : t.value; C.save(); }
  }

  // Summary line for history lists
  function summary(w) {
    const byEx = new Map();
    w.sets.forEach((s) => { const k = s.name; const g = byEx.get(k) || []; g.push(s); byEx.set(k, g); });
    const top = w.sets.filter((s) => s.weight).sort((a, b) => b.weight - a.weight)[0];
    const sc = (w.scores || []).map((x) => `${esc(x.name.split(' · ')[0])}: ${esc(x.text)}`).join(' · ');
    if (!w.sets.length && sc) return sc;
    return `${byEx.size} exercises · ${w.sets.length} sets${top ? ` · top ${esc(top.name)} ${top.weight}×${top.reps ?? '–'}` : ''}${sc ? ' · ' + sc : ''}`;
  }

  window.Training = {
    init(ctx) {
      C = ctx;
      Object.assign(ctx.actions, actions);
      Object.assign(ctx.modalActions, modalActions);
      ctx.views.plans = viewPlans;
      ctx.views.guide = viewGuide;
      ctx.views.session = viewSession;
      Object.assign(ctx.TITLES, { plans: 'Plans', guide: 'Program guide', session: 'Workout' });
      Object.assign(ctx.PARENT, { plans: 'train', guide: 'train', session: 'train' });
      document.addEventListener('input', onInput);
    },
    afterRender(tab) { if (tab === 'session') sessionClock(); if (!wodIv && S().activeSession && S().activeSession.clock) runClock(); },
    scoreInfo,
    preload() { progs().forEach((p) => loadPlan(p.planId).then(() => C.render()).catch(() => {})); },
    resetPlans() { planIndex = null; indexPromise = null; planCache.clear(); failedPlans.clear(); progs().forEach((p) => loadPlan(p.planId).then(() => C.softRender ? C.softRender() : C.render()).catch(() => {})); },
    progs, planNow: (id) => planNow(id), loadPlan, plannedOn, startOneOff, programWeek, atWeek,
    trainCard, todayCard, summary, isCardio, renderBody,
    cachePlan(id, data) { planCache.set(id, data); },
    editSession: (id) => { const w = S().workouts.find((x) => x.id === id); if (w) editSession(w); },
    withState(st, fn) { const prev = override; override = st; try { return fn(); } finally { override = prev; } },
    daysAt, MAX_KEYS, pctText,
  };
})();
