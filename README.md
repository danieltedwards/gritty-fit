# Gritty Fit — personal fitness tracker

A phone-first web app for one person. No account, no server, no monthly bill.
It installs to your home screen like a normal app and works offline.

## What's in it

| Tab | What you do there |
| --- | --- |
| **Today** | Dashboard: quick-add buttons, a backup reminder when one is due, your week-so-far score, daily accountability checklist (with streaks), calories vs. target, workouts this week, weight trend and distance to goal, active goals with countdowns, and a journal prompt. |
| **Food** | **Search & auto-fill**: type a food and pick it; calories, protein, carbs and fat fill in for the amount you choose (grams, "1 large", "1 cup", "1 serving"…). **Scan a barcode** with the camera, or type the number, for packaged foods. Foods you've logged before come up first. Then: log by meal, step back through previous days, one-tap re-add, 14-day calorie chart. |
| **Train** | Log workouts (type, minutes, effort, sets/exercises, notes), one-tap **Repeat** of a past session, workout days per week vs. your weekly target. **Lifts & PRs**: write sets like `Squat 5x5 @ 225` or `Bench 185x5` and the app tracks your best set and estimated 1-rep max per lift, charts it, and calls out new PRs when you save. |
| **Body** | Weigh-ins plus body fat %, muscle mass, and tape measurements (waist, chest, hips, arm, thigh, neck), all with trend charts. **Progress photos**: take or upload, then tap any two to compare side by side with the weight on each date. |
| **Goals → Week** | Weekly accountability review: a score for the week (calories on target, workouts vs. goal, habits, journal), weight change, PRs, your wins, and the "tomorrow I will…" commitments you made, so you can check yourself. Step back through past weeks. |
| **Goals** | Daily journal check-in (mood, energy, hunger, one win, honest notes, tomorrow's commitment), goals with target dates and your "why", and the daily habits that drive the Today checklist. |
| **⚙ Settings** | Name, lb/kg (switching converts existing entries), calorie/protein/workout targets (or **calculate them** from height, age, weight, activity and how fast you want to lose or gain), goal weight, **backup export/import**, erase. |

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

## Where your data lives

Everything is stored **only in your phone's browser** (IndexedDB). Nothing is uploaded anywhere.
That keeps it free and private, but it has two consequences:

1. **Use one device.** Data doesn't sync between your phone and your laptop.
2. **Export a backup now and then** (Settings → Export backup). If you clear Safari/Chrome
   website data or lose the phone, the backup file is how you get your history back.

The app reminds you on the Today screen when you haven't backed up in two weeks.

Photos are resized to about 1400 px before they're saved, so they don't take up much space.

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
foods.json            built-in USDA food database (per 100 g + portions)
db.js                 on-device storage (IndexedDB)
charts.js             small SVG charts (no libraries)
sw.js                 offline cache
manifest.webmanifest  install-to-home-screen metadata
icon*.{svg,png}       app icons
```

No build step and no dependencies.
