// Parses the text an Apple Shortcut copies from Apple Health (see README → Apple Watch / Apple Health).
// Deliberately forgiving: Shortcuts formats numbers, durations and dates differently across iOS
// versions and regions, so every field accepts several shapes. The app shows a preview before saving.
(function (root) {
  'use strict';
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');

  function parseNum(s) {
    if (s == null) return null;
    const m = String(s).replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  // Returns minutes. ctx: 'sleep' (bare numbers are hours, a:b is h:mm) or 'workout' (bare numbers are minutes, a:b is m:ss)
  function parseDuration(s, ctx) {
    if (s == null) return null;
    const str = String(s).toLowerCase().trim();
    if (!str) return null;
    let m = str.match(/(\d+):(\d{2}):(\d{2})/);
    if (m) return +m[1] * 60 + +m[2] + +m[3] / 60;
    m = str.match(/(\d+):(\d{2})(?!\d)/);
    if (m) return ctx === 'sleep' ? +m[1] * 60 + +m[2] : +m[1] + +m[2] / 60;
    let total = 0, found = false;
    const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
    while ((m = re.exec(str))) {
      found = true;
      const v = +m[1], u = m[2][0];
      total += u === 'h' ? v * 60 : u === 'm' ? v : v / 60;
    }
    if (found) return total;
    const n = parseNum(str);
    if (n == null) return null;
    if (ctx === 'sleep') return n <= 24 ? n * 60 : n > 1440 ? n / 60 : n; // hours, seconds, or minutes
    return n > 600 ? n / 60 : n; // seconds if huge, else minutes
  }

  // "Oct 30, 2026 at 6:02 AM", "30 Oct 2026 at 06:02", "10/30/26, 6:02 AM", "2026-10-30T06:02:00-07:00"
  function parseDateTime(s) {
    if (!s) return null;
    const str = String(s).trim();
    let y, mo, d, h = null, mi = 0, m;
    if ((m = str.match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/))) { [, y, mo, d] = m.map(Number); if (m[4]) { h = +m[4]; mi = +m[5]; } }
    else if ((m = str.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/))) { mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = +m[3]; }
    else if ((m = str.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/))) { d = +m[1]; mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()]; y = +m[3]; }
    else if ((m = str.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else return null;
    if (!mo || !d || !y) return null;
    if (h === null) {
      const t = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?\s*[Mm]?/g);
      const last = t && t[t.length - 1].match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?/);
      if (last) {
        h = +last[1]; mi = +last[2];
        const ap = last[3] && last[3].toLowerCase();
        if (ap === 'p' && h < 12) h += 12;
        if (ap === 'a' && h === 12) h = 0;
      }
    }
    return { date: `${y}-${pad(mo)}-${pad(d)}`, time: h === null ? '' : `${pad(h)}:${pad(mi)}` };
  }

  const TYPE_MAP = [
    [/run/i, 'Run'], [/walk|hik/i, 'Walk'], [/cycl|bik/i, 'Cycle'], [/strength|weight|lift|core training/i, 'Strength'],
    [/high intensity|hiit|interval/i, 'HIIT'], [/swim/i, 'Swim'], [/yoga|pilates|flexib|mobility|stretch|cooldown/i, 'Yoga / Mobility'],
  ];
  function cleanWorkoutName(raw) {
    let n = String(raw || '').replace(/HKWorkoutActivityType/i, '').replace(/^workout\s*/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    if (!n) return 'Workout';
    for (const [re, t] of TYPE_MAP) if (re.test(n)) return t;
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  function parseWorkout(value) {
    const parts = String(value).split(/\s*[;|]\s*/).filter(Boolean);
    const w = { name: '', rawName: '', minutes: null, kcal: null, date: '', time: '', avgHr: null };
    for (const part of parts) {
      const p = part.trim();
      const dt = /\d{4}|\d{1,2}\/\d{1,2}\/\d{2}/.test(p) ? parseDateTime(p) : null;
      if (dt && !w.date) { w.date = dt.date; w.time = dt.time; continue; }
      if (/kcal|cal\b|calories/i.test(p)) { w.kcal = Math.round(parseNum(p)); continue; }
      if (/bpm|heart/i.test(p)) { w.avgHr = Math.round(parseNum(p)); continue; }
      if (/\d/.test(p) && (/(hr|h|min|m|sec|s)\b/i.test(p) || /\d:\d{2}/.test(p)) && w.minutes == null) { w.minutes = Math.round(parseDuration(p, 'workout')); continue; }
      if (/^[^\d]+$/.test(p) && !w.rawName) { w.rawName = p; continue; }
      if (/^\d+(\.\d+)?$/.test(p)) { if (w.minutes == null) w.minutes = Math.round(parseDuration(p, 'workout')); else if (w.kcal == null) w.kcal = Math.round(+p); }
    }
    w.name = cleanWorkoutName(w.rawName);
    return w;
  }

  function parse(text) {
    const out = { ok: false, steps: null, active: null, sleepMin: null, rhr: null, weight: null, weightUnit: null, bodyFat: null, workouts: [], date: null };
    if (!text) return out;
    const lines = String(text).split(/\r?\n/);
    let currentKey = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^gritty ?fit/i.test(line)) { out.ok = true; continue; }
      const m = line.match(/^([A-Za-z][A-Za-z \-]*?)\s*[:=]\s*(.*)$/);
      const KNOWN = /^(steps?|active|sleep|resting|rhr|weight|body ?fat|workouts?|date)\b/i;
      let key, val;
      if (m && KNOWN.test(m[1])) { key = m[1].toLowerCase(); val = m[2]; }
      else if (currentKey === 'workout') { key = 'workout'; val = line.replace(/^[-•*]\s*/, ''); }
      else continue;
      if (/^date/.test(key)) { const d = parseDateTime(val); if (d) out.date = d.date; continue; }
      if (/^steps?/.test(key)) { const n = parseNum(val); if (n != null) { out.steps = Math.round(n); out.ok = true; } continue; }
      if (/^active/.test(key)) { const n = parseNum(val); if (n != null) { out.active = Math.round(/kj/i.test(val) ? n / 4.184 : n); out.ok = true; } continue; }
      if (/^sleep/.test(key)) { const n = parseDuration(val, 'sleep'); if (n != null) { out.sleepMin = Math.round(n); out.ok = true; } continue; }
      if (/^(resting|rhr)/.test(key)) { const n = parseNum(val); if (n != null) { out.rhr = Math.round(n); out.ok = true; } continue; }
      if (/^weight/.test(key)) { const n = parseNum(val); if (n != null) { out.weight = n; out.weightUnit = /kg/i.test(val) ? 'kg' : /lb|pound/i.test(val) ? 'lb' : null; out.ok = true; } continue; }
      if (/^body ?fat/.test(key)) { let n = parseNum(val); if (n != null) { if (n <= 1 && !/%/.test(val)) n *= 100; out.bodyFat = Math.round(n * 10) / 10; out.ok = true; } continue; }
      if (/^workouts?$/.test(key) && key !== 'workout') {
        currentKey = 'workout';
        if (val.trim()) { const w = parseWorkout(val); if (w.rawName || w.minutes) { out.workouts.push(w); out.ok = true; } }
        continue;
      }
      if (key === 'workout') { const w = parseWorkout(val); if (w.rawName || w.minutes) { out.workouts.push(w); out.ok = true; } }
    }
    return out;
  }

  const api = { parse, parseDuration, parseDateTime, parseWorkout, parseNum, cleanWorkoutName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HealthImport = api;
})(this);
