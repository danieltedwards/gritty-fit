/* GRIT Nutrition — one method, drawing on RP (calorie/macro priorities, carbs scaled to training,
   nutrient timing), the Vertical Diet (digestible, nutrient-dense staples; adjust carbs first) and the
   Zone (balanced meals, roughly even protein through the day).
   What changes day to day: training intensity (rest / light / moderate / heavy) and training timing
   (which meal you train after). Everything else comes from the client's profile and goal. */
(function () {
  'use strict';
  let C;
  const S = () => C.getState();
  const esc = (s) => C.esc(s);
  const r5 = (n) => Math.round(n / 5) * 5;

  // ---------- method constants (GRIT Nutrition v1) ----------
  const JOB = { desk: [1.2, 'Desk / mostly sitting'], light: [1.35, 'On my feet some of the day'], active: [1.5, 'On my feet most of the day'], physical: [1.7, 'Physical / manual job'] };
  const TRAIN = { rest: [0, 'Rest'], light: [2, 'Light'], moderate: [4, 'Moderate'], heavy: [6.5, 'Heavy'] }; // extra kcal per lb bodyweight
  const TRAIN_HELP = { rest: 'No training', light: 'Easy session, walk, mobility, technique', moderate: 'Normal lifting or conditioning session', heavy: 'Long or very hard session, two-a-day, competition' };
  const RATE = { cut: { gentle: 0.4, standard: 0.6, aggressive: 0.9 }, build: { gentle: 0.2, standard: 0.35, aggressive: 0.5 } }; // % bodyweight per week
  const GOALS = { cut: 'Cut (lose fat)', maintain: 'Maintain', build: 'Build (gain muscle)' };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Staples (Vertical-Diet-style base) with USDA macros per 100 g; unit = how amounts are shown.
  const FOODS = {
    chicken: { n: 'Chicken breast (cooked)', p: 31, c: 0, f: 3.6, u: 'oz', g: 28.35, k: 'protein' },
    beef93: { n: '93% lean ground beef (cooked)', p: 28.9, c: 0, f: 9.5, u: 'oz', g: 28.35, k: 'protein' },
    sirloin: { n: 'Sirloin steak (cooked)', p: 30.4, c: 0, f: 5.8, u: 'oz', g: 28.35, k: 'protein' },
    turkey: { n: '93% lean ground turkey (cooked)', p: 27.1, c: 0, f: 11.6, u: 'oz', g: 28.35, k: 'protein' },
    salmon: { n: 'Salmon (cooked)', p: 22.1, c: 0, f: 12.3, u: 'oz', g: 28.35, k: 'protein' },
    whitefish: { n: 'White fish / tilapia (cooked)', p: 26.1, c: 0, f: 2.6, u: 'oz', g: 28.35, k: 'protein' },
    shrimp: { n: 'Shrimp (cooked)', p: 24, c: 0.2, f: 0.3, u: 'oz', g: 28.35, k: 'protein' },
    eggwhites: { n: 'Egg whites', p: 10.9, c: 0.7, f: 0.2, u: 'whites', g: 33, k: 'protein' },
    greekyog: { n: 'Nonfat Greek yogurt', p: 10.2, c: 3.6, f: 0.4, u: 'g', g: 1, k: 'protein' },
    cottage: { n: 'Low-fat cottage cheese', p: 10.4, c: 4.8, f: 2.3, u: 'g', g: 1, k: 'protein' },
    whey: { n: 'Whey protein', p: 78, c: 6.2, f: 1.6, u: 'scoops', g: 30, k: 'protein' },
    rice: { n: 'White rice (cooked)', p: 2.7, c: 28.2, f: 0.3, u: 'cups', g: 158, k: 'carb' },
    potato: { n: 'Potatoes (baked)', p: 2.5, c: 21.1, f: 0.1, u: 'g', g: 1, k: 'carb' },
    sweetpot: { n: 'Sweet potato (baked)', p: 2, c: 20.7, f: 0.1, u: 'g', g: 1, k: 'carb' },
    oats: { n: 'Oats (dry)', p: 13.2, c: 67.7, f: 6.5, u: 'cups', g: 81, k: 'carb' },
    banana: { n: 'Banana', p: 1.1, c: 22.8, f: 0.3, u: 'medium', g: 118, k: 'carb' },
    oj: { n: 'Orange juice', p: 0.7, c: 10.4, f: 0.2, u: 'cups', g: 248, k: 'carb' },
    berries: { n: 'Blueberries', p: 0.7, c: 14.5, f: 0.3, u: 'cups', g: 148, k: 'carb' },
    bread: { n: 'Whole-wheat bread', p: 12.4, c: 42.7, f: 3.5, u: 'slices', g: 32, k: 'carb' },
    pasta: { n: 'Pasta (cooked)', p: 5.8, c: 30.9, f: 0.9, u: 'cups', g: 140, k: 'carb' },
    quinoa: { n: 'Quinoa (cooked)', p: 4.4, c: 21.3, f: 1.9, u: 'cups', g: 185, k: 'carb' },
    avocado: { n: 'Avocado', p: 2, c: 8.5, f: 14.7, u: 'g', g: 1, k: 'fat' },
    olive: { n: 'Olive oil', p: 0, c: 0, f: 100, u: 'tbsp', g: 13.5, k: 'fat' },
    pb: { n: 'Peanut butter', p: 22.2, c: 22.3, f: 51.4, u: 'tbsp', g: 16, k: 'fat' },
    almonds: { n: 'Almonds', p: 21.1, c: 21.6, f: 49.9, u: 'g', g: 1, k: 'fat' },
    eggs: { n: 'Whole eggs', p: 12.6, c: 1.1, f: 10.6, u: 'eggs', g: 50, k: 'fat' },
    cheese: { n: 'Cheddar cheese', p: 22.9, c: 3.4, f: 33.3, u: 'oz', g: 28.35, k: 'fat' },
    carbpowder: { n: 'Carb powder (dextrin / dextrose)', p: 0, c: 95, f: 0, u: 'g', g: 1, k: 'carb' },
    sportsdrink: { n: 'Sports drink', p: 0, c: 6, f: 0, u: 'fl oz', g: 29.6, k: 'carb' },
    tofu: { n: 'Firm tofu', p: 17.3, c: 2.8, f: 8.7, u: 'g', g: 1, k: 'protein' },
    tempeh: { n: 'Tempeh', p: 20.3, c: 7.6, f: 10.8, u: 'g', g: 1, k: 'protein' },
    seitan: { n: 'Seitan', p: 75, c: 14, f: 1.9, u: 'g', g: 1, k: 'protein' },
    peaprotein: { n: 'Pea / plant protein powder', p: 80, c: 3, f: 6, u: 'scoops', g: 30, k: 'protein' },
    edamame: { n: 'Edamame (shelled)', p: 11.9, c: 8.9, f: 5.2, u: 'cups', g: 155, k: 'protein' },
    lentils: { n: 'Lentils (cooked)', p: 9, c: 20.1, f: 0.4, u: 'cups', g: 198, k: 'carb' },
    chickpeas: { n: 'Chickpeas (cooked)', p: 8.9, c: 27.4, f: 2.6, u: 'cups', g: 164, k: 'carb' },
    blackbeans: { n: 'Black beans (cooked)', p: 8.9, c: 23.7, f: 0.5, u: 'cups', g: 172, k: 'carb' },
    tuna: { n: 'Tuna (canned in water)', p: 25.5, c: 0, f: 0.8, u: 'oz', g: 28.35, k: 'protein' },
    beef85: { n: '85% lean ground beef (cooked)', p: 26, c: 0, f: 15, u: 'oz', g: 28.35, k: 'protein' },
    walnuts: { n: 'Walnuts', p: 15.2, c: 13.7, f: 65.2, u: 'g', g: 1, k: 'fat' },
    chia: { n: 'Chia seeds', p: 16.5, c: 42.1, f: 30.7, u: 'tbsp', g: 12, k: 'fat' },
    coconut: { n: 'Coconut oil', p: 0, c: 0, f: 100, u: 'tbsp', g: 13.6, k: 'fat' },
    butter: { n: 'Butter / ghee', p: 0.9, c: 0.1, f: 81, u: 'tbsp', g: 14, k: 'fat' },
  };
  // what each food is, for diet styles
  const TAGS = { chicken: 'meat', beef93: 'meat red', sirloin: 'meat red', turkey: 'meat', beef85: 'meat red', salmon: 'fish', whitefish: 'fish', shrimp: 'fish', tuna: 'fish',
    eggwhites: 'egg', eggs: 'egg', greekyog: 'dairy', cottage: 'dairy', whey: 'dairy', cheese: 'dairy', butter: 'dairy',
    rice: 'grain white', oats: 'grain', bread: 'grain gluten', pasta: 'grain gluten', quinoa: 'grain', seitan: 'grain gluten',
    potato: 'starch', sweetpot: 'starch', banana: 'fruit', oj: 'fruit sugar', berries: 'fruit lowcarb',
    pb: 'legume', tofu: 'legume soy', tempeh: 'legume soy', edamame: 'legume soy', lentils: 'legume', chickpeas: 'legume', blackbeans: 'legume', peaprotein: 'legume',
    almonds: 'nut', walnuts: 'nut', chia: 'seed', avocado: 'plantfat', olive: 'plantfat', coconut: 'plantfat', carbpowder: 'sugar', sportsdrink: 'sugar' };
  const tagged = (key, t) => (' ' + (TAGS[key] || '') + ' ').includes(' ' + t + ' ');
  // Diet styles: which foods are out, the default picks, and how they shift macros
  const STYLES = {
    standard: { n: 'Standard', out: () => false },
    vertical: { n: 'Vertical Diet', out: (k) => tagged(k, 'legume') || tagged(k, 'gluten') || k === 'quinoa' || k === 'almonds' || k === 'walnuts' || k === 'chia',
      prefs: { protein: ['sirloin', 'beef93', 'eggs', 'salmon', 'greekyog'], carb: ['rice', 'potato', 'oj', 'sweetpot'], fat: ['eggs', 'butter', 'olive', 'avocado'] },
      note: 'Red meat, eggs, white rice, potatoes, dairy and easy-to-digest veggies (carrots, spinach, peppers).' },
    paleo: { n: 'Paleo', out: (k) => tagged(k, 'grain') || tagged(k, 'legume') || tagged(k, 'dairy') || tagged(k, 'sugar'),
      prefs: { protein: ['chicken', 'sirloin', 'salmon', 'eggs', 'turkey'], carb: ['sweetpot', 'potato', 'banana', 'berries'], fat: ['avocado', 'olive', 'almonds', 'coconut'] },
      note: 'Meat, fish, eggs, veggies, fruit, potatoes, nuts and oils. No grains, beans or dairy.' },
    pescatarian: { n: 'Pescatarian', out: (k) => tagged(k, 'meat'),
      prefs: { protein: ['salmon', 'whitefish', 'shrimp', 'tuna', 'greekyog', 'eggwhites'], carb: ['rice', 'potato', 'oats', 'banana'], fat: ['avocado', 'olive', 'eggs', 'almonds'] },
      note: 'Fish and seafood, eggs and dairy. No meat.' },
    vegetarian: { n: 'Vegetarian', out: (k) => tagged(k, 'meat') || tagged(k, 'fish'),
      prefs: { protein: ['greekyog', 'eggwhites', 'cottage', 'tofu', 'tempeh', 'whey'], carb: ['rice', 'oats', 'lentils', 'potato', 'banana'], fat: ['eggs', 'avocado', 'pb', 'cheese'] },
      note: 'Eggs, dairy, tofu, tempeh and beans. No meat or fish.' },
    vegan: { n: 'Vegan', out: (k) => tagged(k, 'meat') || tagged(k, 'fish') || tagged(k, 'dairy') || tagged(k, 'egg'),
      prefs: { protein: ['tofu', 'tempeh', 'seitan', 'peaprotein', 'edamame'], carb: ['rice', 'oats', 'lentils', 'chickpeas', 'potato'], fat: ['avocado', 'pb', 'almonds', 'olive', 'chia'] },
      note: 'All plants: tofu, tempeh, seitan, beans, lentils and plant protein. No animal foods.' },
    keto: { n: 'Keto / low-carb', out: (k) => FOODS[k].k === 'carb' && !tagged(k, 'lowcarb') || tagged(k, 'grain') || tagged(k, 'sugar') || ['banana', 'oj', 'pb', 'chia', 'edamame'].includes(k),
      prefs: { protein: ['beef85', 'salmon', 'chicken', 'eggs', 'sirloin'], carb: ['berries'], fat: ['avocado', 'olive', 'cheese', 'almonds', 'butter'] },
      note: 'Carbs kept under about 30 g a day, mostly from veggies and berries; fat makes up the rest.', carbCap: 30 },
  };
  const styleOf = (n) => (n && ((n.coach && n.coach.style) || (n.profile && n.profile.style))) || 'standard';
  const styleOK = (style, key) => !(STYLES[style] || STYLES.standard).out(key);
  function prefsFor(p, style) {
    const sd = STYLES[style] || STYLES.standard, base = (p && p.prefs) || DEFAULT_PREFS, out = {};
    ['protein', 'carb', 'fat'].forEach((g) => {
      let arr = (base[g] || []).filter((k) => FOODS[k] && styleOK(style, k));
      if (arr.length < 2 && sd.prefs) arr = sd.prefs[g].filter((k) => FOODS[k] && styleOK(style, k));
      if (!arr.length) arr = Object.keys(FOODS).filter((k) => FOODS[k].k === g && styleOK(style, k) && !tagged(k, 'sugar')).slice(0, 4);
      out[g] = arr;
    });
    return out;
  }
  // a recipe fits a style? (recipes aren't tagged by diet, so read the ingredients)
  const RX = { meat: /\b(chicken|beef|steak|pork|bacon|ham|turkey|sausage|lamb|bison|venison|prosciutto|pepperoni|salami|chorizo|meatball|jerky)\b/i,
    fish: /\b(salmon|tuna|shrimp|cod|tilapia|fish|crab|lobster|scallop|sardine|anchov|halibut|mahi|trout)\b/i,
    dairy: /\b(milk|cheese|yogurt|yoghurt|butter|cream|whey|casein|parmesan|mozzarella|cheddar|feta|ricotta|ghee|kefir)\b/i,
    egg: /\b(eggs?|egg whites?)\b/i, grain: /\b(rice|oats?|oatmeal|bread|pasta|noodles?|flour|tortilla|quinoa|couscous|bagel|cereal|granola|barley|wheat)\b/i,
    legume: /\b(beans?|lentils?|chickpeas?|peanuts?|peanut butter|tofu|edamame|soy|hummus|peas)\b/i, sugar: /\b(sugar|honey|syrup|candy|chocolate chips)\b/i,
    plantmilk: /\b(almond|oat|soy|coconut|cashew)\s+(milk|yogurt|cream|butter)\b/i };
  function recipeFits(r, style) {
    if (!r || style === 'standard') return true;
    const txt = ((r.ingredients || []).map((i) => (typeof i === 'string' ? i : [i.item, i.name, i.text].filter(Boolean).join(' '))).join(' ') + ' ' + (r.name || '')).replace(RX.plantmilk, ' ');
    const has = (k) => RX[k].test(txt);
    if (style === 'vegan') return !has('meat') && !has('fish') && !has('dairy') && !has('egg');
    if (style === 'vegetarian') return !has('meat') && !has('fish');
    if (style === 'pescatarian') return !has('meat');
    if (style === 'paleo') return !has('grain') && !has('legume') && !has('dairy') && !has('sugar');
    if (style === 'vertical') return !has('legume') && !/\b(bread|pasta|noodles?|flour|tortilla|bagel)\b/i.test(txt);
    if (style === 'keto') { const nc = r.netCarbs != null ? Number(r.netCarbs) : (r.per ? r.per.c : 99); return nc <= 12; }
    return true;
  }
  // ---------- methods ----------
  const METHODS = {
    auto: { n: 'GRIT Auto (RP)', d: 'Calculated macros that adjust with weigh-ins and 2-week check-ins.' },
    coach: { n: 'Coach macros', d: 'Your coach sets calories and macros (training and rest days can differ).' },
    calpro: { n: 'Calories + Protein', d: 'Just two numbers to hit each day.' },
    plate: { n: 'Plate method', d: 'No counting: build each meal as ½ veggies, ¼ protein, ¼ carbs and a thumb of fat.' },
    meal: { n: 'Meal plan', d: 'A set meal plan from your coach; tick meals off.' },
    zone: { n: 'Zone blocks', d: 'Protein, carb and fat blocks per meal.' },
  };
  const methodOf = (n) => {
    const m = (n && n.coach && n.coach.method) || (n && n.method) || (window.Cloud && Cloud.coach && Cloud.coach.targets && Cloud.coach.targets.defaultNut && Cloud.coach.targets.defaultNut.method) || 'auto';
    return METHODS[m] ? m : 'auto';
  };
  const DEFAULT_PREFS = { protein: ['chicken', 'beef93', 'eggwhites', 'salmon', 'greekyog'], carb: ['rice', 'potato', 'oats', 'banana'], fat: ['avocado', 'olive', 'pb', 'eggs'] };
  const VEG = 'Spinach, carrots, peppers, broccoli, greens';

  // ---------- core math ----------
  // Bodyweight for the math: the average of the weigh-ins in the 7 days up to the latest one, so a single
  // salty-dinner spike doesn't move the targets (RP works off weekly averages).
  const toLb = (st, w) => (st.settings.units === 'kg' ? w / 0.45359237 : w);
  const addDaysISO = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const x = new Date(y, m - 1, d + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  function weightInfo(body, units) {
    const ws = (body || []).filter((b) => b.weight != null && b.date).sort((a, b) => a.date.localeCompare(b.date));
    if (!ws.length) return null;
    const last = ws[ws.length - 1], from = addDaysISO(last.date, -6);
    const wk = ws.filter((b) => b.date >= from);
    const avg = wk.reduce((a, b) => a + Number(b.weight), 0) / wk.length;
    const lb = units === 'kg' ? avg / 0.45359237 : avg;
    return { lb, n: wk.length, last: last.date };
  }
  const lbOf = (st, p) => { const w = weightInfo(st.body, st.settings.units); return w ? w.lb : p.weightLb; };
  // body fat: the latest one logged with a weigh-in, else the one from setup
  function bfOf(st, p) {
    const b = (st.body || []).filter((x) => Number(x.bodyFat) > 2 && Number(x.bodyFat) < 70).sort((a, c) => a.date.localeCompare(c.date)).pop();
    return b ? Number(b.bodyFat) : (p.bodyFat || null);
  }
  function bmrOf(p, bw) {
    const kg = bw * 0.45359237, cm = (p.heightIn || 66) * 2.54;
    const mifflin = 10 * kg + 6.25 * cm - 5 * (p.age || 30) + (p.sex === 'm' ? 5 : -161);
    const katch = p.bodyFat ? 370 + 21.6 * kg * (1 - p.bodyFat / 100) : null;
    return { bmr: katch || mifflin, mifflin, katch };
  }
  function macros(p, type, bw, coach = {}) {
    const { bmr } = bmrOf(p, bw);
    const job = (JOB[p.job] || JOB.desk)[0];
    const maintFor = (t) => bmr * job + TRAIN[t][0] * bw;
    const rate = p.goal === 'maintain' ? 0 : ((RATE[p.goal] || {})[p.pace || 'standard'] || 0);
    const delta = (p.goal === 'cut' ? -1 : 1) * rate / 100 * bw * 500; // %BW/week → kcal/day
    const floor = Math.max(p.sex === 'm' ? 1500 : 1200, bmr * 0.9);
    const kcalFor = (t) => { let k = maintFor(t) + delta + (Number(coach.kcalAdjust) || 0); if (p.goal === 'cut') k = Math.max(k, floor); return k; };
    // protein (GRIT Auto): 0.8 g per lb bodyweight for women, 1.0 g for men. Safety rule: above 35% body fat
    // (women) / 30% (men), base it on a healthier target weight (lean mass / 0.75 women, / 0.80 men) instead.
    const perLb = p.sex === 'm' ? 1.0 : 0.8;
    let protW = bw;
    if (p.bodyFat && p.bodyFat > (p.sex === 'm' ? 30 : 35)) protW = Math.min(bw, (bw * (1 - p.bodyFat / 100)) / (p.sex === 'm' ? 0.80 : 0.75));
    const autoP = perLb * protW;
    const P = coach.protein ? Number(coach.protein) : r5(autoP);
    // fat: same every day (min 0.3 g/lb, ~25% of rest-day calories); carbs absorb the training difference
    const fatPct = p.goal === 'cut' ? 0.25 : p.goal === 'build' ? 0.30 : 0.27;
    let F = r5(Math.max(0.3 * bw, fatPct * kcalFor('rest') / 9));
    const kcal = kcalFor(type);
    let Cg = (kcal - P * 4 - F * 9) / 4;
    if (p.style === 'keto') { Cg = Math.min(Cg, 30); F = r5(Math.max(0.3 * bw, (kcal - P * 4 - Cg * 4) / 9)); return { kcal: Math.round(P * 4 + Cg * 4 + F * 9), protein: P, carbs: Math.max(20, r5(Cg)), fat: F, maintenance: Math.round(maintFor(type)), bmr: Math.round(bmr), delta: Math.round(delta) }; }
    if (Cg < 30) { F = r5(Math.max(0.25 * bw, (kcal - P * 4 - 30 * 4) / 9)); Cg = (kcal - P * 4 - F * 9) / 4; }
    Cg = Math.max(25, r5(Cg));
    return { kcal: Math.round(P * 4 + Cg * 4 + F * 9), protein: P, carbs: Cg, fat: F, maintenance: Math.round(maintFor(type)), bmr: Math.round(bmr), delta: Math.round(delta) };
  }

  // Meal layout for a day: roles drive how carbs/fat are timed around training (RP-style).
  function layout(p, type, after) {
    const M = Math.min(6, Math.max(2, p.meals || 4));
    const slots = Array.from({ length: M }, (_, i) => ({ key: 'm' + (i + 1), label: 'Meal ' + (i + 1), role: 'other' }));
    if (type !== 'rest') {
      const a = Math.min(M, Math.max(0, after == null ? (p.trainAfter ?? 2) : after));
      if (a >= 1) slots[a - 1].role = 'pre';
      let postIdx = a;
      if (p.shake !== false) { slots.splice(a, 0, { key: 'shake', label: 'Workout shake', role: 'shake' }); postIdx = a + 1; }
      if (slots[postIdx]) slots[postIdx].role = 'post';
    }
    slots.forEach((s, i) => {
      s.when = s.role === 'pre' ? '1–3 h before training' : s.role === 'shake' ? 'During and right after training' : s.role === 'post' ? 'Within an hour after training'
        : i === 0 ? 'On waking' : i === slots.length - 1 ? 'Last meal of the day' : '2–4 h after your last meal';
    });
    return slots;
  }
  function distribute(slots, t, type) {
    const W = { p: { shake: 0.8 }, c: type === 'rest' ? {} : { pre: 1.5, shake: 2, post: 2.5, other: 0.7 }, f: type === 'rest' ? {} : { pre: 0.4, shake: 0, post: 0.4, other: 1.4 } };
    const alloc = (total, w) => {
      const ws = slots.map((s) => (w[s.role] ?? w.other ?? 1));
      const sum = ws.reduce((a, b) => a + b, 0) || 1;
      const vals = ws.map((x) => Math.floor((total * x) / sum));
      let rem = total - vals.reduce((a, b) => a + b, 0);
      const order = ws.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]);
      for (let k = 0; rem > 0; k = (k + 1) % order.length, rem--) vals[order[k][1]]++;
      return vals;
    };
    const P = alloc(t.protein, W.p), Cc = alloc(t.carbs, W.c), F = alloc(t.fat, W.f);
    return slots.map((s, i) => ({ ...s, p: P[i], c: Cc[i], f: F[i], kcal: P[i] * 4 + Cc[i] * 4 + F[i] * 9 }));
  }

  // Precise: amounts of chosen staples that hit the meal's macros
  function amounts(m, picks) {
    const out = [];
    const take = (key, grams) => {
      const fd = FOODS[key]; if (!fd || grams <= 0) return null;
      const q = grams / fd.g;
      const qty = fd.u === 'g' ? Math.round(grams / 5) * 5 : fd.u === 'oz' ? Math.round(q * 2) / 2 : fd.u === 'cups' || fd.u === 'tbsp' ? Math.round(q * 4) / 4 : Math.max(0.5, Math.round(q * 2) / 2);
      const g = fd.u === 'g' ? qty : qty * fd.g;
      const it = { key, name: fd.n, qty, unit: fd.u, grams: Math.round(g), p: Math.round(fd.p * g / 100), c: Math.round(fd.c * g / 100), f: Math.round(fd.f * g / 100) };
      it.kcal = Math.round(it.p * 4 + it.c * 4 + it.f * 9);
      out.push(it); return it;
    };
    const pr = picks.protein && m.p > 5 ? take(picks.protein, (m.p / FOODS[picks.protein].p) * 100) : null;
    let cRemain = m.c - (pr ? pr.c : 0);
    let cb = null, cb2 = null;
    if (picks.carb && cRemain > 8) {
      const want = picks.carbCap ? Math.min(cRemain, picks.carbCap) : cRemain;
      cb = take(picks.carb, (want / FOODS[picks.carb].c) * 100);
      cRemain -= cb ? cb.c : 0;
      if (picks.carb2 && cRemain > 8) cb2 = take(picks.carb2, (cRemain / FOODS[picks.carb2].c) * 100);
    }
    const fRemain = m.f - (pr ? pr.f : 0) - (cb ? cb.f : 0) - (cb2 ? cb2.f : 0);
    if (picks.fat && fRemain > 3) {
      // one whole food covers up to ~20 g of fat (no "10 eggs"); oil / butter tops up the rest
      const oily = ['olive', 'coconut', 'butter'].includes(picks.fat), cap = oily ? fRemain : Math.min(fRemain, 20);
      const ft = take(picks.fat, (cap / FOODS[picks.fat].f) * 100);
      const left = fRemain - (ft ? ft.f : 0);
      if (left > 4 && picks.fat2 && picks.fat2 !== picks.fat) take(picks.fat2, (left / FOODS[picks.fat2].f) * 100);
    }
    return out;
  }
  const qtyText = (it) => `${it.unit === 'g' ? it.qty + ' g' : `${fmtQty(it.qty)} ${it.unit === 'oz' ? 'oz' : it.qty === 1 ? it.unit.replace(/s$/, '') : it.unit}`}`;
  const fmtQty = (q) => { const w = Math.floor(q), fr = q - w; const f = fr >= 0.74 ? '¾' : fr >= 0.49 ? '½' : fr >= 0.24 ? '¼' : ''; return (w || !f ? w : '') + f; };

  // ---------- per-day plan ----------
  function dayInfo(iso) {
    const st = S(), n = st.nutrition;
    if (!n || !(n.profile || coachRun(n))) return null;
    const p = n.profile || COACH_ONLY_PROFILE(st);
    const ov = (n.overrides || {})[iso] || {};
    const [y, mo, d] = iso.split('-').map(Number);
    const wd = new Date(y, mo - 1, d).getDay();
    const type = ov.type || (p.schedule && p.schedule[wd]) || 'rest';
    const after = ov.after ?? p.trainAfter ?? 2;
    const bw = lbOf(st, p), bf = bfOf(st, p), method = methodOf(n), style = styleOf(n), co = n.coach || {};
    let t = macros(Object.assign({}, p, { bodyFat: bf, style }), type, bw, co);
    const adj = Number(co.kcalAdjust) || 0;
    if (method === 'coach' && co.macros) {
      // coach's numbers for training / rest days; the 2-week check-in adjustment comes off (or on) carbs
      const src = (type === 'rest' ? co.macros.rest : co.macros.train) || co.macros.train || co.macros.rest || {};
      const P = Number(src.p) || t.protein, F = src.f != null && src.f !== '' ? Number(src.f) : t.fat;
      let Cg = src.c != null && src.c !== '' ? Number(src.c) : Math.max(0, ((Number(src.kcal) || t.kcal) - P * 4 - F * 9) / 4);
      Cg = Math.max(0, Math.round(Cg + adj / 4));
      t = Object.assign({}, t, { protein: P, carbs: Cg, fat: F, kcal: Math.round(P * 4 + Cg * 4 + F * 9) });
    } else if (method === 'calpro' && (co.cal || co.protein)) {
      const kcal = (Number(co.cal) || t.kcal) + (co.cal ? adj : 0), P = Number(co.protein) || t.protein;
      const Cg = Math.max(25, Math.round((kcal - P * 4 - t.fat * 9) / 4));
      t = Object.assign({}, t, { kcal: Math.round(P * 4 + Cg * 4 + t.fat * 9), protein: P, carbs: Cg });
    }
    const meals = distribute(layout(p, type, after), t, type);
    return { p, type, after, bw, bf, method, style, targets: t, meals, override: !!(ov.type || ov.after != null) };
  }
  function targetsFor(iso) { const d = dayInfo(iso); return d && d.method !== 'plate' ? d.targets : null; }
  // a coach can run a client on Coach macros or the Plate method before the client fills in the setup
  const coachRun = (n) => !!(n && n.coach && ((n.coach.method === 'coach' && n.coach.macros) || n.coach.method === 'plate'));
  const COACH_ONLY_PROFILE = (st) => ({ sex: st.settings.sex || 'f', age: st.settings.age || 30, heightIn: (st.settings.heightCm || 168) / 2.54, weightLb: 160, goal: 'maintain', pace: 'standard', job: 'desk', meals: 4, trainAfter: 2, shake: true,
    schedule: { 0: 'rest', 1: 'moderate', 2: 'moderate', 3: 'rest', 4: 'moderate', 5: 'moderate', 6: 'light' } });
  const active = () => { const n = S().nutrition; return !!(n && (n.profile || coachRun(n))); };

  // ---------- setup ----------
  function setupForm() {
    const st = S(), n = st.nutrition || {}, p = n.profile || {};
    const kg = st.settings.units === 'kg';
    const bwLb = lbOf(st, p) || '';
    const bwShow = bwLb ? Math.round((kg ? bwLb * 0.45359237 : bwLb) * 10) / 10 : '';
    const hIn = p.heightIn || st.settings.heightCm / 2.54 || '';
    const sched = p.schedule || { 0: 'rest', 1: 'moderate', 2: 'moderate', 3: 'rest', 4: 'moderate', 5: 'moderate', 6: 'light' };
    const sel = (name, val, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const prefs = p.prefs || DEFAULT_PREFS;
    const chk = (group, key) => `<label class="pill-check"><input type="checkbox" name="pref_${group}" value="${key}" ${(prefs[group] || []).includes(key) ? 'checked' : ''}><span>${esc(FOODS[key].n.replace(/ \(.*\)/, ''))}</span></label>`;
    C.openModal(`<h2>Your nutrition plan</h2>
      <p class="hint" style="margin-top:0">Takes 2 minutes. Your coach can fine-tune it afterwards.</p>
      <div class="fields-2">${C.field('Sex', sel('sex', p.sex || st.settings.sex || 'f', [['f', 'Female'], ['m', 'Male']]))}${C.field('Age', C.inNum('age', p.age || st.settings.age, 'min="14" max="90" required'))}</div>
      ${kg ? C.field('Height (cm)', C.inNum('hcm', hIn ? Math.round(hIn * 2.54) : '', 'min="120" max="230" required'))
        : `<div class="fields-2">${C.field('Height (ft)', C.inNum('hft', hIn ? Math.floor(hIn / 12) : '', 'min="4" max="7" required'))}${C.field('(in)', C.inNum('hin', hIn ? Math.round(hIn % 12) : '', 'min="0" max="11"'))}</div>`}
      <div class="fields-2">${C.field(`Weight (${kg ? 'kg' : 'lb'})`, C.inNum('weight', bwShow, 'min="60" required'))}${C.field('Body fat % (optional)', C.inNum('bf', bfOf(st, p) || '', 'min="3" max="60"'))}</div>
      ${C.field('Your day outside training', sel('job', p.job || 'desk', Object.entries(JOB).map(([k, v]) => [k, v[1]])))}
      <div class="fields-2">${C.field('Goal', sel('goal', p.goal || 'maintain', Object.entries(GOALS)))}${C.field('Pace', sel('pace', p.pace || 'standard', [['gentle', 'Gentle'], ['standard', 'Standard'], ['aggressive', 'Aggressive']]))}</div>
      <div class="sub" style="font-weight:700;margin:10px 0 6px">Your training week</div>
      <div class="week-sched">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><span>${DAYS[d]}</span>${sel('sch' + d, sched[d] || 'rest', Object.entries(TRAIN).map(([k, v]) => [k, v[1]]))}</label>`).join('')}</div>
      <p class="hint">Light = easy session or mobility · Moderate = normal session · Heavy = long/very hard session or two-a-day. You can change any single day from the Food tab.</p>
      <div class="fields-2">${C.field('Meals per day', sel('meals', p.meals || 4, [[3, '3'], [4, '4'], [5, '5'], [6, '6']]))}${C.field('Usually train', sel('after', p.trainAfter ?? 2, [[0, 'First thing'], [1, 'After meal 1'], [2, 'After meal 2'], [3, 'After meal 3'], [4, 'After meal 4']]))}</div>
      <label class="ed-check" style="margin-bottom:10px"><input type="checkbox" name="shake" ${p.shake === false ? '' : 'checked'}><span>Protein + carb shake around training</span></label>
      <div class="sub" style="font-weight:700;margin:10px 0 6px">How you want to eat</div>
      ${n.coach && n.coach.method ? `<p class="hint" style="margin-top:0">Method set by your coach: <strong>${esc(METHODS[methodOf(n)].n)}</strong></p>`
        : C.field('Method', sel('method', methodOf(n), ['auto', 'calpro', 'plate'].map((k) => [k, METHODS[k].n])), 'Auto: full macros that adjust over time · Calories + Protein: two numbers · Plate: no counting')}
      ${n.coach && n.coach.style ? `<p class="hint">Diet style set by your coach: <strong>${esc(STYLES[styleOf(n)].n)}</strong></p>`
        : C.field('Diet style', sel('style', p.style || 'standard', Object.entries(STYLES).map(([k, v]) => [k, v.n])), 'Removes foods you don\'t eat from suggestions and recipes.')}
      ${n.coach && n.coach.window ? '' : `<div class="fields-2">${C.field('Eating window from (optional)', `<input type="time" name="wstart" value="${esc((n.window || {}).start || '')}">`)}${C.field('to', `<input type="time" name="wend" value="${esc((n.window || {}).end || '')}">`)}</div>`}
      <div class="sub" style="font-weight:700;margin:10px 0 6px">Foods you like</div>
      <div class="pill-row">${DEFAULT_PREFS.protein.concat(['sirloin', 'turkey', 'beef85', 'whitefish', 'shrimp', 'tuna', 'cottage', 'tofu', 'tempeh', 'seitan', 'edamame', 'peaprotein']).map((k) => chk('protein', k)).join('')}</div>
      <div class="pill-row">${['rice', 'potato', 'sweetpot', 'oats', 'banana', 'berries', 'bread', 'pasta', 'quinoa', 'oj', 'lentils', 'chickpeas', 'blackbeans'].map((k) => chk('carb', k)).join('')}</div>
      <div class="pill-row">${['avocado', 'olive', 'pb', 'almonds', 'walnuts', 'chia', 'eggs', 'cheese', 'butter', 'coconut'].map((k) => chk('fat', k)).join('')}</div>
      <p class="hint" style="margin-top:0">Anything your diet style rules out is skipped automatically.</p>
      <div class="sub" style="font-weight:700;margin:12px 0 6px">Health check</div>
      <label class="ed-check"><input type="checkbox" name="flag"><span>I'm pregnant or breastfeeding, have a medical condition affecting my diet (e.g. diabetes, kidney disease), or have a history of an eating disorder</span></label>
      <div id="nut-preview" class="card" style="background:var(--surface-2);margin-top:12px"></div>`, (fd) => {
      const prof = readForm(fd);
      if (!prof) { C.toast('Fill in age, height and weight'); return false; }
      st.nutrition = Object.assign({ overrides: {}, coach: {} }, st.nutrition || {}, { profile: prof });
      if (fd.get('method')) st.nutrition.method = fd.get('method');
      if (fd.has('wstart')) st.nutrition.window = fd.get('wstart') && fd.get('wend') ? { start: fd.get('wstart'), end: fd.get('wend') } : null;
      st.settings.sex = prof.sex; st.settings.age = prof.age; st.settings.heightCm = Math.round(prof.heightIn * 2.54 * 10) / 10;
      const typed = Math.round((kg ? prof.weightLb * 0.45359237 : prof.weightLb) * 10) / 10, cur = lbOf(st, prof);
      const bfChanged = prof.bodyFat && prof.bodyFat !== bfOf(st, Object.assign({}, prof, { bodyFat: null }));
      if (!st.body.some((b) => b.weight != null) || Math.abs(cur - prof.weightLb) >= 0.5 || bfChanged) {
        const ex = st.body.find((b) => b.date === C.todayISO());
        if (ex) { ex.weight = typed; if (prof.bodyFat) ex.bodyFat = prof.bodyFat; }
        else st.body.push({ id: C.uid(), date: C.todayISO(), weight: typed, bodyFat: prof.bodyFat || undefined, notes: 'From nutrition setup' });
      }
      C.save();
      C.toast(prof.flagged ? 'Saved. Your coach will review your targets before you cut calories' : 'Your nutrition plan is ready 🍽');
    }, { saveLabel: p.goal ? 'Update my plan' : 'Create my plan' });
    const form = document.getElementById('modal-form');
    function readForm(fd) {
      const age = Number(fd.get('age')), w = Number(fd.get('weight'));
      const hIn2 = kg ? Number(fd.get('hcm')) / 2.54 : Number(fd.get('hft')) * 12 + (Number(fd.get('hin')) || 0);
      if (!age || !w || !hIn2) return null;
      const schedule = {}; [0, 1, 2, 3, 4, 5, 6].forEach((d) => { schedule[d] = fd.get('sch' + d); });
      const flagged = fd.get('flag') === 'on';
      const pick = (g) => { const v = fd.getAll('pref_' + g); return v.length ? v : DEFAULT_PREFS[g]; };
      return { sex: fd.get('sex'), age, heightIn: Math.round(hIn2 * 10) / 10, weightLb: kg ? w / 0.45359237 : w, bodyFat: Number(fd.get('bf')) || null, job: fd.get('job'),
        style: fd.get('style') || p.style || 'standard', goal: flagged && fd.get('goal') === 'cut' ? 'maintain' : fd.get('goal'), pace: fd.get('pace'), schedule, meals: Number(fd.get('meals')), trainAfter: Number(fd.get('after')),
        shake: fd.get('shake') === 'on', prefs: { protein: pick('protein'), carb: pick('carb'), fat: pick('fat') }, flagged, updated: C.todayISO() };
    }
    const preview = () => {
      const prof = readForm(new FormData(form));
      const box = document.getElementById('nut-preview');
      if (!box) return;
      if (!prof) { box.innerHTML = '<div class="sub">Fill in age, height and weight to see your numbers.</div>'; return; }
      const coach = (S().nutrition && S().nutrition.coach) || {};
      const row = (t) => { const m = macros(prof, t, prof.weightLb, coach); return `<tr><td><strong>${TRAIN[t][1]}</strong></td><td>${m.kcal}</td><td>${m.protein}</td><td>${m.carbs}</td><td>${m.fat}</td></tr>`; };
      const used = [...new Set(Object.values(prof.schedule))];
      box.innerHTML = `${prof.flagged && fd0(form, 'goal') === 'cut' ? '<p class="bad" style="margin-top:0">Because of your health answer, your plan starts at maintenance. Your coach will decide on a cut with you.</p>' : ''}
        <table class="tbl"><thead><tr><th>Day</th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr></thead><tbody>${['rest', 'light', 'moderate', 'heavy'].filter((t) => used.includes(t)).map(row).join('')}</tbody></table>
        <p class="hint" style="margin:6px 0 0">Protein and fat stay steady; carbs rise with training. ${prof.goal === 'cut' ? `Aim: lose about ${(RATE.cut[prof.pace] * prof.weightLb / 100).toFixed(1)} lb a week.` : prof.goal === 'build' ? `Aim: gain about ${(RATE.build[prof.pace] * prof.weightLb / 100).toFixed(1)} lb a week.` : 'Aim: hold your weight steady.'}</p>`;
    };
    const fd0 = (f, n2) => new FormData(f).get(n2);
    form.addEventListener('input', preview); form.addEventListener('change', preview);
    preview();
  }

  // ---------- Food tab ----------
  // ---------- eating window (intermittent fasting) ----------
  const winOf = (n) => { const w = (n && n.coach && n.coach.window) || (n && n.window); return w && w.start && w.end ? w : null; };
  const hm = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const fmtT = (t) => { const [h, m] = String(t).split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`; };
  function windowHTML(n, iso) {
    const w = winOf(n); if (!w) return '';
    let status = '';
    if (iso === C.todayISO()) {
      const now = new Date(), cur = now.getHours() * 60 + now.getMinutes(), a = hm(w.start), b = hm(w.end);
      const open = a <= b ? cur >= a && cur < b : cur >= a || cur < b;
      const until = (x) => { const d = (x - cur + 1440) % 1440; return d >= 60 ? `${Math.floor(d / 60)}h ${d % 60}m` : `${d}m`; };
      status = open ? ` · <strong>open</strong>, closes in ${until(b)}` : ` · closed, opens in ${until(a)}`;
    }
    return `<div class="win-chip">⏱ Eating window ${fmtT(w.start)}–${fmtT(w.end)}${status}</div>`;
  }
  // ---------- plate method: no counting ----------
  function plateCard(d, iso, items) {
    const st = S(), n = st.nutrition, p = d.p, m = p.sex === 'm';
    const M = Math.min(6, Math.max(2, p.meals || 4));
    const extra = Math.round((Number((n.coach || {}).kcalAdjust) || 0) / 100); // ±1 cupped hand of carbs ≈ ±100 kcal
    const plates = ((n.plates || {})[iso]) || [];
    const veg = d.style === 'keto' ? '1–2 fists of veggies' : '1–2 fists of veggies';
    const prot = `${m ? 2 : 1} palm${m ? 's' : ''} of protein`;
    const carb = d.style === 'keto' ? 'skip starchy carbs (berries are fine)' : `${m ? 2 : 1} cupped hand${m ? 's' : ''} of carbs`;
    const fat = `${m ? 2 : 1} thumb${m ? 's' : ''} of fat`;
    const sd = STYLES[d.style] || STYLES.standard;
    const ideas = (g) => prefsFor(p, d.style)[g].slice(0, 3).map((k) => FOODS[k].n.replace(/ \(.*\)/, '')).join(', ');
    let h = `<div class="card"><div class="card-head"><h2>Today's plate</h2><button class="btn small" data-action="nut-setup">Edit</button></div>
      ${windowHTML(n, iso)}
      <div class="plate-row"><svg class="plate-svg" viewBox="0 0 120 120" role="img" aria-label="Plate: half veggies, a quarter protein, a quarter carbs">
        <circle cx="60" cy="60" r="56" fill="var(--surface-2)" stroke="var(--line)" stroke-width="2"/>
        <path d="M60 60 L60 8 A52 52 0 0 0 60 112 Z" fill="var(--good)" opacity=".75"/>
        <path d="M60 60 L60 8 A52 52 0 0 1 112 60 Z" fill="var(--accent)"/>
        <path d="M60 60 L112 60 A52 52 0 0 1 60 112 Z" fill="var(--tan)"/>
        <text x="32" y="64" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">VEG</text><text x="84" y="44" font-size="9" font-weight="700" text-anchor="middle" fill="#fff">PROTEIN</text><text x="84" y="84" font-size="9" font-weight="700" text-anchor="middle" fill="#1a1a1b">CARBS</text></svg>
        <ul class="plate-list"><li><strong>Veggies:</strong> ${veg}</li><li><strong>Protein:</strong> ${prot}</li><li><strong>Carbs:</strong> ${carb}</li><li><strong>Fat:</strong> ${fat}</li></ul></div>
      ${d.type !== 'rest' && d.style !== 'keto' ? '<p class="hint" style="margin:6px 0 0">Training day: add 1 more cupped hand of carbs to the meal after you train.</p>' : ''}
      ${extra ? `<p class="hint" style="margin:4px 0 0"><strong>From your coach:</strong> ${extra > 0 ? 'add' : 'drop'} ${Math.abs(extra)} cupped hand${Math.abs(extra) > 1 ? 's' : ''} of carbs a day.</p>` : ''}
      ${d.style !== 'standard' ? `<p class="hint" style="margin:4px 0 0"><strong>${esc(sd.n)}:</strong> ${esc(sd.note || '')}</p>` : ''}
      <p class="hint" style="margin:4px 0 0">Ideas: ${esc(ideas('protein'))} · ${esc(ideas('carb'))} · ${esc(ideas('fat'))}</p>
      <div class="plate-meals">${Array.from({ length: M }, (_, i) => `<button class="plate-meal ${plates.includes(i) ? 'on' : ''}" data-action="nut-plate" data-i="${i}" aria-pressed="${plates.includes(i)}"><span>Meal ${i + 1}</span><strong>${plates.includes(i) ? '✓ Built' : 'Tap when built'}</strong></button>`).join('')}</div>
      <p class="hint" style="margin:8px 0 0"><strong>Plate method</strong> · ${plates.length}/${M} plates today${p.flagged ? ' · <strong>coach review</strong>' : ''}</p></div>`;
    if (items.length) h += `<div class="card"><div class="card-head"><h2>Logged</h2></div><ul class="list">${items.map((f) => `<li><div class="grow" data-action="edit-food" data-id="${f.id}" style="cursor:pointer"><div class="title">${esc(f.name)}</div><div class="meta">${esc(f.meal || '')}</div></div><button class="del" data-action="del-food" data-id="${f.id}" aria-label="Delete">×</button></li>`).join('')}</ul></div>`;
    return h;
  }
  function foodCard(dateIso, items) {
    if (!active()) {
      return `<div class="card" style="border-color:var(--accent)"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><strong>Get your nutrition plan</strong>
        <div class="sub">Daily calories, protein, carbs and fat, and what to eat at each meal, based on your training.</div></div>
        <button class="btn primary" data-action="nut-setup">Start</button></div></div>
        <button class="btn block" data-action="nut-browse" style="margin-bottom:14px">📖 Recipes & saved meals</button>`;
    }
    const d = dayInfo(dateIso), st = S(), p = d.p, t = d.targets;
    if (d.method === 'plate') return plateCard(d, dateIso, items);
    const sum = (k) => items.reduce((a, f) => a + (f[k] || 0), 0);
    const got = { kcal: sum('kcal'), p: sum('protein'), c: sum('carbs'), f: sum('fat') };
    const bar = (label, v, goal, unit) => `<div class="mbar"><div class="row" style="justify-content:space-between"><span>${label}</span><span class="sub">${Math.round(v)} / ${goal}${unit}</span></div><div class="progress ${v > goal * 1.08 ? 'over' : ''}"><i style="width:${Math.min(100, (v / (goal || 1)) * 100)}%"></i></div></div>`;
    let h = `<div class="card"><div class="card-head"><h2>Today's plan</h2><button class="btn small" data-action="nut-setup">Edit</button></div>
      <div class="chips-row">${Object.entries(TRAIN).map(([k, v]) => `<button class="chip-btn ${d.type === k ? 'on' : ''}" data-action="nut-type" data-type="${k}" title="${esc(TRAIN_HELP[k])}">${v[1]}</button>`).join('')}</div>
      ${d.type !== 'rest' ? `<div class="row" style="margin:8px 0 0;flex-wrap:nowrap"><span class="sub" style="flex:none">Training</span><select class="small-select" data-nut-after>${Array.from({ length: p.meals + 1 }, (_, i) => `<option value="${i}" ${d.after === i ? 'selected' : ''}>${i === 0 ? 'first thing' : 'after meal ' + i}</option>`).join('')}</select></div>` : ''}
      ${d.override ? `<button class="link-btn" data-action="nut-reset-day" style="font-size:13px">Reset to my usual ${DAYS[new Date(...dateIso.split('-').map((x, i) => (i === 1 ? x - 1 : +x))).getDay()]}</button>` : ''}
      ${windowHTML(st.nutrition, dateIso)}
      <div style="margin-top:12px">${bar('Calories', got.kcal, t.kcal, '')}${bar('Protein', got.p, t.protein, ' g')}${d.method === 'calpro' ? '' : bar('Carbs', got.c, t.carbs, ' g') + bar('Fat', got.f, t.fat, ' g')}</div>
      <button class="btn small block" data-action="nut-browse" style="margin-top:10px">📖 Browse recipes & saved meals</button>
      <p class="hint" style="margin:8px 0 0"><strong>${esc(METHODS[d.method].n)}</strong>${d.style !== 'standard' ? ' · ' + esc(STYLES[d.style].n) : ''} · ${GOALS[p.goal]}${p.goal !== 'maintain' ? ' · ' + p.pace : ''}${st.nutrition.coach && (st.nutrition.coach.kcalAdjust || st.nutrition.coach.protein) ? ' · adjusted by your coach' : ''}${p.flagged ? ' · <strong>coach review</strong>' : ''}</p>
      <p class="hint" style="margin:2px 0 0">Based on ${(() => { const w = weightInfo(st.body, st.settings.units); const kg = st.settings.units === 'kg'; const v = (lb) => (kg ? (lb * 0.45359237).toFixed(1) + ' kg' : lb.toFixed(1) + ' lb');
        return w ? `${w.n > 1 ? `your 7-day average weight, ${v(w.lb)}` : `your last weigh-in, ${v(w.lb)}`}` : `${v(d.bw)}`; })()}${d.bf ? ` · ${d.bf}% body fat` : ''}. Updates as you log weigh-ins.</p></div>`;
    const picksFor = (m, i) => {
      const prefs = prefsFor(p, d.style);
      const rot = (arr, off) => arr[(i + off + ((C.ui.nutSwap || {})[m.key] || 0)) % arr.length];
      if (m.role === 'shake') return { protein: styleOK(d.style, 'whey') ? 'whey' : 'peaprotein', carb: styleOK(d.style, 'banana') ? 'banana' : prefs.carb[0], carbCap: 25, carb2: d.style === 'keto' ? null : (p.prefs && p.prefs.shakeCarb) || (styleOK(d.style, 'carbpowder') ? 'carbpowder' : null), fat: null };
      const carbs = m.role === 'pre' || m.role === 'post' ? (prefs.carb.filter((k) => ['rice', 'potato', 'oats', 'pasta', 'bread', 'banana', 'oj', 'sweetpot', 'quinoa', 'berries'].includes(k))) : prefs.carb;
      const oil = ['olive', 'butter', 'coconut'].find((k) => styleOK(d.style, k));
      return { protein: rot(prefs.protein, 0), carb: rot(carbs.length ? carbs : prefs.carb, 1), fat: m.role === 'pre' || m.role === 'post' ? null : rot(prefs.fat, 2), fat2: oil };
    };
    d.meals.forEach((m, i) => {
      const logged = items.filter((f) => f.meal === m.label);
      const lg = { p: logged.reduce((a, f) => a + (f.protein || 0), 0), c: logged.reduce((a, f) => a + (f.carbs || 0), 0), f: logged.reduce((a, f) => a + (f.fat || 0), 0) };
      const done = m.p && lg.p >= m.p * 0.85;
      const picks = picksFor(m, i);
      const am = amounts(m, picks);
      const body = `<div class="meal-target">${m.p} g protein · ${m.c} g carbs · ${m.f} g fat · ${m.kcal} kcal</div>
          ${logged.length ? '' : `<div class="res-head" style="margin-top:8px">Suggested</div><ul class="list amt-list">${am.map((x) => `<li><div class="grow">${esc(x.name)}</div><span class="num">${esc(qtyText(x))}</span></li>`).join('')}${m.role !== 'shake' ? `<li><div class="grow sub">Veggies: ${VEG}</div><span class="num sub">1+ cup</span></li>` : ''}</ul>`}`;
      h += `<div class="card meal-card ${done ? 'met' : ''}"><div class="row" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-start">
          <div><strong>${esc(m.label)}</strong>${m.role !== 'other' ? ` <span class="chip ${m.role === 'shake' ? 'strong' : ''}">${m.role === 'pre' ? 'Pre-workout' : m.role === 'post' ? 'Post-workout' : 'Training'}</span>` : ''}<div class="sub" style="font-size:12px">${esc(m.when)}</div></div>
          <span class="sub" style="font-size:12px;white-space:nowrap">${logged.length ? `${Math.round(lg.p)}/${m.p} g P` : ''}${done ? ' ✓' : ''}</span></div>
        ${body}
        ${logged.length ? `<ul class="list logged">${logged.map((f) => `<li><div class="grow" data-action="edit-food" data-id="${f.id}" style="cursor:pointer"><div class="title">${esc(f.name)}</div><div class="meta">${[f.serving ? esc(f.serving) : '', `P ${Math.round(f.protein || 0)} C ${Math.round(f.carbs || 0)} F ${Math.round(f.fat || 0)}`].filter(Boolean).join(' · ')}</div></div><span class="num">${Math.round(f.kcal || 0)}</span><button class="del" data-action="del-food" data-id="${f.id}" aria-label="Delete">×</button></li>`).join('')}</ul>` : ''}
        <div class="row meal-actions">
          ${logged.length ? '' : `<button class="btn small primary" data-action="nut-log-meal" data-key="${m.key}">Log suggestion</button>${m.role !== 'shake' ? `<button class="btn small" data-action="nut-swap" data-key="${m.key}">Swap</button>` : ''}`}
          <button class="btn small ${logged.length ? '' : ''}" data-action="nut-choose" data-key="${m.key}">📖 Choose a meal</button>
          <button class="btn small" data-action="add-food-slot" data-slot="${esc(m.label)}">+ Food</button>
          ${logged.length ? `<button class="btn small" data-action="nut-save-meal" data-key="${m.key}">⭐ Save as meal</button>` : ''}</div></div>`;
    });
    const other = items.filter((f) => !d.meals.some((m) => m.label === f.meal));
    if (other.length) h += `<div class="card"><div class="card-head"><h2>Other</h2></div><ul class="list">${other.map((f) => `<li><div class="grow" data-action="edit-food" data-id="${f.id}" style="cursor:pointer"><div class="title">${esc(f.name)}</div><div class="meta">${esc(f.meal || '')} · P ${Math.round(f.protein || 0)} C ${Math.round(f.carbs || 0)} F ${Math.round(f.fat || 0)}</div></div><span class="num">${Math.round(f.kcal || 0)}</span><button class="del" data-action="del-food" data-id="${f.id}" aria-label="Delete">×</button></li>`).join('')}</ul></div>`;
    C.ui.nutMeals = { date: dateIso, meals: d.meals, picks: d.meals.map((m, i) => amounts(m, picksFor(m, i))) };
    return h;
  }

  // ---------- actions ----------
  const actions = {
    'nut-setup': () => setupForm(),
    'nut-plate': (el) => {
      const n = S().nutrition, iso = C.ui.foodDate || C.todayISO(), i = +el.dataset.i;
      n.plates = n.plates || {}; const a = n.plates[iso] || (n.plates[iso] = []);
      const k = a.indexOf(i); if (k >= 0) a.splice(k, 1); else a.push(i);
      Object.keys(n.plates).forEach((d) => { if (C.daysBetween && C.daysBetween(d, C.todayISO()) > 60) delete n.plates[d]; });
      C.save(); C.render();
    },
    'nut-type': (el) => { const st = S(); const n = st.nutrition; const iso = C.ui.foodDate; n.overrides = n.overrides || {}; n.overrides[iso] = { ...(n.overrides[iso] || {}), type: el.dataset.type }; C.save(); C.render(); },
    'nut-reset-day': () => { const n = S().nutrition; delete (n.overrides || {})[C.ui.foodDate]; C.save(); C.render(); },
    'nut-choose': (el) => chooseMeal(el.dataset.key),
    'nut-browse': () => {
      const iso = C.ui.foodDate || C.todayISO();
      const opts = C.mealOptions ? C.mealOptions(iso) : ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
      const hr = new Date().getHours();
      const label = active() ? ((dayInfo(iso).meals.find((x) => !S().food.some((f) => f.date === iso && f.meal === x.label)) || { label: opts[0] }).label) : (hr < 11 ? 'Breakfast' : hr < 15 ? 'Lunch' : hr < 21 ? 'Dinner' : 'Snack');
      const keep = C.ui.nutMeals && C.ui.nutMeals.date === iso ? C.ui.nutMeals.meals.filter((x) => x.key !== 'browse') : [];
      C.ui.nutMeals = { date: iso, meals: [...keep, { key: 'browse', label, role: 'other', p: 0, c: 0, f: 0, kcal: 0 }], picks: [] };
      chooseMeal('browse');
    },
    'nut-save-meal': (el) => saveMeal(el.dataset.key),
    'nut-swap': (el) => { C.ui.nutSwap = C.ui.nutSwap || {}; C.ui.nutSwap[el.dataset.key] = (C.ui.nutSwap[el.dataset.key] || 0) + 1; C.render(); },
    'nut-log-meal': (el) => {
      const nm = C.ui.nutMeals; if (!nm) return;
      const i = nm.meals.findIndex((m) => m.key === el.dataset.key); if (i < 0) return;
      const m = nm.meals[i], st = S();
      const now = new Date(), time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      nm.picks[i].forEach((x) => st.food.push({ id: C.uid(), date: nm.date, time, meal: m.label, name: x.name, serving: qtyText(x), kcal: x.kcal, protein: x.p, carbs: x.c, fat: x.f }));
      C.save(); C.toast(`${m.label} logged`); C.render();
    },
  };
  // ---------- meal library (my saved meals + coach recipes) ----------
  const r4 = (n) => Math.round(n * 4) / 4;
  function libraryItems() {
    const mine = (S().savedMeals || []).map((x) => ({ id: x.id, src: 'mine', name: x.name, tags: x.tags || [], per: x.per, items: x.items, servings: 1 }));
    const coach = ((window.Cloud && Cloud.recipes && Cloud.recipes()) || []).map((r) => ({ id: r.id, src: 'coach', name: r.data.name, tags: r.data.tags || [], per: r.data.per, recipe: r.data, published: r.published !== false }));
    return [...mine, ...coach].filter((x) => x.per && x.per.kcal != null);
  }
  // Scale to the meal's protein; dishes with little protein scale by calories instead. Kept to ½–2½ servings.
  const suggestServings = (it, m) => {
    if (it.src === 'mine') return 1;
    const byP = it.per.p >= 10 && m.p ? m.p / it.per.p : null;
    const byK = it.per.kcal && m.kcal ? m.kcal / it.per.kcal : 1;
    return Math.min(2.5, Math.max(0.5, r4(byP || byK)));
  };
  const scaled = (per, s) => ({ kcal: Math.round(per.kcal * s), p: Math.round(per.p * s), c: Math.round(per.c * s), f: Math.round(per.f * s) });
  function fitScore(x, m) { const rel = (a, b) => Math.abs(a - b) / Math.max(b, 10); return rel(x.p, m.p) + 0.6 * rel(x.c, m.c) + 0.4 * rel(x.f, m.f); }
  const fitText = (x, m) => `<span class="${Math.abs(x.p - m.p) <= Math.max(5, m.p * 0.15) ? 'good' : ''}">P ${x.p}/${m.p}</span> · <span class="${Math.abs(x.c - m.c) <= Math.max(8, m.c * 0.2) ? 'good' : ''}">C ${x.c}/${m.c}</span> · <span class="${Math.abs(x.f - m.f) <= Math.max(4, m.f * 0.25) ? 'good' : ''}">F ${x.f}/${m.f}</span>`;
  const ROLE_TAGS = { pre: ['pre-workout'], post: ['post-workout'], shake: ['shake', 'post-workout'] };

  function chooseMeal(key) {
    const nm = C.ui.nutMeals; const m = nm && nm.meals.find((x) => x.key === key); if (!m) return;
    if (window.Cloud && Cloud.loadRecipes) Cloud.loadRecipes().then(() => { if (document.getElementById('lib-list')) draw(); }).catch(() => {});
    let tab = 'all', q = '';
    const browse = !m.kcal;
    C.openModal(`<h2>${browse ? 'Recipes & saved meals' : `Choose a meal · ${esc(m.label)}`}</h2>
      ${browse ? '<p class="hint" style="margin-top:0">Tap one to see it, pick the servings and log it.</p>' : `<div class="meal-target" style="margin-top:0">Target: ${m.p} g P · ${m.c} g C · ${m.f} g F · ${m.kcal} kcal</div>`}
      <input type="search" id="lib-q" placeholder="Search meals and recipes" autocomplete="off" style="margin:10px 0">
      ${isCoach() ? '<button class="btn primary block" data-modal-action="lib-new" style="margin-bottom:8px">+ New recipe</button>' : ''}
      <div class="segmented" id="lib-tabs" style="margin-bottom:8px"><button class="active" data-t="all">All</button><button data-t="mine">My meals</button><button data-t="coach">${isCoach() ? 'Library' : 'Coach recipes'}</button></div>
      <div id="lib-list"></div>`, null, { hideSave: true });
    const draw = () => {
      const want = ROLE_TAGS[m.role] || [];
      const style = styleOf(S().nutrition);
      let items = libraryItems().filter((x) => tab === 'all' || x.src === tab).filter((x) => x.src === 'mine' || recipeFits(x.recipe, style))
        .filter((x) => !q || (x.name + ' ' + x.tags.join(' ')).toLowerCase().includes(q));
      items = items.map((x) => {
        const s = suggestServings(x, m); const v = scaled(x.per, s);
        const stretch = Math.abs(Math.log2(s)) * 0.35; // prefer dishes that fit near one serving
        return { ...x, s, v, score: fitScore(v, m) + stretch - (x.tags.some((t) => want.includes(t)) ? 0.3 : 0) };
      }).sort((a, b) => (browse ? a.name.localeCompare(b.name) : a.score - b.score));
      const box = document.getElementById('lib-list'); if (!box) return;
      box.innerHTML = items.length ? `<ul class="list lib">${items.map((x) => `<li><button data-modal-action="lib-open" data-id="${esc(x.id)}" data-src="${x.src}" data-key="${key}">
          <div class="title">${esc(x.name)} ${x.src === 'coach' ? (x.published ? '<span class="chip">Coach</span>' : '<span class="chip" style="color:var(--warn)">Hidden</span>') : '<span class="chip">Mine</span>'}</div>
          <div class="meta">${browse ? `${x.per.kcal} kcal · P ${x.per.p} C ${x.per.c} F ${x.per.f} per serving${x.tags.length ? ' · ' + esc(x.tags.slice(0, 3).join(', ')) : ''}` : `${x.src === 'coach' ? `${fmtQ(x.s)} serving${x.s > 1 ? 's' : ''} · ` : ''}${x.v.kcal} kcal · ${fitText(x.v, m)}`}</div></button></li>`).join('')}</ul>`
        : `<div class="empty">${tab === 'mine' || !libraryItems().length ? 'No saved meals yet. Log a meal, then tap ⭐ Save as meal.' : 'Nothing matches.'}${tab === 'coach' ? ' Your coach hasn\'t added recipes yet.' : ''}</div>`;
    };
    document.getElementById('lib-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
    document.getElementById('lib-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; e.preventDefault(); tab = b.dataset.t; [...e.currentTarget.children].forEach((x) => x.classList.toggle('active', x === b)); draw(); });
    draw();
  }
  const fmtQ = (q) => fmtQty(q) || '0';
  const isCoach = () => !!(window.Cloud && Cloud.profile && Cloud.profile.role === 'coach');

  function openLibItem(id, src, key) {
    const nm = C.ui.nutMeals; const m = nm && nm.meals.find((x) => x.key === key); if (!m) return;
    const it = libraryItems().find((x) => x.id === id && x.src === src); if (!it) return;
    let s = suggestServings(it, m);
    const r = it.recipe;
    C.closeModal();
    setTimeout(() => {
      C.openModal(`<h2>${esc(it.name)}</h2>
        ${it.tags.length ? `<div style="margin-bottom:8px">${it.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="row" style="flex-wrap:nowrap;margin-bottom:10px"><span class="sub" style="flex:1">${src === 'coach' ? 'Servings' : 'Amount'}</span>
          <button class="btn small" data-modal-action="lib-s" data-d="-0.25">−</button><strong id="lib-s" style="min-width:56px;text-align:center"></strong><button class="btn small" data-modal-action="lib-s" data-d="0.25">+</button></div>
        <div class="card" style="background:var(--surface-2)" id="lib-fit"></div>
        ${src === 'mine' ? `<ul class="list">${it.items.map((x) => `<li><div class="grow"><div class="title">${esc(x.name)}</div><div class="meta">${esc(x.serving || '')}</div></div><span class="num">${Math.round(x.kcal || 0)}</span></li>`).join('')}</ul>` : ''}
        ${r && r.ingredients && r.ingredients.length ? `<div class="res-head">Ingredients (whole recipe, ${r.servings || 1} serving${(r.servings || 1) > 1 ? 's' : ''})</div><ul class="list">${r.ingredients.map((g) => `<li><div class="grow">${esc(g.name)}</div><span class="num">${esc(g.amount || (g.grams ? g.grams + ' g' : ''))}</span></li>`).join('')}</ul>` : ''}
        ${r && r.instructions ? `<div class="res-head">How to make it</div><p style="white-space:pre-wrap;margin-top:4px">${esc(r.instructions)}</p>` : ''}
        ${r && r.prepMin ? `<p class="sub">⏱ ${r.prepMin} min</p>` : ''}
        ${r && r.source ? `<p class="sub" style="font-size:12px">${esc(r.source)}</p>` : ''}
        ${m.kcal ? '' : C.field('Log to', `<select id="lib-meal">${(C.mealOptions ? C.mealOptions(nm.date) : ['Breakfast', 'Lunch', 'Dinner', 'Snack']).map((x) => `<option ${x === m.label ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`)}
        <button class="btn primary block" data-modal-action="lib-log" style="margin-top:8px">${m.kcal ? `Log to ${esc(m.label)}` : 'Log it'}</button>
        ${src === 'mine' ? '<button class="btn danger small" data-modal-action="lib-del" style="margin-top:10px">Delete saved meal</button>' : ''}
        ${src === 'coach' && isCoach() ? `<div class="coach-tools"><div class="res-head">Coach</div>
          ${it.published ? '' : '<p class="sub" style="margin:0 0 8px"><strong>Hidden:</strong> clients can\'t see this recipe.</p>'}
          <div class="row"><button class="btn small" data-modal-action="lib-edit">✏️ Edit</button>
          <button class="btn small" data-modal-action="lib-pub">${it.published ? 'Hide from clients' : 'Show to clients'}</button>
          <button class="btn small danger" data-modal-action="lib-rdel">Delete</button></div></div>` : ''}`, null, { hideSave: true });
      const upd = () => { const v = scaled(it.per, s); document.getElementById('lib-s').textContent = src === 'coach' ? fmtQ(s) : `${fmtQ(s)}×`; document.getElementById('lib-fit').innerHTML = m.kcal ? `<strong>${v.kcal} kcal</strong> · ${fitText(v, m)}` : `<strong>${v.kcal} kcal</strong> · P ${v.p} · C ${v.c} · F ${v.f}`; };
      upd();
      C.modalActions['lib-s'] = (b) => { s = Math.min(6, Math.max(0.25, s + Number(b.dataset.d))); upd(); };
      C.modalActions['lib-log'] = () => {
        const st = S(); const now = new Date(); const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const sel = document.getElementById('lib-meal'); const mealLabel = sel ? sel.value : m.label;
        if (src === 'mine') {
          it.items.forEach((x) => st.food.push({ id: C.uid(), date: nm.date, time, meal: mealLabel, name: x.name, serving: s === 1 ? x.serving : `${fmtQ(s)}× ${x.serving || 'serving'}`,
            kcal: Math.round((x.kcal || 0) * s), protein: Math.round((x.protein || 0) * s), carbs: Math.round((x.carbs || 0) * s), fat: Math.round((x.fat || 0) * s), qty: s, unit: x.serving || 'serving' }));
        } else {
          const v = scaled(it.per, s);
          st.food.push({ id: C.uid(), date: nm.date, time, meal: mealLabel, name: it.name, serving: `${fmtQ(s)} serving${s > 1 ? 's' : ''}`, kcal: v.kcal, protein: v.p, carbs: v.c, fat: v.f, recipeId: it.id, qty: s, unit: 'serving' });
        }
        C.save(); C.closeModal(); C.toast(`${it.name} logged to ${mealLabel}`); C.render();
      };
      C.modalActions['lib-edit'] = async () => {
        const row = (await Cloud.loadRecipes(true)).find((x) => x.id === it.id); if (!row) return;
        C.ui.recipeReturn = true; C.closeModal(); setTimeout(() => Recipes.open(row), 0);
      };
      C.modalActions['lib-pub'] = async () => {
        const row = (await Cloud.loadRecipes(true)).find((x) => x.id === it.id); if (!row) return;
        try { await Cloud.saveRecipe({ id: row.id, data: row.data, published: !it.published }); await Cloud.loadRecipes(true); }
        catch (e) { C.toast(e.message); return; }
        C.toast(it.published ? 'Hidden from clients' : 'Visible to clients'); C.closeModal(); setTimeout(() => C.actions['nut-browse'](), 0);
      };
      C.modalActions['lib-rdel'] = async () => {
        if (!confirm(`Delete "${it.name}" from your recipe library? Clients won't see it any more.`)) return;
        try { await Cloud.deleteRecipe(it.id); await Cloud.loadRecipes(true); } catch (e) { C.toast(e.message); return; }
        C.toast('Recipe deleted'); C.closeModal(); setTimeout(() => C.actions['nut-browse'](), 0);
      };
      C.modalActions['lib-del'] = () => {
        if (!confirm(`Delete "${it.name}" from your meals?`)) return;
        const st = S(); st.savedMeals = (st.savedMeals || []).filter((x) => x.id !== it.id); C.save(); C.closeModal(); C.render();
      };
    }, 0);
  }

  function saveMeal(key) {
    const nm = C.ui.nutMeals; const m = nm && nm.meals.find((x) => x.key === key); if (!m) return;
    const st = S();
    const logged = st.food.filter((f) => f.date === nm.date && f.meal === m.label);
    if (!logged.length) return;
    const tot = { kcal: 0, p: 0, c: 0, f: 0 };
    logged.forEach((f) => { tot.kcal += f.kcal || 0; tot.p += f.protein || 0; tot.c += f.carbs || 0; tot.f += f.fat || 0; });
    const tagsFor = ROLE_TAGS[m.role] || [];
    C.openModal(`<h2>Save as meal</h2>
      ${C.field('Name', `<input type="text" name="mname" value="${esc(logged.map((f) => f.name.replace(/ \(.*\)/, '')).slice(0, 2).join(' + '))}" required autofocus>`)}
      <ul class="list">${logged.map((f) => `<li><div class="grow"><div class="title">${esc(f.name)}</div><div class="meta">${esc(f.serving || '')}</div></div><span class="num">${Math.round(f.kcal || 0)}</span></li>`).join('')}</ul>
      <p class="sub">${Math.round(tot.kcal)} kcal · P ${Math.round(tot.p)} · C ${Math.round(tot.c)} · F ${Math.round(tot.f)}</p>`, (fd) => {
      st.savedMeals = st.savedMeals || [];
      st.savedMeals.push({ id: C.uid(), name: fd.get('mname').trim() || 'My meal', tags: tagsFor, createdAt: C.todayISO(),
        items: logged.map((f) => ({ name: f.name, serving: f.serving || '', kcal: f.kcal || 0, protein: f.protein || 0, carbs: f.carbs || 0, fat: f.fat || 0 })),
        per: { kcal: Math.round(tot.kcal), p: Math.round(tot.p), c: Math.round(tot.c), f: Math.round(tot.f) } });
      C.save(); C.toast('Saved to My meals ⭐');
    }, { saveLabel: 'Save' });
  }

  function onChange(e) {
    if (!e.target.matches || !e.target.matches('[data-nut-after]')) return;
    const n = S().nutrition, iso = C.ui.foodDate;
    n.overrides = n.overrides || {}; n.overrides[iso] = { ...(n.overrides[iso] || {}), after: Number(e.target.value) };
    C.save(); C.render();
  }

  // Meal options for the food form when a plan is active
  function slotsFor(iso) { const d = dayInfo(iso); return d ? d.meals.map((m) => m.label) : null; }

  // ---------- 2-week check-in (RP): is the weight moving at the goal's rate? ----------
  // Compares the actual trend over the last ~2 weeks (least-squares slope of the weigh-ins) with the goal rate
  // and suggests a calorie change (mostly from carbs). The coach approves it before anything changes.
  function checkin({ profile: p, coach = {}, body = [], units = 'lb', since, today, foodDays }) {
    if (!p || !p.goal) return null;
    const lbs = (w) => (units === 'kg' ? w / 0.45359237 : w);
    const from = addDaysISO(today, -20);
    const pts = body.filter((b) => b.weight != null && b.date >= from && b.date <= today).map((b) => ({ x: (Date.parse(b.date) - Date.parse(today)) / 864e5, y: lbs(Number(b.weight)) }));
    const start = since || p.updated || today;
    const daysIn = Math.round((Date.parse(today) - Date.parse(start)) / 864e5);
    const due = daysIn >= 14;
    const span = pts.length ? Math.max(...pts.map((q) => q.x)) - Math.min(...pts.map((q) => q.x)) : 0;
    const base = { due, daysIn, since: start, nextOn: addDaysISO(start, 14), weighIns: pts.length, kcalAdjust: Number(coach.kcalAdjust) || 0, foodDays };
    if (pts.length < 4 || span < 9) return Object.assign(base, { status: 'nodata', text: `Only ${pts.length} weigh-in${pts.length === 1 ? '' : 's'} in the last 3 weeks. Ask them to weigh in at least 3 mornings a week so the trend is reliable.` });
    const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length, my = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    const slope = pts.reduce((a, q) => a + (q.x - mx) * (q.y - my), 0) / (pts.reduce((a, q) => a + (q.x - mx) ** 2, 0) || 1); // lb/day
    const actual = slope * 7, bw = my;
    const rate = p.goal === 'maintain' ? 0 : ((RATE[p.goal] || {})[p.pace || 'standard'] || 0);
    const target = (p.goal === 'cut' ? -1 : p.goal === 'build' ? 1 : 0) * rate / 100 * bw; // lb/week
    const r50 = (n) => Math.round(n / 50) * 50, clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    let status = 'ok', change = 0, why;
    const f1 = (n) => (n > 0 ? '+' : '') + n.toFixed(1);
    if (p.goal === 'cut') {
      if (actual > target * 0.5) { status = 'slow'; change = -clamp(r50((actual - target) * 500), 100, 300); why = actual >= 0 ? 'Weight is flat or up' : 'Losing slower than planned'; }
      else if (actual < target * 1.6) { status = 'fast'; change = clamp(r50((target - actual) * 500), 100, 250); why = 'Losing faster than planned (muscle and energy at risk)'; }
    } else if (p.goal === 'build') {
      if (actual < target * 0.5) { status = 'slow'; change = clamp(r50((target - actual) * 500), 100, 300); why = 'Gaining slower than planned'; }
      else if (actual > target * 2) { status = 'fast'; change = -clamp(r50((actual - target) * 500), 100, 250); why = 'Gaining faster than planned (likely extra fat)'; }
    } else if (Math.abs(actual) > Math.max(0.5, bw * 0.003)) { status = actual > 0 ? 'fast' : 'slow'; change = -clamp(r50(actual * 500), -250, 250); if (Math.abs(change) < 100) change = Math.sign(change) * 100; why = actual > 0 ? 'Drifting up' : 'Drifting down'; }
    const unitW = (lb) => (units === 'kg' ? f1(lb * 0.45359237) + ' kg' : f1(lb) + ' lb');
    const meth = arguments[0].method || 'auto';
    const text0 = `${unitW(actual)}/week vs goal ${p.goal === 'maintain' ? 'steady' : unitW(target) + '/week'}.` + (status === 'ok' ? ' On track: keep everything the same.' : ` ${why}: ${change > 0 ? 'add' : 'take off'} ${Math.abs(change)} kcal a day, mostly ${change > 0 ? 'added to' : 'from'} carbs.`);
    let text = text0;
    if (status !== 'ok' && meth === 'plate') { const n = Math.max(1, Math.round(Math.abs(change) / 100)); text = text0.replace(/: (add|take off) \d+ kcal a day, mostly (added to|from) carbs\./, `: ${change > 0 ? 'add' : 'drop'} ${n} cupped hand${n > 1 ? 's' : ''} of carbs a day.`); }
    const lowLog = foodDays != null && foodDays < 4 && meth !== 'plate';
    return Object.assign(base, { status, actual, target, change, text, lowLog, newAdjust: base.kcalAdjust + change });
  }

  window.Nutrition = {
    init(ctx) {
      C = ctx; Object.assign(ctx.actions, actions);
      ctx.modalActions['lib-open'] = (b) => openLibItem(b.dataset.id, b.dataset.src, b.dataset.key);
      ctx.modalActions['lib-new'] = () => { C.ui.recipeReturn = true; C.closeModal(); setTimeout(() => Recipes.open(null), 0); };
      document.addEventListener('change', onChange);
    },
    active, dayInfo, targetsFor, foodCard, slotsFor, setupForm, checkin, weightInfo, METHODS, STYLES, methodOf, styleOf, recipeFits, prefsFor,
    _macros: macros, _layout: layout, _distribute: distribute, _amounts: amounts, FOODS, TRAIN,
  };
})();
