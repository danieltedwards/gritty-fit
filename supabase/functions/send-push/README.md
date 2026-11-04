# Phone notifications setup (one time)

1. **Database:** run `supabase/schema.sql` again (SQL Editor → New query → paste → Run). It adds the
   notifications, push subscriptions and notification settings tables, the triggers, and a reminder job
   that runs every 15 minutes (pg_cron).
   If the reminder job didn't schedule, turn on **Integrations → Cron** and run the file again.
2. **Function:** Edge Functions → *Deploy a new function* → *Via Editor*, name it `send-push`, paste
   `index.ts` from this folder, Deploy.
3. **Keys:** in the app, signed in as the coach: Settings → Account → 🔔 Notifications →
   **Set up phone notifications**. The app makes the key pair on your device, saves the public key to
   the database, and shows you the three values once. Add them in Edge Functions → Secrets:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY` (kept only in Supabase, never in the repo)
   - `VAPID_SUBJECT` (e.g. `mailto:you@example.com`)
4. **Webhook:** Database → Webhooks → *Create a new hook*: table `notifications`, events **Insert**,
   type **Supabase Edge Functions**, function `send-push`. Create.
5. In the app: Settings → Account → **🔔 Notifications** → *Turn on for this device* → *Send a test*.
