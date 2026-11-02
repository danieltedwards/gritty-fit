/* GRIT plan editor (coach). Edits a draft copy of a plan's JSON, then saves it to the coach's
   library through Cloud. Used for templates and for client-specific versions. */
(function () {
  'use strict';
  let C;
  // ui.ed = { data, row: {visibility, published}, isNew, forClientName, open: Set, dirty, onSaved }
  const esc = (s) => C.esc(s);
  const ed = () => C.ui.ed;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const rid = () => Math.random().toString(36).slice(2, 7);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';

  // ---------- path helpers ----------
  const parsePath = (p) => p.split('.').map((k) => (/^\d+$/.test(k) ? +k : k));
  function getAt(obj, path) { return parsePath(path).reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setAt(obj, path, val) {
    const ks = parsePath(path); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = typeof ks[i + 1] === 'number' ? [] : {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
  }
  const parentOf = (path) => { const ks = path.split('.'); const idx = +ks.pop(); return { arrPath: ks.join('.'), idx }; };

  // section body <-> plain text (paragraphs; "- " lines = bullets; "a | b" lines = table, first row = headings)
  function bodyToText(body) {
    return (body || []).map((b) => {
      if (b.p != null) return b.p;
      if (b.ul) return b.ul.map((x) => '- ' + x).join('\n');
      if (b.table) return [b.table.head, ...b.table.rows].map((r) => r.join(' | ')).join('\n');
      return '';
    }).join('\n\n');
  }
  function textToBody(text) {
    return String(text || '').split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
      const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.every((l) => /^[-•*]\s+/.test(l))) return { ul: lines.map((l) => l.replace(/^[-•*]\s+/, '')) };
      if (lines.length > 1 && lines.every((l) => l.includes(' | '))) { const rows = lines.map((l) => l.split('|').map((c) => c.trim())); return { table: { head: rows[0], rows: rows.slice(1) } }; }
      return { p: lines.join(' ') };
    });
  }
  const weeksToText = (w) => { if (!w || !w.length) return ''; const s = [...w].sort((a, b) => a - b); const contig = s.every((x, i) => i === 0 || x === s[i - 1] + 1); return contig && s.length > 1 ? `${s[0]}-${s[s.length - 1]}` : s.join(','); };
  const textToWeeks = (t) => {
    const out = new Set();
    String(t).split(',').forEach((part) => { const m = part.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/); if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.add(i); } else if (/^\d+$/.test(part.trim())) out.add(+part.trim()); });
    return [...out].sort((a, b) => a - b);
  };

  // ---------- inputs ----------
  const inp = (path, val, opts = {}) => {
    const t = opts.type || 'text';
    const attrs = `data-ed="${path}"${opts.kind ? ` data-kind="${opts.kind}"` : ''} ${opts.attrs || ''}`;
    if (t === 'textarea') return `<textarea ${attrs} rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(val ?? '')}</textarea>`;
    if (t === 'check') return `<label class="ed-check"><input type="checkbox" ${attrs} ${val ? 'checked' : ''}><span>${esc(opts.label)}</span></label>`;
    if (t === 'select') return `<select ${attrs}>${opts.options.map(([v, l]) => `<option value="${esc(v)}" ${String(val ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    return `<input type="${t === 'number' ? 'number' : 'text'}" ${t === 'number' ? 'inputmode="decimal" step="any"' : ''} ${attrs} value="${esc(val ?? '')}" placeholder="${esc(opts.ph || '')}">`;
  };
  const lab = (label, html, cls = '') => `<label class="field ${cls}"><span>${esc(label)}</span>${html}</label>`;
  const tools = (path, { up = true, down = true, del = true } = {}) => `<span class="ed-tools">${up ? `<button data-action="ed-move" data-path="${path}" data-dir="-1" aria-label="Move up">↑</button>` : ''}${down ? `<button data-action="ed-move" data-path="${path}" data-dir="1" aria-label="Move down">↓</button>` : ''}${del ? `<button data-action="ed-del" data-path="${path}" aria-label="Delete">✕</button>` : ''}</span>`;
  const details = (key, summary, body, extraCls = '') => `<details class="card ed-sec ${extraCls}" data-key="${key}" ${ed().open.has(key) ? 'open' : ''}><summary>${summary}</summary><div class="ed-body">${body}</div></details>`;

  const ROLES = [['main', 'Main lift'], ['accessory', 'Accessory'], ['isolation', 'Isolation'], ['core', 'Core'], ['cardio', 'Cardio / conditioning']];
  const REGIONS = [['lower', 'Lower body'], ['upper', 'Upper body'], ['full', 'Full body'], ['', '—']];

  function exerciseHTML(path, ex, i, n, isSuperset) {
    return `<div class="ed-ex"><div class="ed-ex-head"><span class="ed-ex-n">${isSuperset ? String.fromCharCode(65 + i) : i + 1}</span>
        ${inp(path + '.name', ex.name, { ph: 'Exercise name', attrs: 'class="ed-ex-name"' })}${tools(path, { up: i > 0, down: i < n - 1 })}</div>
      <div class="ed-grid4">${lab('Sets', inp(path + '.sets', ex.sets, { type: 'number', kind: 'int' }))}${lab('Reps', inp(path + '.reps', ex.reps, { ph: '8–12' }))}${lab('Tempo', inp(path + '.tempo', ex.tempo, { ph: '3-1-1-1' }))}${lab('Rest', inp(path + '.rest', ex.rest, { ph: '60 sec' }))}</div>
      <div class="ed-grid2">${lab('Type', inp(path + '.role', ex.role || 'accessory', { type: 'select', options: ROLES }))}${lab('Effort', inp(path + '.effort', ex.effort, { ph: 'RPE 7' }))}</div>
      ${lab('Coaching cue', inp(path + '.notes', ex.notes, { ph: 'Ribs down, squeeze at the top…' }))}
      <div class="row">${inp(path + '.each', ex.each, { type: 'check', label: 'Each side / leg' })}${inp(path + '.bodyweight', ex.bodyweight, { type: 'check', label: 'Bodyweight' })}${inp(path + '.region', ex.region || '', { type: 'select', options: [['', 'Region: from day'], ['lower', 'Lower body'], ['upper', 'Upper body']] })}</div></div>`;
  }

  function dayHTML(d, di, nDays) {
    const p = `days.${di}`;
    const warmups = Object.entries(ed().data.warmups || {}).map(([k, w]) => [k, w.name]);
    let body = `<div class="ed-grid2">${lab('Label', inp(p + '.label', d.label, { ph: 'Day 1' }))}${lab('Name', inp(p + '.name', d.name, { ph: 'Build the Shelf' }))}</div>
      ${lab('Focus of the day', inp(p + '.focus', d.focus, { type: 'textarea', rows: 2, ph: 'One line that sets the intent…' }))}
      <div class="ed-grid2">${lab('Body region', inp(p + '.region', d.region || '', { type: 'select', options: REGIONS }))}${lab('Warm-up', inp(p + '.warmup', d.warmup || '', { type: 'select', options: [['', 'None'], ...warmups] }))}</div>
      <div class="row">${inp(p + '.optional', d.optional, { type: 'check', label: 'Optional day' })}${inp(p + '.freeform', d.freeform, { type: 'check', label: 'Client adds own exercises' })}</div>`;
    if (d.freeform) body += lab('Suggestions (comma separated)', inp(p + '.suggestions', (d.suggestions || []).join(', '), { kind: 'list', ph: 'Shoulders, Core, 20 min cardio' }));
    (d.blocks || []).forEach((b, bi) => {
      const bp = `${p}.blocks.${bi}`;
      const ss = b.type === 'superset';
      body += `<div class="ed-block ${ss ? 'superset' : ''}"><div class="ed-block-head">
          ${inp(bp + '.type', b.type || 'single', { type: 'select', options: [['single', 'Straight sets'], ['superset', 'Superset / circuit']] })}
          ${tools(bp, { up: bi > 0, down: bi < d.blocks.length - 1 })}</div>
        ${ss || b.name ? `<div class="ed-grid2">${lab('Block name', inp(bp + '.name', b.name, { ph: ss ? 'Block 1 — Mechanical Tension' : 'Core' }))}${ss ? lab('Rest after round', inp(bp + '.rest', b.rest, { ph: '60 sec' })) : ''}</div>` : ''}
        ${ss ? lab('Block instructions', inp(bp + '.note', b.note, { ph: 'No rest between exercises…' })) : ''}
        ${(b.exercises || []).map((ex, xi) => exerciseHTML(`${bp}.exercises.${xi}`, ex, xi, b.exercises.length, ss)).join('')}
        <button class="link-btn" data-action="ed-add" data-path="${bp}.exercises" data-kind="exercise">+ Exercise</button>
        ${!ss && !b.name ? `<button class="link-btn" data-action="ed-name-block" data-path="${bp}" style="margin-left:12px">+ Block name</button>` : ''}</div>`;
    });
    body += `<button class="btn small block" data-action="ed-add" data-path="${p}.blocks" data-kind="block">+ Add block (exercise or superset)</button>`;
    const summary = `<span><strong>${esc(d.label || 'Day')}</strong> · ${esc(d.name || 'Untitled')} <span class="sub">${(d.blocks || []).reduce((a, b) => a + (b.exercises || []).length, 0)} exercises${d.optional ? ' · optional' : ''}</span></span>${tools(p, { up: di > 0, down: di < nDays - 1 })}`;
    return details('day-' + (d.id || di), summary, body);
  }

  function viewEditor() {
    const E = ed();
    if (!E) return '<div class="card"><div class="empty">Nothing to edit.</div></div>';
    const d = E.data;
    let h = `<div class="card ed-top">${E.forClientName ? `<div class="week-pill" style="margin:0 0 8px">Custom plan for ${esc(E.forClientName)}</div>` : ''}
      <div class="row" style="justify-content:space-between"><strong>${E.isNew ? 'New plan' : 'Editing'}</strong><span class="sub">${E.dirty ? 'Unsaved changes' : 'Saved'}</span></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-action="ed-save">Save${E.forClientName ? ` for ${esc(E.forClientName)}` : ''}</button><button class="btn" data-action="ed-cancel">Close</button></div></div>`;
    h += details('info', '<strong>Plan details</strong>', `${lab('Name', inp('name', d.name, { ph: 'Project Big Booty, Snatched Waist' }))}
      <div class="ed-grid2">${lab('Phase', inp('phase', d.phase, { ph: 'Phase I – Foundation' }))}${lab('Coach', inp('coach', d.coach))}</div>
      ${lab('Subtitle', inp('subtitle', d.subtitle, { ph: '12-Week Glute Priority Strength & Hypertrophy' }))}
      ${lab('Summary (shown when choosing a plan)', inp('summary', d.summary, { type: 'textarea', rows: 3 }))}
      <div class="ed-grid2">${lab('Total weeks', inp('weeks', d.weeks, { type: 'number', kind: 'int' }))}${lab('Block length (weeks)', inp('cycleWeeks', d.cycleWeeks, { type: 'number', kind: 'int' }))}</div>
      ${lab('Blocks note', inp('blocksNote', d.blocksNote, { type: 'textarea', rows: 2, ph: 'Block 2 repeats with heavier loads…' }))}
      ${lab('Days per week (label)', inp('daysPerWeek', d.daysPerWeek, { ph: '4 + 1 optional' }))}
      ${lab('Tags (comma separated)', inp('tags', (d.tags || []).join(', '), { kind: 'list' }))}
      <p class="hint">Load jumps when a lift progresses: lower body ${esc((d.progression && d.progression.loadJumps && d.progression.loadJumps.lower) || '+10 lb')}, upper body ${esc((d.progression && d.progression.loadJumps && d.progression.loadJumps.upper) || '+5 lb')}.</p>`);
    h += details('weeks', `<strong>Week-by-week guide</strong> <span class="sub">${(d.weekGuide || []).length} phases</span>`,
      (d.weekGuide || []).map((g, i) => `<div class="ed-row"><div class="ed-grid2">${lab('Weeks', inp(`weekGuide.${i}.weeks`, weeksToText(g.weeks), { kind: 'weeks', ph: '1-2' }))}${lab('Label', inp(`weekGuide.${i}.label`, g.label, { ph: 'Movement quality' }))}</div>
        ${lab('Effort', inp(`weekGuide.${i}.effort`, g.effort, { ph: 'Main lifts 2–3 RIR' }))}${lab('Note', inp(`weekGuide.${i}.note`, g.note, { type: 'textarea', rows: 2 }))}
        <div class="row" style="justify-content:space-between">${inp(`weekGuide.${i}.deload`, g.deload, { type: 'check', label: 'Deload week' })}${tools(`weekGuide.${i}`, { up: i > 0, down: i < d.weekGuide.length - 1 })}</div></div>`).join('')
      + `<button class="btn small block" data-action="ed-add" data-path="weekGuide" data-kind="week">+ Add phase</button><p class="hint">Weeks count within a block (e.g. 1-2, 3-5, 6); they repeat for each block.</p>`);
    h += `<div class="res-head" style="margin:18px 0 8px">Training days</div>` + (d.days || []).map((day, i) => dayHTML(day, i, d.days.length)).join('')
      + `<button class="btn block" data-action="ed-add" data-path="days" data-kind="day" style="margin-bottom:14px">+ Add day</button>`;
    const c = d.cardio;
    h += details('weekly', `<strong>Each week: cardio & extras</strong> <span class="sub">${(d.extras || []).length} extras</span>`,
      (c ? `<div class="ed-row"><div class="row" style="justify-content:space-between"><strong>Cardio</strong><button class="link-btn" data-action="ed-cardio-off">Remove</button></div>
          <div class="ed-grid4">${lab('Min ×/wk', inp('cardio.perWeek.0', c.perWeek[0], { type: 'number', kind: 'int' }))}${lab('Max ×/wk', inp('cardio.perWeek.1', c.perWeek[1], { type: 'number', kind: 'int' }))}${lab('Min minutes', inp('cardio.minutes.0', c.minutes[0], { type: 'number', kind: 'int' }))}${lab('Max minutes', inp('cardio.minutes.1', c.minutes[1], { type: 'number', kind: 'int' }))}</div>
          ${lab('Options (comma separated)', inp('cardio.options', (c.options || []).join(', '), { kind: 'list' }))}${lab('Note', inp('cardio.note', c.note))}</div>`
        : '<button class="btn small block" data-action="ed-cardio-on">+ Weekly cardio target</button>')
      + (d.extras || []).map((x, i) => `<div class="ed-row"><div class="row" style="justify-content:space-between;flex-wrap:nowrap">${inp(`extras.${i}.name`, x.name, { ph: 'Pilates class', attrs: 'class="ed-ex-name"' })}${tools(`extras.${i}`, { up: i > 0, down: i < d.extras.length - 1 })}</div>
          <div class="ed-grid2">${lab('Times per week', inp(`extras.${i}.perWeek`, x.perWeek, { type: 'number', kind: 'int' }))}${lab('Minutes', inp(`extras.${i}.minutes`, x.minutes, { type: 'number', kind: 'int' }))}</div>
          ${lab('Instructions', inp(`extras.${i}.notes`, x.notes, { ph: 'Reformer class, any studio' }))}${inp(`extras.${i}.cardio`, x.cardio, { type: 'check', label: 'Counts toward cardio' })}</div>`).join('')
      + `<button class="btn small block" data-action="ed-add" data-path="extras" data-kind="extra" style="margin-top:10px">+ Weekly extra (Pilates, yoga, CrossFit, class…)</button>`);
    h += details('warmups', `<strong>Warm-ups</strong> <span class="sub">${Object.keys(d.warmups || {}).length}</span>`,
      Object.entries(d.warmups || {}).map(([k, w]) => `<div class="ed-row"><div class="row" style="justify-content:space-between;flex-wrap:nowrap">${inp(`warmups.${k}.name`, w.name, { attrs: 'class="ed-ex-name"' })}<span class="ed-tools"><button data-action="ed-del-warmup" data-key="${esc(k)}" aria-label="Delete warm-up">✕</button></span></div>
          ${lab('Note', inp(`warmups.${k}.note`, w.note))}
          ${(w.items || []).map((it, i) => `<div class="ed-grid2 ed-wu">${inp(`warmups.${k}.items.${i}.name`, it.name, { ph: 'Movement' })}<div class="row" style="flex-wrap:nowrap">${inp(`warmups.${k}.items.${i}.dose`, it.dose, { ph: '2×15' })}${tools(`warmups.${k}.items.${i}`, { up: false, down: false })}</div></div>`).join('')}
          <button class="link-btn" data-action="ed-add" data-path="warmups.${k}.items" data-kind="wuitem">+ Movement</button></div>`).join('')
      + `<button class="btn small block" data-action="ed-add-warmup">+ Warm-up</button><p class="hint">Attach a warm-up to a day in that day's settings.</p>`);
    h += details('sections', `<strong>Coaching notes</strong> <span class="sub">${(d.sections || []).length} sections</span>`,
      (d.sections || []).map((sec, i) => `<div class="ed-row"><div class="row" style="justify-content:space-between;flex-wrap:nowrap">${inp(`sections.${i}.title`, sec.title, { attrs: 'class="ed-ex-name"' })}${tools(`sections.${i}`, { up: i > 0, down: i < d.sections.length - 1 })}</div>
          ${inp(`sections.${i}.body`, bodyToText(sec.body), { type: 'textarea', rows: 6, kind: 'body' })}</div>`).join('')
      + `<button class="btn small block" data-action="ed-add" data-path="sections" data-kind="section">+ Section</button>
        <p class="hint">Blank line = new paragraph. Lines starting with "- " = bullet list. Lines like "Hip Thrust | 3-1-X-3" = a table (first line is the heading).</p>`);
    h += `<div class="row" style="margin:6px 0 20px"><button class="btn primary" data-action="ed-save">Save</button>${E.isNew ? '' : `<button class="btn" data-action="ed-duplicate">Save as new plan</button>`}</div>
      ${E.isNew ? '' : `<button class="btn danger block" data-action="ed-delete">Delete this plan</button>`}`;
    return h;
  }

  // ---------- events ----------
  function onInput(e) {
    const t = e.target;
    if (!t.dataset || t.dataset.ed == null || !ed()) return;
    let v;
    const kind = t.dataset.kind;
    if (t.type === 'checkbox') v = t.checked;
    else if (kind === 'int') v = t.value === '' ? null : Math.round(Number(t.value));
    else if (t.type === 'number') v = t.value === '' ? null : Number(t.value);
    else if (kind === 'list') v = t.value.split(',').map((x) => x.trim()).filter(Boolean);
    else if (kind === 'weeks') v = textToWeeks(t.value);
    else if (kind === 'body') v = textToBody(t.value);
    else v = t.value;
    setAt(ed().data, t.dataset.ed, v);
    ed().dirty = true;
    const flag = document.querySelector('.ed-top .sub'); if (flag) flag.textContent = 'Unsaved changes';
    // structural fields re-render so dependent inputs appear
    if (/\.(type|freeform)$/.test(t.dataset.ed) && e.type === 'change') rerender();
  }
  function rememberOpen() {
    document.querySelectorAll('details.ed-sec').forEach((dt) => { if (dt.open) ed().open.add(dt.dataset.key); else ed().open.delete(dt.dataset.key); });
  }
  function rerender() { rememberOpen(); C.render(); }

  function uniqueExId(name) {
    const used = new Set(ed().data.days.flatMap((d) => (d.blocks || []).flatMap((b) => (b.exercises || []).map((x) => x.id))));
    let base = slug(name), id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    return id;
  }
  const NEW = {
    exercise: () => ({ id: 'new-' + rid(), name: '', sets: 3, reps: '10–12', role: 'accessory', rest: '60 sec' }),
    block: () => ({ type: 'single', exercises: [NEW.exercise()] }),
    day: () => { const n = ed().data.days.length + 1; let id = 'd' + n; while (ed().data.days.some((d) => d.id === id)) id = 'd' + n + '-' + rid(); return { id, label: 'Day ' + n, name: 'New day', region: 'lower', blocks: [NEW.block()] }; },
    week: () => ({ weeks: [], label: '', effort: '', note: '' }),
    section: () => ({ title: 'New section', body: [{ p: '' }] }),
    extra: () => ({ id: 'x-' + rid(), name: 'Pilates', perWeek: 1, minutes: 50, notes: '' }),
    wuitem: () => ({ name: '', dose: '' }),
  };

  function finalize(data) {
    const out = clone(data);
    out.days = (out.days || []).map((d) => ({ ...d, blocks: (d.blocks || []).map((b) => ({ ...b, exercises: (b.exercises || []).filter((x) => x.name && x.name.trim()) })).filter((b) => b.exercises.length) }));
    // give new exercises stable ids from their names (history and PRs follow ids)
    const used = new Set();
    out.days.forEach((d) => d.blocks.forEach((b) => b.exercises.forEach((x) => {
      if (!x.id || x.id.startsWith('new-')) { let base = slug(x.name), id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; x.id = id; }
      while (used.has(x.id)) x.id = x.id + '-' + rid();
      used.add(x.id);
      Object.keys(x).forEach((k) => { if (x[k] === '' || x[k] === null || x[k] === false) delete x[k]; });
      x.name = x.name.trim(); if (!x.sets) x.sets = 3; if (!x.reps) x.reps = '10';
    })));
    (out.weekGuide || []).forEach((g) => { if (!g.deload) delete g.deload; });
    out.weekGuide = (out.weekGuide || []).filter((g) => g.weeks && g.weeks.length);
    out.sections = (out.sections || []).filter((s) => s.title && s.title.trim());
    out.extras = (out.extras || []).filter((x) => x.name && x.name.trim());
    if (!out.extras.length) delete out.extras;
    out.schema = 1;
    return out;
  }

  const actions = {
    'ed-add': (el) => {
      const arr = getAt(ed().data, el.dataset.path) || [];
      if (!getAt(ed().data, el.dataset.path)) setAt(ed().data, el.dataset.path, arr);
      const item = NEW[el.dataset.kind]();
      arr.push(item);
      if (el.dataset.kind === 'day') ed().open.add('day-' + item.id);
      ed().dirty = true; rerender();
    },
    'ed-del': (el) => {
      const { arrPath, idx } = parentOf(el.dataset.path);
      const arr = getAt(ed().data, arrPath);
      const item = arr[idx];
      const what = item && (item.name || item.title || item.label) ? `"${item.name || item.title || item.label}"` : 'this';
      if (!confirm(`Delete ${what}?`)) return;
      arr.splice(idx, 1); ed().dirty = true; rerender();
    },
    'ed-move': (el) => {
      const { arrPath, idx } = parentOf(el.dataset.path);
      const arr = getAt(ed().data, arrPath), j = idx + Number(el.dataset.dir);
      if (j < 0 || j >= arr.length) return;
      [arr[idx], arr[j]] = [arr[j], arr[idx]]; ed().dirty = true; rerender();
    },
    'ed-name-block': (el) => { setAt(ed().data, el.dataset.path + '.name', 'Block'); ed().dirty = true; rerender(); },
    'ed-cardio-on': () => { ed().data.cardio = { perWeek: [3, 4], minutes: [20, 40], options: ['StairMaster', 'Incline Walking'], note: '' }; ed().dirty = true; rerender(); },
    'ed-cardio-off': () => { if (confirm('Remove the weekly cardio target?')) { delete ed().data.cardio; ed().dirty = true; rerender(); } },
    'ed-add-warmup': () => {
      const name = prompt('Warm-up name', 'Upper Body Primer'); if (!name) return;
      const key = slug(name);
      ed().data.warmups = ed().data.warmups || {};
      ed().data.warmups[key] = { name, note: '', items: [NEW.wuitem()] };
      ed().open.add('warmups'); ed().dirty = true; rerender();
    },
    'ed-del-warmup': (el) => {
      if (!confirm('Delete this warm-up?')) return;
      delete ed().data.warmups[el.dataset.key];
      ed().data.days.forEach((d) => { if (d.warmup === el.dataset.key) delete d.warmup; });
      ed().dirty = true; rerender();
    },
    'ed-save': async () => {
      rememberOpen();
      const E = ed();
      if (!E.data.name || !E.data.name.trim()) { C.toast('Give the plan a name'); return; }
      if (!E.data.days || !E.data.days.length) { C.toast('Add at least one day'); return; }
      const data = finalize(E.data);
      try {
        await Cloud.savePlan({ id: data.id, data, visibility: E.row.visibility, published: E.row.published }, E.grantTo);
        E.data = data; E.dirty = false; E.isNew = false;
        if (window.Training) { Training.cachePlan(data.id, data); Training.resetPlans(); }
        C.toast(E.forClientName ? `Saved. ${E.forClientName}'s app switches to it on next sync` : 'Plan saved');
        C.render();
      } catch (e) { C.toast('Save failed: ' + e.message); }
    },
    'ed-cancel': () => {
      if (ed() && ed().dirty && !confirm('Close without saving your changes?')) return;
      C.ui.ed = null; C.setTab('coach');
    },
    'ed-duplicate': () => {
      const name = prompt('Name for the new plan', (ed().data.name || '') + ' (copy)'); if (!name) return;
      const data = clone(ed().data);
      data.name = name; data.id = slug(name) + '-' + rid();
      delete data.forClient; delete data.basedOn; delete data.clientName;
      C.ui.ed = { data, row: { visibility: 'all', published: false }, isNew: true, open: new Set(['info']), dirty: true };
      C.toast('Copy created. Save to add it to your library (hidden until you publish)');
      rerender(); window.scrollTo(0, 0);
    },
    'ed-delete': async () => {
      const E = ed();
      if (!confirm(`Delete "${E.data.name}" from your library? Clients following it keep their logged workouts but lose the plan.`)) return;
      try { await Cloud.deletePlan(E.data.id); C.ui.ed = null; if (window.Training) Training.resetPlans(); C.toast('Plan deleted'); C.setTab('coach'); }
      catch (e) { C.toast('Delete failed: ' + e.message); }
    },
  };

  function open({ data, row, isNew, forClientName, grantTo }) {
    C.ui.ed = { data: clone(data), row: row || { visibility: 'all', published: true }, isNew: !!isNew, forClientName, grantTo, open: new Set(isNew ? ['info'] : []), dirty: !!isNew };
    C.setTab('editor');
  }
  function blankPlan() {
    return { schema: 1, id: 'plan-' + rid(), name: '', phase: '', coach: (Cloud.profile && Cloud.profile.full_name) || '', weeks: 6, cycleWeeks: 6, daysPerWeek: '', tags: [], summary: '',
      weekGuide: [{ weeks: [1, 2], label: 'Learn', effort: '2–3 RIR', note: '' }, { weeks: [3, 4, 5], label: 'Build', effort: '1–2 RIR', note: '' }, { weeks: [6], label: 'Deload', effort: 'Loads −10–20%, 3+ RIR', note: '', deload: true }],
      progression: { loadJumps: { lower: '+10 lb', upper: '+5 lb' } },
      warmups: {}, days: [{ id: 'd1', label: 'Day 1', name: 'New day', region: 'lower', blocks: [{ type: 'single', exercises: [{ id: 'new-' + rid(), name: '', sets: 3, reps: '8–12', role: 'accessory', rest: '90 sec' }] }] }], sections: [] };
  }

  window.Editor = {
    init(ctx) {
      C = ctx;
      Object.assign(ctx.actions, actions);
      ctx.views.editor = viewEditor;
      ctx.TITLES.editor = 'Plan editor';
      ctx.PARENT.editor = 'coach';
      document.addEventListener('input', onInput);
      document.addEventListener('change', onInput);
      document.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('ed-sec') && ed()) { if (e.target.open) ed().open.add(e.target.dataset.key); else ed().open.delete(e.target.dataset.key); } }, true);
    },
    open, blankPlan,
    _bodyToText: bodyToText, _textToBody: textToBody, _finalize: finalize,
  };
})();
