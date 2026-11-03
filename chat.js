// GRIT — chat between a coach and each client (one conversation per client).
// Floating chat button with an unread badge → Chat screen. Coaches see a list of clients; clients go
// straight to their coach. New messages are fetched by polling (every few seconds while a conversation
// is open, about once a minute otherwise).
(function () {
  let C, sb = null;
  const st = { summary: [], clients: null, thread: null, msgs: [], pending: [], lastAt: null, loading: false, sending: false };
  let fastIv = null, slowIv = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => Cloud.user && Cloud.user.id;
  const isCoach = () => !!(Cloud.profile && Cloud.profile.role === 'coach');
  const getSb = () => sb || (sb = Cloud._sb ? Cloud._sb() : null);
  const available = () => !!(getSb() && Cloud.user && Cloud.profile && (isCoach() || Cloud.profile.coach_id));
  const totalUnread = () => st.summary.reduce((a, s) => a + Number(s.unread || 0), 0);

  // ---------- data ----------
  async function loadSummary() {
    if (!available() || !getSb()) return;
    const { data, error } = await sb.rpc('chat_summary');
    if (!error) st.summary = data || [];
    updateFab();
  }
  async function loadClients() {
    if (!isCoach()) return;
    const { data } = await sb.from('profiles').select('id,full_name,email,last_seen').eq('coach_id', me());
    st.clients = (data || []).sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
  }
  // server messages are kept by id (no duplicates possible); unsent ones live in st.pending
  const merge = (rows) => { rows.forEach((m) => { const i = st.msgs.findIndex((x) => x.id === m.id); if (i >= 0) st.msgs[i] = m; else st.msgs.push(m); }); st.msgs.sort((a, b) => a.created_at.localeCompare(b.created_at)); };
  async function loadThread(clientId, more) {
    let q = sb.from('messages').select('id,client_id,sender_id,body,created_at,read_at').eq('client_id', clientId).order('created_at', { ascending: true });
    if (more && st.lastAt) q = q.gte('created_at', new Date(Date.parse(st.lastAt) - 60000).toISOString());
    else q = q.limit(300);
    const { data, error } = await q;
    if (error || st.thread !== clientId) return false;
    const before = JSON.stringify(st.msgs.map((m) => m.id + (m.read_at || '')));
    if (!more) st.msgs = [];
    merge(data || []);
    if (st.msgs.length) st.lastAt = st.msgs[st.msgs.length - 1].created_at;
    const changed = !more || before !== JSON.stringify(st.msgs.map((m) => m.id + (m.read_at || '')));
    if ((data || []).some((m) => m.sender_id !== me() && !m.read_at)) {
      await sb.rpc('mark_chat_read', { p_client: clientId });
      const s = st.summary.find((x) => x.client_id === clientId); if (s) s.unread = 0;
      updateFab();
    }
    return changed;
  }
  async function send(text) {
    const body = text.trim();
    if (!body || !st.thread) return;
    const tmp = { id: 'tmp-' + Date.now(), client_id: st.thread, sender_id: me(), body, created_at: new Date().toISOString(), pending: true };
    st.pending.push(tmp); paintLog(true);
    const res = await sb.from('messages').insert({ client_id: st.thread, body }).select().single();
    const error = res.error, data = Array.isArray(res.data) ? res.data[0] : res.data;
    if (error) { tmp.failed = true; tmp.pending = false; paintLog(); C.toast('Message not sent. Check your connection'); return; }
    st.pending = st.pending.filter((m) => m !== tmp);
    merge([data]); st.lastAt = st.msgs[st.msgs.length - 1].created_at;
    paintLog();
    const s = st.summary.find((x) => x.client_id === st.thread);
    if (s) Object.assign(s, { last_body: body, last_at: data.created_at, last_sender: me() }); else st.summary.push({ client_id: st.thread, unread: 0, last_body: body, last_at: data.created_at, last_sender: me() });
  }

  // ---------- polling ----------
  function startPolling() {
    clearInterval(slowIv);
    slowIv = setInterval(() => { if (document.visibilityState === 'visible' && available()) loadSummary(); }, 45000);
  }
  function setFast(on) {
    clearInterval(fastIv); fastIv = null;
    if (on) fastIv = setInterval(async () => {
      if (document.visibilityState !== 'visible' || C.ui.tab !== 'chat' || !st.thread) return;
      if (await loadThread(st.thread, true)) paintLog(true);
    }, 4000);
  }

  // ---------- floating button ----------
  function fab() {
    let b = document.getElementById('chat-fab');
    if (!b) {
      b = document.createElement('button');
      b.id = 'chat-fab'; b.className = 'chat-fab'; b.dataset.action = 'chat-open'; b.setAttribute('aria-label', 'Chat');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><span class="chat-badge" hidden></span>';
      document.body.appendChild(b);
    }
    return b;
  }
  function updateFab() {
    if (!C) return;
    const b = fab();
    const hide = !available() || C.ui.viewAs || ['chat', 'session', 'editor'].includes(C.ui.tab);
    b.hidden = !!hide;
    const n = totalUnread(), badge = b.querySelector('.chat-badge');
    badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
    b.classList.toggle('has-unread', n > 0);
  }

  // ---------- views ----------
  const fmtTime = (iso) => { const d = new Date(iso); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const dayKey = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  function otherName() {
    if (!isCoach()) { const c = Cloud.coach; return c ? (c.full_name || c.email || 'Your coach') : 'Your coach'; }
    const c = (st.clients || []).find((x) => x.id === st.thread);
    return c ? (c.full_name || c.email) : (C.ui.chatName || 'Client');
  }
  function logHTML() {
    const all = st.msgs.concat(st.pending);
    if (!all.length) return `<div class="empty chat-empty">${isCoach() ? 'No messages yet. Say hi 👋' : 'Message your coach here: questions, check-ins, form videos (paste a link), anything.'}</div>`;
    let h = '', lastDay = null;
    all.forEach((m) => {
      const k = dayKey(m.created_at);
      if (k !== lastDay) { lastDay = k; h += `<div class="chat-day">${esc(C.relDay(k))}</div>`; }
      const mine = m.sender_id === me();
      h += `<div class="chat-msg ${mine ? 'mine' : 'theirs'}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}"><div class="chat-bubble">${linkify(m.body)}</div>
        <div class="chat-meta">${fmtTime(m.created_at)}${mine && m.read_at ? ' · Seen' : ''}${m.failed ? ' · Not sent' : ''}${mine && !m.pending && !m.failed && !String(m.id).startsWith('tmp') ? ` <button class="chat-del" data-action="chat-del" data-id="${esc(m.id)}" aria-label="Delete message">×</button>` : ''}</div></div>`;
    });
    return h;
  }
  function paintLog(scroll) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
    log.innerHTML = logHTML();
    if (scroll || nearBottom) requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
  }
  function viewChat() {
    if (!available()) return `<div class="card"><p style="margin-top:0">Chat connects you with your coach. Sign in and join your coach with an invite code to start chatting.</p><button class="btn primary block" data-action="open-settings">Open settings</button></div>`;
    if (isCoach() && !st.thread) return viewList();
    if (!isCoach() && !st.thread) st.thread = me();
    setFast(true);
    if (!st.loading && !st._loadedFor) {
      st.loading = true; st._loadedFor = st.thread;
      loadThread(st.thread).then(() => { st.loading = false; paintLog(true); });
    }
    return `<div class="chat-head card"><div class="chat-avatar">${esc((otherName()[0] || '?').toUpperCase())}</div><div style="min-width:0"><strong>${esc(otherName())}</strong><div class="sub" style="font-size:13px">${isCoach() ? 'Client' : 'Your coach'}</div></div></div>
      <div id="chat-log" class="chat-log">${st._loadedFor === st.thread && !st.loading ? logHTML() : '<div class="empty">Loading…</div>'}</div>
      <form class="chat-compose" id="chat-form" autocomplete="off"><textarea id="chat-input" rows="1" maxlength="4000" placeholder="Message ${esc(otherName())}…" aria-label="Message">${esc(C.ui.chatDraft || '')}</textarea>
        <button class="btn primary" type="submit" aria-label="Send">Send</button></form>`;
  }
  function viewList() {
    setFast(false);
    if (!st.clients) { loadClients().then(() => { if (C.ui.tab === 'chat') C.render(); }); return '<div class="empty">Loading…</div>'; }
    if (!st.clients.length) return '<div class="card"><div class="empty">No clients yet. Invite someone from the Coach dashboard and you can chat here.</div></div>';
    const sum = new Map(st.summary.map((s) => [s.client_id, s]));
    const rows = [...st.clients].sort((a, b) => String((sum.get(b.id) || {}).last_at || '').localeCompare(String((sum.get(a.id) || {}).last_at || '')));
    return `<div class="card"><ul class="list chat-list">${rows.map((c) => {
      const s = sum.get(c.id) || {}, name = c.full_name || c.email, n = Number(s.unread || 0);
      return `<li data-action="chat-thread" data-id="${c.id}" data-name="${esc(name)}" style="cursor:pointer"><div class="chat-avatar">${esc((name[0] || '?').toUpperCase())}</div>
        <div class="grow" style="min-width:0"><div class="title" style="${n ? 'font-weight:800' : ''}">${esc(name)}</div><div class="meta chat-preview">${s.last_body ? (s.last_sender === me() ? 'You: ' : '') + esc(s.last_body) : 'No messages yet'}</div></div>
        <span class="num" style="text-align:right">${s.last_at ? `<div class="sub" style="font-size:12px">${esc(C.relDay(dayKey(s.last_at)))}</div>` : ''}${n ? `<span class="chat-count">${n}</span>` : ''}</span></li>`;
    }).join('')}</ul></div>`;
  }

  function openThread(id, name) {
    st.thread = id; st.msgs = []; st.pending = []; st.lastAt = null; st._loadedFor = null; C.ui.chatName = name || null; C.ui.chatDraft = '';
  }
  const actions = {
    'chat-open': () => { C.ui.chatFrom = C.ui.tab === 'chat' ? C.ui.chatFrom : C.ui.tab; if (!isCoach()) openThread(me()); else { st.thread = null; loadClients(); } C.setTab('chat'); loadSummary(); },
    'chat-thread': (el) => { openThread(el.dataset.id, el.dataset.name); C.render(); requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight)); },
    'chat-with': (el) => { C.ui.chatFrom = C.ui.tab; openThread(el.dataset.id, el.dataset.name); C.setTab('chat'); },
    'chat-back': () => {
      if (isCoach() && st.thread && C.ui.chatFrom !== 'coach') { st.thread = null; setFast(false); loadSummary().then(() => { if (C.ui.tab === 'chat') C.render(); }); C.render(); return; }
      st.thread = isCoach() ? null : st.thread; setFast(false); C.setTab(C.ui.chatFrom && C.ui.chatFrom !== 'chat' ? C.ui.chatFrom : 'today');
    },
    'chat-del': async (el) => {
      if (!confirm('Delete this message for both of you?')) return;
      const { error } = await sb.from('messages').delete().eq('id', el.dataset.id);
      if (error) { C.toast('Couldn\'t delete'); return; }
      st.msgs = st.msgs.filter((m) => m.id !== el.dataset.id); paintLog();
    },
  };

  window.Chat = {
    init(ctx) {
      C = ctx;
      Object.assign(ctx.actions, actions);
      ctx.views.chat = viewChat;
      ctx.TITLES.chat = 'Chat';
      ctx.PARENT.chat = 'today';
      document.addEventListener('submit', (e) => {
        if (e.target.id !== 'chat-form') return;
        e.preventDefault();
        const ta = document.getElementById('chat-input');
        const v = ta.value; ta.value = ''; C.ui.chatDraft = ''; ta.style.height = '';
        send(v); ta.focus();
      });
      document.addEventListener('input', (e) => {
        if (e.target.id !== 'chat-input') return;
        C.ui.chatDraft = e.target.value;
        e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
      });
      document.addEventListener('keydown', (e) => {
        if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
          e.preventDefault(); document.getElementById('chat-form').requestSubmit();
        }
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && available()) { loadSummary(); if (C.ui.tab === 'chat' && st.thread) loadThread(st.thread, true).then((n) => n && paintLog()); } });
      startPolling();
    },
    afterRender(tab) {
      if (tab !== 'chat') setFast(false);
      if (tab === 'chat' && st.thread && C.ui.chatDraft) { const ta = document.getElementById('chat-input'); if (ta && !ta.value) ta.value = C.ui.chatDraft; }
      updateFab();
    },
    onSignedIn() { st.summary = []; st.clients = null; st.thread = null; st.msgs = []; loadSummary(); },
    onSignedOut() { st.summary = []; st.clients = null; st.thread = null; st.msgs = []; setFast(false); updateFab(); },
    composing: () => document.activeElement && document.activeElement.id === 'chat-input',
    unread: (clientId) => { const s = st.summary.find((x) => x.client_id === clientId); return s ? Number(s.unread || 0) : 0; },
    totalUnread,
  };
})();
