/* Gritty Fit — single-user, on-device fitness tracker. No accounts, no server. */
(function () {
  'use strict';

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => isoOf(new Date());
  const parseISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
  const weekStart = (iso) => { const d = parseISO(iso); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return isoOf(d); };
  const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const num = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const round1 = (n) => Math.round(n * 10) / 10;
  const fmt = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
  const prettyDate = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => parseISO(iso).toLocaleDateString(undefined, opts);
  const relDay = (iso) => { const diff = daysBetween(iso, todayISO()); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : prettyDate(iso); };
  const byDateDesc = (a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''));

  // ---------- state ----------
  const DEFAULT_STATE = () => ({
    version: 1,
    settings: { name: '', units: 'lb', calorieTarget: 2200, proteinTarget: 150, workoutsPerWeek: 4, goalWeight: null, startWeight: null, sex: null, age: null, heightCm: null, lastBackup: null },
    food: [], workouts: [], body: [], journal: [], goals: [],
    habits: [
      { id: uid(), name: 'Hit my calorie target', active: true },
      { id: uid(), name: 'Drink 100 oz water', active: true },
      { id: uid(), name: '10,000 steps', active: true },
      { id: uid(), name: '7+ hours sleep', active: true },
    ],
    habitLog: {},
    health: {},
  });
  let S = null;
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => DB.setState(S).catch((e) => toast('Save failed: ' + e.message)), 150);
  }

  const ui = { tab: 'today', foodDate: todayISO(), bodySeg: 'weigh', goalSeg: 'journal', reviewWeek: null, compare: [], photoUrls: new Map() };

  const wUnit = () => S.settings.units;
  const lUnit = () => (S.settings.units === 'kg' ? 'cm' : 'in');

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- modal ----------
  const modal = $('#modal');
  const modalForm = $('#modal-form');
  let modalHandler = null;
  function openModal(html, onSave, { saveLabel = 'Save', hideSave = false } = {}) {
    modalForm.innerHTML = html + `<div class="modal-actions">
      <button class="btn" value="cancel" formnovalidate>${hideSave ? 'Close' : 'Cancel'}</button>
      ${hideSave ? '' : `<button class="btn primary" value="save">${saveLabel}</button>`}</div>`;
    modalHandler = onSave;
    modal.showModal();
    const first = modalForm.querySelector('[autofocus]');
    if (first) setTimeout(() => first.focus(), 50);
  }
  modalForm.addEventListener('submit', async (e) => {
    const action = e.submitter && e.submitter.value;
    if (action !== 'save') return; // dialog closes itself
    e.preventDefault();
    const ok = modalHandler ? await modalHandler(new FormData(modalForm), modalForm) : true;
    if (ok !== false) { modal.close(); render(); }
  });
  modalForm.addEventListener('click', (e) => {
    const b = e.target.closest('[data-modal-action]');
    if (b && modalActions[b.dataset.modalAction]) { e.preventDefault(); modalActions[b.dataset.modalAction](b); }
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
  modal.addEventListener('close', () => window.FoodLookup && FoodLookup.stopScanner());
  const modalActions = {};

  const field = (label, input, hint = '') => `<label class="field"><span>${label}</span>${input}</label>${hint ? `<p class="hint">${hint}</p>` : ''}`;
  const inNum = (name, val, attrs = '') => `<input type="number" inputmode="decimal" step="any" name="${name}" value="${val ?? ''}" ${attrs}>`;
  const inText = (name, val, attrs = '') => `<input type="text" name="${name}" value="${esc(val)}" ${attrs}>`;
  const inDate = (name, val) => `<input type="date" name="${name}" value="${val}" required>`;
  const scale = (name, val, labels = ['1', '2', '3', '4', '5']) => `<div class="scale">${labels.map((l, i) =>
    `<label><input type="radio" name="${name}" value="${i + 1}" ${val === i + 1 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;

  // ---------- derived data ----------
  const foodOn = (iso) => S.food.filter((f) => f.date === iso);
  const sumKcal = (list) => list.reduce((a, f) => a + (f.kcal || 0), 0);
  const sumProtein = (list) => list.reduce((a, f) => a + (f.protein || 0), 0);
  const sumMacro = (list, k) => list.reduce((a, f) => a + (f[k] || 0), 0);
  const bodySorted = () => [...S.body].sort((a, b) => a.date.localeCompare(b.date));
  const latestWith = (key) => { const b = bodySorted().filter((x) => x[key] != null); return b[b.length - 1] || null; };
  const activeHabits = () => S.habits.filter((h) => h.active);
  const habitDone = (iso, id) => (S.habitLog[iso] || []).includes(id);

  function dayHasActivity(iso) {
    return (S.habitLog[iso] || []).length > 0 || S.food.some((f) => f.date === iso) || S.workouts.some((w) => w.date === iso)
      || S.body.some((b) => b.date === iso) || S.journal.some((j) => j.date === iso);
  }
  function streak(test) {
    let d = todayISO();
    if (!test(d)) d = addDays(d, -1); // today isn't over yet
    let n = 0;
    while (test(d) && n < 3650) { n++; d = addDays(d, -1); }
    return n;
  }
  const workoutsInWeek = (ws) => S.workouts.filter((w) => w.date >= ws && w.date <= addDays(ws, 6));

  // Parse strength lines like "Squat 5x5 @ 225", "Bench 3x8 at 165", "Deadlift 315x3", "OHP: 95 x 8"
  const LIFT_A = /^(.+?)[\s:\u2013-]+(\d+)\s*[x\u00d7]\s*(\d+)\s*(?:@|at)\s*(\d+(?:\.\d+)?)/i;
  const LIFT_B = /^(.+?)[\s:\u2013-]+(\d+(?:\.\d+)?)\s*(?:lbs?|kg)?\s*[x\u00d7]\s*(\d+)\b/i;
  function parseLifts(text) {
    const out = [];
    (text || '').split('\n').forEach((raw) => {
      const line = raw.trim().replace(/^[-*\u2022]\s*/, '');
      let m = line.match(LIFT_A), name, reps, weight;
      if (m) { name = m[1]; reps = +m[3]; weight = +m[4]; }
      else if ((m = line.match(LIFT_B))) { name = m[1]; weight = +m[2]; reps = +m[3]; }
      else return;
      name = name.trim().replace(/[:\-\u2013]+$/, '').trim();
      if (!name || !weight || !reps || reps > 50) return;
      out.push({ name, key: name.toLowerCase().replace(/\s+/g, ' '), reps, weight, e1rm: round1(weight * (1 + reps / 30)) });
    });
    return out;
  }
  // Best set per lift across all workouts (optionally excluding one workout id)
  function liftBests(excludeId) {
    const best = new Map();
    S.workouts.forEach((w) => {
      if (w.id === excludeId) return;
      parseLifts(w.exercises).forEach((l) => {
        const b = best.get(l.key);
        if (!b) best.set(l.key, { name: l.name, key: l.key, weight: l.weight, reps: l.reps, e1rm: l.e1rm, date: w.date, last: w.date, sessions: 1 });
        else {
          b.sessions++; if (w.date > b.last) { b.last = w.date; b.name = l.name; }
          if (l.weight > b.weight || (l.weight === b.weight && l.reps > b.reps)) Object.assign(b, { weight: l.weight, reps: l.reps, date: w.date });
          if (l.e1rm > b.e1rm) b.e1rm = l.e1rm;
        }
      });
    });
    return best;
  }

  function weekStats(ws) {
    const st = S.settings, t = todayISO();
    const we = addDays(ws, 6);
    const elapsed = t < ws ? 0 : t > we ? 7 : daysBetween(ws, t) + 1;
    const days = [...Array(elapsed)].map((_, i) => addDays(ws, i));
    const kcalDays = days.map((d) => sumKcal(foodOn(d))).filter((k) => k > 0);
    const avgKcal = kcalDays.length ? Math.round(kcalDays.reduce((a, b) => a + b, 0) / kcalDays.length) : null;
    const onTarget = kcalDays.filter((k) => st.calorieTarget && k >= st.calorieTarget * 0.85 && k <= st.calorieTarget * 1.05).length;
    const protDays = days.map((d) => sumProtein(foodOn(d))).filter((_, i) => sumKcal(foodOn(days[i])) > 0);
    const avgProtein = protDays.length ? Math.round(protDays.reduce((a, b) => a + b, 0) / protDays.length) : null;
    const ws_ = workoutsInWeek(ws);
    const wDays = new Set(ws_.map((w) => w.date)).size;
    const minutes = ws_.reduce((a, w) => a + (w.minutes || 0), 0);
    const allBests = liftBests(); // PRs this week: all-time best set this week and beats everything before it
    const before = new Map();
    S.workouts.filter((w) => w.date < ws).forEach((w) => parseLifts(w.exercises).forEach((l) => { const b = before.get(l.key); if (!b || l.weight > b) before.set(l.key, l.weight); }));
    const prs = [];
    allBests.forEach((b) => { if (b.date >= ws && b.date <= we && before.has(b.key) && b.weight > before.get(b.key)) prs.push(b); });
    const bodyRows = bodySorted().filter((b) => b.weight != null);
    const endW = bodyRows.filter((b) => b.date <= we).pop();
    const startW = bodyRows.filter((b) => b.date < ws).pop();
    const weightChange = endW && startW && endW.date >= ws ? round1(endW.weight - startW.weight) : null;
    const habits = activeHabits();
    const habitRows = habits.map((h) => ({ name: h.name, done: days.filter((d) => habitDone(d, h.id)).length }));
    const habitPct = habits.length && elapsed ? habitRows.reduce((a, r) => a + r.done, 0) / (habits.length * elapsed) : null;
    const journal = S.journal.filter((j) => j.date >= ws && j.date <= we).sort((a, b) => a.date.localeCompare(b.date));
    const moods = journal.filter((j) => j.mood);
    const avgMood = moods.length ? round1(moods.reduce((a, j) => a + j.mood, 0) / moods.length) : null;
    const workoutTargetSoFar = Math.max(1, Math.round((st.workoutsPerWeek || 0) * (elapsed / 7))) || 1;
    const parts = [];
    if (elapsed) {
      parts.push(Math.min(1, kcalDays.length ? onTarget / elapsed : 0));
      if (st.workoutsPerWeek) parts.push(Math.min(1, wDays / (elapsed === 7 ? st.workoutsPerWeek : workoutTargetSoFar)));
      if (habitPct != null) parts.push(habitPct);
      parts.push(Math.min(1, journal.length / elapsed));
    }
    const score = parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : null;
    return { ws, we, elapsed, kcalDays: kcalDays.length, avgKcal, onTarget, avgProtein, wDays, minutes, workouts: ws_.length, prs, weightChange, endW, habitRows, habitPct, journal, avgMood, score };
  }

  // ---------- views ----------
  const views = {};

  views.today = () => {
    const t = todayISO();
    const st = S.settings;
    const eaten = sumKcal(foodOn(t)), protein = sumProtein(foodOn(t));
    const ws = weekStart(t);
    const weekW = workoutsInWeek(ws);
    const wDays = new Set(weekW.map((w) => w.date));
    const latest = latestWith('weight');
    const weights = bodySorted().filter((b) => b.weight != null).map((b) => ({ x: b.date, y: b.weight }));
    const monthAgo = weights.filter((p) => p.x <= addDays(t, -28)).pop() || weights[0];
    const change = latest && monthAgo && monthAgo.x !== latest.date ? round1(latest.weight - monthAgo.y) : null;
    const habits = activeHabits();
    const doneCount = habits.filter((h) => habitDone(t, h.id)).length;
    const journaled = S.journal.some((j) => j.date === t);
    const activeGoals = S.goals.filter((g) => !g.done);
    const strk = streak(dayHasActivity);
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    let h = `<p class="sub" style="margin:0 0 14px">${greet}${st.name ? ', ' + esc(st.name) : ''}. ${strk ? `<strong>${strk}-day</strong> logging streak — keep it alive.` : 'Log anything today to start a streak.'}</p>`;

    h += `<div class="quick-row"><button class="btn primary" data-action="add-food">+ Food</button><button class="btn primary" data-action="add-workout">+ Workout</button><button class="btn primary" data-action="add-body">+ Weight</button></div>`;
    const hd = S.health && (S.health[t] || S.health[addDays(t, -1)]);
    if (hd) {
      const isToday = !!S.health[t];
      const stat = (v, label) => (v != null ? `<div><div class="big" style="font-size:22px">${v}</div><div class="sub" style="font-size:12px">${label}</div></div>` : '');
      h += `<div class="card"><div class="card-head"><h2>⌚ Apple Health</h2><span class="sub">${isToday ? 'Today' : 'Yesterday'} · ${hd.at ? new Date(hd.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span></div>
        <div class="row" style="justify-content:space-between">${stat(hd.steps != null ? fmt(hd.steps, 0) : null, 'steps')}${stat(hd.active != null ? fmt(hd.active, 0) : null, 'active kcal')}${stat(hd.exerciseMin != null ? hd.exerciseMin : null, 'exercise min')}${stat(hd.sleepMin != null ? fmtSleep(hd.sleepMin) : null, 'sleep')}${stat(hd.rhr, 'resting HR')}</div>
        <button class="btn small block" data-action="health-import" style="margin-top:12px">Update from Apple Health</button></div>`;
    }
    const records = S.food.length + S.workouts.length + S.body.length + S.journal.length;
    const sinceBackup = st.lastBackup ? daysBetween(st.lastBackup.slice(0, 10), t) : null;
    if (records >= 15 && (sinceBackup == null || sinceBackup >= 14)) {
      h += `<div class="card" style="border-color:var(--accent)"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>Back up your data</strong>
        <div class="sub">${sinceBackup == null ? 'You haven\'t made a backup yet.' : `Last backup was ${sinceBackup} days ago.`} It only lives on this phone.</div></div>
        <button class="btn small primary" data-action="backup-now">Back up</button></div></div>`;
    }
    h += `<div class="card"><div class="card-head"><h2>Daily accountability</h2><span class="sub">${doneCount}/${habits.length}</span></div>`;
    h += habits.length ? habits.map((hb) => {
      const s = streak((d) => habitDone(d, hb.id));
      return `<button class="habit ${habitDone(t, hb.id) ? 'done' : ''}" data-action="toggle-habit" data-id="${hb.id}">
        <span class="box"></span><span>${esc(hb.name)}</span><span class="streak">${s ? '🔥 ' + s : ''}</span></button>`;
    }).join('') : `<div class="empty">No daily habits yet.</div>`;
    h += `<button class="btn small" data-action="goto" data-tab="journal" data-seg="habits">Edit habits</button></div>`;

    h += `<div class="grid-2">`;
    h += `<div class="card" data-action="goto" data-tab="food" style="cursor:pointer"><div class="card-head"><h2>Calories</h2></div>
      <div class="big">${fmt(eaten, 0)}<small> / ${fmt(st.calorieTarget, 0)}</small></div>
      <div class="progress ${eaten > st.calorieTarget ? 'over' : ''}"><i style="width:${Math.min(100, (eaten / (st.calorieTarget || 1)) * 100)}%"></i></div>
      <div class="sub">${eaten <= st.calorieTarget ? fmt(st.calorieTarget - eaten, 0) + ' left' : fmt(eaten - st.calorieTarget, 0) + ' over'} · ${fmt(protein, 0)}g protein</div></div>`;
    h += `<div class="card" data-action="goto" data-tab="train" style="cursor:pointer"><div class="card-head"><h2>Workouts</h2></div>
      <div class="big">${wDays.size}<small> / ${st.workoutsPerWeek} this week</small></div>
      <div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(ws, i); return `<div class="${wDays.has(d) ? 'on' : ''} ${d === t ? 'today' : ''}"><i></i>${'MTWTFSS'[i]}</div>`; }).join('')}</div></div>`;
    h += `</div>`;

    h += `<div class="card" data-action="goto" data-tab="body" style="cursor:pointer"><div class="card-head"><h2>Weight</h2><span class="sub">${latest ? relDay(latest.date) : ''}</span></div>`;
    if (latest) {
      const toGoal = st.goalWeight != null ? round1(latest.weight - st.goalWeight) : null;
      h += `<div class="row" style="justify-content:space-between;align-items:flex-end"><div><div class="big">${fmt(latest.weight)}<small> ${wUnit()}</small></div>
        <div class="sub">${change != null ? `<span class="${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${change > 0 ? '+' : ''}${change} ${wUnit()}</span> vs ${relDay(monthAgo.x)}` : 'First weigh-in logged'}
        ${toGoal != null ? ` · ${Math.abs(toGoal)} ${wUnit()} ${toGoal > 0 ? 'to goal' : toGoal < 0 ? 'past goal' : '— at goal!'}` : ''}</div></div>
        ${Charts.spark(weights.slice(-20))}</div>`;
      const lb = latestWith('bodyFat');
      if (lb) h += `<div class="sub" style="margin-top:6px">Body fat ${fmt(lb.bodyFat)}%${latestWith('muscle') ? ` · Muscle ${fmt(latestWith('muscle').muscle)} ${wUnit()}` : ''}</div>`;
    } else h += `<div class="empty">No weigh-ins yet.</div>`;
    h += `</div>`;

    const wk = weekStats(ws);
    if (wk.score != null) {
      h += `<div class="card" data-action="goto" data-tab="journal" data-seg="review" style="cursor:pointer"><div class="card-head"><h2>Week so far</h2><span class="sub">Review ›</span></div>
        <div class="row" style="flex-wrap:nowrap"><div class="big ${wk.score >= 80 ? 'good' : wk.score < 50 ? 'bad' : ''}">${wk.score}<small>%</small></div>
        <div class="sub" style="flex:1">Accountability score: calories on target, workouts, habits and journal for the days so far.</div></div></div>`;
    }
    h += `<div class="card"><div class="card-head"><h2>Goals</h2><button class="btn small" data-action="goto" data-tab="journal" data-seg="goals">All</button></div>`;
    h += activeGoals.length ? `<ul class="list">${activeGoals.slice(0, 4).map((g) => {
      const left = g.targetDate ? daysBetween(t, g.targetDate) : null;
      return `<li><div class="grow"><div class="title">${esc(g.title)}</div>${g.why ? `<div class="meta">${esc(g.why)}</div>` : ''}</div>
        ${left != null ? `<span class="num ${left < 0 ? 'bad' : ''}">${left < 0 ? Math.abs(left) + 'd late' : left + 'd left'}</span>` : ''}</li>`;
    }).join('')}</ul>` : `<div class="empty">Set a goal to hold yourself to.</div>`;
    h += `</div>`;

    h += `<div class="card"><div class="card-head"><h2>Journal</h2></div>
      ${journaled ? `<p class="sub" style="margin:0 0 10px">✓ Today's check-in is written.</p>` : `<p class="sub" style="margin:0 0 10px">How did today go? Two minutes, be honest.</p>`}
      <button class="btn ${journaled ? '' : 'primary'} block" data-action="journal-today">${journaled ? 'View / edit today' : 'Write today\'s check-in'}</button></div>`;

    return h;
  };

  const fmtSleep = (min) => `${Math.floor(min / 60)}h ${pad(Math.round(min % 60))}m`;
  const macroText = (f) => [f.protein ? 'P ' + fmt(f.protein, 0) : '', f.carbs ? 'C ' + fmt(f.carbs, 0) : '', f.fat ? 'F ' + fmt(f.fat, 0) : ''].filter(Boolean).join(' ');
  views.food = () => {
    const d = ui.foodDate, st = S.settings;
    const items = foodOn(d).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const eaten = sumKcal(items), protein = sumProtein(items);
    let h = `<div class="daynav"><button class="btn small" data-action="food-day" data-delta="-1">‹</button>
      <strong>${relDay(d)}</strong><button class="btn small" data-action="food-day" data-delta="1" ${d >= todayISO() ? 'disabled' : ''}>›</button></div>`;
    h += `<div class="card ring">${Charts.ring(eaten, st.calorieTarget)}<div><div class="big">${fmt(eaten, 0)}<small> kcal</small></div>
      <div class="sub">Target ${fmt(st.calorieTarget, 0)} · ${eaten <= st.calorieTarget ? fmt(st.calorieTarget - eaten, 0) + ' left' : `<span class="bad">${fmt(eaten - st.calorieTarget, 0)} over</span>`}</div>
      <div class="sub">Protein ${fmt(protein, 0)} / ${fmt(st.proteinTarget, 0)} g</div>
      ${sumMacro(items, 'carbs') || sumMacro(items, 'fat') ? `<div class="sub">Carbs ${fmt(sumMacro(items, 'carbs'), 0)} g · Fat ${fmt(sumMacro(items, 'fat'), 0)} g</div>` : ''}
      <a href="#" class="sub" data-action="calc" style="font-size:13px">Not sure about your target? Calculate it</a></div></div>`;

    const meals = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
    h += `<div class="card"><div class="card-head"><h2>Log</h2><button class="btn small primary" data-action="add-food">+ Add</button></div>`;
    if (!items.length) h += `<div class="empty">Nothing logged ${d === todayISO() ? 'yet today' : 'this day'}.</div>`;
    meals.forEach((m) => {
      const list = items.filter((f) => (f.meal || 'Snack') === m);
      if (!list.length) return;
      h += `<div class="sub" style="font-weight:700;margin-top:6px">${m} · ${fmt(sumKcal(list), 0)} kcal</div><ul class="list">${list.map((f) =>
        `<li><div class="grow" data-action="edit-food" data-id="${f.id}" style="cursor:pointer"><div class="title">${esc(f.name)}</div><div class="meta">${[f.time, f.serving ? esc(f.serving) : '', macroText(f)].filter(Boolean).join(' · ')}</div></div>
        <span class="num">${fmt(f.kcal, 0)}</span><button class="del" data-action="del-food" data-id="${f.id}" aria-label="Delete">×</button></li>`).join('')}</ul>`;
    });
    h += `</div>`;

    // quick re-add from recent
    const seen = new Set(), recent = [];
    [...S.food].sort(byDateDesc).forEach((f) => { const k = f.name.toLowerCase(); if (!seen.has(k) && recent.length < 10) { seen.add(k); recent.push(f); } });
    if (recent.length) {
      h += `<div class="card"><div class="card-head"><h2>Quick add</h2></div><ul class="list">${recent.map((f) =>
        `<li><div class="grow"><div class="title">${esc(f.name)}</div><div class="meta">${fmt(f.kcal, 0)} kcal${macroText(f) ? ' · ' + macroText(f) : ''}</div></div>
        <button class="btn small" data-action="quick-food" data-id="${f.id}">+ Add</button></li>`).join('')}</ul></div>`;
    }

    const days = [];
    for (let i = 13; i >= 0; i--) { const dd = addDays(todayISO(), -i); days.push({ label: Charts.shortDate(dd), value: sumKcal(foodOn(dd)) }); }
    const logged = days.filter((x) => x.value);
    const avg = logged.length ? Math.round(logged.reduce((a, x) => a + x.value, 0) / logged.length) : 0;
    h += `<div class="card"><div class="card-head"><h2>Last 14 days</h2><span class="sub">${avg ? 'avg ' + fmt(avg, 0) : ''}</span></div>${Charts.bars(days, { target: st.calorieTarget, overIsBad: true, label: 'Daily calories' })}</div>`;
    return h;
  };

  views.train = () => {
    const t = todayISO(), st = S.settings;
    const ws = weekStart(t);
    const thisWeek = workoutsInWeek(ws);
    const mins = thisWeek.reduce((a, w) => a + (w.minutes || 0), 0);
    let h = `<div class="grid-2"><div class="card"><div class="card-head"><h2>This week</h2></div><div class="big">${new Set(thisWeek.map((w) => w.date)).size}<small> / ${st.workoutsPerWeek} days</small></div></div>
      <div class="card"><div class="card-head"><h2>Minutes</h2></div><div class="big">${fmt(mins, 0)}<small> min</small></div></div></div>`;

    const weeks = [];
    for (let i = 7; i >= 0; i--) { const s = addDays(ws, -7 * i); weeks.push({ label: Charts.shortDate(s), value: new Set(workoutsInWeek(s).map((w) => w.date)).size }); }
    h += `<div class="card"><div class="card-head"><h2>Workout days per week</h2></div>${Charts.bars(weeks, { target: st.workoutsPerWeek, label: 'Workouts per week' })}</div>`;

    const lifts = [...liftBests().values()].sort((a, b) => b.last.localeCompare(a.last));
    h += `<div class="card"><div class="card-head"><h2>Lifts & PRs</h2></div>`;
    h += lifts.length ? `<ul class="list">${lifts.slice(0, 12).map((l) => `<li data-action="lift-chart" data-key="${esc(l.key)}" style="cursor:pointer"><div class="grow"><div class="title">${esc(l.name)}</div>
        <div class="meta">PR ${relDay(l.date)} · ${l.sessions} session${l.sessions > 1 ? 's' : ''} · est. 1RM ${fmt(l.e1rm, 0)}</div></div>
        <span class="num">${fmt(l.weight)} × ${l.reps}</span></li>`).join('')}</ul>`
      : `<div class="empty">Write sets like <strong>Squat 5x5 @ 225</strong> or <strong>Bench 185x5</strong> in a workout and your PRs show up here automatically.</div>`;
    h += `</div>`;

    const list = [...S.workouts].sort(byDateDesc);
    h += `<div class="card"><div class="card-head"><h2>History</h2><button class="btn small primary" data-action="add-workout">+ Add</button></div>`;
    h += list.length ? list.slice(0, 60).map((w) => `<div class="entry"><div class="row" style="justify-content:space-between">
        <div data-action="edit-workout" data-id="${w.id}" style="cursor:pointer;flex:1"><div class="meta">${w.source === 'Apple Health' ? '⌚ ' : ''}${relDay(w.date)}${w.time ? ' ' + w.time : ''}${w.minutes ? ' · ' + w.minutes + ' min' : ''}${w.kcal ? ' · ' + w.kcal + ' kcal' : ''}${w.avgHr ? ' · ' + w.avgHr + ' bpm' : ''}${w.intensity ? ' · RPE ' + w.intensity : ''}</div>
        <strong>${esc(w.type)}</strong></div><button class="btn small" style="flex:none" data-action="repeat-workout" data-id="${w.id}">Repeat</button><button class="del" data-action="del-workout" data-id="${w.id}" aria-label="Delete">×</button></div>
        ${w.exercises ? `<p class="sub">${esc(w.exercises)}</p>` : ''}${w.notes ? `<p>${esc(w.notes)}</p>` : ''}</div>`).join('')
      : `<div class="empty">No workouts logged yet.</div>`;
    h += `</div>`;
    return h;
  };

  const MEASURES = [['waist', 'Waist'], ['chest', 'Chest'], ['hips', 'Hips'], ['arm', 'Arm'], ['thigh', 'Thigh'], ['neck', 'Neck']];

  views.body = () => {
    const seg = ui.bodySeg;
    let h = `<div class="segmented">${[['weigh', 'Weigh-ins'], ['measure', 'Measurements'], ['photos', 'Photos']].map(([k, l]) =>
      `<button class="${seg === k ? 'active' : ''}" data-action="body-seg" data-seg="${k}">${l}</button>`).join('')}</div>`;
    const rows = bodySorted();

    if (seg === 'weigh') {
      const weights = rows.filter((b) => b.weight != null).map((b) => ({ x: b.date, y: b.weight }));
      const first = weights[0], last = weights[weights.length - 1];
      h += `<div class="grid-2"><div class="card"><div class="card-head"><h2>Current</h2></div><div class="big">${last ? fmt(last.y) : '—'}<small> ${wUnit()}</small></div>
        <div class="sub">${first && last && first !== last ? `${last.y - first.y > 0 ? '+' : ''}${round1(last.y - first.y)} since ${prettyDate(first.x, { month: 'short', day: 'numeric' })}` : ''}</div></div>
        <div class="card"><div class="card-head"><h2>Goal</h2></div><div class="big">${S.settings.goalWeight != null ? fmt(S.settings.goalWeight) : '—'}<small> ${wUnit()}</small></div>
        <div class="sub">${S.settings.goalWeight == null ? '<a href="#" data-action="open-settings">Set a goal</a>' : last ? Math.abs(round1(last.y - S.settings.goalWeight)) + ' to go' : ''}</div></div></div>`;
      h += `<div class="card"><div class="card-head"><h2>Weight trend</h2></div>${Charts.line(weights, { goal: S.settings.goalWeight, label: 'Weight', empty: 'Log a weigh-in to see your trend' })}</div>`;
      const bf = rows.filter((b) => b.bodyFat != null).map((b) => ({ x: b.date, y: b.bodyFat }));
      const mm = rows.filter((b) => b.muscle != null).map((b) => ({ x: b.date, y: b.muscle }));
      if (bf.length) h += `<div class="card"><div class="card-head"><h2>Body fat %</h2><span class="sub">${fmt(bf[bf.length - 1].y)}%</span></div>${Charts.line(bf, { label: 'Body fat' })}</div>`;
      if (mm.length) h += `<div class="card"><div class="card-head"><h2>Muscle mass</h2><span class="sub">${fmt(mm[mm.length - 1].y)} ${wUnit()}</span></div>${Charts.line(mm, { label: 'Muscle mass' })}</div>`;
      h += `<div class="card"><div class="card-head"><h2>Log</h2><button class="btn small primary" data-action="add-body">+ Weigh-in</button></div>`;
      h += rows.length ? `<ul class="list">${[...rows].reverse().map((b) =>
        `<li><div class="grow" data-action="edit-body" data-id="${b.id}" style="cursor:pointer"><div class="title">${relDay(b.date)}</div>
          <div class="meta">${[b.bodyFat != null ? fmt(b.bodyFat) + '% fat' : '', b.muscle != null ? fmt(b.muscle) + ' ' + wUnit() + ' muscle' : '', b.waist != null ? 'waist ' + fmt(b.waist) + ' ' + lUnit() : ''].filter(Boolean).join(' · ')}${b.notes ? ' · ' + esc(b.notes) : ''}</div></div>
          <span class="num">${b.weight != null ? fmt(b.weight) + ' ' + wUnit() : ''}</span><button class="del" data-action="del-body" data-id="${b.id}" aria-label="Delete">×</button></li>`).join('')}</ul>` : `<div class="empty">No entries yet.</div>`;
      h += `</div>`;
    }

    if (seg === 'measure') {
      let any = false;
      MEASURES.forEach(([k, label]) => {
        const pts = rows.filter((b) => b[k] != null).map((b) => ({ x: b.date, y: b[k] }));
        if (!pts.length) return;
        any = true;
        const diff = round1(pts[pts.length - 1].y - pts[0].y);
        h += `<div class="card"><div class="card-head"><h2>${label}</h2><span class="sub">${fmt(pts[pts.length - 1].y)} ${lUnit()}${pts.length > 1 ? ` (<span class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : ''}${diff}</span>)` : ''}</span></div>${Charts.line(pts, { label })}</div>`;
      });
      if (!any) h += `<div class="card"><div class="empty">No tape measurements yet. Add them with a weigh-in — waist is the one to watch.</div></div>`;
      h += `<button class="btn primary block" data-action="add-body">+ Log measurements</button>`;
    }

    if (seg === 'photos') {
      h += `<div class="card"><div class="card-head"><h2>Progress photos</h2><button class="btn small primary" data-action="add-photo">+ Photo</button></div>
        <p class="sub" style="margin-top:0">Same spot, same light, same time of day. Tap two photos to compare.</p><div id="photo-grid" class="photos"><div class="empty">Loading…</div></div></div>
        <div id="compare"></div>`;
    }
    return h;
  };

  views.journal = () => {
    const seg = ui.goalSeg;
    let h = `<div class="segmented">${[['review', 'Week'], ['journal', 'Journal'], ['goals', 'Goals'], ['habits', 'Habits']].map(([k, l]) =>
      `<button class="${seg === k ? 'active' : ''}" data-action="goal-seg" data-seg="${k}">${l}</button>`).join('')}</div>`;

    if (seg === 'journal') {
      const list = [...S.journal].sort(byDateDesc);
      h += `<button class="btn primary block" data-action="journal-today" style="margin-bottom:14px">${S.journal.some((j) => j.date === todayISO()) ? 'Edit today\'s check-in' : 'Write today\'s check-in'}</button>`;
      const moods = list.filter((j) => j.mood).slice(0, 30).reverse().map((j) => ({ x: j.date, y: j.mood }));
      if (moods.length > 1) h += `<div class="card"><div class="card-head"><h2>Mood</h2></div>${Charts.line(moods, { decimals: 0, label: 'Mood' })}</div>`;
      h += `<div class="card">${list.length ? list.map((j) => `<div class="entry" data-action="edit-journal" data-id="${j.id}" style="cursor:pointer">
        <div class="meta">${prettyDate(j.date, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        <div>${j.mood ? `<span class="chip">Mood ${j.mood}/5</span>` : ''}${j.energy ? `<span class="chip">Energy ${j.energy}/5</span>` : ''}${j.hunger ? `<span class="chip">Hunger ${j.hunger}/5</span>` : ''}</div>
        ${j.wins ? `<p><strong>Win:</strong> ${esc(j.wins)}</p>` : ''}${j.text ? `<p>${esc(j.text)}</p>` : ''}${j.tomorrow ? `<p><strong>Tomorrow:</strong> ${esc(j.tomorrow)}</p>` : ''}</div>`).join('')
        : `<div class="empty">Your journal is empty. A daily check-in is the cheapest accountability there is.</div>`}</div>`;
    }

    if (seg === 'goals') {
      const t = todayISO();
      const active = S.goals.filter((g) => !g.done), done = S.goals.filter((g) => g.done);
      const goalHtml = (g) => {
        const left = g.targetDate ? daysBetween(t, g.targetDate) : null;
        return `<div class="goal-item ${g.done ? 'done' : ''}"><div class="row" style="justify-content:space-between;flex-wrap:nowrap">
          <div style="flex:1;cursor:pointer" data-action="edit-goal" data-id="${g.id}"><div class="title">${esc(g.title)}</div>
          <div class="meta sub">${g.targetDate ? (g.done ? 'Target ' + prettyDate(g.targetDate) : left < 0 ? `<span class="bad">${-left} days past ${prettyDate(g.targetDate)}</span>` : `${left} days left · ${prettyDate(g.targetDate)}`) : 'No deadline'}</div>
          ${g.why ? `<p class="sub" style="margin:4px 0 0">Why: ${esc(g.why)}</p>` : ''}</div>
          <button class="btn small" data-action="toggle-goal" data-id="${g.id}">${g.done ? 'Undo' : 'Done ✓'}</button></div></div>`;
      };
      h += `<div class="card"><div class="card-head"><h2>Active goals</h2><button class="btn small primary" data-action="add-goal">+ Goal</button></div>${active.length ? active.map(goalHtml).join('') : '<div class="empty">What are you working toward? Add it with a date.</div>'}</div>`;
      if (done.length) h += `<div class="card"><div class="card-head"><h2>Achieved 🏆</h2></div>${done.map(goalHtml).join('')}</div>`;
    }

    if (seg === 'review') {
      const thisWs = weekStart(todayISO());
      const ws = ui.reviewWeek || thisWs;
      const w = weekStats(ws), st = S.settings, u = wUnit();
      const isCurrent = ws === thisWs;
      h += `<div class="daynav"><button class="btn small" data-action="review-week" data-delta="-7">‹</button>
        <strong>${prettyDate(ws, { month: 'short', day: 'numeric' })} – ${prettyDate(w.we, { month: 'short', day: 'numeric' })}</strong>
        <button class="btn small" data-action="review-week" data-delta="7" ${isCurrent ? 'disabled' : ''}>›</button></div>`;
      if (!w.elapsed) return h + `<div class="card"><div class="empty">This week hasn't started.</div></div>`;
      const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
      h += `<div class="card ring">${Charts.ring(w.score || 0, 100)}<div><div class="card-head" style="margin:0"><h2>Accountability</h2></div>
        <div class="sub">${isCurrent ? `${w.elapsed} of 7 days in. ` : ''}${w.score >= 85 ? 'Locked in. This is how it\'s done.' : w.score >= 65 ? 'Solid week. Tighten one thing.' : w.score >= 40 ? 'Mixed. Pick the weakest area below and fix that first.' : 'Rough one. Reset tomorrow, one habit at a time.'}</div></div></div>`;
      const stat = (label, val, sub, cls = '') => `<div class="card"><div class="card-head"><h2>${label}</h2></div><div class="big ${cls}" style="font-size:28px">${val}</div><div class="sub">${sub}</div></div>`;
      h += `<div class="grid-2">`;
      h += stat('Calories', w.avgKcal != null ? fmt(w.avgKcal, 0) + '<small> avg</small>' : '—', `${w.onTarget}/${w.elapsed} days on target · ${w.kcalDays} logged${w.avgProtein != null ? ` · ${w.avgProtein}g protein` : ''}`, w.kcalDays && w.onTarget / w.elapsed >= 0.7 ? 'good' : '');
      h += stat('Training', `${w.wDays}<small> / ${st.workoutsPerWeek} days</small>`, `${w.workouts} session${w.workouts === 1 ? '' : 's'} · ${fmt(w.minutes, 0)} min${w.prs.length ? ` · ${w.prs.length} PR${w.prs.length > 1 ? 's' : ''} 🏆` : ''}`, w.wDays >= st.workoutsPerWeek ? 'good' : '');
      h += stat('Weight', w.weightChange != null ? `${w.weightChange > 0 ? '+' : ''}${w.weightChange}<small> ${u}</small>` : w.endW && w.endW.date >= ws ? `${fmt(w.endW.weight)}<small> ${u}</small>` : '—', w.weightChange != null ? `now ${fmt(w.endW.weight)} ${u}` : 'Weigh in to track change', w.weightChange != null && st.goalWeight != null && w.weightChange !== 0 && (st.goalWeight < w.endW.weight - w.weightChange) === (w.weightChange < 0) ? 'good' : '');
      h += stat('Journal', `${w.journal.length}<small> / ${w.elapsed} days</small>`, w.avgMood != null ? `avg mood ${w.avgMood}/5` : 'No check-ins', w.journal.length >= w.elapsed ? 'good' : '');
      h += `</div>`;
      if (w.habitRows.length) h += `<div class="card"><div class="card-head"><h2>Habits</h2><span class="sub">${Math.round((w.habitPct || 0) * 100)}%</span></div>${w.habitRows.map((r) =>
        `<div style="margin-bottom:10px"><div class="row" style="justify-content:space-between"><span>${esc(r.name)}</span><span class="sub">${r.done}/${w.elapsed}</span></div>
        <div class="progress" style="margin:4px 0 0"><i style="width:${pct(r.done, w.elapsed)}%"></i></div></div>`).join('')}</div>`;
      if (w.prs.length) h += `<div class="card"><div class="card-head"><h2>PRs this week 🏆</h2></div><ul class="list">${w.prs.map((l) => `<li><div class="grow title">${esc(l.name)}</div><span class="num">${fmt(l.weight)} × ${l.reps}</span></li>`).join('')}</ul></div>`;
      const wins = w.journal.filter((j) => j.wins);
      if (wins.length) h += `<div class="card"><div class="card-head"><h2>Wins</h2></div><ul class="list">${wins.map((j) => `<li><div class="grow"><div class="meta">${prettyDate(j.date, { weekday: 'short' })}</div>${esc(j.wins)}</div></li>`).join('')}</ul></div>`;
      const commits = w.journal.filter((j) => j.tomorrow);
      if (commits.length) h += `<div class="card"><div class="card-head"><h2>What you said you'd do</h2></div><ul class="list">${commits.map((j) => `<li><div class="grow"><div class="meta">${prettyDate(addDays(j.date, 1), { weekday: 'short' })}</div>${esc(j.tomorrow)}</div></li>`).join('')}</ul>
        <p class="sub" style="margin-bottom:0">Did you? Be honest in tonight's check-in.</p></div>`;
    }

    if (seg === 'habits') {
      h += `<div class="card"><div class="card-head"><h2>Daily habits</h2><button class="btn small primary" data-action="add-habit">+ Habit</button></div>
        <p class="sub" style="margin-top:0">These show on your Today screen as the daily checklist.</p>`;
      h += S.habits.length ? `<ul class="list">${S.habits.map((hb) => {
        const s = streak((d) => habitDone(d, hb.id));
        let last30 = 0; for (let i = 0; i < 30; i++) if (habitDone(addDays(todayISO(), -i), hb.id)) last30++;
        return `<li><div class="grow"><div class="title" style="${hb.active ? '' : 'opacity:.5'}">${esc(hb.name)}</div><div class="meta">${s} day streak · ${last30}/30 days</div></div>
          <button class="btn small" data-action="toggle-habit-active" data-id="${hb.id}">${hb.active ? 'Pause' : 'Resume'}</button>
          <button class="del" data-action="del-habit" data-id="${hb.id}" aria-label="Delete">×</button></li>`;
      }).join('')}</ul>` : '<div class="empty">No habits yet.</div>';
      h += `</div>`;
      // 5-week consistency heatmap of all habits
      const habits = activeHabits();
      if (habits.length) {
        const start = addDays(weekStart(todayISO()), -28);
        let cells = '';
        for (let i = 0; i < 35; i++) {
          const d = addDays(start, i);
          const frac = d > todayISO() ? -1 : habits.filter((hb) => habitDone(d, hb.id)).length / habits.length;
          cells += `<div title="${d}"><i style="background:${frac < 0 ? 'transparent' : frac === 0 ? 'var(--surface-2)' : `color-mix(in srgb, var(--accent) ${Math.round(25 + frac * 75)}%, var(--surface-2))`}"></i></div>`;
        }
        h += `<div class="card"><div class="card-head"><h2>Last 5 weeks</h2></div><div class="week">${'MTWTFSS'.split('').map((c) => `<div>${c}</div>`).join('')}${cells}</div></div>`;
      }
    }
    return h;
  };

  // ---------- photos ----------
  async function renderPhotos() {
    const grid = $('#photo-grid');
    if (!grid) return;
    const photos = (await DB.allPhotos()).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if (!photos.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No photos yet. Your first one is your "before".</div>'; return; }
    grid.innerHTML = photos.map((p) => {
      if (!ui.photoUrls.has(p.id)) ui.photoUrls.set(p.id, URL.createObjectURL(p.blob));
      return `<button data-action="pick-photo" data-id="${p.id}" class="${ui.compare.includes(p.id) ? 'picked' : ''}"><img src="${ui.photoUrls.get(p.id)}" alt="Progress photo ${p.date}" loading="lazy"><span>${prettyDate(p.date, { month: 'short', day: 'numeric', year: '2-digit' })}${p.pose ? ' · ' + esc(p.pose) : ''}</span></button>`;
    }).join('');
    const cmp = $('#compare');
    const picked = ui.compare.map((id) => photos.find((p) => p.id === id)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
    if (picked.length === 2) {
      const days = daysBetween(picked[0].date, picked[1].date);
      const wAt = (d) => { const r = bodySorted().filter((b) => b.weight != null && b.date <= d).pop(); return r ? ` · ${fmt(r.weight)} ${wUnit()}` : ''; };
      cmp.innerHTML = `<div class="card"><div class="card-head"><h2>Compare · ${days} days</h2><button class="btn small" data-action="clear-compare">Clear</button></div>
        <div class="compare">${picked.map((p) => `<figure><img src="${ui.photoUrls.get(p.id)}" alt=""><figcaption>${prettyDate(p.date, { month: 'short', day: 'numeric', year: 'numeric' })}${wAt(p.date)}</figcaption></figure>`).join('')}</div></div>`;
    } else if (picked.length === 1) {
      cmp.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><span class="sub">1 selected — pick another to compare, or</span>
        <button class="btn small" data-action="view-photo" data-id="${picked[0].id}">Open</button></div></div>`;
    } else cmp.innerHTML = '';
  }

  function compressImage(file, maxDim = 1400, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scaleBy = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scaleBy); c.height = Math.round(img.height * scaleBy);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  // ---------- forms ----------
  // Log-food form with search (your foods, built-in USDA database, Open Food Facts) and barcode scanning.
  function foodForm(f = {}) {
    const isEdit = !!f.id;
    const hr = new Date().getHours();
    const defMeal = hr < 11 ? 'Breakfast' : hr < 15 ? 'Lunch' : hr < 21 ? 'Dinner' : 'Snack';
    openModal(`<h2>${isEdit ? 'Edit food' : 'Log food'}</h2>
      ${isEdit ? '' : `<div class="lookup">
        <div class="search-row"><input type="search" id="fsearch" placeholder="Search: eggs, rice, Chobani…" autocomplete="off" enterkeyhint="search" autofocus>
        <button class="btn" data-modal-action="scan" aria-label="Scan barcode">${ICON_SCAN}<span>Scan</span></button></div>
        <div id="fresults"></div></div>`}
      <div id="fpick"></div>
      ${field('What', inText('name', f.name, `required ${isEdit ? 'autofocus' : ''} placeholder="Or type it in yourself" autocomplete="off"`))}
      <div class="fields-2">${field('Calories', inNum('kcal', f.kcal, 'required min="0"'))}${field('Protein (g)', inNum('protein', f.protein, 'min="0"'))}</div>
      <div class="fields-2">${field('Carbs (g)', inNum('carbs', f.carbs, 'min="0"'))}${field('Fat (g)', inNum('fat', f.fat, 'min="0"'))}</div>
      <input type="hidden" name="serving" value="${esc(f.serving || '')}">
      <div class="fields-2">${field('Meal', `<select name="meal">${['Breakfast', 'Lunch', 'Dinner', 'Snack'].map((m) => `<option ${(f.meal || defMeal) === m ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
      ${field('Time', `<input type="time" name="time" value="${f.time || nowTime()}">`)}</div>
      ${field('Date', inDate('date', f.date || ui.foodDate))}`, (fd) => {
      const rec = { id: f.id || uid(), name: fd.get('name').trim(), kcal: num(fd.get('kcal')) || 0, protein: num(fd.get('protein')), carbs: num(fd.get('carbs')), fat: num(fd.get('fat')),
        serving: fd.get('serving') || '', meal: fd.get('meal'), time: fd.get('time'), date: fd.get('date') };
      if (isEdit) S.food = S.food.map((x) => (x.id === f.id ? rec : x)); else S.food.push(rec);
      save(); toast(`Logged ${rec.kcal} kcal`);
    });
    if (isEdit) return;
    const input = $('#fsearch');
    // manual edits to the name clear the "serving" label from a previous pick
    modalForm.elements.name.addEventListener('input', () => { modalForm.elements.serving.value = ''; });
    let seq = 0, debounce;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); runSearch(true); } });
    input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => runSearch(false), 160); });
    showRecent();

    function showRecent() {
      const mine = FoodLookup.searchHistory('', S.food, 6);
      foodCache.list = mine;
      $('#fresults').innerHTML = mine.length ? `<div class="res-head">Recent</div>${resultList(mine, 0)}` : '<p class="hint" style="margin:6px 0 0">Search ~7,000 common foods, look up packaged foods, or scan a barcode.</p>';
    }
    async function runSearch(online) {
      const q = input.value.trim();
      const my = ++seq;
      if (q.length < 2) { showRecent(); return; }
      const mine = FoodLookup.searchHistory(q, S.food, 4);
      let common = [];
      const box = $('#fresults');
      if (!box) return;
      try { common = await FoodLookup.searchCommon(q, 10); } catch (e) { box.innerHTML = `<p class="hint">Food database didn't load (${esc(e.message)}). Packaged search may still work.</p>`; }
      if (my !== seq) return;
      foodCache.list = [...mine, ...common];
      let h = '';
      if (mine.length) h += `<div class="res-head">Your foods</div>${resultList(mine, 0)}`;
      if (common.length) h += `<div class="res-head">Common foods · USDA</div>${resultList(common, mine.length)}`;
      if (!mine.length && !common.length) h += `<p class="hint" style="margin:6px 0">No matches in common foods.</p>`;
      h += `<div id="fonline">${online ? '' : `<button class="btn small block" data-modal-action="search-online">Search packaged & brand foods for “${esc(q)}”</button>`}</div>`;
      box.innerHTML = h;
      if (online) searchOnline(q, my);
    }
    async function searchOnline(q, my) {
      const box = $('#fonline');
      if (!box) return;
      box.innerHTML = '<p class="hint">Searching Open Food Facts…</p>';
      try {
        const res = await FoodLookup.searchPackaged(q, 12);
        if (my !== seq || !$('#fonline')) return;
        const base = foodCache.list.length;
        foodCache.list = foodCache.list.concat(res);
        $('#fonline').innerHTML = res.length ? `<div class="res-head">Packaged foods · Open Food Facts</div>${resultList(res, base)}` : '<p class="hint">No packaged foods found. Try the brand name, or scan the barcode.</p>';
      } catch (e) {
        if ($('#fonline')) $('#fonline').innerHTML = `<p class="hint">${esc(navigator.onLine ? e.message : 'You\'re offline. Packaged-food search needs a connection.')}</p>
          ${navigator.onLine ? '<button class="btn small block" data-modal-action="search-online">Try again</button>' : ''}`;
      }
    }
    modalActions['search-online'] = () => { clearTimeout(debounce); seq++; searchOnline(input.value.trim(), seq); };
  }
  const ICON_SCAN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>';
  const foodCache = { list: [] };

  function resultList(items, offset) {
    return `<ul class="list results">${items.map((it, i) => {
      const per = it.perServing && !it.per100 ? it.perServing : null;
      const meta = it.source === 'Mine' ? `${fmt(it.perServing.k, 0)} kcal${it.entry.serving ? ' · ' + esc(it.entry.serving) : ''}`
        : per ? `${fmt(per.k, 0)} kcal / serving` : `${fmt(it.per100.k, 0)} kcal / 100 g · P ${fmt(it.per100.p, 0)} C ${fmt(it.per100.c, 0)} F ${fmt(it.per100.f, 0)}`;
      return `<li><button data-modal-action="pick-food" data-i="${offset + i}"><div class="title">${esc(FoodLookup.displayName(it))}</div><div class="meta">${it.brand && it.source !== 'USDA' ? esc(it.brand) + ' · ' : ''}${meta}</div></button></li>`;
    }).join('')}</ul>`;
  }

  // Selecting a result shows a portion picker that fills in the fields below it.
  function showPicker(food) {
    const pick = $('#fpick');
    if (!pick) return;
    const opts = food.portions.map(([label], i) => `<option value="${i}">${esc(label)}</option>`).join('') + (food.per100 ? '<option value="-1">grams</option>' : '');
    const dp = FoodLookup.defaultPortion(food);
    pick.innerHTML = `<div class="picked"><div class="row" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-start">
        <div><strong>${esc(FoodLookup.displayName(food))}</strong><div class="sub" style="font-size:12px">${food.source === 'Mine' ? 'From your log' : food.source}${food.brand && food.source !== 'USDA' ? ' · ' + esc(food.brand) : ''}</div></div>
        <button class="del" data-modal-action="unpick" aria-label="Clear">×</button></div>
      <div class="portion"><input type="number" id="pqty" inputmode="decimal" step="any" min="0" value="${dp === -1 ? 100 : 1}" aria-label="Amount">
        <select id="pportion" aria-label="Portion">${opts}</select></div>
      <div id="pout" class="sub"></div></div>`;
    $('#pportion').value = String(dp);
    const apply = () => {
      const pi = Number($('#pportion').value), qty = Number($('#pqty').value) || 0;
      const n = FoodLookup.nutrition(food, pi, qty);
      const els = modalForm.elements;
      if (!n) { $('#pout').textContent = 'No nutrition data for this portion. Enter it below.'; return; }
      els.name.value = FoodLookup.displayName(food);
      els.kcal.value = n.k; els.protein.value = n.p; els.carbs.value = n.c; els.fat.value = n.f;
      const label = pi === -1 ? `${fmt(qty)} g` : `${fmt(qty)} × ${food.portions[pi][0]}`;
      els.serving.value = food.source === 'Mine' && qty === 1 ? food.entry.serving || '' : food.source === 'Mine' ? `${fmt(qty)} × ${food.entry.serving || 'serving'}` : label;
      const grams = pi === -1 ? qty : food.portions[pi][1] ? food.portions[pi][1] * qty : null;
      $('#pout').innerHTML = `<strong>${n.k} kcal</strong> · P ${n.p} · C ${n.c} · F ${n.f}${grams ? ` <span style="opacity:.7">(${fmt(grams, 0)} g)</span>` : ''}`;
    };
    $('#pqty').addEventListener('input', apply);
    $('#pportion').addEventListener('change', () => { if ($('#pportion').value === '-1' && Number($('#pqty').value) < 5) $('#pqty').value = 100; apply(); });
    apply();
    pick.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  modalActions['pick-food'] = (b) => {
    const food = foodCache.list[Number(b.dataset.i)];
    if (!food) return;
    if (food.source === 'Mine') {
      food.perServing = { k: food.entry.kcal || 0, p: food.entry.protein || 0, c: food.entry.carbs || 0, f: food.entry.fat || 0 };
      food.portions = [[food.entry.serving ? `serving (${food.entry.serving})` : 'serving', null]];
      const meal = modalForm.elements.meal;
      if (food.entry.meal && meal) meal.value = food.entry.meal;
    }
    $('#fresults').innerHTML = '';
    showPicker(food);
  };
  modalActions.unpick = () => {
    $('#fpick').innerHTML = '';
    ['name', 'kcal', 'protein', 'carbs', 'fat', 'serving'].forEach((k) => { modalForm.elements[k].value = ''; });
    const inp = $('#fsearch'); if (inp) { inp.dispatchEvent(new Event('input')); inp.focus(); }
  };
  modalActions.scan = () => {
    const box = $('#fresults');
    $('#fpick').innerHTML = '';
    box.innerHTML = `<div class="scanner"><video muted playsinline></video><div class="scan-frame"></div></div>
      <p class="hint" id="scan-msg" style="margin:8px 0">Point the camera at the barcode.</p>
      <div class="search-row"><input type="text" id="scan-code" inputmode="numeric" placeholder="…or type the barcode number" autocomplete="off">
      <button class="btn" data-modal-action="lookup-code">Look up</button></div>
      <button class="btn small block" data-modal-action="stop-scan" style="margin-top:8px">Cancel scan</button>`;
    $('#scan-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); modalActions['lookup-code'](); } });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('.scanner').remove();
      $('#scan-msg').textContent = 'This browser can\'t use the camera here. Type the barcode number instead.';
      return;
    }
    FoodLookup.startScanner($('.scanner video'), (code) => lookupBarcode(code), (msg) => {
      const sc = $('.scanner'); if (sc) sc.remove();
      const m = $('#scan-msg'); if (m) m.textContent = msg;
    });
  };
  modalActions['stop-scan'] = () => { FoodLookup.stopScanner(); const inp = $('#fsearch'); if (inp) inp.dispatchEvent(new Event('input')); };
  modalActions['lookup-code'] = () => {
    const code = ($('#scan-code').value || '').replace(/\D/g, '');
    if (code.length < 8) { toast('Barcodes are 8–14 digits'); return; }
    FoodLookup.stopScanner();
    lookupBarcode(code);
  };
  async function lookupBarcode(code) {
    const box = $('#fresults');
    if (!box) return;
    box.innerHTML = `<p class="hint">Looking up ${esc(code)}…</p>`;
    // Previously logged with this barcode? Use your own numbers first.
    const prev = [...S.food].reverse().find((x) => x.barcode === code);
    try {
      const food = await FoodLookup.byBarcode(code);
      if (!$('#fresults')) return;
      if (!food && !prev) {
        box.innerHTML = `<p class="hint">Barcode ${esc(code)} isn't in Open Food Facts yet. Enter the label's numbers below — next time you can find it under Recent.</p>`;
        modalForm.elements.name.focus();
        return;
      }
      box.innerHTML = '';
      if (food) { food.barcode = code; showPicker(food); } else modalActions['pick-food']({ dataset: { i: (foodCache.list = FoodLookup.searchHistory(prev.name, S.food, 1), 0) } });
      ensureBarcodeField(code);
    } catch (e) {
      if ($('#fresults')) box.innerHTML = `<p class="hint">${esc(navigator.onLine ? e.message : 'You\'re offline. Barcode lookup needs a connection.')}</p>`;
      ensureBarcodeField(code);
    }
  }
  function ensureBarcodeField(code) {
    let el = modalForm.elements.barcode;
    if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = 'barcode'; modalForm.appendChild(el); }
    el.value = code;
    // store barcode on save
    const prevHandler = modalHandler;
    modalHandler = (fd, form) => {
      const out = prevHandler(fd, form);
      if (out !== false) { const last = S.food[S.food.length - 1]; if (last) last.barcode = code; save(); }
      return out;
    };
  }

  function workoutForm(w = {}) {
    const isEdit = !!w.id;
    const types = ['Strength', 'Run', 'Walk', 'Cycle', 'HIIT', 'Swim', 'Sport', 'Yoga / Mobility', 'Other'];
    openModal(`<h2>${isEdit ? 'Edit workout' : 'Log workout'}</h2>
      <div class="fields-2">${field('Type', `<input type="text" name="type" list="wtypes" value="${esc(w.type || '')}" required placeholder="Strength" autocomplete="off"><datalist id="wtypes">${types.map((t) => `<option value="${t}">`).join('')}</datalist>`)}
      ${field('Minutes', inNum('minutes', w.minutes, 'min="0"'))}</div>
      ${field('Effort (RPE 1–10)', inNum('intensity', w.intensity, 'min="1" max="10" step="1"'))}
      ${field('Exercises / sets', `<textarea name="exercises" placeholder="Squat 5x5 @ 225&#10;Bench 3x8 @ 165&#10;Pull-ups 3x10">${esc(w.exercises || '')}</textarea>`)}
      ${field('Notes', inText('notes', w.notes, 'placeholder="How it felt, PRs, pain…"'))}
      ${field('Date', inDate('date', w.date || todayISO()))}`, (fd) => {
      const rec = { id: w.id || uid(), type: fd.get('type').trim(), minutes: num(fd.get('minutes')), intensity: num(fd.get('intensity')), exercises: fd.get('exercises').trim(), notes: fd.get('notes').trim(), date: fd.get('date') };
      const before = liftBests(rec.id);
      const prs = parseLifts(rec.exercises).filter((l) => before.has(l.key) && l.weight > before.get(l.key).weight);
      if (isEdit) S.workouts = S.workouts.map((x) => (x.id === w.id ? rec : x)); else S.workouts.push(rec);
      save(); toast(prs.length ? `New PR: ${prs.map((l) => `${l.name} ${l.weight}`).join(', ')} 🏆` : 'Workout logged 💪');
    });
  }

  function bodyForm(b = {}) {
    const isEdit = !!b.id;
    const u = wUnit(), l = lUnit();
    openModal(`<h2>${isEdit ? 'Edit entry' : 'Weigh-in'}</h2>
      ${field('Date', inDate('date', b.date || todayISO()))}
      <div class="fields-3">${field(`Weight (${u})`, inNum('weight', b.weight, 'autofocus min="0"'))}${field('Body fat %', inNum('bodyFat', b.bodyFat, 'min="0" max="80"'))}${field(`Muscle (${u})`, inNum('muscle', b.muscle, 'min="0"'))}</div>
      <p class="hint">Fill in what you have — all fields are optional. Smart-scale numbers work fine.</p>
      <div class="sub" style="font-weight:700;margin:6px 0 8px">Tape measurements (${l})</div>
      <div class="fields-3">${MEASURES.map(([k, label]) => field(label, inNum(k, b[k], 'min="0"'))).join('')}</div>
      ${field('Notes', inText('notes', b.notes, 'placeholder="Morning, after bathroom, before food…"'))}`, (fd) => {
      const rec = { id: b.id || uid(), date: fd.get('date'), weight: num(fd.get('weight')), bodyFat: num(fd.get('bodyFat')), muscle: num(fd.get('muscle')), notes: fd.get('notes').trim() };
      MEASURES.forEach(([k]) => { rec[k] = num(fd.get(k)); });
      const hasData = ['weight', 'bodyFat', 'muscle', ...MEASURES.map((m) => m[0])].some((k) => rec[k] != null);
      if (!hasData) { toast('Enter at least one number'); return false; }
      if (isEdit) S.body = S.body.map((x) => (x.id === b.id ? rec : x)); else S.body.push(rec);
      save(); toast('Saved');
    });
  }

  function journalForm(j) {
    const date = j?.date || todayISO();
    j = j || S.journal.find((x) => x.date === date) || { date };
    const isEdit = !!j.id;
    const open = S.goals.filter((g) => !g.done).slice(0, 3).map((g) => esc(g.title)).join(' · ');
    openModal(`<h2>Check-in · ${relDay(date)}</h2>
      ${open ? `<p class="hint">Working toward: ${open}</p>` : ''}
      ${field('Mood', scale('mood', j.mood, ['😞', '😕', '😐', '🙂', '😄']))}
      <div class="fields-2">${field('Energy', scale('energy', j.energy))}${field('Hunger', scale('hunger', j.hunger))}</div>
      ${field('One win today', inText('wins', j.wins, 'placeholder="Even a small one"'))}
      ${field('How did it go? Be honest.', `<textarea name="text" placeholder="What went well, what got in the way, what you're feeling…">${esc(j.text || '')}</textarea>`)}
      ${field('Tomorrow I will…', inText('tomorrow', j.tomorrow, 'placeholder="One concrete commitment"'))}
      ${isEdit ? `<button class="btn danger small" data-modal-action="del-journal" data-id="${j.id}">Delete entry</button>` : ''}`, (fd) => {
      const rec = { id: j.id || uid(), date, mood: num(fd.get('mood')), energy: num(fd.get('energy')), hunger: num(fd.get('hunger')), wins: fd.get('wins').trim(), text: fd.get('text').trim(), tomorrow: fd.get('tomorrow').trim() };
      if (isEdit) S.journal = S.journal.map((x) => (x.id === j.id ? rec : x)); else S.journal.push(rec);
      save(); toast('Check-in saved');
    });
  }
  modalActions['del-journal'] = (b) => {
    if (!confirm('Delete this journal entry?')) return;
    S.journal = S.journal.filter((x) => x.id !== b.dataset.id); save(); modal.close(); render();
  };

  function goalForm(g = {}) {
    const isEdit = !!g.id;
    openModal(`<h2>${isEdit ? 'Edit goal' : 'New goal'}</h2>
      ${field('Goal', inText('title', g.title, 'required autofocus placeholder="e.g. Hit 185 lb · Squat 315 · Run a 5K"'))}
      ${field('Target date', `<input type="date" name="targetDate" value="${g.targetDate || ''}">`)}
      ${field('Why it matters', `<textarea name="why" placeholder="The reason you\'ll read on the hard days">${esc(g.why || '')}</textarea>`)}
      ${isEdit ? `<button class="btn danger small" data-modal-action="del-goal" data-id="${g.id}">Delete goal</button>` : ''}`, (fd) => {
      const rec = { ...g, id: g.id || uid(), title: fd.get('title').trim(), targetDate: fd.get('targetDate') || null, why: fd.get('why').trim(), done: !!g.done, createdAt: g.createdAt || todayISO() };
      if (isEdit) S.goals = S.goals.map((x) => (x.id === g.id ? rec : x)); else S.goals.push(rec);
      save();
    });
  }
  modalActions['del-goal'] = (b) => {
    if (!confirm('Delete this goal?')) return;
    S.goals = S.goals.filter((x) => x.id !== b.dataset.id); save(); modal.close(); render();
  };

  function photoForm() {
    openModal(`<h2>Add progress photo</h2>
      ${field('Photo', '<input type="file" name="file" accept="image/*" required>')}
      <div class="fields-2">${field('Pose', `<select name="pose"><option>Front</option><option>Side</option><option>Back</option><option value="">Other</option></select>`)}${field('Date', inDate('date', todayISO()))}</div>
      <p class="hint">Photos stay on this device only and are shrunk to save space.</p>`, async (fd) => {
      const file = fd.get('file');
      if (!file || !file.size) { toast('Pick a photo first'); return false; }
      try {
        const blob = await compressImage(file);
        await DB.putPhoto({ id: uid(), date: fd.get('date'), pose: fd.get('pose'), blob });
        toast('Photo saved');
      } catch (e) { toast(e.message); return false; }
    }, { saveLabel: 'Save photo' });
  }

  function settingsForm() {
    const st = S.settings;
    openModal(`<h2>Settings</h2>
      ${field('Your name', inText('name', st.name, 'placeholder="Optional"'))}
      ${field('Units', `<select name="units"><option value="lb" ${st.units === 'lb' ? 'selected' : ''}>Pounds / inches</option><option value="kg" ${st.units === 'kg' ? 'selected' : ''}>Kilograms / cm</option></select>`, 'Switching converts everything you\'ve already logged.')}
      <div class="fields-2">${field('Daily calories', inNum('calorieTarget', st.calorieTarget, 'min="0" required'))}${field('Daily protein (g)', inNum('proteinTarget', st.proteinTarget, 'min="0"'))}</div>
      <p class="hint"><a href="#" data-modal-action="calc" style="color:var(--accent);font-weight:650">Calculate my targets</a> from height, age, weight and activity.</p>
      <div class="fields-2">${field('Workouts / week', inNum('workoutsPerWeek', st.workoutsPerWeek, 'min="0" max="14" step="1"'))}${field(`Goal weight (${st.units})`, inNum('goalWeight', st.goalWeight, 'min="0"'))}</div>
      <div class="sub" style="font-weight:700;margin:10px 0 8px">Apple Watch / Apple Health</div>
      <p class="hint">Bring in steps, active calories, sleep, resting heart rate, weight and watch workouts with a one-tap Shortcut. <a href="https://github.com/danieltedwards/gritty-fit#apple-watch--apple-health" target="_blank" rel="noopener" style="color:var(--accent);font-weight:650">Setup guide</a></p>
      <button class="btn block" data-modal-action="health-import" style="margin-bottom:12px">⌚ Import from Apple Health</button>
      <div class="sub" style="font-weight:700;margin:10px 0 8px">Your data</div>
      <p class="hint">Everything is stored only in this browser on this device. Export a backup now and then — clearing browser data deletes it.</p>
      <div class="row" style="margin-bottom:10px"><button class="btn" data-modal-action="export">Export backup</button><button class="btn" data-modal-action="import">Import backup</button></div>
      <button class="btn danger block" data-modal-action="wipe">Erase all data</button>`, (fd) => {
      const newUnits = fd.get('units');
      if (newUnits !== st.units) convertUnits(st.units, newUnits);
      Object.assign(st, {
        name: fd.get('name').trim(), units: newUnits, calorieTarget: num(fd.get('calorieTarget')) || 0, proteinTarget: num(fd.get('proteinTarget')) || 0,
        workoutsPerWeek: num(fd.get('workoutsPerWeek')) ?? 0, goalWeight: num(fd.get('goalWeight')),
      });
      // goal weight was entered in the new unit already, nothing else to do
      save(); toast('Settings saved');
    });
  }
  function convertUnits(from, to) {
    const wf = from === 'lb' && to === 'kg' ? 0.45359237 : 1 / 0.45359237;
    const lf = from === 'lb' && to === 'kg' ? 2.54 : 1 / 2.54;
    S.body.forEach((b) => {
      if (b.weight != null) b.weight = round1(b.weight * wf);
      if (b.muscle != null) b.muscle = round1(b.muscle * wf);
      MEASURES.forEach(([k]) => { if (b[k] != null) b[k] = round1(b[k] * lf); });
    });
  }

  const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  modalActions.export = async () => {
    const withPhotos = confirm('Include progress photos in the backup? (Bigger file)');
    const photos = withPhotos ? await Promise.all((await DB.allPhotos()).map(async (p) => ({ id: p.id, date: p.date, pose: p.pose, dataUrl: await blobToDataURL(p.blob) }))) : [];
    const blob = new Blob([JSON.stringify({ app: 'gritty-fit', exportedAt: new Date().toISOString(), state: S, photos })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gritty-fit-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    S.settings.lastBackup = new Date().toISOString(); save(); if (!modal.open) render();
    toast('Backup downloaded');
  };
  modalActions.import = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        if (data.app !== 'gritty-fit' || !data.state) throw new Error('That is not a Gritty Fit backup');
        if (!confirm('Replace everything on this device with this backup?')) return;
        S = Object.assign(DEFAULT_STATE(), data.state);
        await DB.setState(S);
        if (data.photos && data.photos.length) {
          await DB.clearPhotos();
          for (const p of data.photos) await DB.putPhoto({ id: p.id, date: p.date, pose: p.pose, blob: await (await fetch(p.dataUrl)).blob() });
        }
        ui.photoUrls.forEach((u) => URL.revokeObjectURL(u)); ui.photoUrls.clear();
        modal.close(); render(); toast('Backup restored');
      } catch (e) { toast('Import failed: ' + e.message); }
    };
    input.click();
  };
  modalActions.wipe = async () => {
    if (!confirm('Erase ALL data, including photos? This cannot be undone.')) return;
    if (prompt('Type ERASE to confirm') !== 'ERASE') return;
    S = DEFAULT_STATE(); await DB.setState(S); await DB.clearPhotos();
    modal.close(); render(); toast('All data erased');
  };

  // Mifflin-St Jeor BMR x activity, then a weekly-rate adjustment (3500 kcal per lb).
  function calcForm() {
    const st = S.settings, kg = st.units === 'kg';
    const latest = latestWith('weight');
    const hCm = st.heightCm;
    const ft = hCm ? Math.floor(hCm / 2.54 / 12) : '', inch = hCm ? Math.round(hCm / 2.54 - Math.floor(hCm / 2.54 / 12) * 12) : '';
    const rates = kg ? [['-0.75', 'Lose 0.75 kg/week'], ['-0.5', 'Lose 0.5 kg/week'], ['-0.25', 'Lose 0.25 kg/week'], ['0', 'Maintain'], ['0.25', 'Gain 0.25 kg/week']]
      : [['-1.5', 'Lose 1.5 lb/week'], ['-1', 'Lose 1 lb/week'], ['-0.5', 'Lose 0.5 lb/week'], ['0', 'Maintain'], ['0.5', 'Gain 0.5 lb/week (lean bulk)']];
    openModal(`<h2>Calorie calculator</h2>
      <div class="fields-2">${field('Sex', `<select name="sex"><option value="m" ${st.sex === 'm' ? 'selected' : ''}>Male</option><option value="f" ${st.sex === 'f' ? 'selected' : ''}>Female</option></select>`)}${field('Age', inNum('age', st.age, 'min="13" max="100" required'))}</div>
      ${kg ? field('Height (cm)', inNum('hcm', hCm ? Math.round(hCm) : '', 'min="100" max="250" required'))
        : `<div class="fields-2">${field('Height (ft)', inNum('hft', ft, 'min="3" max="8" required'))}${field('(in)', inNum('hin', inch, 'min="0" max="11.9"'))}</div>`}
      ${field(`Current weight (${st.units})`, inNum('weight', latest ? latest.weight : '', 'min="30" required'))}
      ${field('Activity (including workouts)', `<select name="act">
        <option value="1.2">Desk job, little exercise</option><option value="1.375">Light: 1–3 workouts/week</option>
        <option value="1.55" selected>Moderate: 3–5 workouts/week</option><option value="1.725">Very active: 6–7 hard sessions/week</option>
        <option value="1.9">Physical job + training</option></select>`)}
      ${field('Goal', `<select name="rate">${rates.map(([v, l]) => `<option value="${v}" ${v === (kg ? '-0.5' : '-1') ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      <div id="calc-out" class="card" style="background:var(--surface-2)"><div class="sub">Fill in the fields to see your numbers.</div></div>
      <p class="hint">Estimates only. Use it as a starting point, then adjust every 2–3 weeks based on what the scale actually does.</p>`, (fd) => {
      const r = compute(fd);
      if (!r) { toast('Fill in all the fields'); return false; }
      Object.assign(st, { sex: fd.get('sex'), age: num(fd.get('age')), heightCm: r.hCm, calorieTarget: r.target, proteinTarget: r.protein });
      save(); toast(`Targets set: ${r.target} kcal, ${r.protein}g protein`);
    }, { saveLabel: 'Use these targets' });
    function compute(fd) {
      const age = num(fd.get('age')), w = num(fd.get('weight'));
      const hCm = kg ? num(fd.get('hcm')) : (num(fd.get('hft')) != null ? num(fd.get('hft')) * 30.48 + (num(fd.get('hin')) || 0) * 2.54 : null);
      if (!age || !w || !hCm) return null;
      const wKg = kg ? w : w * 0.45359237;
      const bmr = 10 * wKg + 6.25 * hCm - 5 * age + (fd.get('sex') === 'm' ? 5 : -161);
      const tdee = bmr * Number(fd.get('act'));
      const rate = Number(fd.get('rate'));
      const perDay = (kg ? rate / 0.45359237 : rate) * 3500 / 7;
      const floor = fd.get('sex') === 'm' ? 1500 : 1200;
      const target = Math.max(floor, Math.round((tdee + perDay) / 10) * 10);
      const goalKg = st.goalWeight != null ? (kg ? st.goalWeight : st.goalWeight * 0.45359237) : wKg;
      const protein = Math.round((Math.min(wKg, Math.max(goalKg, wKg * 0.85)) * 1.8) / 5) * 5; // ~1.8 g/kg (~0.8 g/lb) of (near-)goal bodyweight
      return { bmr: Math.round(bmr), tdee: Math.round(tdee / 10) * 10, target, protein, hCm: round1(hCm), floored: target === floor && tdee + perDay < floor };
    }
    const update = () => {
      const r = compute(new FormData(modalForm));
      $('#calc-out').innerHTML = r ? `<div class="row" style="justify-content:space-between"><div><div class="sub">Maintenance</div><strong>${fmt(r.tdee, 0)} kcal</strong></div>
        <div><div class="sub">Your target</div><div class="big" style="font-size:26px">${fmt(r.target, 0)}<small> kcal</small></div></div>
        <div><div class="sub">Protein</div><strong>${r.protein} g</strong></div></div>${r.floored ? '<p class="hint" style="margin:8px 0 0">Capped at a safe minimum. Pick a slower rate.</p>' : ''}`
        : '<div class="sub">Fill in the fields to see your numbers.</div>';
    };
    modalForm.addEventListener('input', update);
    modal.addEventListener('close', () => modalForm.removeEventListener('input', update), { once: true });
    update();
  }
  modalActions.calc = () => { modal.close(); setTimeout(calcForm, 0); };

  function liftChart(key) {
    const pts = [];
    S.workouts.forEach((w) => {
      const sets = parseLifts(w.exercises).filter((l) => l.key === key);
      if (sets.length) pts.push({ x: w.date, y: Math.max(...sets.map((l) => l.e1rm)), top: sets.reduce((a, b) => (b.weight > a.weight ? b : a)) });
    });
    pts.sort((a, b) => a.x.localeCompare(b.x));
    const b = liftBests().get(key);
    openModal(`<h2>${esc(b ? b.name : key)}</h2>
      <div class="sub" style="margin-bottom:8px">Estimated 1-rep max per session</div>${Charts.line(pts, { decimals: 0, label: 'Estimated 1RM' })}
      <ul class="list" style="margin-top:10px">${[...pts].reverse().slice(0, 10).map((p) => `<li><div class="grow">${relDay(p.x)}</div><span class="num">${fmt(p.top.weight)} × ${p.top.reps}</span></li>`).join('')}</ul>`, null, { hideSave: true });
  }

  // ---------- Apple Health import (via an Apple Shortcut that copies a text summary) ----------
  function healthImportForm(prefill = '') {
    openModal(`<h2>⌚ Import from Apple Health</h2>
      <p class="hint" style="margin-top:0">Run your <strong>Gritty Fit Health</strong> Shortcut first, then tap Paste.</p>
      <button class="btn primary block" data-modal-action="health-paste">Paste from Shortcut</button>
      <details style="margin:10px 0"><summary class="sub" style="cursor:pointer">Paste didn't work? Paste it here instead</summary>
        <textarea id="health-text" placeholder="GRITTYFIT&#10;Steps: 8432&#10;…" style="margin-top:8px;min-height:90px">${esc(prefill)}</textarea></details>
      <div id="health-preview"></div>`, (fd) => applyHealthImport(fd), { saveLabel: 'Import' });
    $('#health-text').addEventListener('input', (e) => previewHealth(e.target.value));
    if (prefill) previewHealth(prefill);
  }
  let healthParsed = null;
  modalActions['health-paste'] = async () => {
    try {
      const text = await navigator.clipboard.readText();
      $('#health-text').value = text;
      previewHealth(text);
    } catch (e) {
      const d = $('#modal-form details'); if (d) d.open = true;
      toast('Couldn\'t read the clipboard. Long-press the box and Paste.');
    }
  };
  function previewHealth(text) {
    const r = HealthImport.parse(text);
    healthParsed = r;
    const box = $('#health-preview');
    if (!r.ok) { box.innerHTML = text.trim() ? '<p class="hint">That doesn\'t look like the Shortcut\'s output. It should start with GRITTYFIT.</p>' : ''; return; }
    const t = todayISO();
    const u = wUnit();
    const wConv = r.weight == null ? null : r.weightUnit && r.weightUnit !== u ? round1(r.weightUnit === 'kg' ? r.weight / 0.45359237 : r.weight * 0.45359237) : round1(r.weight);
    r.weightConv = wConv;
    const check = (name, label, val, on = true, extra = '') => val == null ? '' : `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span><strong>${label}</strong> ${val}${extra}</span></label>`;
    const dupKey = (w) => `${w.date}T${w.time}|${w.rawName || w.name}`;
    const have = new Set(S.workouts.map((w) => w.healthKey).filter(Boolean));
    let h = `<div class="card" style="background:var(--surface-2);margin-top:12px">
      ${field('Daily totals are for', `<select name="hdate"><option value="${t}">Today, ${prettyDate(t)}</option><option value="${addDays(t, -1)}">Yesterday, ${prettyDate(addDays(t, -1))}</option></select>`)}
      ${check('h_steps', 'Steps', r.steps != null ? fmt(r.steps, 0) : null)}
      ${check('h_active', 'Active calories', r.active != null ? fmt(r.active, 0) + ' kcal' : null)}
      ${check('h_exercise', 'Exercise', r.exerciseMin != null ? r.exerciseMin + ' min' : null)}
      ${check('h_sleep', 'Sleep', r.sleepMin != null ? fmtSleep(r.sleepMin) : null)}
      ${check('h_rhr', 'Resting heart rate', r.rhr != null ? r.rhr + ' bpm' : null)}
      ${check('h_weight', 'Weigh-in', wConv != null ? `${fmt(wConv)} ${u}` : null, true, r.bodyFat != null ? ` · ${fmt(r.bodyFat)}% fat` : '')}
      ${r.workouts.map((w, i) => { const dup = have.has(dupKey(w)); return check('h_w' + i, '⌚ ' + esc(w.rawName || w.name), [w.date ? relDay(w.date) + (w.time ? ' ' + w.time : '') : '', w.minutes ? w.minutes + ' min' : '', w.kcal ? w.kcal + ' kcal' : ''].filter(Boolean).join(' · '), !dup, dup ? ' <span class="sub">(already imported)</span>' : ''); }).join('')}
      </div>`;
    // habits that will be ticked
    const ticks = habitsFromHealth(r, false);
    if (ticks.length) h += `<p class="hint">Will also check off: ${ticks.map((x) => '<strong>' + esc(x.name) + '</strong>').join(', ')}</p>`;
    box.innerHTML = h;
  }
  // Habits whose names mention steps/sleep with a number, e.g. "10,000 steps", "10k steps", "7+ hours sleep"
  function habitsFromHealth(r) {
    const out = [];
    activeHabits().forEach((hb) => {
      const n = hb.name.toLowerCase();
      if (/step/.test(n) && r.steps != null) {
        const m = n.replace(/(\d),(\d{3})/g, '$1$2').match(/(\d+(?:\.\d+)?)\s*(k\b)?/);
        const target = m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
        if (target && r.steps >= target) out.push(hb);
      } else if (/sleep/.test(n) && r.sleepMin != null) {
        const m = n.match(/(\d+(?:\.\d+)?)/);
        if (m && r.sleepMin / 60 >= Number(m[1])) out.push(hb);
      }
    });
    return out;
  }
  function applyHealthImport(fd) {
    const r = healthParsed;
    if (!r || !r.ok) { toast('Paste the Shortcut\'s output first'); return false; }
    const date = fd.get('hdate') || todayISO();
    const on = (k) => fd.get(k) === 'on';
    const day = S.health[date] || (S.health[date] = {});
    const done = [];
    if (on('h_steps')) { day.steps = r.steps; done.push('steps'); }
    if (on('h_active')) { day.active = r.active; done.push('active calories'); }
    if (on('h_exercise')) { day.exerciseMin = r.exerciseMin; done.push('exercise minutes'); }
    if (on('h_sleep')) { day.sleepMin = r.sleepMin; done.push('sleep'); }
    if (on('h_rhr')) { day.rhr = r.rhr; done.push('resting HR'); }
    day.at = new Date().toISOString();
    if (on('h_weight') && r.weightConv != null) {
      const existing = S.body.find((b) => b.date === date && (b.source === 'Apple Health' || b.weight === r.weightConv));
      const rec = { ...(existing || { id: uid(), date, notes: '' }), weight: r.weightConv, source: 'Apple Health' };
      if (r.bodyFat != null) rec.bodyFat = r.bodyFat;
      if (existing) Object.assign(existing, rec); else S.body.push(rec);
      done.push('weigh-in');
    }
    let added = 0;
    r.workouts.forEach((w, i) => {
      if (!on('h_w' + i)) return;
      const key = `${w.date}T${w.time}|${w.rawName || w.name}`;
      if (S.workouts.some((x) => x.healthKey === key)) return;
      S.workouts.push({ id: uid(), type: w.name, minutes: w.minutes, kcal: w.kcal, avgHr: w.avgHr, intensity: null, exercises: '',
        notes: w.rawName && w.rawName !== w.name ? w.rawName : '', date: w.date || date, time: w.time || '', source: 'Apple Health', healthKey: key });
      added++;
    });
    if (added) done.push(`${added} workout${added > 1 ? 's' : ''}`);
    const log = S.habitLog[date] || (S.habitLog[date] = []);
    const ticked = habitsFromHealth({ steps: on('h_steps') ? r.steps : null, sleepMin: on('h_sleep') ? r.sleepMin : null }).filter((hb) => !log.includes(hb.id));
    ticked.forEach((hb) => log.push(hb.id));
    save();
    toast(done.length ? `Imported ${done.join(', ')}${ticked.length ? ` · ✓ ${ticked.length} habit${ticked.length > 1 ? 's' : ''}` : ''}` : 'Nothing selected');
  }
  modalActions['health-import'] = () => { modal.close(); setTimeout(() => healthImportForm(), 0); };

  function habitForm() {
    openModal(`<h2>New daily habit</h2>${field('Habit', inText('name', '', 'required autofocus placeholder="e.g. No snacking after 8pm"'))}`, (fd) => {
      S.habits.push({ id: uid(), name: fd.get('name').trim(), active: true }); save();
    });
  }

  // ---------- actions ----------
  const find = (list, id) => S[list].find((x) => x.id === id);
  const actions = {
    'open-settings': settingsForm,
    goto: (el) => { if (el.dataset.seg) { if (el.dataset.tab === 'body') ui.bodySeg = el.dataset.seg; else { ui.goalSeg = el.dataset.seg; ui.reviewWeek = null; } } setTab(el.dataset.tab); },
    'toggle-habit': (el) => {
      const t = todayISO(), list = S.habitLog[t] || (S.habitLog[t] = []);
      const i = list.indexOf(el.dataset.id);
      if (i >= 0) list.splice(i, 1); else list.push(el.dataset.id);
      save(); render();
      if (i < 0 && activeHabits().every((h) => habitDone(t, h.id))) toast('All habits done today 🔥');
    },
    'add-food': () => foodForm(),
    'edit-food': (el) => foodForm(find('food', el.dataset.id)),
    'quick-food': (el) => { const f = find('food', el.dataset.id); S.food.push({ ...f, id: uid(), date: ui.foodDate, time: nowTime() }); save(); render(); toast(`Added ${f.name}`); },
    'del-food': (el) => { S.food = S.food.filter((x) => x.id !== el.dataset.id); save(); render(); },
    'food-day': (el) => { ui.foodDate = addDays(ui.foodDate, +el.dataset.delta); if (ui.foodDate > todayISO()) ui.foodDate = todayISO(); render(); },
    'add-workout': () => workoutForm(),
    'health-import': () => healthImportForm(),
    'repeat-workout': (el) => { const w = find('workouts', el.dataset.id); workoutForm({ ...w, id: undefined, date: todayISO(), notes: '' }); },
    'lift-chart': (el) => liftChart(el.dataset.key),
    'review-week': (el) => { const cur = weekStart(todayISO()); let n = addDays(ui.reviewWeek || cur, +el.dataset.delta); if (n > cur) n = cur; ui.reviewWeek = n; render(); },
    calc: calcForm,
    'backup-now': () => modalActions.export(),
    'edit-workout': (el) => workoutForm(find('workouts', el.dataset.id)),
    'del-workout': (el) => { if (confirm('Delete this workout?')) { S.workouts = S.workouts.filter((x) => x.id !== el.dataset.id); save(); render(); } },
    'add-body': () => bodyForm(),
    'edit-body': (el) => bodyForm(find('body', el.dataset.id)),
    'del-body': (el) => { if (confirm('Delete this entry?')) { S.body = S.body.filter((x) => x.id !== el.dataset.id); save(); render(); } },
    'body-seg': (el) => { ui.bodySeg = el.dataset.seg; render(); },
    'goal-seg': (el) => { ui.goalSeg = el.dataset.seg; render(); },
    'add-photo': photoForm,
    'pick-photo': (el) => {
      const id = el.dataset.id, i = ui.compare.indexOf(id);
      if (i >= 0) ui.compare.splice(i, 1); else { ui.compare.push(id); if (ui.compare.length > 2) ui.compare.shift(); }
      renderPhotos();
    },
    'clear-compare': () => { ui.compare = []; renderPhotos(); },
    'view-photo': async (el) => {
      const p = await DB.getPhoto(el.dataset.id);
      openModal(`<h2>${prettyDate(p.date, { month: 'long', day: 'numeric', year: 'numeric' })}${p.pose ? ' · ' + esc(p.pose) : ''}</h2>
        <img src="${ui.photoUrls.get(p.id)}" alt="" style="width:100%;border-radius:12px;display:block;margin-bottom:12px">
        <button class="btn danger small" data-modal-action="del-photo" data-id="${p.id}">Delete photo</button>`, null, { hideSave: true });
    },
    'journal-today': () => journalForm(),
    'edit-journal': (el) => journalForm(find('journal', el.dataset.id)),
    'add-goal': () => goalForm(),
    'edit-goal': (el) => goalForm(find('goals', el.dataset.id)),
    'toggle-goal': (el) => { const g = find('goals', el.dataset.id); g.done = !g.done; g.doneAt = g.done ? todayISO() : null; save(); render(); if (g.done) toast('Goal achieved 🏆'); },
    'add-habit': habitForm,
    'toggle-habit-active': (el) => { const hb = find('habits', el.dataset.id); hb.active = !hb.active; save(); render(); },
    'del-habit': (el) => { if (confirm('Delete this habit and its history?')) { S.habits = S.habits.filter((x) => x.id !== el.dataset.id); Object.values(S.habitLog).forEach((l) => { const i = l.indexOf(el.dataset.id); if (i >= 0) l.splice(i, 1); }); save(); render(); } },
  };
  modalActions['del-photo'] = async (b) => {
    if (!confirm('Delete this photo?')) return;
    await DB.deletePhoto(b.dataset.id);
    const u = ui.photoUrls.get(b.dataset.id); if (u) URL.revokeObjectURL(u); ui.photoUrls.delete(b.dataset.id);
    ui.compare = ui.compare.filter((x) => x !== b.dataset.id);
    modal.close(); render();
  };

  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.tabbar [data-tab]');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    const el = e.target.closest('[data-action]');
    if (!el || el.closest('#modal')) return;
    e.preventDefault();
    const fn = actions[el.dataset.action];
    if (fn) fn(el);
  });

  // ---------- render ----------
  const TITLES = { today: 'Today', food: 'Food', train: 'Training', body: 'Body', journal: 'Goals & Journal' };
  function setTab(tab) {
    ui.tab = tab;
    if (tab === 'food') ui.foodDate = todayISO();
    try { localStorage.setItem('gf-tab', tab); } catch (_) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    $('#view-title').textContent = TITLES[ui.tab];
    $('#today-label').textContent = prettyDate(todayISO(), { weekday: 'long', month: 'long', day: 'numeric' });
    document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    $('#view').innerHTML = views[ui.tab]();
    if (ui.tab === 'body' && ui.bodySeg === 'photos') renderPhotos();
  }

  // re-render when the app comes back after midnight
  let lastDay = todayISO();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && todayISO() !== lastDay) { lastDay = todayISO(); ui.foodDate = lastDay; render(); }
  });

  async function boot() {
    try {
      S = (await DB.getState()) || DEFAULT_STATE();
      S = Object.assign(DEFAULT_STATE(), S, { settings: Object.assign(DEFAULT_STATE().settings, S.settings) });
      if (!S.health) S.health = {};
    } catch (e) {
      $('#view').innerHTML = `<div class="card"><p>Could not open on-device storage (${esc(e.message)}). Private browsing mode can block it.</p></div>`;
      return;
    }
    try { const t = localStorage.getItem('gf-tab'); if (t && views[t]) ui.tab = t; } catch (_) { /* ignore */ }
    render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot();
})();
