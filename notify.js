// GRIT: notifications. Bell + inbox, phone notifications (web push), notification settings and reminders.
// Notifications are created on the server (database triggers for coach/client actions, and a
// reminder job every 15 minutes); the app lists them, keeps the badge current and manages settings.
(function () {
  let C, sb = null;
  const st = { items: null, unread: 0, prefs: null, loading: false, pendingGo: null };
  let iv = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getSb = () => sb || (sb = window.Cloud && Cloud._sb ? Cloud._sb() : null);
  const me = () => window.Cloud && Cloud.user && Cloud.user.id;
  const available = () => !!(getSb() && me() && Cloud.profile);
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch (_) { return 'America/New_York'; } };
  const DAYS = [[1, 'M'], [2, 'T'], [3, 'W'], [4, 'T'], [5, 'F'], [6, 'S'], [7, 'S']];
  const TYPES = [['chat', 'Chat messages'], ['note', 'Notes from your coach'], ['plan', 'New and updated plans'], ['nutrition', 'Nutrition and target changes'], ['recipe', 'New recipes'], ['reminder', 'Reminders']];
  const REMINDERS = [
    { type: 'workout', label: 'Workout reminder', sub: 'On your training days, if you haven\'t logged a workout yet', time: '17:00', days: [1, 3, 5], on: true, pickDays: true },
    { type: 'food', label: 'Log your food', sub: 'If nothing is logged by this time', time: '20:00', on: true },
    { type: 'habits', label: 'Daily habits', sub: 'If today\'s habits aren\'t all checked off', time: '21:00', on: true },
    { type: 'weigh', label: 'Weigh-in', sub: 'On the days you pick, if you haven\'t logged weight', time: '07:30', days: [1], on: true, pickDays: true },
    { type: 'journal', label: 'Daily check-in (journal)', sub: 'If you haven\'t written today', time: '21:30', on: false },
    { type: 'water', label: 'Water', sub: 'A daily nudge', time: '12:00', on: false },
  ];
  const ICON = { chat: '💬', note: '📝', plan: '🏋️', nutrition: '🥗', recipe: '🍳', reminder: '⏰' };

  // ---------- data ----------
  async function refreshCount() {
    if (!available()) { st.unread = 0; badge(); return; }
    const { data, error } = await sb.from('notifications').select('id').is('read_at', null).limit(100);
    if (!error) { st.unread = (data || []).length; badge(); }
  }
  async function loadItems() {
    const { data, error } = await sb.from('notifications').select('id,kind,title,body,link,count,created_at,read_at').order('created_at', { ascending: false }).limit(60);
    st.items = error ? [] : (data || []);
    st.unread = st.items.filter((n) => !n.read_at).length;
    badge();
  }
  async function markRead(ids) {
    await sb.rpc('mark_notifications_read', { p_ids: ids || null });
    (st.items || []).forEach((n) => { if (!ids || ids.includes(n.id)) n.read_at = n.read_at || new Date().toISOString(); });
    st.unread = (st.items || []).filter((n) => !n.read_at).length;
    if (!ids) st.unread = 0;
    badge();
  }
  function defaultPrefs() {
    return { types: Object.fromEntries(TYPES.map(([k]) => [k, true])), quiet_start: null, quiet_end: null, tz: tz(),
      reminders: REMINDERS.map((r) => ({ type: r.type, on: r.on, time: r.time, days: r.days ? r.days.slice() : [1, 2, 3, 4, 5, 6, 7] })) };
  }
  async function loadPrefs() {
    const { data } = await sb.from('notify_prefs').select('types,quiet_start,quiet_end,tz,reminders').eq('user_id', me()).maybeSingle();
    if (data) {
      st.prefs = data;
      // keep the stored time zone current (travel, daylight saving is handled by the zone name)
      if (data.tz !== tz()) sb.from('notify_prefs').update({ tz: tz(), updated_at: new Date().toISOString() }).eq('user_id', me()).then(() => {});
    } else {
      st.prefs = defaultPrefs();
      await sb.from('notify_prefs').insert(Object.assign({ user_id: me() }, st.prefs));
    }
    return st.prefs;
  }
  async function savePrefs(p) {
    st.prefs = p;
    const { error } = await sb.from('notify_prefs').upsert(Object.assign({ user_id: me(), updated_at: new Date().toISOString() }, p), { onConflict: 'user_id' });
    return !error;
  }

  // ---------- phone notifications ----------
  // the public web-push key lives in the database (app_config), set once by the coach in Notification settings
  let vapidKey = null;
  async function loadVapid() {
    const { data } = await sb.from('app_config').select('value').eq('key', 'vapid_public_key').maybeSingle();
    vapidKey = (data && data.value) || null;
    return vapidKey;
  }
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const browserCanPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const pushSupported = () => browserCanPush() && !!vapidKey;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function urlB64(s) { const pad = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function enablePush() {
    if (!vapidKey) await loadVapid();
    if (browserCanPush() && !vapidKey) throw new Error('Phone notifications aren\'t set up yet. ' + (Cloud.profile && Cloud.profile.role === 'coach' ? 'Use "Set up phone notifications" below first.' : 'Your coach needs to finish setting them up.'));
    if (!pushSupported()) throw new Error(isIOS() && !standalone() ? 'On iPhone, add GRIT to your Home Screen first (Share → Add to Home Screen), then open it from there.' : 'This browser can\'t show notifications.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in your phone or browser settings.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey && b64u(sub.options.applicationServerKey) !== vapidKey) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(vapidKey) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: me(), p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
    if (error) throw new Error(error.message);
  }
  async function disablePush() {
    const sub = await currentSub();
    if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe().catch(() => {}); }
  }

  // ---------- badge ----------
  function badge() {
    const b = document.getElementById('bell-btn');
    if (!b) return;
    b.hidden = !available() || !!(C && C.ui.viewAs);
    const el = b.querySelector('.bell-badge');
    el.hidden = !st.unread; el.textContent = st.unread > 9 ? '9+' : String(st.unread);
    try { if (navigator.setAppBadge) { if (st.unread) navigator.setAppBadge(st.unread); else navigator.clearAppBadge(); } } catch (_) { /* unsupported */ }
  }

  // ---------- navigation from a notification ----------
  function go(link, nid) {
    if (nid) markRead([nid]);
    if (!link || !link.tab) { C.setTab('today'); return; }
    if (link.tab === 'chat') {
      if (Cloud.profile && Cloud.profile.role === 'coach' && link.client) {
        const el = document.createElement('button'); el.dataset.id = link.client; el.dataset.name = '';
        C.actions['chat-with'](el);
      } else C.actions['chat-open']();
      return;
    }
    if (link.tab === 'guide' && link.id) { C.ui.guidePlan = link.id; C.ui.guideWeek = null; C.setTab('guide'); return; }
    if (C.views[link.tab]) C.setTab(link.tab); else C.setTab('today');
  }

  // ---------- views ----------
  const ago = (iso) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d < 7 ? d + ' days ago' : new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  function viewInbox() {
    if (!available()) return '<div class="card"><p style="margin-top:0">Sign in to get notifications from your coach and reminders.</p><button class="btn primary block" data-action="open-settings">Open settings</button></div>';
    if (!st.items) { if (!st.loading) { st.loading = true; loadItems().then(() => { st.loading = false; if (C.ui.tab === 'inbox') C.render(); }); } return '<div class="empty">Loading…</div>'; }
    let h = `<div class="row" style="margin-bottom:12px"><button class="btn small" data-action="notify-settings">⚙️ Notification settings</button>${st.unread ? '<button class="btn small" data-action="inbox-read-all">Mark all read</button>' : ''}</div>`;
    h += pushNudge();
    if (!st.items.length) return h + '<div class="card"><div class="empty">No notifications yet. Messages from your coach, new plans and your reminders show up here.</div></div>';
    h += `<div class="card"><ul class="list inbox">${st.items.map((n, i) => `<li class="${n.read_at ? '' : 'unread'}" data-action="inbox-go" data-i="${i}" style="cursor:pointer">
      <span class="inbox-ico">${ICON[n.kind] || '🔔'}</span><div class="grow" style="min-width:0"><div class="title">${esc(n.title)}</div>${n.body ? `<div class="meta inbox-body">${esc(n.body)}</div>` : ''}<div class="meta">${esc(ago(n.created_at))}</div></div>
      ${n.read_at ? '' : '<span class="inbox-dot" aria-label="unread"></span>'}</li>`).join('')}</ul></div>`;
    return h;
  }
  function pushNudge() {
    if (!pushSupported()) {
      if (isIOS() && !standalone()) return '<div class="card nudge"><strong>Get notifications on your iPhone</strong><p class="sub" style="margin:4px 0 0">Tap Share → <em>Add to Home Screen</em>, open GRIT from your Home Screen, then turn notifications on in Notification settings.</p></div>';
      return '';
    }
    if (Notification.permission === 'granted' && st.hasSub) return '';
    if (Notification.permission === 'denied') return '<div class="card nudge"><strong>Phone notifications are blocked</strong><p class="sub" style="margin:4px 0 0">Allow notifications for GRIT in your phone or browser settings, then turn them on in Notification settings.</p></div>';
    return '<div class="card nudge"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>Turn on phone notifications</strong><div class="sub">Coach messages and reminders on your lock screen.</div></div><button class="btn primary small" data-action="push-on">Turn on</button></div></div>';
  }
  function timeIn(name, val) { return `<input type="time" name="${name}" value="${esc(val || '')}">`; }
  async function openSettings() {
    const p = st.prefs || await loadPrefs();
    await loadVapid().catch(() => {});
    const coachSetup = Cloud.profile && Cloud.profile.role === 'coach' ? `<div class="card" style="background:var(--surface-2)"><div><strong>Coach setup: phone notification keys</strong></div>
      <div class="sub" style="margin:2px 0 8px">${vapidKey ? 'Set up ✓ (only make new keys if something is broken; everyone then turns notifications on again).' : 'One-time step before anyone can get phone notifications.'}</div>
      <button class="btn small ${vapidKey ? '' : 'primary'}" data-modal-action="vapid-gen">${vapidKey ? 'Make new keys' : 'Set up phone notifications'}</button></div>` : '';
    const sub = await currentSub().catch(() => null);
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const status = browserCanPush() && !vapidKey ? 'Not set up yet' + (Cloud.profile && Cloud.profile.role === 'coach' ? ': use the coach setup above.' : ': your coach is finishing the setup.')
      : !pushSupported() ? (isIOS() && !standalone() ? 'Add GRIT to your Home Screen to get phone notifications on iPhone.' : 'This browser can\'t show phone notifications. You\'ll still see them in the bell.')
      : perm === 'denied' ? 'Blocked in your phone/browser settings. Allow notifications for this site, then try again.'
      : sub ? 'On for this device ✓' : 'Off for this device.';
    const rem = (type) => (p.reminders || []).find((r) => r.type === type) || REMINDERS.find((r) => r.type === type);
    C.openModal(`<h2>Notifications</h2>
      <div class="card" style="background:var(--surface-2)"><div><strong>Phone notifications</strong></div><div class="sub" style="margin:2px 0 8px">${esc(status)}</div>
        <div class="row">${pushSupported() && perm !== 'denied' ? (sub ? '<button class="btn small" data-modal-action="push-off">Turn off on this device</button><button class="btn small" data-modal-action="push-test">Send a test</button>' : '<button class="btn small primary" data-modal-action="push-on">Turn on for this device</button>') : ''}</div></div>
      ${coachSetup}
      <div class="res-head">Notify me about</div>
      ${TYPES.map(([k, l]) => `<label class="ed-check" style="display:flex;margin:6px 0"><input type="checkbox" name="t_${k}" ${p.types && p.types[k] === false ? '' : 'checked'}><span>${l}</span></label>`).join('')}
      <div class="res-head">Quiet hours</div>
      <p class="hint" style="margin-top:0">No phone alerts during these hours (they still wait in the bell). Leave blank for none.</p>
      <div class="fields-2">${C.field('From', timeIn('quiet_start', p.quiet_start))}${C.field('Until', timeIn('quiet_end', p.quiet_end))}</div>
      <div class="res-head">Reminders</div>
      <p class="hint" style="margin-top:0">Only sent if you haven't done it yet that day. Times are your local time (${esc(tz())}).</p>
      ${REMINDERS.map((d) => { const r = rem(d.type); return `<div class="rem-row"><label class="ed-check" style="display:flex;flex:1;min-width:0"><input type="checkbox" name="r_${d.type}_on" ${r.on ? 'checked' : ''}><span><strong>${d.label}</strong><br><span class="sub" style="font-size:12px">${d.sub}</span></span></label>${timeIn(`r_${d.type}_time`, r.time)}</div>
        ${d.pickDays ? `<div class="rem-days">${DAYS.map(([n, l]) => `<label class="day-chip"><input type="checkbox" name="r_${d.type}_d${n}" ${(r.days || []).includes(n) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>` : ''}`; }).join('')}`,
    async (fd) => {
      const np = { types: Object.fromEntries(TYPES.map(([k]) => [k, fd.get('t_' + k) === 'on'])), quiet_start: fd.get('quiet_start') || null, quiet_end: fd.get('quiet_end') || null, tz: tz(),
        reminders: REMINDERS.map((d) => ({ type: d.type, on: fd.get(`r_${d.type}_on`) === 'on', time: fd.get(`r_${d.type}_time`) || d.time,
          days: d.pickDays ? DAYS.map(([n]) => n).filter((n) => fd.get(`r_${d.type}_d${n}`) === 'on') : [1, 2, 3, 4, 5, 6, 7] })) };
      if ((np.quiet_start && !np.quiet_end) || (!np.quiet_start && np.quiet_end)) { C.toast('Set both quiet-hour times, or neither'); return false; }
      const ok = await savePrefs(np);
      C.toast(ok ? 'Notification settings saved' : 'Couldn\'t save. Check your connection');
      return ok ? undefined : false;
    }, { saveLabel: 'Save' });
  }

  const actions = {
    'inbox-open': () => { st.items = null; C.setTab('inbox'); },
    'inbox-go': (el) => { const n = (st.items || [])[+el.dataset.i]; if (n) go(n.link, n.id); },
    'inbox-read-all': async () => { await markRead(null); C.render(); },
    'notify-settings': () => openSettings(),
    'push-on': async () => { try { await enablePush(); st.hasSub = true; C.toast('Phone notifications on 🔔'); C.render(); } catch (e) { C.toast(e.message || String(e)); } },
  };
  const modalActions = {
    'push-on': async () => { try { await enablePush(); st.hasSub = true; C.toast('Phone notifications on 🔔'); C.closeModal(); setTimeout(openSettings, 0); } catch (e) { C.toast(e.message || String(e)); } },
    'push-off': async () => { await disablePush(); st.hasSub = false; C.toast('Phone notifications off for this device'); C.closeModal(); setTimeout(openSettings, 0); },
    'vapid-gen': async () => {
      if (vapidKey && !confirm('Make new keys? Everyone (you included) will need to turn phone notifications on again.')) return;
      try {
        const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
        const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
        const priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
        const { error } = await sb.rpc('set_app_config', { p_key: 'vapid_public_key', p_value: pub });
        if (error) throw new Error(error.message);
        vapidKey = pub;
        C.closeModal();
        setTimeout(() => C.openModal(`<h2>Finish in Supabase</h2>
          <p style="margin-top:0">Your keys are made and the public one is saved. Copy these into <strong>Supabase → Edge Functions → Secrets</strong> now. The private key is shown only this once and isn't stored anywhere else.</p>
          ${C.field('VAPID_PUBLIC_KEY', `<textarea readonly rows="3" onclick="this.select()">${esc(pub)}</textarea>`)}
          ${C.field('VAPID_PRIVATE_KEY (keep secret)', `<textarea readonly rows="2" onclick="this.select()">${esc(priv)}</textarea>`)}
          ${C.field('VAPID_SUBJECT', `<textarea readonly rows="1" onclick="this.select()">mailto:${esc((Cloud.user && Cloud.user.email) || 'you@example.com')}</textarea>`)}
          <p class="hint">Then: deploy the <code>send-push</code> function and add the database webhook (steps in <code>supabase/functions/send-push/README.md</code>), and turn on notifications for this device.</p>`, null, { hideSave: true }), 0);
      } catch (e) {
        const m = String((e && e.message) || e);
        C.toast(/set_app_config|function|schema cache|does not exist/i.test(m) ? 'Run the notifications SQL in Supabase first, then try again.' : 'Couldn\'t make keys: ' + m);
      }
    },
    'push-test': async () => { const { error } = await sb.rpc('notify_test'); C.toast(error ? 'Test failed: ' + error.message : 'Test sent. It should arrive in a few seconds'); },
  };

  window.Notify = {
    init(ctx) {
      C = ctx;
      Object.assign(ctx.actions, actions);
      Object.assign(ctx.modalActions, modalActions);
      ctx.views.inbox = viewInbox;
      ctx.TITLES.inbox = 'Notifications';
      ctx.PARENT.inbox = 'today';
      // opened from a tapped notification: ?go={"tab":…}
      try {
        const q = new URLSearchParams(location.search).get('go');
        if (q) { st.pendingGo = JSON.parse(q); history.replaceState(history.state, '', location.pathname + location.hash); }
      } catch (_) { /* ignore */ }
      if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
        const d = e.data || {};
        if (d.type === 'grit-push') { refreshCount(); if (C.ui.tab === 'inbox') loadItems().then(() => C.render()); }
        if (d.type === 'grit-open') go(d.link, d.id);
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && available()) { refreshCount(); if (C.ui.tab === 'inbox') loadItems().then(() => C.render()); } });
      clearInterval(iv); iv = setInterval(() => { if (document.visibilityState === 'visible' && available()) refreshCount(); }, 45000);
    },
    async onSignedIn() {
      st.items = null; st.prefs = null;
      await refreshCount();
      loadPrefs().catch(() => {});
      await loadVapid().catch(() => {});
      currentSub().then((s) => {
        st.hasSub = !!s;
        // re-save this device's subscription in case it changed or belonged to the previous account
        if (s && vapidKey && s.options && s.options.applicationServerKey && b64u(s.options.applicationServerKey) !== vapidKey && Notification.permission === 'granted') { enablePush().catch(() => {}); return; }
        if (s) { const j = s.toJSON(); sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: me(), p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' }).then(() => {}); }
      }).catch(() => {});
      if (st.pendingGo) { const g = st.pendingGo; st.pendingGo = null; setTimeout(() => go(g, g.nid), 0); }
    },
    async beforeSignOut() { await disablePush().catch(() => {}); },
    onSignedOut() { st.items = null; st.unread = 0; st.prefs = null; badge(); },
    afterRender() { badge(); },
  };
})();
