// GRIT: exercise library. A built-in starter library (exercises.json) plus the coach's own edits and
// exercises (Supabase table exercise_library). Every exercise name anywhere in the app is matched to a
// library entry through its other names, so "DB Bench", "Dumbbell Bench Press" and "dumbbell bench" are
// one lift for history and PRs. Coaches add cues, swaps and a demo video link (YouTube / Vimeo / any URL).
(function () {
  let C, base = [], custom = new Map(), byKey = new Map(), byId = new Map(), loaded = false, coachRows = null;
  const st = { q: '', cat: '', equip: '' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = () => (window.Cloud && Cloud._sb ? Cloud._sb() : null);
  const isCoach = () => !!(window.Cloud && Cloud.profile && Cloud.profile.role === 'coach');
  const me = () => (window.Cloud && Cloud.user ? Cloud.user.id : null);
  const CATS = ['Squat', 'Hinge', 'Lunge', 'Push', 'Pull', 'Olympic', 'Carry', 'Core', 'Arms', 'Shoulders', 'Legs', 'Glutes', 'Conditioning', 'Plyo', 'Mobility'];

  // ---------- name matching ----------
  const ABBR = { db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', kb: 'kettlebell', kbs: 'kettlebell', ohp: 'overhead press', ohs: 'overhead squat', rdl: 'romanian deadlift', rdls: 'romanian deadlift',
    sldl: 'stiff leg deadlift', hspu: 'handstand push up', t2b: 'toes to bar', ttb: 'toes to bar', k2e: 'knees to elbows', kte: 'knees to elbows', c2b: 'chest to bar', du: 'double unders', dus: 'double unders',
    tgu: 'turkish get up', ssb: 'safety bar', ghr: 'glute ham raise', bss: 'bulgarian split squat', rfess: 'bulgarian split squat', cgbp: 'close grip bench press', pushup: 'push up', pushups: 'push up',
    pullup: 'pull up', pullups: 'pull up', chinup: 'chin up', chinups: 'chin up', situp: 'sit up', situps: 'sit up', '&': ' ' };
  const DROP = /\b(superset|part [a-d]|with belt|beltless|emoms?|otm|e\d?mom|max effort|competition style|competition|comp|style|light|slow|heavy|warm ?up|each side|each|per side|focus|any|variation|optional)\b/g;
  const stem = (w) => (w.length > 3 && !/(ss|us|is)$/.test(w) ? w.replace(/sses$/, 'ss').replace(/ies$/, 'y').replace(/(?<=[a-z]{3})es$/, (m, o, s) => (/(ch|sh|x|ss)es$/.test(s.slice(0, o + 2)) ? '' : 'e')).replace(/s$/, '') : w);
  function norm(name) {
    let s = String(name || '').toLowerCase().replace(/[’'`]/g, '').replace(/\(.*?\)/g, ' ').replace(/&/g, ' and ');
    s = s.replace(/^\s*(superset\s*)?(\d+[a-z]\b|[a-z]\d\b)[\s.:)-]*/, ' ');
    s = s.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).map((w) => ABBR[w] || w).join(' ');
    return s.split(/\s+/).map(stem).join(' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const keyOf = (s) => norm(s).replace(/\s+/g, '');
  const keyLoose = (s) => norm(s).replace(DROP, ' ').replace(/\b(\d+)\b/g, ' ').replace(/\s+/g, '');

  function index() {
    byKey = new Map(); byId = new Map();
    const all = base.map((e) => (custom.has(e.id) ? Object.assign({}, e, custom.get(e.id), { id: e.id }) : e));
    custom.forEach((c, id) => { if (!base.some((e) => e.id === id)) all.push(Object.assign({ id }, c)); });
    all.forEach((e) => {
      if (e.hidden) return;
      byId.set(e.id, e);
      [e.name].concat(e.aliases || []).forEach((n) => { const k = keyOf(n); if (k && !byKey.has(k)) byKey.set(k, e); });
    });
    all.forEach((e) => { if (e.hidden) return; [e.name].concat(e.aliases || []).forEach((n) => { const k = keyLoose(n); if (k && !byKey.has('~' + k)) byKey.set('~' + k, e); }); });
  }
  function find(name) {
    if (!name) return null;
    const k = keyOf(name); if (byKey.has(k)) return byKey.get(k);
    const l = keyLoose(name); return byKey.get('~' + l) || null;
  }
  // key used to group sets for history / PRs
  function liftKey(name) { const e = find(name); return e ? 'ex:' + e.id : String(name).toLowerCase().replace(/\s+/g, ' ').trim(); }
  const list = () => [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

  // ---------- loading ----------
  async function loadBase() {
    try { const r = await fetch('exercises.json'); const j = await r.json(); base = j.exercises || []; } catch (_) { base = base || []; }
    index(); loaded = true;
  }
  async function loadCustom() {
    custom = new Map();
    const s = sb(), uid = me();
    let coachId = null;
    if (uid) coachId = isCoach() ? uid : (window.Cloud && Cloud.profile && Cloud.profile.coach_id) || null;
    if (s && coachId) {
      try {
        const { data, error } = await s.from('exercise_library').select('id,data').eq('coach_id', coachId);
        if (!error) { (data || []).forEach((r) => custom.set(r.id, r.data || {})); coachRows = true; try { await DB.setKV('exlib', [...custom.entries()]); } catch (_) {} }
        else coachRows = /exercise_library|schema cache|does not exist/i.test(error.message) ? 'missing' : null;
      } catch (_) { /* offline */ }
    }
    if (!custom.size) { try { const c = await DB.getKV('exlib'); if (Array.isArray(c) && uid) c.forEach(([k, v]) => custom.set(k, v)); } catch (_) {} }
    index();
  }

  // ---------- video ----------
  function videoEmbed(url) {
    if (!url) return '';
    let m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/);
    if (m) {
      const t = (String(url).match(/[?&]t=(\d+)/) || [])[1];
      return `<div class="ex-video"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&playsinline=1${t ? '&start=' + t : ''}" title="Demo video" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
    }
    m = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return `<div class="ex-video"><iframe src="https://player.vimeo.com/video/${m[1]}" title="Demo video" allow="fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
    if (/^https?:\/\//.test(url)) return `<a class="btn block" href="${esc(url)}" target="_blank" rel="noopener">▶ Watch demo ↗</a>`;
    return '';
  }

  // ---------- history for one exercise (current user's or a viewed client's) ----------
  function history(e) {
    const S = C.getState(); const out = []; const key = 'ex:' + e.id;
    (S.workouts || []).forEach((w) => {
      const sets = (C.liftSetsOf ? C.liftSetsOf(w) : []).filter((x) => x.key === key);
      const all = (w.sets || []).filter((x) => x && find(x.name) === e);
      if (!sets.length && !all.length) return;
      const top = sets.slice().sort((a, b) => b.weight - a.weight || (b.reps || 0) - (a.reps || 0))[0];
      out.push({ date: w.date, sets: Math.max(all.length, sets.length), top, e1rm: top && top.reps ? Math.round(top.weight * (1 + Math.min(top.reps, 12) / 30)) : null, reps: (all.length ? all : sets).map((x) => x.reps).filter(Boolean) });
    });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  // ---------- views ----------
  function filtered() {
    const q = keyOf(st.q);
    return list().filter((e) => (!st.cat || e.cat === st.cat) && (!st.equip || (e.equip || []).includes(st.equip))
      && (!q || keyOf(e.name).includes(q) || (e.aliases || []).some((a) => keyOf(a).includes(q)) || (e.muscles || []).some((m) => keyOf(m).includes(q))));
  }
  function rowsHTML() {
    const items = filtered();
    if (!items.length) return `<div class="empty">No exercises match.${isCoach() ? ' <button class="link-btn" data-action="exlib-new">Add one</button>' : ''}</div>`;
    return items.map((e) => `<button class="ex-row" data-action="exlib-open" data-id="${esc(e.id)}"><span class="ex-row-main"><strong>${esc(e.name)}</strong>
      <span class="sub">${esc([e.cat].concat(e.equip || []).filter(Boolean).join(' · '))}</span></span>${e.video ? '<span class="ex-row-vid" aria-label="Has video">▶</span>' : ''}</button>`).join('');
  }
  function equipOptions() { const s = new Set(); list().forEach((e) => (e.equip || []).forEach((q) => s.add(q))); return [...s].sort(); }
  function unmatchedFromPlans() {
    const cd = window.Cloud && Cloud.coachData ? Cloud.coachData() : null; if (!cd || !cd.plans) return [];
    const seen = new Map();
    cd.plans.forEach((p) => {
      const walk = (days) => (days || []).forEach((d) => (d.blocks || []).forEach((b) => (b.exercises || []).forEach((x) => {
        if (!x.name || find(x.name)) return; const k = keyOf(x.name); if (!k || k.length < 3) return;
        const c = seen.get(k) || { name: x.name, n: 0 }; c.n++; seen.set(k, c);
      })));
      walk(p.data && p.data.days); ((p.data && p.data.schedule) || []).forEach((w) => walk(w && w.days));
    });
    return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 60);
  }
  function view() {
    if (!loaded) { loadBase().then(() => C.render()); return '<div class="empty">Loading exercises…</div>'; }
    let h = `<div class="exlib-head"><input type="search" id="exlib-q" placeholder="Search ${byId.size} exercises, muscles…" value="${esc(st.q)}" autocomplete="off">
      ${isCoach() ? '<button class="btn small primary" data-action="exlib-new">+ New</button>' : ''}</div>
      <div class="chips-row exlib-cats"><button class="chip-btn ${!st.cat ? 'on' : ''}" data-action="exlib-cat" data-cat="">All</button>${CATS.map((c) => `<button class="chip-btn ${st.cat === c ? 'on' : ''}" data-action="exlib-cat" data-cat="${c}">${c}</button>`).join('')}</div>
      <select id="exlib-equip" class="small-select" style="margin:6px 0 10px"><option value="">Any equipment</option>${equipOptions().map((q) => `<option value="${esc(q)}" ${st.equip === q ? 'selected' : ''}>${esc(q)}</option>`).join('')}</select>
      <div class="card exlib-list" id="exlib-list">${rowsHTML()}</div>`;
    if (isCoach()) {
      if (coachRows === 'missing') h += '<p class="hint">Run the latest SQL in Supabase to save your own exercises and videos.</p>';
      const um = unmatchedFromPlans();
      if (um.length) h += `<details class="card"><summary><strong>In your plans, not in the library</strong> <span class="sub">${um.length}</span></summary>
        <p class="hint" style="margin-top:6px">Add them so clients get cues and videos, or add the name as an "other name" of an existing exercise.</p>
        ${um.map((u) => `<div class="row" style="justify-content:space-between;flex-wrap:nowrap;padding:4px 0"><span>${esc(u.name)} <span class="sub">×${u.n}</span></span><button class="btn small" data-action="exlib-new" data-name="${esc(u.name)}">+ Add</button></div>`).join('')}</details>`;
    }
    return h;
  }
  function open(id, name) {
    const e = id ? byId.get(id) : find(name);
    if (!e) {
      if (!name) return;
      C.openModal(`<h2>${esc(name)}</h2><p class="sub">Not in the exercise library yet.</p>${isCoach() ? `<button class="btn primary block" data-modal-action="exlib-new" data-name="${esc(name)}">Add to library</button>` : ''}`, null, { hideSave: true });
      return;
    }
    const hist = history(e);
    const best = hist.filter((x) => x.e1rm).sort((a, b) => b.e1rm - a.e1rm)[0];
    const u = (C.getState().settings || {}).units || 'lb';
    C.openModal(`<h2 style="margin-bottom:2px">${esc(e.name)}</h2>
      <div class="chips-row" style="margin-bottom:10px">${[e.cat].concat(e.equip || [], e.muscles || []).filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      ${videoEmbed(e.video)}
      ${(e.cues || []).length ? `<div class="res-head">Coaching cues</div><ul class="cues">${e.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${e.notes ? `<p>${esc(e.notes)}</p>` : ''}
      ${(e.swaps || []).length ? `<div class="res-head">Swaps</div><div class="chips-row">${e.swaps.map((s) => { const t = find(s); return t ? `<button class="chip-btn" data-modal-action="exlib-go" data-id="${esc(t.id)}">${esc(t.name)}</button>` : ''; }).join('')}</div>` : ''}
      <div class="res-head">${C.ui.viewAs ? 'Their history' : 'Your history'}</div>
      ${hist.length ? `${best ? `<p class="sub" style="margin:0 0 6px">Best: <strong>${best.top.weight} ${u} × ${best.top.reps}</strong> (est. 1RM ${best.e1rm})</p>` : ''}
        <ul class="list">${hist.slice(0, 6).map((x) => `<li><div class="grow"><div class="title">${esc(C.prettyDate(x.date, { month: 'short', day: 'numeric', year: '2-digit' }))}</div><div class="meta">${x.sets} set${x.sets === 1 ? "" : "s"}${x.reps.length ? ' · ' + esc(x.reps.join(', ')) + ' reps' : ''}</div></div><span class="num">${x.top ? `${x.top.weight}×${x.top.reps ?? '–'}` : ''}</span></li>`).join('')}</ul>`
        : '<p class="sub" style="margin-top:0">Not logged yet.</p>'}
      ${(e.aliases || []).length ? `<p class="hint">Also called: ${esc(e.aliases.slice(0, 8).join(', '))}${e.aliases.length > 8 ? '…' : ''}</p>` : ''}
      ${isCoach() && !C.ui.viewAs ? `<button class="btn block" data-modal-action="exlib-edit" data-id="${esc(e.id)}" style="margin-top:8px">✎ Edit (cues, swaps, video)</button>` : ''}`, null, { hideSave: true });
  }
  function editForm(e, presetName) {
    const isNew = !e;
    e = e || { name: presetName || '', cat: 'Push', equip: [], muscles: [], aliases: [], cues: [], swaps: [] };
    const csv = (a) => esc((a || []).join(', '));
    C.openModal(`<h2>${isNew ? 'New exercise' : 'Edit ' + esc(e.name)}</h2>
      ${C.field('Name', `<input type="text" name="name" value="${esc(e.name)}" required maxlength="80">`)}
      <div class="fields-2">${C.field('Movement', `<select name="cat">${CATS.map((c) => `<option ${e.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
        ${C.field('Equipment', `<input type="text" name="equip" value="${csv(e.equip)}" placeholder="barbell, dumbbell">`)}</div>
      ${C.field('Demo video link', `<input type="url" name="video" value="${esc(e.video || '')}" placeholder="https://youtube.com/watch?v=…">`, 'YouTube, Vimeo or any link. Plays right in the app.')}
      ${C.field('Coaching cues (one per line)', `<textarea name="cues" rows="4">${esc((e.cues || []).join('\n'))}</textarea>`)}
      ${C.field('Swaps (exercise names, comma separated)', `<input type="text" name="swaps" value="${csv(e.swaps)}">`)}
      ${C.field('Muscles', `<input type="text" name="muscles" value="${csv(e.muscles)}" placeholder="Quads, Glutes">`)}
      ${C.field('Other names (comma separated)', `<input type="text" name="aliases" value="${csv(e.aliases)}" placeholder="DB bench, flat dumbbell press">`, 'Any of these names in a plan or log count as this exercise.')}
      ${C.field('Notes', `<textarea name="notes" rows="2">${esc(e.notes || '')}</textarea>`)}
      ${!isNew ? `<button type="button" class="btn danger small" data-modal-action="exlib-hide" data-id="${esc(e.id)}" style="margin-top:6px">${base.some((b) => b.id === e.id) ? 'Hide from my library' : 'Delete exercise'}</button>` : ''}`, async (fd) => {
      const split = (k) => String(fd.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
      const data = { name: String(fd.get('name') || '').trim(), cat: fd.get('cat'), equip: split('equip').map((s) => s.toLowerCase()), video: String(fd.get('video') || '').trim() || undefined,
        cues: String(fd.get('cues') || '').split('\n').map((s) => s.trim()).filter(Boolean), swaps: split('swaps'), muscles: split('muscles'), aliases: split('aliases'), notes: String(fd.get('notes') || '').trim() || undefined };
      if (!data.name) return false;
      const dup = find(data.name);
      if (isNew && dup) { C.toast(`"${data.name}" is already in the library as ${dup.name}`); return false; }
      const id = isNew ? 'c-' + data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Math.random().toString(36).slice(2, 5) : e.id;
      if (!(await save(id, data))) return false;
      C.toast(isNew ? 'Added to your library' : 'Saved');
      setTimeout(() => open(id), 0);
    }, { saveLabel: isNew ? 'Add exercise' : 'Save' });
  }
  async function save(id, data) {
    const s = sb(); if (!s || !me()) { C.toast('Sign in as the coach to edit the library'); return false; }
    const { error } = await s.from('exercise_library').upsert({ coach_id: me(), id, data, updated_at: new Date().toISOString() }, { onConflict: 'coach_id,id' });
    if (error) { C.toast(/exercise_library|schema cache|does not exist/i.test(error.message) ? 'Run the latest SQL in Supabase first (exercise library).' : 'Couldn\'t save: ' + error.message); return false; }
    custom.set(id, data); index(); try { await DB.setKV('exlib', [...custom.entries()]); } catch (_) {}
    return true;
  }

  const actions = {
    'exlib-open': (el) => open(el.dataset.id, el.dataset.name),
    'ex-info': (el) => open(null, el.dataset.name),
    'exlib-cat': (el) => { st.cat = el.dataset.cat; C.render(); },
    'exlib-new': (el) => editForm(null, el.dataset.name),
    'exlib-go-tab': () => C.setTab('exercises'),
  };
  const modalActions = {
    'exlib-go': (b) => { C.closeModal(); setTimeout(() => open(b.dataset.id), 0); },
    'exlib-edit': (b) => { const e = byId.get(b.dataset.id); C.closeModal(); setTimeout(() => editForm(e), 0); },
    'exlib-new': (b) => { C.closeModal(); setTimeout(() => editForm(null, b.dataset.name), 0); },
    'exlib-hide': async (b) => {
      const e = byId.get(b.dataset.id); if (!e || !confirm(`Remove "${e.name}" from your library? Logged history is kept.`)) return;
      if (await save(e.id, Object.assign({}, custom.get(e.id) || {}, { hidden: true }))) { C.closeModal(); C.toast('Removed'); C.render(); }
    },
  };
  function onInput(e) {
    if (e.target.id === 'exlib-q' && e.type === 'input') { st.q = e.target.value; const l = document.getElementById('exlib-list'); if (l) l.innerHTML = rowsHTML(); }
    if (e.target.id === 'exlib-equip') { st.equip = e.target.value; const l = document.getElementById('exlib-list'); if (l) l.innerHTML = rowsHTML(); }
  }
  // <datalist> for name autocomplete in the plan editor
  function datalist() {
    let dl = document.getElementById('ex-names');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'ex-names'; document.body.appendChild(dl); }
    if (dl.childElementCount !== byId.size) dl.innerHTML = list().map((e) => `<option value="${esc(e.name)}">`).join('');
  }

  window.ExLib = {
    init(ctx) {
      C = ctx; Object.assign(ctx.actions, actions); Object.assign(ctx.modalActions, modalActions);
      ctx.views.exercises = view; ctx.TITLES.exercises = 'Exercises'; ctx.PARENT.exercises = 'train';
      document.addEventListener('input', onInput); document.addEventListener('change', onInput);
      loadBase().then(() => { datalist(); if (C.softRender && C.getState()) C.softRender(); });
    },
    onSignedIn() { loadCustom().then(() => { datalist(); C.softRender ? C.softRender() : C.render(); }); },
    onSignedOut() { custom = new Map(); index(); },
    find, liftKey, norm, keyOf, open, datalist, list, videoEmbed,
    get ready() { return loaded; },
    _setBase(b) { base = b; index(); loaded = true; },
  };
})();
