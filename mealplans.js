// GRIT: meal plans. The coach builds meal-plan templates (Meal 1: foods, with swap options and optional
// calories/protein), keeps them in a library (Supabase table meal_plans), and assigns one to a client from the
// client's Nutrition settings. The assigned plan is copied to the client, so it can be tweaked for that person
// without touching the template. The client ticks meals off (picking a swap if they want) instead of counting.
(function () {
  let C;
  const st = { list: null, loading: false, missing: false };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = () => (window.Cloud && Cloud._sb ? Cloud._sb() : null);
  const me = () => (window.Cloud && Cloud.user ? Cloud.user.id : null);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const totals = (plan) => {
    const ms = (plan && plan.meals) || [];
    const k = ms.reduce((a, m) => a + (num(m.kcal) || 0), 0), p = ms.reduce((a, m) => a + (num(m.p) || 0), 0);
    return { kcal: k || null, p: p || null };
  };

  // ---------- library (coach) ----------
  async function load() {
    const s = sb(); if (!s || !me()) { st.list = []; return; }
    st.loading = true;
    const { data, error } = await s.from('meal_plans').select('id,data,updated_at').eq('coach_id', me()).order('updated_at', { ascending: false });
    st.loading = false;
    if (error) { st.missing = /meal_plans|schema cache|does not exist/i.test(error.message); st.list = []; return; }
    st.list = (data || []).map((r) => Object.assign({ id: r.id }, r.data));
  }
  function section() {
    if (st.list == null) { if (!st.loading) load().then(() => C.render()); return '<div class="card"><div class="card-head"><h2>Meal plans</h2></div><div class="empty">Loading…</div></div>'; }
    const rows = st.list.map((pl) => { const t = totals(pl); return `<li><div class="grow" data-action="mp-edit" data-id="${esc(pl.id)}" style="cursor:pointer"><div class="title">${esc(pl.name)}</div>
      <div class="meta">${(pl.meals || []).length} meals${t.kcal ? ` · ${t.kcal} kcal` : ''}${t.p ? ` · ${t.p} g protein` : ''}${(pl.tags || []).length ? ' · ' + esc(pl.tags.join(', ')) : ''}</div></div>
      <button class="btn small" data-action="mp-copy" data-id="${esc(pl.id)}">Copy</button></li>`; }).join('');
    return `<div class="card"><div class="card-head"><h2>Meal plans · ${st.list.length}</h2><button class="btn small primary" data-action="mp-new">+ New</button></div>
      ${st.missing ? '<p class="hint">Run the latest SQL in Supabase to save meal plans.</p>' : ''}
      ${rows ? `<ul class="list">${rows}</ul>` : '<div class="empty">No meal plans yet. Build one (e.g. "1,800 cut") and assign it from a client\'s 🍽 Nutrition button (method: Meal plan).</div>'}</div>`;
  }

  // ---------- editor (template, or one client's copy) ----------
  function blankMeal(i) { return { name: `Meal ${i + 1}`, time: '', foods: '', swaps: [], kcal: null, p: null }; }
  function editor(plan, { onSave, title, forClient } = {}) {
    plan = JSON.parse(JSON.stringify(plan || { name: '', notes: '', tags: [], meals: [0, 1, 2, 3].map(blankMeal) }));
    const draw = () => {
      const mealHTML = (m, i) => `<div class="mp-meal"><div class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:8px">
          <input type="text" name="m${i}_name" value="${esc(m.name)}" placeholder="Meal ${i + 1}" style="flex:1;font-weight:700">
          <input type="text" name="m${i}_time" value="${esc(m.time || '')}" placeholder="7:00 am" style="width:92px">
          <button type="button" class="del" data-modal-action="mp-del-meal" data-i="${i}" aria-label="Remove meal">×</button></div>
        <textarea name="m${i}_foods" rows="3" placeholder="3 whole eggs&#10;1 cup oats with berries&#10;Black coffee">${esc(m.foods || '')}</textarea>
        <div class="fields-2">${C.field('kcal (optional)', `<input type="number" name="m${i}_kcal" value="${m.kcal ?? ''}" min="0">`)}${C.field('Protein g (optional)', `<input type="number" name="m${i}_p" value="${m.p ?? ''}" min="0">`)}</div>
        ${C.field('Swap options (one per line)', `<textarea name="m${i}_swaps" rows="2" placeholder="Greek yogurt, granola and a banana">${esc((m.swaps || []).join('\n'))}</textarea>`)}</div>`;
      C.openModal(`<h2>${esc(title || (plan.name ? 'Edit meal plan' : 'New meal plan'))}</h2>
        ${forClient ? `<p class="hint" style="margin-top:0">Changes apply to ${esc(forClient)} only. Your template stays the same.</p>` : ''}
        ${C.field('Name', `<input type="text" name="name" value="${esc(plan.name)}" required maxlength="80" placeholder="1,800 cut · 4 meals">`)}
        ${C.field('Tags (comma separated)', `<input type="text" name="tags" value="${esc((plan.tags || []).join(', '))}" placeholder="cut, busy, vegetarian">`)}
        ${plan.meals.map(mealHTML).join('')}
        <button type="button" class="btn small" data-modal-action="mp-add-meal">+ Add meal</button>
        ${C.field('Notes for the client', `<textarea name="notes" rows="2" placeholder="Drink 100 oz water. Veggies are free.">${esc(plan.notes || '')}</textarea>`)}
        ${!forClient && plan.id ? '<button type="button" class="btn danger small" data-modal-action="mp-delete" style="margin-top:6px">Delete meal plan</button>' : ''}`, async (fd) => {
        read(fd);
        if (!plan.name.trim()) { C.toast('Name the meal plan'); return false; }
        plan.meals = plan.meals.filter((m) => (m.foods || '').trim() || (m.swaps || []).length);
        if (!plan.meals.length) { C.toast('Add at least one meal'); return false; }
        return onSave(plan);
      }, { saveLabel: 'Save meal plan' });
      const tot = totals(plan);
      if (tot.kcal) { const h = document.querySelector('#modal-form h2'); if (h) h.insertAdjacentHTML('afterend', `<p class="hint">Plan total: ${tot.kcal} kcal${tot.p ? ` · ${tot.p} g protein` : ''}</p>`); }
    };
    const read = (fd) => {
      plan.name = String(fd.get('name') || ''); plan.notes = String(fd.get('notes') || '').trim();
      plan.tags = String(fd.get('tags') || '').split(',').map((x) => x.trim()).filter(Boolean);
      plan.meals = plan.meals.map((m, i) => ({ name: String(fd.get(`m${i}_name`) || m.name).trim() || `Meal ${i + 1}`, time: String(fd.get(`m${i}_time`) || '').trim(),
        foods: String(fd.get(`m${i}_foods`) || '').trim(), swaps: String(fd.get(`m${i}_swaps`) || '').split('\n').map((x) => x.trim()).filter(Boolean),
        kcal: num(fd.get(`m${i}_kcal`)), p: num(fd.get(`m${i}_p`)) }));
    };
    const fdNow = () => new FormData(document.getElementById('modal-form'));
    C.modalActions['mp-add-meal'] = () => { read(fdNow()); plan.meals.push(blankMeal(plan.meals.length)); draw(); };
    C.modalActions['mp-del-meal'] = (b) => { read(fdNow()); plan.meals.splice(+b.dataset.i, 1); draw(); };
    C.modalActions['mp-delete'] = async () => {
      if (!confirm(`Delete "${plan.name}"? Clients already on it keep their copy.`)) return;
      const { error } = await sb().from('meal_plans').delete().eq('coach_id', me()).eq('id', plan.id);
      if (error) { C.toast(error.message); return; }
      st.list = st.list.filter((x) => x.id !== plan.id); C.closeModal(); C.render();
    };
    draw();
  }
  async function saveTemplate(plan) {
    const s = sb(); if (!s || !me()) { C.toast('Sign in as the coach'); return false; }
    const id = plan.id || 'mp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const data = Object.assign({}, plan); delete data.id;
    const { error } = await s.from('meal_plans').upsert({ coach_id: me(), id, data, updated_at: new Date().toISOString() }, { onConflict: 'coach_id,id' });
    if (error) { C.toast(/meal_plans|schema cache|does not exist/i.test(error.message) ? 'Run the latest SQL in Supabase first (meal plans).' : 'Couldn\'t save: ' + error.message); return false; }
    plan.id = id; st.list = [plan].concat((st.list || []).filter((x) => x.id !== id));
    C.toast('Meal plan saved'); C.render(); return true;
  }

  // ---------- client: today's meals ----------
  function card(d, iso, items) {
    const S = C.getState(), n = S.nutrition, plan = n && n.coach && n.coach.mealPlan;
    if (!plan || !(plan.meals || []).length) return `<div class="card"><div class="card-head"><h2>Meal plan</h2></div><p class="sub">Your coach hasn't assigned a meal plan yet.</p></div>`;
    const ticks = ((n.mpTicks || {})[iso]) || {};
    const done = plan.meals.filter((_, i) => ticks[i] != null).length;
    const t = totals(plan);
    const eaten = plan.meals.reduce((a, m, i) => (ticks[i] != null ? { kcal: a.kcal + (num(m.kcal) || 0), p: a.p + (num(m.p) || 0) } : a), { kcal: 0, p: 0 });
    let h = `<div class="card"><div class="card-head"><h2>${esc(plan.name)}</h2><span class="sub">${done}/${plan.meals.length} meals</span></div>
      ${window.Nutrition && Nutrition.windowHTML ? Nutrition.windowHTML(n, iso) : ''}
      <div class="progress" style="margin-top:10px"><i style="width:${(done / plan.meals.length) * 100}%"></i></div>
      ${t.kcal ? `<p class="sub" style="margin:6px 0 0">${eaten.kcal} / ${t.kcal} kcal${t.p ? ` · ${eaten.p} / ${t.p} g protein` : ''}</p>` : ''}
      ${plan.notes ? `<p class="hint" style="white-space:pre-wrap">${esc(plan.notes)}</p>` : ''}</div>`;
    h += plan.meals.map((m, i) => {
      const pick = ticks[i];
      const opts = [m.foods].concat(m.swaps || []);
      return `<div class="card mp-card ${pick != null ? 'done' : ''}"><div class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:10px">
        <div style="min-width:0"><strong>${esc(m.name)}</strong>${m.time ? ` <span class="sub">· ${esc(m.time)}</span>` : ''}${m.kcal ? `<div class="sub" style="font-size:12px">${m.kcal} kcal${m.p ? ` · ${m.p} g P` : ''}</div>` : ''}</div>
        <button class="btn small ${pick != null ? 'primary' : ''}" data-action="mp-tick" data-i="${i}" data-o="${pick != null ? pick : 0}" aria-pressed="${pick != null}">${pick != null ? '✓ Eaten' : 'Mark eaten'}</button></div>
        ${opts.map((o, k) => (k === 0 || (m.swaps || []).length) ? `<label class="mp-opt ${pick === k ? 'on' : ''}"><input type="radio" name="mp${i}" data-mp-opt data-i="${i}" data-o="${k}" ${pick === k ? 'checked' : ''}><span style="white-space:pre-wrap">${k ? '<span class="chip">Swap</span> ' : ''}${esc(o)}</span></label>` : '').join('')}</div>`;
    }).join('');
    const other = items.filter((f) => f.meal && !plan.meals.some((m) => m.name === f.meal));
    if (other.length) h += `<div class="card"><div class="card-head"><h2>Also logged</h2></div><ul class="list">${other.map((f) => `<li><div class="grow"><div class="title">${esc(f.name)}</div></div><span class="num">${Math.round(f.kcal || 0)}</span><button class="del" data-action="del-food" data-id="${f.id}" aria-label="Delete">×</button></li>`).join('')}</ul></div>`;
    return h;
  }
  function setTick(i, o, toggle) {
    const S = C.getState(), n = S.nutrition, iso = C.ui.foodDate || C.todayISO();
    n.mpTicks = n.mpTicks || {}; const t = n.mpTicks[iso] || (n.mpTicks[iso] = {});
    if (toggle && t[i] != null) delete t[i]; else t[i] = o;
    Object.keys(n.mpTicks).forEach((d) => { if (C.daysBetween(d, C.todayISO()) > 60) delete n.mpTicks[d]; });
    C.save(); C.render();
  }

  // ---------- coach: assign from the client's Nutrition settings ----------
  function pickerHTML(current) {
    const list = st.list || [];
    return `<select name="nMealPlan"><option value="">${current ? 'Keep their current plan' : 'Choose a meal plan…'}</option>${list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${totals(p).kcal ? ` · ${totals(p).kcal} kcal` : ''}</option>`).join('')}</select>`;
  }
  const byId = (id) => (st.list || []).find((x) => x.id === id) || null;
  // closest plan by calories, for 2-week check-ins on the Meal plan method
  function nearest(curKcal, change) {
    const want = curKcal + change;
    const c = (st.list || []).filter((p) => totals(p).kcal && Math.sign(totals(p).kcal - curKcal) === Math.sign(change)).sort((a, b) => Math.abs(totals(a).kcal - want) - Math.abs(totals(b).kcal - want));
    return c[0] || null;
  }

  window.MealPlans = {
    ready: true,
    init(ctx) {
      C = ctx;
      Object.assign(ctx.actions, {
        'mp-new': () => editor(null, { onSave: saveTemplate }),
        'mp-edit': (el) => { const p = byId(el.dataset.id); if (p) editor(p, { onSave: saveTemplate }); },
        'mp-copy': (el) => { const p = byId(el.dataset.id); if (!p) return; const c = JSON.parse(JSON.stringify(p)); delete c.id; c.name = p.name + ' (copy)'; editor(c, { onSave: saveTemplate }); },
        'mp-tick': (el) => setTick(+el.dataset.i, +el.dataset.o, true),
      });
      document.addEventListener('change', (e) => { const t = e.target; if (t.matches && t.matches('[data-mp-opt]')) setTick(+t.dataset.i, +t.dataset.o, false); });
    },
    onSignedIn() { st.list = null; },
    onSignedOut() { st.list = null; },
    load, section, card, editor, pickerHTML, byId, totals, nearest,
    list: () => st.list || [],
  };
})();
