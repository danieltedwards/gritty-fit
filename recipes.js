/* GRIT recipe library (coach). Recipes live in the coach's private database (table "recipes");
   clients see published ones under "Choose a meal". Ingredients come from the food search, so
   macros are calculated; custom ingredients can be typed in. */
(function () {
  'use strict';
  let C;
  const esc = (s) => C.esc(s);
  const rid = () => Math.random().toString(36).slice(2, 7);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'recipe';
  const TAGS = ['breakfast', 'lunch', 'dinner', 'snack', 'pre-workout', 'post-workout', 'shake', 'meal prep', 'quick'];

  const ingMacros = (g) => (g.per100 ? { kcal: g.per100.k * g.grams / 100, p: g.per100.p * g.grams / 100, c: g.per100.c * g.grams / 100, f: g.per100.f * g.grams / 100 }
    : { kcal: +g.kcal || 0, p: +g.p || 0, c: +g.c || 0, f: +g.f || 0 });
  function totals(r) {
    const t = { kcal: 0, p: 0, c: 0, f: 0 };
    (r.ingredients || []).forEach((g) => { const m = ingMacros(g); t.kcal += m.kcal; t.p += m.p; t.c += m.c; t.f += m.f; });
    return t;
  }
  function perServing(r) {
    // book recipes list ingredients without macros: keep the per-serving numbers that came with them
    const counted = (r.ingredients || []).some((g) => g.per100 || +g.kcal || +g.p || +g.c || +g.f);
    if (!counted && r.per) return r.per;
    const t = totals(r), s = Math.max(1, Number(r.servings) || 1);
    return { kcal: Math.round(t.kcal / s), p: Math.round(t.p / s), c: Math.round(t.c / s), f: Math.round(t.f / s) };
  }

  // ---------- dashboard section ----------
  function section(rows) {
    rows = rows || [];
    let h = `<div class="card"><div class="card-head"><h2>Recipe library · ${rows.length}</h2><span class="row" style="gap:6px"><button class="btn small primary" data-action="rcp-new">+ New</button><button class="btn small" data-action="rcp-upload">Upload</button></span></div>
      <button class="btn block" data-action="nut-browse" style="margin-bottom:10px">📖 Open recipe browser (what clients see)</button>`;
    h += rows.length ? `<ul class="list">${rows.map((r) => {
      const p = r.data.per || perServing(r.data);
      return `<li><div class="grow"><div class="title">${esc(r.data.name)}${r.published ? '' : ' <span class="chip">hidden</span>'}</div>
        <div class="meta">${p.kcal} kcal · P ${p.p} C ${p.c} F ${p.f} per serving${(r.data.tags || []).length ? ' · ' + esc(r.data.tags.join(', ')) : ''}</div></div>
        <button class="btn small" data-action="rcp-edit" data-id="${esc(r.id)}">Edit</button></li>`;
    }).join('')}</ul>` : '<p class="sub">No recipes yet. Add your go-to meals; clients pick them under <strong>Choose a meal</strong>, scaled to each meal\'s targets.</p>';
    return h + '</div>';
  }

  // When the editor was opened from the recipe browser, go back there afterwards
  function backToBrowser() {
    if (!C.ui.recipeReturn) return;
    C.ui.recipeReturn = false;
    setTimeout(() => { if (C.actions['nut-browse']) C.actions['nut-browse'](); }, 50);
  }
  // ---------- editor ----------
  function editor(row) {
    const isNew = !row;
    const draft = row ? JSON.parse(JSON.stringify(row.data)) : { name: '', tags: [], servings: 1, prepMin: null, ingredients: [], instructions: '' };
    let published = row ? row.published : true;
    const id = row ? row.id : `${slug('recipe')}-${rid()}`;
    C.openModal(`<h2>${isNew ? 'New recipe' : 'Edit recipe'}</h2><div id="rcp"></div>`, async () => {
      if (!draft.name.trim()) { C.toast('Give the recipe a name'); return false; }
      if (!draft.ingredients.length && !draft.per) { C.toast('Add at least one ingredient'); return false; }
      draft.per = perServing(draft);
      draft.name = draft.name.trim();
      try {
        await Cloud.saveRecipe({ id: isNew ? `${slug(draft.name)}-${rid()}` : id, data: draft, published });
        await Cloud.loadRecipes(true);
        C.toast('Recipe saved'); Cloud.refreshCoach(); backToBrowser();
      }
      catch (e) { C.toast('Save failed: ' + e.message); return false; }
    }, { saveLabel: 'Save recipe' });
    const box = document.getElementById('rcp');
    let results = [];
    const draw = () => {
      const p = perServing(draft);
      box.innerHTML = `${C.field('Name', `<input type="text" data-r="name" value="${esc(draft.name)}" placeholder="e.g. Beef & rice bowl" autofocus>`)}
        <div class="pill-row">${TAGS.map((t) => `<label class="pill-check"><input type="checkbox" data-tag="${t}" ${draft.tags.includes(t) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        <div class="fields-2">${C.field('Servings this makes', `<input type="number" inputmode="decimal" min="1" step="1" data-r="servings" value="${draft.servings || 1}">`)}${C.field('Prep time (min)', `<input type="number" inputmode="numeric" min="0" data-r="prepMin" value="${draft.prepMin ?? ''}">`)}</div>
        <div class="res-head">Ingredients (whole recipe)</div>
        ${draft.ingredients.length ? `<ul class="list">${draft.ingredients.map((g, i) => { const m = ingMacros(g); return `<li><div class="grow"><div class="title">${esc(g.name)}</div>
            <div class="meta">${Math.round(m.kcal)} kcal · P ${Math.round(m.p)} C ${Math.round(m.c)} F ${Math.round(m.f)}</div></div>
            ${g.per100 ? `<input type="number" inputmode="decimal" class="g-input" data-g="${i}" value="${g.grams}" aria-label="grams"><span class="sub">g</span>` : `<span class="sub">${esc(g.amount || '')}</span>`}
            <button class="del" data-modal-action="rcp-del-ing" data-i="${i}" aria-label="Remove">×</button></li>`; }).join('')}</ul>` : '<p class="sub" style="margin:4px 0">No ingredients yet.</p>'}
        <div class="search-row" style="margin-top:6px"><input type="search" id="rcp-q" placeholder="Add ingredient: chicken, rice…" autocomplete="off"></div>
        <div id="rcp-res">${results.length ? `<ul class="list results">${results.map((f, i) => `<li><button data-modal-action="rcp-add" data-i="${i}"><div class="title">${esc(FoodLookup.displayName(f))}</div><div class="meta">${Math.round(f.per100.k)} kcal / 100 g · P ${Math.round(f.per100.p)} C ${Math.round(f.per100.c)} F ${Math.round(f.per100.f)}</div></button></li>`).join('')}</ul>` : ''}</div>
        <button class="link-btn" data-modal-action="rcp-custom">+ Custom ingredient (type the macros)</button>
        ${C.field('How to make it', `<textarea data-r="instructions" rows="4" placeholder="Steps, tips, swaps…">${esc(draft.instructions || '')}</textarea>`)}
        <div class="card" style="background:var(--surface-2)"><strong>Per serving: ${p.kcal} kcal</strong><div class="sub">Protein ${p.p} g · Carbs ${p.c} g · Fat ${p.f} g</div></div>
        <label class="ed-check"><input type="checkbox" data-pub ${published ? 'checked' : ''}><span>Visible to clients</span></label>
        ${isNew ? '' : '<button class="btn danger small block" data-modal-action="rcp-delete" style="margin-top:6px">Delete recipe</button>'}`;
      const q = document.getElementById('rcp-q');
      let t;
      q.addEventListener('input', () => { clearTimeout(t); const v = q.value.trim(); t = setTimeout(async () => { results = v.length < 2 ? [] : (await FoodLookup.searchCommon(v, 8)).filter((f) => f.per100); drawResults(); }, 200); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    };
    const drawResults = () => {
      const el = document.getElementById('rcp-res'); if (!el) return;
      el.innerHTML = results.length ? `<ul class="list results">${results.map((f, i) => `<li><button data-modal-action="rcp-add" data-i="${i}"><div class="title">${esc(FoodLookup.displayName(f))}</div><div class="meta">${Math.round(f.per100.k)} kcal / 100 g · P ${Math.round(f.per100.p)} C ${Math.round(f.per100.c)} F ${Math.round(f.per100.f)}</div></button></li>`).join('')}</ul>` : '';
    };
    box.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.r) { draft[el.dataset.r] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value; if (el.dataset.r === 'servings') softDraw(); }
      if (el.dataset.g != null) { draft.ingredients[+el.dataset.g].grams = Number(el.value) || 0; softDraw(); }
    });
    box.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.tag) { draft.tags = el.checked ? [...new Set([...draft.tags, el.dataset.tag])] : draft.tags.filter((x) => x !== el.dataset.tag); }
      if ('pub' in el.dataset) published = el.checked;
    });
    // update the totals without rebuilding inputs (keeps the keyboard open)
    const softDraw = () => {
      const p = perServing(draft);
      const card = box.querySelector('.card'); if (card) card.innerHTML = `<strong>Per serving: ${p.kcal} kcal</strong><div class="sub">Protein ${p.p} g · Carbs ${p.c} g · Fat ${p.f} g</div>`;
      box.querySelectorAll('[data-g]').forEach((inp) => { const g = draft.ingredients[+inp.dataset.g]; const m = ingMacros(g); const meta = inp.closest('li').querySelector('.meta'); if (meta) meta.textContent = `${Math.round(m.kcal)} kcal · P ${Math.round(m.p)} C ${Math.round(m.c)} F ${Math.round(m.f)}`; });
    };
    C.modalActions['rcp-add'] = (b) => {
      const f = results[+b.dataset.i]; if (!f) return;
      const portion = (f.portions || []).find(([l]) => /\b(oz|cup|large|medium|serving|slice|tbsp)\b/i.test(l));
      draft.ingredients.push({ name: FoodLookup.displayName(f), grams: portion && portion[1] ? Math.round(portion[1]) : 100, per100: { ...f.per100 } });
      results = []; draw();
      const last = box.querySelector(`[data-g="${draft.ingredients.length - 1}"]`); if (last) { last.focus(); last.select(); }
    };
    C.modalActions['rcp-del-ing'] = (b) => { draft.ingredients.splice(+b.dataset.i, 1); draw(); };
    C.modalActions['rcp-custom'] = () => {
      const name = prompt('Ingredient (e.g. "Tortilla, 1 large")'); if (!name) return;
      const vals = prompt('Calories, protein, carbs, fat for that amount (e.g. 140, 4, 24, 3.5)'); if (!vals) return;
      const [kcal, p, c, f] = vals.split(/[,\s]+/).map(Number);
      draft.ingredients.push({ name, amount: '', kcal: kcal || 0, p: p || 0, c: c || 0, f: f || 0 }); draw();
    };
    C.modalActions['rcp-delete'] = async () => {
      if (!confirm(`Delete "${draft.name}"?`)) return;
      try { await Cloud.deleteRecipe(id); await Cloud.loadRecipes(true); C.closeModal(); C.toast('Recipe deleted'); Cloud.refreshCoach(); backToBrowser(); } catch (e) { C.toast(e.message); }
    };
    draw();
  }

  // Upload: JSON array of recipes, or { recipes: [...] }. Each: name, servings?, tags?, ingredients?
  // ([{name, grams, per100:{k,p,c,f}}] or [{name, amount, kcal, p, c, f}]), instructions?, per? ({kcal,p,c,f} per serving)
  async function importData(raw) {
        const list = Array.isArray(raw) ? raw : raw.recipes;
        if (!Array.isArray(list) || !list.length) throw new Error('No recipes in that file');
        const rows = [];
        for (const r of list) {
          if (!r.name) continue;
          const data = { name: r.name, tags: r.tags || [], servings: r.servings || 1, prepMin: r.prepMin || null, ingredients: r.ingredients || [], instructions: r.instructions || '', source: r.source || '' };
          if (r.per) data.per = r.per;
          data.per = perServing(data);
          if (r.servingsEstimated) data.servingsEstimated = true;
          rows.push({ id: r.id || `${slug(r.name)}-${rid()}`, data, published: r.published !== false });
        }
        for (let i = 0; i < rows.length; i += 100) {
          C.toast(`Uploading recipes… ${Math.min(i + 100, rows.length)} / ${rows.length}`);
          await Cloud.saveRecipes(rows.slice(i, i + 100));
        }
        Cloud.refreshCoach();
        return rows.length;
  }
  function upload() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const n = await importData(JSON.parse(await input.files[0].text()));
        C.toast(`${n} recipe${n === 1 ? '' : 's'} added to your library`);
      } catch (e) { C.toast('Upload failed: ' + e.message); }
    };
    input.click();
  }

  window.Recipes = {
    init(ctx) {
      C = ctx;
      Object.assign(ctx.actions, {
        'rcp-new': () => editor(null),
        'rcp-edit': async (el) => { const r = (await Cloud.loadRecipes(true)).find((x) => x.id === el.dataset.id); if (r) editor(r); },
        'rcp-upload': upload,
      });
    },
    section, perServing, importData, open: (row) => editor(row || null),
  };
})();
