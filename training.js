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
        if (!vis.length && isCoach) return staticIndex(); // coach hasn't added plans yet
        return vis.map((r) => metaOf(r.data));
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
  function planNow(id) {
    if (!id) return null;
    if (planCache.has(id)) return planCache.get(id);
    loadPlan(id).then(() => C.render()).catch(() => {});
    return undefined;
  }

  // ---------- helpers ----------
  const S = () => C.getState();
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
  const repRange = (reps) => { const m = String(reps).match(/\d+/g); return m ? { min: +m[0], max: +(m[1] || m[0]) } : null; };
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
      if (top) return `New block 💪 Start heavier than block 1: try ${top + bumpFor(ex)} ${u} (your best before the deload was ${top}).`;
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
    const sameWeight = weights.every((x) => x === top);
    if (rr && sameWeight && last.sets.length >= ex.sets && last.sets.every((s) => (s.reps || 0) >= rr.max)) {
      const bump = bumpFor(ex);
      return `✅ All sets hit ${rr.max} last time. Add weight: try ${top + bump} ${u} and restart at ${rr.min} reps.`;
    }
    if (rr) return `Stay at ${top} ${u}. Goal: more reps until every set reaches ${rr.max}.`;
    return '';
  }

  function sessionsThisProgramWeek(prog, wk) {
    return S().workouts.filter((w) => w.planId === prog.planId && w.date >= wk.weekStart && w.date <= wk.weekEnd);
  }
  function nextDay(plan, prog, wk) {
    const done = new Set(sessionsThisProgramWeek(prog, wk).map((w) => w.dayId));
    const core = plan.days.filter((d) => !d.optional);
    return core.find((d) => !done.has(d.id)) || plan.days.find((d) => d.optional && !done.has(d.id)) || null;
  }
  const CARDIO_RE = /stair|ruck|incline|hik|walk|run|cycl|bike|elliptical|row(ing|er)|swim|cardio|treadmill/i;
  const isCardio = (w) => w.cardio || (!w.sets && CARDIO_RE.test(w.type || ''));

  // ---------- Train tab: program card ----------
  function trainCard() {
    const st = S();
    const prog = st.program;
    const as = st.activeSession;
    let h = '';
    if (as) {
      h += `<div class="card" style="border-color:var(--accent)"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>Workout in progress</strong>
        <div class="sub">${esc(as.dayLabel)} · ${esc(as.dayName)} · started ${new Date(as.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div>
        <button class="btn primary" data-action="session-open">Resume</button></div></div>`;
    }
    if (!prog) {
      return h + `<div class="card"><div class="card-head"><h2>Your program</h2></div><p class="sub" style="margin-top:0">Pick a training plan from your coach. Every session is laid out set by set, with your last numbers and when to add weight.</p>
        <button class="btn primary block" data-action="plans-open">Choose a plan</button></div>`;
    }
    const plan = planNow(prog.planId);
    if (plan === undefined) return h + '<div class="card"><div class="empty">Loading your plan…</div></div>';
    if (!plan) return h;
    const wk = programWeek(prog, plan);
    const doneIds = new Set(sessionsThisProgramWeek(prog, wk).map((w) => w.dayId));
    const nd = nextDay(plan, prog, wk);
    const cardioDone = st.workouts.filter((w) => isCardio(w) && w.date >= wk.weekStart && w.date <= wk.weekEnd).length;
    h += `<div class="card"><div class="card-head"><h2>Your program</h2><button class="btn small" data-action="plan-guide" data-id="${esc(plan.id)}">Guide</button></div>
      <div style="font-weight:800;font-size:18px;line-height:1.2">${esc(plan.name)}</div><div class="sub">${esc(plan.phase || '')}</div>
      ${wk.before ? `<p class="sub">Starts ${C.prettyDate(prog.startDate)}.</p>` : wk.done ? `<p><strong>Program complete 🎉</strong> <span class="sub">Talk to your coach about the next phase.</span></p>` : `
      <div class="week-pill">Week ${wk.week} of ${plan.weeks}${wk.blocks > 1 ? ` · Block ${wk.block}` : ''}${wk.guide ? ` · ${esc(wk.guide.label)}` : ''}</div>
      ${wk.guide ? `<p class="sub" style="margin:6px 0 0"><strong>${esc(wk.guide.effort)}</strong>. ${esc(wk.guide.note || '')}</p>` : ''}`}
      <div class="days">${plan.days.map((d) => `<button class="day ${doneIds.has(d.id) ? 'done' : ''} ${nd && nd.id === d.id ? 'next' : ''}" data-action="session-start" data-day="${d.id}">
        <span class="day-label">${esc(d.label)}${d.optional ? ' · optional' : ''}</span><span class="day-name">${esc(d.name)}</span><span class="day-state">${doneIds.has(d.id) ? '✓ Done' : nd && nd.id === d.id ? 'Up next' : ''}</span></button>`).join('')}</div>
      ${!as && nd && !wk.done ? `<button class="btn primary block" data-action="session-start" data-day="${nd.id}" style="margin-top:10px">Start ${esc(nd.label)}: ${esc(nd.name)}</button>` : ''}
      ${!nd && !wk.done && !wk.before ? '<p class="sub">All sessions done this week. Recover well 💪</p>' : ''}
      ${plan.cardio ? `<div class="row" style="justify-content:space-between;margin-top:12px;flex-wrap:nowrap"><div><strong>Cardio</strong> <span class="sub">${cardioDone} / ${plan.cardio.perWeek.join('–')} this week · ${plan.cardio.minutes.join('–')} min</span></div>
        <button class="btn small" data-action="log-cardio" style="flex:none">+ Cardio</button></div>
        <div class="progress"><i style="width:${Math.min(100, (cardioDone / plan.cardio.perWeek[0]) * 100)}%"></i></div>` : ''}
    </div>`;
    return h;
  }

  // Today screen card
  function todayCard() {
    const st = S();
    if (st.activeSession) return `<div class="card" style="border-color:var(--accent)"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>🏋️ Workout in progress</strong><div class="sub">${esc(st.activeSession.dayName)}</div></div><button class="btn primary" data-action="session-open">Resume</button></div></div>`;
    const prog = st.program;
    if (!prog) return '';
    const plan = planNow(prog.planId);
    if (!plan) return '';
    const wk = programWeek(prog, plan);
    if (wk.before || wk.done) return '';
    const nd = nextDay(plan, prog, wk);
    const doneToday = st.workouts.some((w) => w.planId === prog.planId && w.date === C.todayISO() && w.sets);
    return `<div class="card"><div class="card-head"><h2>Training · Week ${wk.week}</h2><span class="sub">${wk.guide ? esc(wk.guide.effort) : ''}</span></div>
      ${doneToday ? '<p style="margin:0 0 8px">✓ Trained today. Nice work.</p>' : ''}
      ${nd ? `<div class="row" style="flex-wrap:nowrap"><div style="flex:1"><div class="sub">${doneToday ? 'Next' : 'Up next'}</div><strong>${esc(nd.label)}: ${esc(nd.name)}</strong></div>
        <button class="btn ${doneToday ? '' : 'primary'}" data-action="session-start" data-day="${nd.id}">Start</button></div>` : '<p class="sub" style="margin:0">All sessions done this week 💪</p>'}</div>`;
  }

  // ---------- plan library ----------
  function viewPlans() {
    if (!planIndex) { loadIndex().then(() => C.render()).catch((e) => C.toast('Couldn\'t load plans: ' + e.message)); return '<div class="empty">Loading plans…</div>'; }
    const cur = S().program;
    let h = '<p class="sub" style="margin-top:0">Choose the program you want to run. You can switch later; your history stays.</p>';
    if (!planIndex.length) h += '<div class="card"><div class="empty">Your coach hasn\'t made any plans available to you yet.</div></div>';
    h += planIndex.map((p) => `<div class="card"><div style="font-weight:800;font-size:18px">${esc(p.name)}</div><div class="sub">${esc(p.phase || '')}</div>
      <p class="sub" style="margin:8px 0">${esc(p.summary || '')}</p>
      <div style="margin-bottom:10px">${[`${p.weeks} weeks`, p.daysPerWeek ? p.daysPerWeek + ' days/week' : '', ...(p.tags || [])].filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      <div class="row"><button class="btn" data-action="plan-guide" data-id="${esc(p.id)}">View plan</button>
      ${cur && cur.planId === p.id ? '<button class="btn" disabled>✓ Current plan</button>' : `<button class="btn primary" data-action="plan-choose" data-id="${esc(p.id)}">Start this plan</button>`}</div></div>`).join('');
    if (cur) h += '<button class="btn danger block" data-action="plan-leave">Stop following a plan</button>';
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
  const prescription = (ex) => `${ex.sets} × ${esc(ex.reps)}${ex.each ? ' each side' : ''}`;

  function viewGuide() {
    const id = C.ui.guidePlan;
    const plan = planNow(id);
    if (!plan) return '<div class="empty">Loading plan…</div>';
    const cur = S().program;
    let h = `<div class="card"><div style="font-weight:800;font-size:20px;line-height:1.2">${esc(plan.name)}</div><div class="sub">${esc(plan.phase || '')}${plan.subtitle ? ' · ' + esc(plan.subtitle) : ''}</div>
      ${plan.coach ? `<div class="sub" style="margin-top:4px">Coach: ${esc(plan.coach)}</div>` : ''}<p>${esc(plan.summary || '')}</p>
      ${cur && cur.planId === plan.id ? '' : `<button class="btn primary block" data-action="plan-choose" data-id="${esc(plan.id)}">Start this plan</button>`}</div>`;
    if (plan.weekGuide) h += `<div class="card"><div class="card-head"><h2>Week by week</h2></div><table class="tbl"><tbody>${plan.weekGuide.map((g) => `<tr><td style="white-space:nowrap"><strong>Wk ${g.weeks.length > 1 ? g.weeks[0] + '–' + g.weeks[g.weeks.length - 1] : g.weeks[0]}</strong></td><td><strong>${esc(g.label)}</strong><br><span class="sub">${esc(g.effort)}</span></td></tr>`).join('')}</tbody></table>
      ${plan.blocksNote ? `<p class="sub">${esc(plan.blocksNote)}</p>` : plan.cycleWeeks && plan.weeks > plan.cycleWeeks ? `<p class="sub">The ${plan.cycleWeeks}-week block repeats through week ${plan.weeks}.</p>` : ''}
      ${plan.progression && plan.progression.loadJumps ? `<p class="sub">Load jumps: lower body ${esc(plan.progression.loadJumps.lower)}, upper body ${esc(plan.progression.loadJumps.upper)}.</p>` : ''}</div>`;
    h += plan.days.map((d) => `<div class="card"><div class="card-head"><h2>${esc(d.label)}${d.optional ? ' · optional' : ''}</h2></div><div style="font-weight:800;font-size:18px">${esc(d.name)}</div>
      ${d.focus ? `<p class="sub"><em>${esc(d.focus)}</em></p>` : ''}
      ${d.warmup && plan.warmups && plan.warmups[d.warmup] ? `<p class="sub">Starts with the ${esc(plan.warmups[d.warmup].name)}.</p>` : ''}
      ${d.blocks.map((b) => `${b.type === 'superset' || b.name ? `<div class="res-head">${esc(b.name || 'Superset')}</div>` : ''}<ul class="list">${b.exercises.map((ex, i) => `<li><div class="grow"><div class="title">${b.type === 'superset' ? String.fromCharCode(65 + i) + '. ' : ''}${esc(ex.name)}</div>
        <div class="meta">${[ex.tempo ? 'Tempo ' + ex.tempo : '', ex.rest ? 'Rest ' + ex.rest : '', ex.effort || ''].filter(Boolean).join(' · ')}</div></div><span class="num">${prescription(ex)}</span></li>`).join('')}</ul>`).join('')}
      ${d.suggestions ? `<div>${d.suggestions.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}</div>`).join('');
    h += (plan.sections || []).map((s) => `<details class="card guide-sec"><summary><strong>${esc(s.title)}</strong></summary><div class="guide-body">${renderBody(s.body)}</div></details>`).join('');
    return h;
  }

  // ---------- session logger ----------
  function startSession(dayId) {
    const st = S();
    const prog = st.program, plan = planCache.get(prog && prog.planId);
    if (!plan) { C.toast('Plan still loading, try again'); return; }
    if (st.activeSession) {
      if (st.activeSession.dayId === dayId) { openSession(); return; }
      if (!confirm('You have a workout in progress. Discard it and start this one?')) return;
    }
    const day = plan.days.find((d) => d.id === dayId);
    const wk = programWeek(prog, plan);
    st.activeSession = { id: C.uid(), planId: plan.id, dayId, dayLabel: day.label, dayName: day.name, week: wk.week, date: C.todayISO(),
      startedAt: Date.now(), sets: {}, extraSets: {}, primer: {}, extra: [], notes: '', deload: !!(wk.guide && wk.guide.deload) };
    C.save();
    openSession();
  }
  function openSession() { C.setTab('session'); }

  function setRows(ex, as, last) {
    const n = ex.sets + (as.extraSets[ex.id] || 0);
    const u = unit();
    const rr = repRange(ex.reps);
    let h = `<div class="sets"><div class="set-head"><span>Set</span><span>${ex.bodyweight ? '+' + u : u}</span><span>Reps</span><span></span></div>`;
    for (let i = 0; i < n; i++) {
      const v = (as.sets[ex.id] || [])[i] || {};
      const prev = last && last.sets[i];
      const phW = prev && prev.weight != null ? prev.weight : '';
      const phR = prev && prev.reps != null ? prev.reps : rr ? (rr.min === rr.max ? rr.min : `${rr.min}-${rr.max}`) : '';
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
    const hn = hint(ex, last, wk2);
    const lastTxt = last ? last.sets.map((s) => (s.weight ? `${s.weight}×${s.reps ?? '–'}` : `${s.reps ?? '–'}`)).join(', ') : '';
    return `<div class="ex-card" id="ex-${ex.id}"><div class="ex-title">${letter ? `<span class="ex-letter">${letter}</span>` : ''}${esc(ex.name)}</div>
      <div class="ex-chips"><span class="chip strong">${prescription(ex)}</span>${ex.tempo ? `<span class="chip">Tempo ${esc(ex.tempo)}</span>` : ''}${ex.rest ? `<span class="chip">Rest ${esc(ex.rest)}</span>` : ''}${ex.effort ? `<span class="chip">${esc(ex.effort)}</span>` : ''}
        ${ex.role === 'main' && wk.guide ? `<span class="chip">${esc(wk.guide.effort.replace('Main lifts ', ''))}</span>` : ''}</div>
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
    const day = plan.days.find((d) => d.id === as.dayId);
    const wk = programWeek(st.program && st.program.planId === plan.id ? st.program : { startDate: as.date }, plan, as.date);
    let h = `<div class="card session-head"><div class="sub">${esc(day.label)} · Week ${wk.week}${wk.guide ? ' · ' + esc(wk.guide.label) : ''}</div>
      <div style="font-weight:800;font-size:22px;line-height:1.15">${esc(day.name)}</div>
      ${day.focus ? `<p class="focus">“${esc(day.focus)}”</p>` : ''}
      ${wk.guide ? `<p class="sub" style="margin:4px 0 0"><strong>${esc(wk.guide.effort)}</strong>${wk.guide.deload ? ' — deload week' : ''}</p>` : ''}
      <div class="sub" id="session-clock" style="margin-top:6px"></div></div>`;
    const wu = day.warmup && plan.warmups && plan.warmups[day.warmup];
    if (wu) {
      const doneN = wu.items.filter((_, i) => as.primer[i]).length;
      h += `<details class="card" ${doneN === wu.items.length ? '' : 'open'}><summary><strong>${esc(wu.name)}</strong> <span class="sub">${doneN}/${wu.items.length}</span></summary>
        ${wu.note ? `<p class="sub">${esc(wu.note)}</p>` : ''}
        ${wu.items.map((it, i) => `<button class="habit ${as.primer[i] ? 'done' : ''}" data-action="primer-toggle" data-i="${i}"><span class="box"></span><span>${esc(it.name)} <span class="sub">${esc(it.dose)}</span></span></button>`).join('')}</details>`;
    }
    day.blocks.forEach((b) => {
      if (b.type === 'superset') {
        h += `<div class="card block-card"><div class="card-head" style="margin-bottom:4px"><h2>${esc(b.name || 'Superset')}</h2></div>${b.note ? `<p class="sub" style="margin-top:0">${esc(b.note)}</p>` : ''}
          ${b.exercises.map((ex, i) => exerciseCard(withRegion(ex, day), as, wk, String.fromCharCode(65 + i))).join('')}</div>`;
      } else {
        h += `<div class="card block-card">${b.name ? `<div class="card-head" style="margin-bottom:4px"><h2>${esc(b.name)}</h2></div>` : ''}${b.exercises.map((ex) => exerciseCard(withRegion(ex, day), as, wk)).join('')}</div>`;
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
    const day = plan && plan.days.find((d) => d.id === as.dayId);
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
    if (!sets.length && !confirm('No sets logged. Save this workout anyway?')) return;
    const minutes = Math.max(1, Math.min(240, Math.round((Date.now() - as.startedAt) / 60000)));
    const before = C.liftBests();
    const rec = { id: C.uid(), date: as.date, time: new Date(as.startedAt).toTimeString().slice(0, 5), type: `${as.dayLabel} · ${as.dayName}`, minutes,
      planId: as.planId, dayId: as.dayId, week: as.week, deload: !!as.deload, sets, notes: as.notes.trim(), exercises: '', intensity: null };
    st.workouts.push(rec);
    st.activeSession = null;
    stopTimer();
    C.save();
    const prs = [];
    const seen = new Set();
    sets.filter((s) => s.weight && s.reps).sort((a, b) => b.weight - a.weight).forEach((s) => {
      const k = exKey(s.name), b = before.get(k);
      if (b && s.weight > b.weight && !seen.has(k)) { seen.add(k); prs.push(`${s.name} ${s.weight}`); }
    });
    C.toast(prs.length ? `New PR: ${prs.slice(0, 2).join(', ')} 🏆` : `Workout saved · ${sets.length} sets · ${minutes} min 💪`);
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
    'plan-guide': (el) => { C.ui.guidePlan = el.dataset.id; C.setTab('guide'); },
    'plan-choose': async (el) => {
      const plan = await loadPlan(el.dataset.id).catch(() => null);
      if (!plan) { C.toast('Couldn\'t load that plan'); return; }
      const t = C.todayISO();
      C.openModal(`<h2>Start ${esc(plan.name)}</h2><p class="sub" style="margin-top:0">${esc(plan.phase || '')} · ${plan.weeks} weeks</p>
        ${C.field('Week 1 starts', `<select name="start"><option value="${t}">Today, ${C.prettyDate(t)}</option><option value="${C.weekStart(t)}">This Monday, ${C.prettyDate(C.weekStart(t))}</option><option value="${C.addDays(C.weekStart(t), 7)}">Next Monday, ${C.prettyDate(C.addDays(C.weekStart(t), 7))}</option></select>`)}
        <p class="hint">Week numbers, effort targets and the deload week are counted from this date.</p>`, (fd) => {
        const st = S();
        if (st.program) (st.programHistory || (st.programHistory = [])).push({ ...st.program, endDate: C.todayISO() });
        st.program = { planId: plan.id, startDate: fd.get('start') };
        C.save(); C.toast(`Started ${plan.name}`);
        setTimeout(() => C.setTab('train'), 0);
      }, { saveLabel: 'Start plan' });
    },
    'plan-leave': () => {
      if (!confirm('Stop following this plan? Your logged workouts are kept.')) return;
      const st = S();
      (st.programHistory || (st.programHistory = [])).push({ ...st.program, endDate: C.todayISO() });
      st.program = null; C.save(); C.setTab('train');
    },
    'session-start': (el) => {
      const st = S();
      if (!st.program) return;
      loadPlan(st.program.planId).then(() => startSession(el.dataset.day)).catch(() => C.toast('Couldn\'t load the plan'));
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
    'session-finish': () => { if (confirm('Finish and save this workout?')) finishSession(); },
    'session-discard': () => { if (confirm('Discard this workout? Logged sets will be lost.')) { S().activeSession = null; stopTimer(); C.save(); C.setTab('train'); } },
    'timer-add': () => { if (timer) timer.end += 15000; },
    'timer-stop': stopTimer,
    'log-cardio': () => {
      const st = S(), plan = st.program && planCache.get(st.program.planId);
      const opts = (plan && plan.cardio && plan.cardio.options) || ['Incline Walking', 'StairMaster', 'Cycling', 'Running'];
      C.openModal(`<h2>Log cardio</h2>${C.field('Type', `<select name="type">${opts.map((o) => `<option>${esc(o)}</option>`).join('')}<option>Other</option></select>`)}
        <div class="fields-2">${C.field('Minutes', C.inNum('minutes', (plan && plan.cardio && plan.cardio.minutes[0]) || 30, 'min="1" required'))}${C.field('Date', `<input type="date" name="date" value="${C.todayISO()}" required>`)}</div>
        ${C.field('Notes', '<input type="text" name="notes" placeholder="Incline, ruck weight, distance…">')}`, (fd) => {
        st.workouts.push({ id: C.uid(), type: fd.get('type'), minutes: +fd.get('minutes') || null, date: fd.get('date'), notes: fd.get('notes').trim(), exercises: '', cardio: true, intensity: null });
        C.save(); C.toast('Cardio logged');
      });
    },
    'view-session': (el) => {
      const w = S().workouts.find((x) => x.id === el.dataset.id);
      if (!w) return;
      const groups = [];
      w.sets.forEach((s) => { let g = groups.find((x) => x.name === s.name); if (!g) groups.push(g = { name: s.name, sets: [] }); g.sets.push(s); });
      C.openModal(`<h2>${esc(w.type)}</h2><p class="sub" style="margin-top:0">${C.prettyDate(w.date, { weekday: 'long', month: 'short', day: 'numeric' })}${w.week ? ' · Week ' + w.week : ''} · ${w.minutes || '?'} min</p>
        <ul class="list">${groups.map((g) => `<li><div class="grow"><div class="title">${esc(g.name)}</div><div class="meta">${g.sets.map((s) => (s.weight ? `${s.weight}×${s.reps ?? '–'}` : `${s.reps ?? '–'} reps`)).join(' · ')}</div></div></li>`).join('')}</ul>
        ${w.notes ? `<p>${esc(w.notes)}</p>` : ''}
        <button class="btn danger small" data-modal-action="del-session" data-id="${w.id}">Delete workout</button>`, null, { hideSave: true });
    },
  };
  const modalActions = {
    'del-session': (b) => {
      if (!confirm('Delete this workout?')) return;
      const st = S(); st.workouts = st.workouts.filter((x) => x.id !== b.dataset.id); C.save(); C.closeModal(); C.render();
    },
  };

  function onInput(e) {
    const t = e.target;
    const as = S().activeSession;
    if (!as) return;
    if (t.dataset.sx) {
      const v = t.value === '' ? null : Number(t.value);
      setVal(t.dataset.sx, +t.dataset.si, t.dataset.sf, Number.isFinite(v) ? v : null);
      C.save();
    } else if ('sessionNotes' in t.dataset) { as.notes = t.value; C.save(); }
  }

  // Summary line for history lists
  function summary(w) {
    const byEx = new Map();
    w.sets.forEach((s) => { const k = s.name; const g = byEx.get(k) || []; g.push(s); byEx.set(k, g); });
    const top = w.sets.filter((s) => s.weight).sort((a, b) => b.weight - a.weight)[0];
    return `${byEx.size} exercises · ${w.sets.length} sets${top ? ` · top ${esc(top.name)} ${top.weight}×${top.reps ?? '–'}` : ''}`;
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
    afterRender(tab) { if (tab === 'session') sessionClock(); },
    preload() { const p = S().program; if (p) loadPlan(p.planId).then(() => C.render()).catch(() => {}); },
    resetPlans() { planIndex = null; indexPromise = null; planCache.clear(); const p = S().program; if (p) loadPlan(p.planId).then(() => C.softRender ? C.softRender() : C.render()).catch(() => {}); },
    trainCard, todayCard, summary, isCardio,
  };
})();
