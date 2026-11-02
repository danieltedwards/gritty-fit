/* GRIT cloud: sign-in (emailed code or link), two-way sync, coach targets & messages,
   invites, coach dashboard. Works on top of the local-first app: everything still runs
   offline, and changes sync when online. Server rules live in supabase/schema.sql. */
(function () {
  'use strict';
  let C, sb = null;
  let user = null, profile = null, coach = null;
  let meta = { userId: null, snap: {}, lastPull: null, lastSync: null };
  let notes = [];
  let pushTimer = null, pushing = false, pulling = false, pullIv = null;
  let cloudPlans = null; // [{id, data, visibility, published, sort}]
  const S = () => C.getState();
  const esc = (s) => C.esc(s);
  const ARR = ['food', 'workouts', 'body', 'journal', 'goals', 'habits', 'savedMeals'];
  const INVITE_KEY = 'grit-invite';

  // ---------- records <-> state ----------
  function toRecords(st) {
    const m = new Map();
    ARR.forEach((k) => (st[k] || []).forEach((r) => { if (r && r.id) m.set(k + '/' + r.id, { kind: k, id: String(r.id), data: r }); }));
    Object.entries(st.habitLog || {}).forEach(([d, ids]) => { if (ids && ids.length) m.set('habitday/' + d, { kind: 'habitday', id: d, data: { ids } }); });
    Object.entries(st.health || {}).forEach(([d, v]) => m.set('health/' + d, { kind: 'health', id: d, data: v }));
    m.set('settings/main', { kind: 'settings', id: 'main', data: st.settings });
    m.set('program/main', { kind: 'program', id: 'main', data: { program: st.program || null, programHistory: st.programHistory || [] } });
    if (st.nutrition) m.set('nutrition/main', { kind: 'nutrition', id: 'main', data: st.nutrition });
    Object.entries(st.sharedPhotos || {}).forEach(([id, v]) => m.set('photo/' + id, { kind: 'photo', id, data: v }));
    return m;
  }
  function applyRecord(st, kind, id, data, deleted) {
    if (ARR.includes(kind)) {
      const list = st[kind] || (st[kind] = []);
      const i = list.findIndex((r) => String(r.id) === id);
      if (deleted) { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = data; else list.push(data);
    } else if (kind === 'habitday') {
      if (deleted || !data) delete st.habitLog[id]; else st.habitLog[id] = data.ids || [];
    } else if (kind === 'health') {
      if (deleted) delete st.health[id]; else st.health[id] = data;
    } else if (kind === 'settings' && !deleted && data) {
      st.settings = Object.assign({}, st.settings, data);
    } else if (kind === 'nutrition') {
      st.nutrition = deleted ? null : data;
    } else if (kind === 'photo') {
      st.sharedPhotos = st.sharedPhotos || {};
      if (deleted) delete st.sharedPhotos[id]; else st.sharedPhotos[id] = data;
    } else if (kind === 'program' && !deleted && data) {
      st.program = data.program || null; st.programHistory = data.programHistory || [];
    }
  }
  const J = (x) => JSON.stringify(x === undefined ? null : x);

  // ---------- sync ----------
  const saveMeta = () => DB.setKV('sync', meta).catch(() => {});
  function changed() {
    if (!user || C.ui.viewAs) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1500);
  }
  async function push() {
    if (!user || pushing || C.ui.viewAs) return;
    pushing = true;
    try {
      const recs = toRecords(S());
      const rows = [], after = {};
      recs.forEach((r, key) => {
        const j = J(r.data);
        if (meta.snap[key] !== j) { rows.push({ user_id: user.id, kind: r.kind, id: r.id, data: r.data, deleted: false }); after[key] = j; }
      });
      Object.keys(meta.snap).forEach((key) => {
        if (!recs.has(key)) { const [kind, ...rest] = key.split('/'); rows.push({ user_id: user.id, kind, id: rest.join('/'), data: null, deleted: true }); after[key] = undefined; }
      });
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.from('entries').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,kind,id' });
        if (error) throw error;
      }
      Object.entries(after).forEach(([k, v]) => { if (v === undefined) delete meta.snap[k]; else meta.snap[k] = v; });
      if (rows.length) { meta.lastSync = new Date().toISOString(); await saveMeta(); }
      setStatus('ok');
    } catch (e) {
      setStatus('error', e.message);
    } finally { pushing = false; }
  }
  // initial = first sync of this account on this device: the account's copy wins over this
  // device's (things only on this device are kept and uploaded afterwards).
  async function pull(initial = false) {
    if (!user || pulling || C.ui.viewAs) return 0;
    pulling = true;
    let applied = 0;
    try {
      const st = S();
      const local = toRecords(st);
      // 10s overlap guards against rows committed slightly out of order
      const since = meta.lastPull ? new Date(Date.parse(meta.lastPull) - 10000).toISOString() : '1970-01-01T00:00:00Z';
      let from = 0, maxTs = meta.lastPull;
      for (;;) {
        const { data, error } = await sb.from('entries').select('kind,id,data,deleted,updated_at').eq('user_id', user.id)
          .gt('updated_at', since).order('updated_at').range(from, from + 999);
        if (error) throw error;
        for (const row of data) {
          const key = row.kind + '/' + row.id;
          const lj = local.has(key) ? J(local.get(key).data) : undefined;
          // dirty = changed (or deleted) on this device since the last sync
          const dirty = lj !== undefined ? lj !== meta.snap[key] : meta.snap[key] !== undefined;
          const rj = row.deleted ? undefined : J(row.data);
          if (!maxTs || row.updated_at > maxTs) maxTs = row.updated_at;
          if (dirty && lj !== rj && !(initial && !row.deleted)) continue; // local change not yet pushed wins; it will push next
          if (lj === rj) { if (rj === undefined) delete meta.snap[key]; else meta.snap[key] = rj; continue; }
          applyRecord(st, row.kind, row.id, row.data, row.deleted);
          if (rj === undefined) delete meta.snap[key]; else meta.snap[key] = rj;
          applied++;
        }
        if (data.length < 1000) break;
        from += 1000;
      }
      meta.lastPull = maxTs;
      meta.lastSync = new Date().toISOString();
      await saveMeta();
      if (applied) { await C.saveLocal(); C.softRender(); }
      setStatus('ok');
    } catch (e) {
      setStatus('error', e.message);
    } finally { pulling = false; }
    return applied;
  }
  async function syncNow() {
    if (!meta.lastPull) { const n = await pull(true); await push(); return n; }
    await push(); const n = await pull(); await push(); return n;
  }

  let status = { state: 'idle', msg: '' };
  function setStatus(state, msg = '') { status = { state, msg }; }

  // ---------- auth ----------
  async function onSignedIn(u) {
    if (user && user.id === u.id) return;
    user = u;
    if (meta.userId && meta.userId !== u.id) {
      // This device holds someone else's data: start clean for the new account.
      await C.replaceState(C.defaultState());
      await DB.clearPhotos().catch(() => {});
      meta = { userId: u.id, snap: {}, lastPull: null, lastSync: null };
      C.toast('Signed in as a different person. This device now shows their data.');
    }
    if (meta.userId !== u.id) { meta.userId = u.id; await saveMeta(); }
    await loadProfile();
    const pending = (() => { try { return localStorage.getItem(INVITE_KEY); } catch (_) { return null; } })();
    if (pending && profile && !profile.coach_id && profile.role !== 'coach') await acceptInvite(pending, true);
    await syncNow();
    await loadNotes();
    applyTargets();
    loadRecipes(true).catch(() => {});
    sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', u.id).then(() => {});
    if (window.Training) Training.resetPlans();
    clearInterval(pullIv);
    pullIv = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 60000);
    C.softRender();
  }
  function onSignedOut() {
    user = null; profile = null; coach = null; notes = []; cloudPlans = null;
    clearInterval(pullIv);
    if (window.Training) Training.resetPlans();
    C.softRender();
  }
  let profileError = '';
  async function loadProfile() {
    profileError = '';
    for (let i = 0; i < 3; i++) {
      const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (data) { profile = data; break; }
      if (error) profileError = error.message;
      // missing profile (e.g. account created before the database was set up): create it
      const r = await sb.rpc('ensure_profile');
      if (r.error && /ensure_profile|function/i.test(r.error.message)) profileError = 'Database setup is out of date. Run supabase/schema.sql again in Supabase → SQL Editor.';
      await new Promise((res) => setTimeout(res, 600));
    }
    if (profile) profileError = '';
    coach = null;
    if (profile && profile.coach_id) {
      const { data } = await sb.from('profiles').select('id,full_name,email').eq('id', profile.coach_id).maybeSingle();
      coach = data || null;
    }
  }
  function applyTargets() {
    const t = profile && profile.targets;
    const st = S();
    if (!t || !t.v || st.settings.coachTargetsV === t.v) return;
    ['calorieTarget', 'proteinTarget', 'carbTarget', 'fatTarget', 'workoutsPerWeek'].forEach((k) => { if (t[k] != null && t[k] !== '') st.settings[k] = Number(t[k]); });
    // GRIT Nutrition plan adjustments (calories ± and protein) live with the plan
    st.nutrition = st.nutrition || { overrides: {} };
    st.nutrition.coach = { kcalAdjust: Number(t.kcalAdjust) || 0, protein: t.nProtein ? Number(t.nProtein) : null };
    st.settings.coachTargetsV = t.v;
    C.save();
    C.toast('Your coach updated your targets');
  }
  async function loadNotes() {
    if (!profile || profile.role === 'coach') { notes = []; return; }
    const { data } = await sb.from('coach_notes').select('id,body,created_at,read_at').eq('client_id', user.id).order('created_at', { ascending: false }).limit(20);
    notes = data || [];
  }
  async function acceptInvite(code, quiet) {
    const { data, error } = await sb.rpc('accept_invite', { p_code: code });
    try { localStorage.removeItem(INVITE_KEY); } catch (_) { /* ignore */ }
    if (error) { C.toast(error.message); return false; }
    await loadProfile();
    if (window.Training) Training.resetPlans();
    C.toast(`You're connected with your coach${data ? ', ' + data : ''} 🎉`);
    if (!quiet) C.softRender();
    return true;
  }

  // ---------- plans (used by training.js) ----------
  const usesCloudPlans = () => !!(user && profile && (profile.role === 'coach' || profile.coach_id));
  async function fetchPlans() {
    const { data, error } = await sb.from('plans').select('id,data,visibility,published,sort').order('sort').order('id');
    if (error) throw error;
    cloudPlans = data || [];
    return cloudPlans;
  }

  async function savePlan(row, grantTo) {
    const { error } = await sb.from('plans').upsert(row);
    if (error) throw error;
    if (grantTo) {
      const r = await sb.from('plan_access').upsert({ plan_id: row.id, client_id: grantTo }, { onConflict: 'plan_id,client_id' });
      if (r.error) throw r.error;
    }
    coachData = null;
  }
  async function deletePlan(id) {
    const { error } = await sb.from('plans').delete().eq('id', id);
    if (error) throw error;
    coachData = null;
  }

  // ---------- recipes (coach library; clients read their coach's published ones) ----------
  let recipeCache = null;
  async function loadRecipes(force) {
    if (!user || !profile || (profile.role !== 'coach' && !profile.coach_id)) { recipeCache = []; return recipeCache; }
    if (recipeCache && !force) return recipeCache;
    const { data, error } = await sb.from('recipes').select('id,data,published').order('id');
    if (error) throw error;
    recipeCache = profile.role === 'coach' ? data : data.filter((r) => r.published);
    return recipeCache;
  }
  async function saveRecipe(row) { const { error } = await sb.from('recipes').upsert(row); if (error) throw error; recipeCache = null; }
  async function deleteRecipe(id) { const { error } = await sb.from('recipes').delete().eq('id', id); if (error) throw error; recipeCache = null; }

  // ---------- progress photos shared with the coach (private storage) ----------
  const BUCKET = 'progress-photos';
  const canSharePhotos = () => !!(user && profile && profile.coach_id);
  async function sharePhoto(photo) {
    if (!canSharePhotos()) throw new Error('Connect with your coach first');
    const path = `${user.id}/${photo.id}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, photo.blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
    return { date: photo.date, pose: photo.pose || '', path, sharedAt: new Date().toISOString() };
  }
  async function unsharePhoto(id, meta) {
    const path = (meta && meta.path) || `${user.id}/${id}.jpg`;
    const { error } = await sb.storage.from(BUCKET).remove([path]);
    if (error) throw error;
  }
  async function photoUrl(path) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    return error ? null : data.signedUrl;
  }

  // ---------- coach: view a client's app read-only ----------
  async function loadClientState(clientId) {
    const st = C.defaultState();
    st.habits = [];
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from('entries').select('kind,id,data,deleted').eq('user_id', clientId).eq('deleted', false).range(from, from + 999);
      if (error) throw error;
      data.forEach((r) => applyRecord(st, r.kind, r.id, r.data, false));
      if (data.length < 1000) break;
      from += 1000;
    }
    return st;
  }

  // ---------- UI: settings section ----------
  function settingsSection() {
    if (!sb) return '';
    if (!user) {
      return `<div class="sub" style="font-weight:700;margin:10px 0 8px">Account</div>
        <p class="hint"><strong>You're not signed in.</strong> Sign in to sync your data, connect with your coach, or (coach) open your dashboard.</p>
        <button class="btn primary block" data-modal-action="cloud-signin" style="margin-bottom:12px">Sign in with email</button>`;
    }
    const role = profile && profile.role === 'coach' ? 'Coach' : 'Client';
    const last = meta.lastSync ? new Date(meta.lastSync).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
    return `<div class="sub" style="font-weight:700;margin:10px 0 8px">Account</div>
      <div class="card" style="background:var(--surface-2);margin-bottom:10px">
        <div><strong>${esc(user.email)}</strong> <span class="chip">${role}</span></div>
        ${coach ? `<div class="sub">Coach: ${esc(coach.full_name || coach.email)}</div>` : ''}
        <div class="sub">Last synced: ${last}${status.state === 'error' ? ` · <span class="bad">${esc(status.msg)}</span>` : ''}</div>
        ${!profile ? `<p class="bad" style="margin:8px 0">Your account profile didn't load${profileError ? ': ' + esc(profileError) : ''}.</p><button class="btn small" data-modal-action="cloud-retry">Try again</button>` : ''}
        ${field('Your name', `<input type="text" name="cloud_name" value="${esc((profile && profile.full_name) || '')}" placeholder="Shown to your coach">`)}
        <div class="row"><button class="btn small" data-modal-action="cloud-sync">Sync now</button>
        ${profile && profile.role === 'coach' ? '<button class="btn small primary" data-modal-action="cloud-coach">Coach dashboard</button>' : ''}
        ${profile && profile.role !== 'coach' && !profile.coach_id ? '<button class="btn small" data-modal-action="cloud-invite">Enter invite code</button>' : ''}
        <button class="btn small" data-modal-action="cloud-signout">Sign out</button></div>
        ${profile && profile.role !== 'coach' && !profile.coach_id ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><p class="hint" style="margin:0 0 8px">Are you the coach? This works once, for the first account only.</p><button class="btn block" data-modal-action="cloud-claim">🧢 Set up this account as the coach</button></div>' : ''}
      </div>`;
  }
  const field = (l, i) => C.field(l, i);
  async function saveName(fd) {
    if (!user || !profile) return;
    const n = (fd.get('cloud_name') || '').trim();
    if (n !== (profile.full_name || '')) {
      await sb.from('profiles').update({ full_name: n || null }).eq('id', user.id);
      profile.full_name = n || null;
    }
  }

  // ---------- UI: sign in ----------
  function signInForm(prefillEmail = '') {
    let invite = null; try { invite = localStorage.getItem(INVITE_KEY); } catch (_) { /* ignore */ }
    C.openModal(`<h2>Sign in to GRIT</h2>
      ${invite ? `<p class="hint" style="margin-top:0">Invite code <strong>${esc(invite)}</strong> will connect you with your coach.</p>` : ''}
      <div id="signin-step1">
        ${field('Email', `<input type="email" name="email" value="${esc(prefillEmail)}" autocomplete="email" inputmode="email" placeholder="you@example.com" autofocus>`)}
        <button class="btn primary block" data-modal-action="cloud-send">Email me a sign-in code</button>
        <p class="hint" style="margin-top:10px">No password. We email you a code (and a link). On a phone, type the code here so you stay signed in inside the app.</p>
      </div>
      <div id="signin-step2" hidden>
        <p class="sub" id="signin-sent" style="margin-top:0"></p>
        ${field('Code from the email', '<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456">')}
        <button class="btn primary block" data-modal-action="cloud-verify">Sign in</button>
        <button class="link-btn" data-modal-action="cloud-back">Use a different email</button>
      </div>`, null, { hideSave: true });
    const form = document.getElementById('modal-form');
    form.elements.email.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); modalActions['cloud-send'](); } });
    form.elements.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); modalActions['cloud-verify'](); } });
  }
  const modalActions = {
    'cloud-signin': () => { C.closeModal(); setTimeout(() => signInForm(), 0); },
    'cloud-send': async (b) => {
      const form = document.getElementById('modal-form');
      const email = form.elements.email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { C.toast('Enter your email address'); return; }
      const btn = b && b.tagName ? b : form.querySelector('[data-modal-action=cloud-send]');
      btn.disabled = true; btn.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
      btn.disabled = false; btn.textContent = 'Email me a sign-in code';
      if (error) {
        C.toast(/rate|limit|seconds/i.test(error.message) ? 'Too many emails right now. Wait a minute and try again.' : /not authorized|authorized/i.test(error.message) ? 'Email sending isn\'t set up for this address yet (coach: see README → Email).' : error.message);
        return;
      }
      document.getElementById('signin-step1').hidden = true;
      document.getElementById('signin-step2').hidden = false;
      document.getElementById('signin-sent').textContent = `We sent a code to ${email}. It can take a minute; check spam too.`;
      form.dataset.email = email;
      setTimeout(() => form.elements.code.focus(), 50);
    },
    'cloud-back': () => { document.getElementById('signin-step1').hidden = false; document.getElementById('signin-step2').hidden = true; },
    'cloud-verify': async () => {
      const form = document.getElementById('modal-form');
      const token = form.elements.code.value.replace(/\D/g, '');
      if (token.length < 6) { C.toast('Enter the code from the email'); return; }
      const { data, error } = await sb.auth.verifyOtp({ email: form.dataset.email, token, type: 'email' });
      if (error) { C.toast(/expired|invalid/i.test(error.message) ? 'That code is wrong or expired. Request a new one.' : error.message); return; }
      C.closeModal();
      C.toast('Signed in ✓ Syncing…');
      if (data && data.user) await onSignedIn(data.user);
    },
    'cloud-retry': async () => { await loadProfile(); C.closeModal(); setTimeout(() => C.actions['open-settings'](), 0); },
    'cloud-sync': async () => { C.toast('Syncing…'); const n = await syncNow(); await loadProfile(); await loadNotes(); applyTargets(); C.toast(status.state === 'error' ? 'Sync failed: ' + status.msg : `Synced${n ? ` · ${n} update${n > 1 ? 's' : ''}` : ''} ✓`); },
    'cloud-signout': async () => {
      if (!confirm('Sign out? Your data stays on this device, and syncing stops until you sign in again.')) return;
      await push();
      await sb.auth.signOut();
      C.closeModal(); onSignedOut(); C.toast('Signed out');
    },
    'cloud-invite': () => {
      C.closeModal();
      setTimeout(() => C.openModal(`<h2>Join your coach</h2>${field('Invite code', '<input type="text" name="code" autocapitalize="characters" autocomplete="off" placeholder="ABC123" autofocus>')}`,
        async (fd) => { const ok = await acceptInvite(String(fd.get('code') || '')); return ok ? undefined : false; }, { saveLabel: 'Join' }), 0);
    },
    'cloud-claim': async () => {
      if (!confirm('Make this account the coach account? Only one coach account can exist.')) return;
      const { error } = await sb.rpc('claim_coach');
      if (error) { C.toast(error.message); return; }
      await loadProfile();
      if (window.Training) Training.resetPlans();
      C.closeModal(); C.toast('You\'re set up as the coach 🧢'); C.setTab('coach');
    },
    'cloud-coach': () => { C.closeModal(); C.setTab('coach'); },
    // coach dashboard modals
    'coach-send-note': async (b) => {
      const form = document.getElementById('modal-form');
      const body = form.elements.note.value.trim();
      if (!body) return;
      const { error } = await sb.from('coach_notes').insert({ client_id: b.dataset.id, body });
      if (error) { C.toast(error.message); return; }
      C.toast('Message sent'); C.closeModal(); refreshCoach();
    },
  };

  // ---------- UI: Today cards ----------
  function todayCards() {
    if (!sb) return '';
    if (C.ui.viewAs) return '';
    if (!user) {
      let invite = null; try { invite = localStorage.getItem(INVITE_KEY); } catch (_) { /* ignore */ }
      if (!invite && S().settings.hideSignInCard) return '';
      return `<div class="card" ${invite ? 'style="border-color:var(--accent)"' : ''}><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>${invite ? 'Join your coach' : 'Sign in to sync'}</strong>
        <div class="sub">${invite ? `Invite code ${esc(invite)} is ready. Sign in to connect.` : 'Back up your data and connect with your coach.'}</div></div>
        <button class="btn primary" data-action="cloud-signin-open">Sign in</button></div>
        ${invite ? '' : '<button class="link-btn" data-action="cloud-hide-card" style="color:var(--muted);font-size:13px">Not now</button>'}</div>`;
    }
    let h = '';
    if (profile && profile.role === 'coach') {
      h += `<div class="card" data-action="goto" data-tab="coach" style="cursor:pointer"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>🧢 Coach dashboard</strong><div class="sub">Clients, plans, invites</div></div><span class="sub">›</span></div></div>`;
    }
    const unread = notes.filter((n) => !n.read_at);
    if (unread.length) {
      h += `<div class="card" style="border-color:var(--accent)"><div class="card-head"><h2>💬 From ${esc(coach ? (coach.full_name || 'your coach') : 'your coach')}</h2></div>
        ${unread.slice(0, 3).map((n) => `<p style="white-space:pre-wrap;margin:0 0 8px">${esc(n.body)}</p><div class="sub" style="font-size:12px;margin-bottom:10px">${new Date(n.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>`).join('')}
        <button class="btn small" data-action="notes-read">Got it</button></div>`;
    }
    return h;
  }
  const actions = {
    'cloud-signin-open': () => signInForm(),
    'cloud-hide-card': () => { S().settings.hideSignInCard = true; C.save(); C.render(); },
    'notes-read': async () => { await sb.rpc('mark_notes_read'); notes.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); }); C.render(); },
    'coach-refresh': () => refreshCoach(),
    'coach-invite': () => {
      C.openModal(`<h2>Invite a client</h2>${field('Client name (for your list)', '<input type="text" name="label" placeholder="e.g. Denise" autofocus>')}
        ${field('Their email or phone (optional)', '<input type="text" name="to" placeholder="denise@email.com or 555-123-4567" autocomplete="off">')}
        <p class="hint">Creates a one-time invite code. <strong>GRIT doesn't send it for you</strong>: on the next screen, tap Email or Text and your phone opens a ready-to-send message.</p>`, async (fd) => {
        const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
        const { error } = await sb.from('invites').insert({ code, label: (fd.get('label') || '').trim() || null });
        if (error) { C.toast(error.message); return false; }
        setTimeout(() => showInvite(code, (fd.get('label') || '').trim(), (fd.get('to') || '').trim()), 0);
        refreshCoach();
      }, { saveLabel: 'Create invite' });
    },
    'coach-show-invite': (el) => showInvite(el.dataset.code, el.dataset.label),
    'coach-del-invite': async (el) => { if (!confirm('Delete this invite?')) return; await sb.from('invites').delete().eq('code', el.dataset.code); refreshCoach(); },
    'coach-view': async (el) => {
      C.toast('Loading…');
      try {
        const st = await loadClientState(el.dataset.id);
        C.enterViewAs(st, el.dataset.name);
      } catch (e) { C.toast('Couldn\'t load: ' + e.message); }
    },
    'coach-note': async (el) => {
      const { data } = await sb.from('coach_notes').select('body,created_at,read_at').eq('client_id', el.dataset.id).order('created_at', { ascending: false }).limit(10);
      C.openModal(`<h2>Message ${esc(el.dataset.name)}</h2>
        <textarea name="note" placeholder="Feedback, adjustments, encouragement…" autofocus></textarea>
        <button class="btn primary block" data-modal-action="coach-send-note" data-id="${el.dataset.id}" style="margin-top:10px">Send</button>
        ${data && data.length ? `<div class="res-head">Sent</div><ul class="list">${data.map((n) => `<li><div class="grow"><div style="white-space:pre-wrap">${esc(n.body)}</div><div class="meta">${new Date(n.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${n.read_at ? 'read ✓' : 'unread'}</div></div></li>`).join('')}</ul>` : ''}`, null, { hideSave: true });
    },
    'coach-targets': async (el) => {
      const { data } = await sb.from('profiles').select('targets').eq('id', el.dataset.id).maybeSingle();
      const t = (data && data.targets) || {};
      const cl = coachData && coachData.clients.find((c) => c.client_id === el.dataset.id);
      const np = cl && cl.nutrition && cl.nutrition.profile;
      C.openModal(`<h2>Targets for ${esc(el.dataset.name)}</h2>
        <div class="sub" style="font-weight:700;margin:4px 0 8px">GRIT Nutrition plan${np ? '' : ' <span class="chip">not set up yet</span>'}</div>
        ${np ? `<p class="hint" style="margin-top:0">${esc(({ cut: 'Cut', maintain: 'Maintain', build: 'Build' })[np.goal] || '')}${np.goal !== 'maintain' ? ' · ' + esc(np.pace || '') : ''} · ${np.meals} meals · ${np.sex === 'm' ? 'M' : 'F'} ${np.age}${np.flagged ? ' · <strong class="bad">flagged health answer: review before cutting</strong>' : ''}</p>` : ''}
        <div class="fields-2">${field('Calories ± per day', C.inNum('kcalAdjust', t.kcalAdjust, 'step="10" placeholder="e.g. -150"'))}${field('Protein (g/day)', C.inNum('nProtein', t.nProtein, 'min="0" placeholder="auto"'))}</div>
        <p class="hint">Adjusts every day of their plan; carbs and fat follow. Leave empty for the automatic numbers.</p>
        <div class="sub" style="font-weight:700;margin:12px 0 8px">Fixed targets (clients without a plan)</div>
        <div class="fields-2">${field('Daily calories', C.inNum('calorieTarget', t.calorieTarget, 'min="0"'))}${field('Protein (g)', C.inNum('proteinTarget', t.proteinTarget, 'min="0"'))}</div>
        <div class="fields-2">${field('Carbs (g)', C.inNum('carbTarget', t.carbTarget, 'min="0"'))}${field('Fat (g)', C.inNum('fatTarget', t.fatTarget, 'min="0"'))}</div>
        ${field('Workouts per week', C.inNum('workoutsPerWeek', t.workoutsPerWeek, 'min="0" max="14" step="1"'))}
        <p class="hint">These replace the client's own targets the next time their app syncs. Leave a box empty to keep theirs.</p>`, async (fd) => {
        const nt = { v: Date.now() };
        ['calorieTarget', 'proteinTarget', 'carbTarget', 'fatTarget', 'workoutsPerWeek', 'kcalAdjust', 'nProtein'].forEach((k) => { const v = fd.get(k); if (v !== '' && v != null) nt[k] = Number(v); });
        const { error } = await sb.from('profiles').update({ targets: nt }).eq('id', el.dataset.id);
        if (error) { C.toast(error.message); return false; }
        C.toast('Targets saved');
      });
    },
    'coach-access': async (el) => {
      const plans = await fetchPlans().catch(() => []);
      const sel = plans.filter((p) => p.visibility === 'assigned');
      const { data: acc } = await sb.from('plan_access').select('plan_id').eq('client_id', el.dataset.id);
      const has = new Set((acc || []).map((a) => a.plan_id));
      C.openModal(`<h2>Plans for ${esc(el.dataset.name)}</h2>
        <p class="hint" style="margin-top:0">Plans set to "All clients" are always available. Tick which "Selected clients" plans this client can choose.</p>
        ${sel.length ? sel.map((p) => `<label class="check"><input type="checkbox" name="pa_${esc(p.id)}" ${has.has(p.id) ? 'checked' : ''}><span><strong>${esc(p.data.name)}</strong> <span class="sub">${esc(p.data.phase || '')}</span></span></label>`).join('')
          : '<p class="sub">No plans are set to "Selected clients". Change a plan\'s visibility in the Plans section first.</p>'}`, async (fd) => {
        for (const p of sel) {
          const want = fd.get('pa_' + p.id) === 'on';
          if (want && !has.has(p.id)) await sb.from('plan_access').insert({ plan_id: p.id, client_id: el.dataset.id });
          if (!want && has.has(p.id)) await sb.from('plan_access').delete().eq('plan_id', p.id).eq('client_id', el.dataset.id);
        }
        C.toast('Plan access saved');
      });
    },
    'coach-remove': async (el) => {
      if (!confirm(`Remove ${el.dataset.name} from your clients? They keep their own data but you lose access.`)) return;
      const { error } = await sb.rpc('remove_client', { p_client: el.dataset.id });
      if (error) { C.toast(error.message); return; }
      refreshCoach();
    },
    'coach-plan-upload': async (el) => {
      try {
        const res = await fetch('plans/' + el.dataset.file); const data = await res.json();
        const { error } = await sb.from('plans').upsert({ id: data.id, data, visibility: 'all', published: true });
        if (error) throw error;
        C.toast(`${data.name} is in your library`); refreshCoach(); if (window.Training) Training.resetPlans();
      } catch (e) { C.toast('Upload failed: ' + e.message); }
    },
    'coach-plan-file': () => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
      input.onchange = async () => {
        try {
          const data = JSON.parse(await input.files[0].text());
          if (!data.id || !data.name || !Array.isArray(data.days)) throw new Error('Not a GRIT plan file');
          const { error } = await sb.from('plans').upsert({ id: data.id, data, visibility: 'all', published: true });
          if (error) throw error;
          C.toast(`${data.name} uploaded`); refreshCoach(); if (window.Training) Training.resetPlans();
        } catch (e) { C.toast('Upload failed: ' + e.message); }
      };
      input.click();
    },
    'coach-plan-new': () => Editor.open({ data: Editor.blankPlan(), isNew: true, row: { visibility: 'all', published: false } }),
    'coach-plan-edit': async (el) => {
      const plans = (coachData && coachData.plans) || await fetchPlans();
      const p = plans.find((x) => x.id === el.dataset.id);
      if (!p) { C.toast('Plan not found'); return; }
      const cn = p.data.forClient && coachData && (coachData.clients.find((c) => c.client_id === p.data.forClient) || {});
      Editor.open({ data: p.data, row: { visibility: p.visibility, published: p.published }, forClientName: cn ? (cn.full_name || cn.email || 'client') : null, grantTo: p.data.forClient || null });
    },
    'coach-customize': async (el) => {
      const plans = await fetchPlans();
      const clientId = el.dataset.id, name = el.dataset.name;
      const existing = plans.find((p) => p.data.forClient === clientId && (!el.dataset.plan || p.id === el.dataset.plan || p.data.basedOn === el.dataset.plan));
      if (existing) { Editor.open({ data: existing.data, row: { visibility: existing.visibility, published: existing.published }, forClientName: name, grantTo: clientId }); return; }
      const templates = plans.filter((p) => !p.data.forClient);
      if (!templates.length) { C.toast('Add a plan to your library first'); return; }
      const startFrom = (base) => {
        const data = JSON.parse(JSON.stringify(base.data));
        data.id = `${base.id}--${clientId.slice(0, 8)}`;
        data.basedOn = base.id; data.forClient = clientId; data.clientName = name;
        data.tags = [...(data.tags || []).filter((t) => !/^For /.test(t)), 'For ' + name];
        Editor.open({ data, isNew: true, row: { visibility: 'assigned', published: true }, forClientName: name, grantTo: clientId });
        C.toast(`Editing ${name}'s copy. Only they will see it`);
      };
      const current = templates.find((p) => p.id === el.dataset.plan);
      if (current) { startFrom(current); return; }
      C.openModal(`<h2>Customize for ${esc(name)}</h2><p class="hint" style="margin-top:0">${esc(name)} isn't following a plan yet. Start their version from:</p>
        ${C.field('Template', `<select name="base">${templates.map((p) => `<option value="${esc(p.id)}">${esc(p.data.name)}</option>`).join('')}</select>`)}
        <p class="hint">They'll see it as "Made for you" in their plan list.</p>`, (fd) => { const b = templates.find((p) => p.id === fd.get('base')); setTimeout(() => startFrom(b), 0); }, { saveLabel: 'Start editing' });
    },
    'coach-plan-set': async (el) => {
      const patch = {}; patch[el.dataset.field] = el.dataset.field === 'published' ? el.dataset.value === 'true' : el.dataset.value;
      const { error } = await sb.from('plans').update(patch).eq('id', el.dataset.id);
      if (error) { C.toast(error.message); return; }
      refreshCoach(); if (window.Training) Training.resetPlans();
    },
  };
  function showInvite(code, label, to = '') {
    const link = `${location.origin}${location.pathname}#invite=${code}`;
    const msg = `${label ? label + ', h' : 'H'}ere's your invite to GRIT, my coaching app.\n\n1. Open this link on your phone: ${link}\n2. Add it to your home screen (iPhone: Safari → Share → Add to Home Screen; Android: Chrome → ⋮ → Install app).\n3. Open GRIT and sign in with your email. You'll get a code by email to type in.\n\nYour invite code: ${code}`;
    const isEmail = /@/.test(to), phone = !isEmail ? to.replace(/[^\d+]/g, '') : '';
    const mailto = `mailto:${isEmail ? encodeURIComponent(to) : ''}?subject=${encodeURIComponent('Your GRIT coaching app invite')}&body=${encodeURIComponent(msg)}`;
    const sms = `sms:${phone}${/iPhone|iPad/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(msg)}`;
    C.openModal(`<h2>Invite ready${label ? ' for ' + esc(label) : ''}</h2>
      <div class="invite-code">${esc(code)}</div>
      <p class="sub" style="text-align:center;margin-top:0;word-break:break-all">${esc(link)}</p>
      <p class="hint" style="margin-top:0"><strong>Now send it.</strong> GRIT doesn't email invites itself, so pick how to send it:</p>
      <div class="row" style="margin-bottom:8px"><a class="btn primary" href="${esc(mailto)}">✉️ Email</a><a class="btn primary" href="${esc(sms)}">💬 Text</a></div>
      <div class="row"><button class="btn" data-modal-action="coach-share">Share…</button><button class="btn" data-modal-action="coach-copy">Copy message</button></div>
      <p class="hint" style="margin-top:10px">Single use. They can also type the code in Settings → Account → Enter invite code.</p>`, null, { hideSave: true });
    modalActions['coach-share'] = async () => { try { if (navigator.share) await navigator.share({ title: 'GRIT invite', text: msg }); else throw new Error('no share'); } catch (_) { modalActions['coach-copy'](); } };
    modalActions['coach-copy'] = async () => { try { await navigator.clipboard.writeText(msg); C.toast('Copied. Paste it into a text or email'); } catch (_) { prompt('Copy this message:', msg); } };
  }

  // ---------- coach dashboard view ----------
  let coachData = null, coachLoading = false;
  async function refreshCoach() {
    if (!user || !profile || profile.role !== 'coach') return;
    coachLoading = true;
    try {
      const [ov, inv, pl, rc] = await Promise.all([
        sb.rpc('coach_overview'),
        sb.from('invites').select('code,label,created_at,used_by').order('created_at', { ascending: false }),
        fetchPlans(),
        loadRecipes(true).catch(() => []),
      ]);
      if (ov.error) throw ov.error;
      let builtin = [];
      try { builtin = (await (await fetch('plans/index.json')).json()).plans || []; } catch (_) { /* offline */ }
      coachData = { clients: ov.data || [], invites: (inv.data || []).filter((i) => !i.used_by), plans: pl, builtin, recipes: rc };
    } catch (e) { coachData = { error: e.message }; }
    coachLoading = false;
    if (C.ui.tab === 'coach') C.render();
  }
  function viewCoach() {
    if (!user || !profile) return '<div class="card"><p>Sign in first.</p><button class="btn primary block" data-action="cloud-signin-open">Sign in</button></div>';
    if (profile.role !== 'coach') return '<div class="card"><p>This account isn\'t the coach account.</p></div>';
    if (!coachData) { if (!coachLoading) refreshCoach(); return '<div class="empty">Loading your clients…</div>'; }
    if (coachData.error) return `<div class="card"><p class="bad">${esc(coachData.error)}</p><button class="btn block" data-action="coach-refresh">Try again</button></div>`;
    const { clients, invites, plans, builtin } = coachData;
    const planName = (id) => { const p = plans.find((x) => x.id === id); return p ? p.data.name + (p.data.forClient ? ' ✨' : '') : null; };
    const today = C.todayISO();
    let h = `<div class="row" style="margin-bottom:14px"><button class="btn primary" data-action="coach-invite">+ Invite client</button><button class="btn" data-action="coach-refresh">↻ Refresh</button></div>`;
    h += `<div class="card"><div class="card-head"><h2>Clients · ${clients.length}</h2></div>`;
    h += clients.length ? clients.map((c) => {
      const name = c.full_name || c.email;
      const active = c.last_activity ? C.relDay(String(c.last_activity).slice(0, 10)) : 'never';
      const quiet = !c.last_activity || C.daysBetween(String(c.last_activity).slice(0, 10), today) >= 3;
      const wChange = c.last_weight != null && c.prev_weight != null ? Math.round((c.last_weight - c.prev_weight) * 10) / 10 : null;
      const pname = c.program && c.program.planId ? planName(c.program.planId) : null;
      return `<div class="client"><div class="row" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-start">
          <div style="min-width:0"><div class="title" style="font-weight:800">${esc(name)}</div><div class="sub" style="font-size:13px">${c.full_name ? esc(c.email) + ' · ' : ''}active <span class="${quiet ? 'bad' : ''}">${esc(active)}</span></div></div>
          ${c.last_weight != null ? `<div style="text-align:right;flex:none"><strong>${Number(c.last_weight)}</strong>${wChange != null ? `<div class="sub" style="font-size:12px">${wChange > 0 ? '+' : ''}${wChange} / wk</div>` : ''}</div>` : ''}</div>
        <div style="margin:6px 0">${[`🏋️ ${c.workouts_7d}/7d`, `🍽 ${c.food_days_7d}/7`, `📓 ${c.journal_days_7d}/7`, pname ? esc(pname) : 'No plan',
          c.nutrition && c.nutrition.profile ? `🥗 ${esc(({ cut: 'Cut', maintain: 'Maintain', build: 'Build' })[c.nutrition.profile.goal] || '')}${c.nutrition.profile.flagged ? ' ⚠️' : ''}` : '',
          c.shared_photos ? `📷 ${c.shared_photos}` : '', c.unread_notes ? `💬 ${c.unread_notes} unread` : ''].filter(Boolean).map((t) => `<span class="chip">${t}</span>`).join('')}</div>
        <div class="row client-actions"><button class="btn small primary" data-action="coach-view" data-id="${c.client_id}" data-name="${esc(name)}">Open</button>
          <button class="btn small" data-action="coach-note" data-id="${c.client_id}" data-name="${esc(name)}">Message</button>
          <button class="btn small" data-action="coach-targets" data-id="${c.client_id}" data-name="${esc(name)}">Targets</button>
          <button class="btn small" data-action="coach-access" data-id="${c.client_id}" data-name="${esc(name)}">Plans</button>
          <button class="btn small" data-action="coach-customize" data-id="${c.client_id}" data-name="${esc(name)}" data-plan="${esc((c.program && c.program.planId) || '')}">Customize</button>
          <button class="del" data-action="coach-remove" data-id="${c.client_id}" data-name="${esc(name)}" aria-label="Remove client">×</button></div></div>`;
    }).join('') : '<div class="empty">No clients yet. Tap <strong>Invite client</strong> to send your first invite.</div>';
    h += '</div>';
    if (invites.length) {
      h += `<div class="card"><div class="card-head"><h2>Open invites</h2></div><ul class="list">${invites.map((i) => `<li><div class="grow"><div class="title">${esc(i.label || 'Unnamed')}</div><div class="meta">${esc(i.code)} · created ${C.relDay(i.created_at.slice(0, 10))}</div></div>
        <button class="btn small" data-action="coach-show-invite" data-code="${esc(i.code)}" data-label="${esc(i.label || '')}">Share</button><button class="del" data-action="coach-del-invite" data-code="${esc(i.code)}" aria-label="Delete invite">×</button></li>`).join('')}</ul></div>`;
    }
    const notUploaded = builtin.filter((b) => !plans.some((p) => p.id === b.id));
    const templates = plans.filter((p) => !p.data.forClient), custom = plans.filter((p) => p.data.forClient);
    const clientName = (id) => { const c = clients.find((x) => x.client_id === id); return c ? (c.full_name || c.email) : 'former client'; };
    h += `<div class="card"><div class="card-head"><h2>Plan library · ${templates.length}</h2><span class="row" style="gap:6px"><button class="btn small primary" data-action="coach-plan-new">+ New</button><button class="btn small" data-action="coach-plan-file">Upload</button></span></div>`;
    h += templates.length ? templates.map((p) => `<div class="client"><div class="title" style="font-weight:800">${esc(p.data.name)}</div><div class="sub" style="font-size:13px">${esc(p.data.phase || '')} · ${p.data.weeks || '?'} weeks · ${(p.data.days || []).length} days</div>
        <div class="row" style="margin-top:8px">
          <button class="btn small ${p.visibility === 'all' ? 'primary' : ''}" data-action="coach-plan-set" data-id="${esc(p.id)}" data-field="visibility" data-value="all">All clients</button>
          <button class="btn small ${p.visibility === 'assigned' ? 'primary' : ''}" data-action="coach-plan-set" data-id="${esc(p.id)}" data-field="visibility" data-value="assigned">Selected clients</button>
          <button class="btn small" data-action="coach-plan-set" data-id="${esc(p.id)}" data-field="published" data-value="${!p.published}">${p.published ? 'Hide' : 'Publish'}</button>
          <button class="btn small" data-action="plan-guide" data-id="${esc(p.id)}">View</button>
          <button class="btn small" data-action="coach-plan-edit" data-id="${esc(p.id)}">✏️ Edit</button></div>
        ${p.published ? '' : '<div class="sub bad" style="font-size:12px;margin-top:4px">Hidden from clients</div>'}</div>`).join('') : '<p class="sub">Your library is empty. Add the built-in plan below to publish it to clients.</p>';
    if (custom.length) h += `<div class="res-head">Client versions</div>` + custom.map((p) => `<div class="client"><div class="title" style="font-weight:800">${esc(p.data.name)}</div>
        <div class="sub" style="font-size:13px">For ${esc(clientName(p.data.forClient))}${p.data.basedOn ? ' · based on ' + esc((plans.find((x) => x.id === p.data.basedOn) || { data: { name: p.data.basedOn } }).data.name) : ''}</div>
        <div class="row" style="margin-top:8px"><button class="btn small" data-action="coach-plan-edit" data-id="${esc(p.id)}">✏️ Edit</button><button class="btn small" data-action="plan-guide" data-id="${esc(p.id)}">View</button></div></div>`).join('');
    const recipesHTML = window.Recipes ? Recipes.section(coachData.recipes) : '';
    if (notUploaded.length) h += `<div class="res-head">Ready to add</div><ul class="list">${notUploaded.map((b) => `<li><div class="grow"><div class="title">${esc(b.name)}</div><div class="meta">${esc(b.phase || '')}</div></div><button class="btn small primary" data-action="coach-plan-upload" data-file="${esc(b.file)}">Add</button></li>`).join('')}</ul>`;
    h += '</div>';
    h += recipesHTML;
    return h;
  }

  // ---------- startup ----------
  function captureInviteFromUrl() {
    const m = location.hash.match(/^#invite=([A-Za-z0-9]{4,12})/);
    if (!m) return;
    try { localStorage.setItem(INVITE_KEY, m[1].toUpperCase()); } catch (_) { /* ignore */ }
    history.replaceState(null, '', location.pathname + location.search);
  }

  window.Cloud = {
    init(ctx) {
      C = ctx;
      Object.assign(ctx.actions, actions);
      Object.assign(ctx.modalActions, modalActions);
      ctx.views.coach = viewCoach;
      ctx.TITLES.coach = 'Coach';
      ctx.PARENT.coach = 'today';
      captureInviteFromUrl();
      const cfg = window.GRIT_CONFIG;
      if (!cfg || !window.supabase || !window.supabase.createClient) return;
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'grit-auth' },
      });
    },
    async start() {
      if (!sb) return;
      try { const m = await DB.getKV('sync'); if (m) meta = Object.assign(meta, m); } catch (_) { /* ignore */ }
      sb.auth.onAuthStateChange((event, session) => {
        if (session && session.user) setTimeout(() => onSignedIn(session.user), 0);
        else if (event === 'SIGNED_OUT') onSignedOut();
      });
      const { data } = await sb.auth.getSession();
      if (data && data.session) await onSignedIn(data.session.user);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && user) { pull(); loadNotes().then(() => C.softRender()); } else if (user) push(); });
      window.addEventListener('online', () => { if (user) syncNow(); });
    },
    changed, settingsSection, saveName, todayCards, usesCloudPlans, fetchPlans, savePlan, deletePlan,
    canSharePhotos, sharePhoto, unsharePhoto, photoUrl,
    loadRecipes, saveRecipe, deleteRecipe, recipes: () => recipeCache || [], refreshCoach: () => refreshCoach(),
    get user() { return user; }, get profile() { return profile; },
    get configured() { return !!sb; },
    // exposed for tests
    _toRecords: toRecords, _applyRecord: applyRecord,
  };
})();
