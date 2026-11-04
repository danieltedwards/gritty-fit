// GRIT: sends a phone notification (web push) for every new row in public.notifications.
// Called by a Supabase Database Webhook (table: notifications, event: INSERT).
// Secrets to set in Supabase → Edge Functions → Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:coach@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

function inQuietHours(prefs: any): boolean {
  if (!prefs || !prefs.quiet_start || !prefs.quiet_end) return false;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: prefs.tz || 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24, m = Number(parts.find((p) => p.type === 'minute')?.value);
  const now = h * 60 + m;
  const toMin = (s: string) => { const [a, b] = s.split(':').map(Number); return a * 60 + (b || 0); };
  const s = toMin(prefs.quiet_start), e = toMin(prefs.quiet_end);
  return s <= e ? now >= s && now < e : now >= s || now < e; // handles overnight ranges like 22:00–07:00
}

Deno.serve(async (req) => {
  let payload: any;
  try { payload = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const n = payload && payload.record;
  if (!n || !n.user_id) return new Response('no record', { status: 200 });

  const { data: prefs } = await db.from('notify_prefs').select('types,quiet_start,quiet_end,tz').eq('user_id', n.user_id).maybeSingle();
  if (prefs && prefs.types && prefs.types[n.kind] === false) return new Response('type off', { status: 200 });
  if (inQuietHours(prefs)) return new Response('quiet hours', { status: 200 });

  const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', n.user_id);
  const { count } = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', n.user_id).is('read_at', null);
  const msg = JSON.stringify({ title: n.title, body: n.body || '', link: n.link || null, tag: n.grp || n.kind, id: n.id, badge: count || 0 });
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg, { TTL: 60 * 60 * 24 });
      sent++;
    } catch (err: any) {
      // the phone unsubscribed or the app was removed: forget this device
      if (err && (err.statusCode === 404 || err.statusCode === 410)) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }
  return new Response(JSON.stringify({ sent }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
