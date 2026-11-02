# GRIT — coaching & fitness tracker

A phone-first coaching app. Clients install it to their home screen (no App Store), follow the
training plans you publish, and log food, workouts, weigh-ins, habits and check-ins. You see
everyone from the **Coach dashboard**. It works offline; everything syncs when online.

- **Coach setup (one time):** see [Coach setup](#coach-setup-one-time) below.
- Without signing in, GRIT still works as a private, on-device tracker.

## What's in it

| Tab | What you do there |
| --- | --- |
| **Today** | Dashboard: quick-add buttons, a backup reminder when one is due, your week-so-far score, daily accountability checklist (with streaks), calories vs. target, workouts this week, weight trend and distance to goal, active goals with countdowns, and a journal prompt. |
| **Food** | **Search & auto-fill**: type a food and pick it; calories, protein, carbs and fat fill in for the amount you choose (grams, "1 large", "1 cup", "1 serving"…). **Scan a barcode** with the camera, or type the number, for packaged foods. Foods you've logged before come up first. Then: log by meal, step back through previous days, one-tap re-add, 14-day calorie chart. |
| **Train** | **Coach programs**: choose a plan (Training → Choose a plan), see where you are (week, effort target, deload), and run each day set by set: prescribed sets × reps, tempo, rest and cues, last session's numbers pre-filled, double-progression hints ("all sets hit 8 → add weight"), lower-body primer checklist, supersets, automatic rest timer, resume after closing the app. Weekly cardio target. Plus free-form workouts, one-tap **Repeat**, and **Lifts & PRs** with estimated 1-rep max charts. |
| **Body** | Weigh-ins plus body fat %, muscle mass, and tape measurements (waist, chest, hips, arm, thigh, neck), all with trend charts. **Progress photos**: take or upload, then tap any two to compare side by side with the weight on each date. |
| **Goals → Week** | Weekly accountability review: a score for the week (calories on target, workouts vs. goal, habits, journal), weight change, PRs, your wins, and the "tomorrow I will…" commitments you made, so you can check yourself. Step back through past weeks. |
| **Goals** | Daily journal check-in (mood, energy, hunger, one win, honest notes, tomorrow's commitment), goals with target dates and your "why", and the daily habits that drive the Today checklist. |
| **⚙ Settings** | Name, lb/kg (switching converts existing entries), calorie/protein/workout targets (or **calculate them** from height, age, weight, activity and how fast you want to lose or gain), goal weight, **backup export/import**, erase., **Import from Apple Health**. |

## Coach setup (one time)

GRIT uses **Supabase** (free tier) for accounts and sync. The project URL and publishable key are
in `config.js`. You do these steps once, in the Supabase dashboard (supabase.com → your project):

**1. Create the database.** Left menu **SQL Editor** → **New query** → paste the whole of
[`supabase/schema.sql`](supabase/schema.sql) → **Run**. You should see "Success. No rows returned".
(Safe to run again later; it only adds what's missing.)

**2. Tell Supabase where the app lives.** **Authentication → URL Configuration**:
- **Site URL**: `https://danieltedwards.github.io/gritty-fit/`
- **Redirect URLs** → **Add URL**: `https://danieltedwards.github.io/gritty-fit/`

**3. Put a sign-in code in the emails.** Phones open email links in the browser, not in the
installed app, so GRIT signs people in with a code. **Authentication → Emails** (Templates):
in **both** "Magic Link" and "Confirm signup", replace the message body with:

```html
<h2>Your GRIT sign-in code</h2>
<p>Enter this code in the app:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Or open this link on this device: <a href="{{ .ConfirmationURL }}">Sign in to GRIT</a></p>
```
Subject: `Your GRIT sign-in code`. Save each.

**4. Become the coach.** On your phone open GRIT → ⚙ Settings → **Sign in with email** → enter the
code → in Settings → Account tap **Set up this account as the coach** (works once, for the first
account only). Then **Coach dashboard** → **Plan library** → **Add** next to the built-in plan.

**5. Before inviting clients: connect an email service.** Supabase's built-in sender only emails
members of your Supabase team, about 2 emails an hour: fine for testing with your own address, not
for clients. **Authentication → Emails → SMTP Settings** → enable custom SMTP using a free provider:
- **Resend** (3,000 emails/month free; needs a domain you own, e.g. gritcoaching.com), or
- **Brevo** (300 emails/day free; can send from a verified address).
Then **Authentication → Rate Limits** → raise "emails sent per hour" (e.g. 30).

**6. Invite a client.** Coach dashboard → **Invite client** → **Share invite**. They open the link on
their phone, add GRIT to the home screen, and sign in with their email. They appear in your client
list (they can also type the code in Settings → Account → Enter invite code).

### What the coach dashboard does
- **Clients**: last active (red if 3+ days quiet), workouts / food-logging days / journal days in the
  last 7 days, latest weight and change vs a week ago, current plan, unread messages.
- **Open**: see the client's whole app (Today, Food, Train, Body, Goals) read-only.
- **Message**: send notes; they appear on the client's Today screen until they tap "Got it".
- **Targets**: set calories, protein, carbs, fat, workouts/week; applied on their next sync.
- **Plans**: choose which "Selected clients" plans each client may pick.
- **Plan library**: add plans, set each to **All clients** or **Selected clients**, hide/publish.

### Privacy
Every table has row-level security: clients can only read and write their own data; the coach can
read (not edit) data of clients on their roster; nobody else can read anything. The publishable key
in `config.js` is meant to be public. Never put the `service_role` key or database password in the
app. Health information is sensitive: keep medical details to short notes, and check what rules
apply to your coaching business.

## Where the food data comes from

| Source | What | Needs internet? |
| --- | --- | --- |
| **Built-in database** (`foods.json`) | ~7,300 common foods (meats, eggs, grains, fruit, veg, dairy, restaurant items) from the **USDA FoodData Central** SR Legacy dataset, with real portion sizes. Everyday foods are boosted so "eggs", "rice", "steak" or "beer" find the obvious thing first. | No. Loaded on the first search, then cached |
| **Open Food Facts** | Packaged and brand-name foods by search or barcode. Free, crowd-sourced, no account or API key. Coverage of US products is good but not complete; if a barcode isn't found, enter the label once and it shows under *Recent* after that. | Yes |
| **Your own log** | Anything you've logged before, with your numbers. | No |

Barcode scanning uses the phone's camera. Android Chrome has a scanner built in; on iPhone the app
loads a small open-source scanner (`barcode-detector`, from jsDelivr) the first time you tap **Scan**.
You'll be asked for camera permission once.

To rebuild `foods.json` from a newer USDA release, see `tools/` (not needed for normal use).

## Apple Watch / Apple Health

Web apps can't read Apple Health directly (Apple only allows that for App Store apps), so a free
**Apple Shortcut** reads it and copies a short summary, and GRIT pastes it in.
Steps, active calories, exercise minutes, sleep, resting heart rate and weight/body fat come in.
Habits like "10,000 steps" and "7+ hours sleep" tick themselves, and duplicates are skipped.

### Build the Shortcut (one time, ~5 minutes)

Open the **Shortcuts** app → **+** → name it **GRIT Health**. Add these actions in order
(search for each name in the action search bar). Tip: after each **Find Health Samples**, tap the
filter rows to set them exactly as listed.

**1. Steps**
- **Find Health Samples** → *Type* is **Steps**, *Start Date* is **today**, *Group By* **Day**
- **Set Variable** → name it `Steps`

**2. Active calories**
- **Find Health Samples** → *Type* is **Active Energy**, *Start Date* is **today**, *Group By* **Day**
- **Set Variable** → `Active`

**3. Resting heart rate**
- **Find Health Samples** → *Type* is **Resting Heart Rate**, *Sort by* **Start Date**, *Order* **Latest First**, *Limit* **1**
- **Set Variable** → `RHR`

**4. Weight** (skip if you weigh in by hand in GRIT)
- **Find Health Samples** → *Type* is **Weight**, *Sort by* **Start Date**, **Latest First**, *Limit* **1**
- **Set Variable** → `Weight`
- Optional, same again with *Type* **Body Fat Percentage** → **Set Variable** `BodyFat`

**5. Sleep** (optional)
- **Find Health Samples** → *Type* is **Sleep Analysis**, *Start Date* is **in the last 1 days**,
  add filters *Value* is not **Awake** and *Value* is not **In Bed**
- **Get Details of Health Samples** → **Duration**
- **Calculate Statistics** → **Sum**
- **Set Variable** → `Sleep`

**6. Exercise minutes** (your green Exercise ring)
- **Find Health Samples** → *Type* is **Exercise Minutes** (may be listed as *Exercise Time*), *Start Date* is **today**, *Group By* **Day**
- **Set Variable** → `Exercise`

> **Workouts:** Apple's Shortcuts can't read individual watch workouts (there's no *Workouts* type
> in Find Health Samples), so log sessions in the **Train** tab — that's where your sets and PRs go
> anyway. Calories burned in workouts are already included in **Active**. If a future iOS adds a
> workouts option, the app still accepts a `Workouts:` section (one line per workout:
> `name ; start date ; duration ; calories`).

**7. Build the summary** — add a **Text** action and type exactly this, inserting each variable
where shown (tap the variable bar above the keyboard):

```
GRITTYFIT
Steps: [Steps]
Active: [Active]
Exercise: [Exercise]
Sleep: [Sleep]
Resting HR: [RHR]
Weight: [Weight]
Body Fat: [BodyFat]
```
Leave out any lines for sections you skipped.

**8. Finish**
- **Copy to Clipboard** (input: the Text from step 7)
- **Show Notification** → "Health copied — open GRIT and tap Paste"

Tap **▶︎** once to run it. iPhone asks which Health data the Shortcut may read: **Turn On All** → **Allow**.

### Use it

1. Run **GRIT Health** (from the Shortcuts app, a home-screen icon, a widget, or Siri: "GRIT Health").
2. Open GRIT → **Update from Apple Health** on Today (first time: **⚙ Settings → Import from Apple Health**).
3. Tap **Paste from Shortcut** → iPhone shows a small **Paste** bubble, tap it → check the preview → **Import**.

### Make it automatic (optional)

Shortcuts → **Automation** → **+** → **Time of Day** → e.g. 9:00 PM, Daily → **Run Immediately** →
pick **GRIT Health**. Each evening you'll get the notification; open GRIT and tap Paste.

### Troubleshooting

- **"That doesn't look like the Shortcut's output"**: the text must start with `GRITTYFIT`. Run the Shortcut again right before pasting (copying anything else replaces it).
- **A number is missing**: open the Shortcut and check that section's filters; an empty line just means Health had no data for it.
- Everything is shown before it's saved, so you can untick anything that looks wrong.

## Where your data lives

Everything is saved on the phone first (IndexedDB), so the app is fast and works offline.
When signed in, every change syncs to the GRIT database (Supabase) and to your other devices; the
coach can read it. Signed out, data stays only on that device (use **Settings → Export backup**).
Progress photos currently stay on the device only.

## Put it on your phone (free)

It's a folder of static files (HTML, CSS, JS). Any free static host works. Pick one:

**Option A: Cloudflare Pages (recommended; free, no expiry)**
1. Make a free account at <https://pages.cloudflare.com>.
2. *Create a project → Direct Upload*, then drag this whole folder in.
3. Open the `*.pages.dev` URL it gives you on your phone.

**Option B: Netlify Drop**: drag this folder onto <https://app.netlify.com/drop>
(sign up free so the site doesn't expire).

**Option C: GitHub Pages**: put these files in their own repo and enable Pages
(Settings → Pages → Deploy from a branch → `/ (root)`). Public is fine: the code has no personal
data in it, since your data never leaves your phone. (Pages on private repos needs a paid GitHub plan.)

Then **add it to your home screen**:
- **iPhone (Safari):** Share button → *Add to Home Screen*.
- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*.

It then opens full-screen with its own icon and keeps working without signal.

> Use the same URL every time. Each web address has its own separate storage.

## Run it locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

## Updating the app

After changing any file, bump `VERSION` in `sw.js` (e.g. `gritty-fit-v2`) and re-upload.
Phones pick up the new version the next time the app opens with a connection. Your data is untouched.

## Files

```
index.html            page shell + bottom tab bar
app.css               styles (light + dark mode follow the phone setting)
app.js                all screens, forms, and logic
food-lookup.js        food search, Open Food Facts, barcode scanning
health.js             parses the Apple Health Shortcut's summary
cloud.js              sign-in, sync, coach dashboard, invites, messages, targets
config.js             Supabase URL + publishable key
vendor/supabase.js    Supabase client library (v2.117.3), bundled for offline use
supabase/schema.sql   database tables + row-level security (run once in Supabase)
training.js           plans, program guide, workout logger, rest timer
plans/                training plans (JSON) — see plans/README.md
foods.json            built-in USDA food database (per 100 g + portions)
db.js                 on-device storage (IndexedDB)
charts.js             small SVG charts (no libraries)
sw.js                 offline cache
manifest.webmanifest  install-to-home-screen metadata
icon*.{svg,png}       app icons
```

No build step and no dependencies.
