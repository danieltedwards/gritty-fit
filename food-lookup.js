// Food lookup: built-in USDA database (offline), Open Food Facts (packaged foods, online),
// and barcode scanning. Every result is normalized to:
//   { name, brand, source, per100: {k,p,c,f} | null, perServing: {k,p,c,f} | null, portions: [[label, grams]] }
(function () {
  'use strict';

  // ---------- built-in USDA database ----------
  let usda = null, usdaPromise = null;
  function loadUSDA() {
    if (usda) return Promise.resolve(usda);
    if (!usdaPromise) {
      usdaPromise = fetch('foods.json')
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((d) => {
          usda = d.foods.map((row) => ({ row, pop: !!row[6], len: norm(row[0]).split(' ').length, words: norm(row[0] + (row[6] ? ' ' + row[6] : '')).split(' ') }));
          return usda;
        })
        .catch((e) => { usdaPromise = null; throw e; });
    }
    return usdaPromise;
  }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  // "eggs" -> "egg", "berries" -> "berr" (still prefixes "berry"/"berries")
  const stem = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const qTokens = (q) => norm(q).split(' ').filter(Boolean).map(stem);

  // Words that make an entry a worse default pick unless asked for.
  const NOISE = /\b(babyfood|infant|formula|imitation|dehydrated|freeze dried|canned|frozen|commercial|prepared from recipe|with salt|without salt|industrial|mechanically separated|by product)\b/;
  const GOOD = /\b(raw|cooked|roasted|boiled|baked|grilled|broiled|steamed|plain|whole|fresh|meat only|skinless)\b/;

  function scoreName(words, name, tokens, pop, len = words.length) {
    let score = pop ? 55 : 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // prefer a whole-word match ("beer") over a prefix of a longer word ("beerwurst")
      let idx = words.findIndex((w) => w === t || stem(w) === t);
      const exact = idx >= 0;
      if (!exact) idx = words.findIndex((w) => w.startsWith(t));
      if (idx < 0) return null;
      score += idx === 0 ? 30 : Math.max(2, 14 - idx);
      score += exact ? 14 : -6;
    }
    if (/[A-Z]{3,}/.test(name) && !tokens.some((t) => name.toLowerCase().includes(t) && /[A-Z]{3,}/.test(name.slice(name.toLowerCase().indexOf(t), name.toLowerCase().indexOf(t) + t.length)))) score -= 8;
    const n = name.toLowerCase();
    if (n.startsWith(tokens[0])) score += 15;
    score -= len * 1.2;
    if (NOISE.test(n)) score -= 12;
    if (GOOD.test(n)) score += 4;
    return score;
  }

  function fromUSDA(row) {
    const [name, k, p, c, f, portions] = row;
    return { name, brand: '', source: 'USDA', per100: { k, p, c, f }, perServing: null, portions: (portions || []).map(([l, g]) => [l, g]) };
  }

  async function searchCommon(q, limit = 12) {
    const tokens = qTokens(q);
    if (!tokens.length) return [];
    const db = await loadUSDA();
    const hits = [];
    for (const item of db) {
      const s = scoreName(item.words, item.row[0], tokens, item.pop, item.len);
      if (s !== null) hits.push([s, item.row]);
    }
    hits.sort((a, b) => b[0] - a[0]);
    return hits.slice(0, limit).map(([, row]) => fromUSDA(row));
  }

  // Your own foods (from food log history): unique by name, most recent first.
  function searchHistory(q, history, limit = 6) {
    const tokens = qTokens(q);
    const seen = new Set(), out = [];
    [...history].sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))).forEach((f) => {
      const key = f.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const words = norm(f.name).split(' ');
      if (tokens.length && !tokens.every((t) => words.some((w) => w.startsWith(t)))) return;
      out.push(f);
    });
    return out.slice(0, limit).map((f) => ({
      name: f.name, brand: '', source: 'Mine', entry: f, per100: null,
      perServing: { k: f.kcal || 0, p: f.protein || 0, c: f.carbs || 0, f: f.fat || 0 },
      portions: [[f.serving || '1 serving', null]],
    }));
  }

  // ---------- Open Food Facts ----------
  const OFF_FIELDS = 'code,product_name,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity,quantity';
  const kcalOf = (n, sfx) => {
    const kc = n['energy-kcal' + sfx];
    if (kc != null && kc !== '') return Number(kc);
    const kj = n['energy-kj' + sfx] ?? n['energy' + sfx];
    return kj != null && kj !== '' ? Number(kj) / 4.184 : null;
  };
  function fromOFF(p) {
    const n = p.nutriments || {};
    const name = (p.product_name_en || p.product_name || p.generic_name || '').trim();
    if (!name) return null;
    const k100 = kcalOf(n, '_100g');
    const per100 = k100 != null ? { k: k100, p: +n.proteins_100g || 0, c: +n.carbohydrates_100g || 0, f: +n.fat_100g || 0 } : null;
    const kS = kcalOf(n, '_serving');
    const perServing = kS != null ? { k: kS, p: +n.proteins_serving || 0, c: +n.carbohydrates_serving || 0, f: +n.fat_serving || 0 } : null;
    if (!per100 && !perServing) return null;
    const sq = Number(p.serving_quantity);
    const portions = [];
    if (sq > 0 && per100) portions.push([`1 serving${p.serving_size ? ' (' + p.serving_size + ')' : ''}`, sq]);
    else if (perServing) portions.push([`1 serving${p.serving_size ? ' (' + p.serving_size + ')' : ''}`, null]);
    const brand = (p.brands || '').split(',')[0].trim();
    return { name, brand, source: 'Open Food Facts', code: p.code, per100, perServing: per100 && sq > 0 ? null : perServing, portions };
  }

  async function searchPackaged(q, limit = 15) {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${limit + 10}&fields=${OFF_FIELDS}`;
    // Open Food Facts is a free, volunteer-run service and sometimes answers "busy" (which browsers
    // report as a failed/CORS-blocked request). Retry once before giving up.
    let res;
    try { res = await fetch(url); if (!res.ok && res.status !== 404) throw new Error('busy'); }
    catch (_) {
      await new Promise((r) => setTimeout(r, 1500));
      try { res = await fetch(url); } catch (e) { throw new Error('Open Food Facts didn\'t respond. It\'s a free service and sometimes busy — try again in a moment.'); }
    }
    if (res.status === 429) throw new Error('Too many searches — wait a minute and try again');
    if (!res.ok) throw new Error('Open Food Facts is busy (HTTP ' + res.status + ')');
    const data = await res.json();
    return (data.products || []).map(fromOFF).filter(Boolean).slice(0, limit);
  }

  async function byBarcode(code) {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Lookup failed (HTTP ' + res.status + ')');
    const data = await res.json();
    if (data.status === 0 || !data.product) return null;
    return fromOFF({ code, ...data.product });
  }

  // ---------- barcode scanning ----------
  // Native BarcodeDetector on Android Chrome; a WASM polyfill (loaded on demand) elsewhere, e.g. iPhone.
  const POLYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/iife/polyfill.js';
  let polyPromise = null;
  function ensureDetector() {
    if ('BarcodeDetector' in window) return Promise.resolve();
    if (!polyPromise) {
      polyPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = POLYFILL; s.async = true;
        s.onload = () => ('BarcodeDetector' in window ? resolve() : reject(new Error('Scanner unavailable')));
        s.onerror = () => { polyPromise = null; reject(new Error('Could not load the scanner (are you online?)')); };
        document.head.appendChild(s);
      });
    }
    return polyPromise;
  }

  let stream = null, timer = null, active = false;
  async function startScanner(video, onCode, onError) {
    stopScanner();
    active = true;
    try {
      await ensureDetector();
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      if (!active) { stopScanner(); return; }
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      await video.play();
      const tick = async () => {
        if (!active) return;
        try {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video);
            const hit = codes.find((c) => /^\d{8,14}$/.test(c.rawValue));
            if (hit) { stopScanner(); if (navigator.vibrate) navigator.vibrate(60); onCode(hit.rawValue); return; }
          }
        } catch (_) { /* keep trying */ }
        timer = setTimeout(tick, 220);
      };
      tick();
    } catch (e) {
      stopScanner();
      const msg = e && e.name === 'NotAllowedError' ? 'Camera permission was denied. You can type the barcode number instead.'
        : e && e.name === 'NotFoundError' ? 'No camera found. Type the barcode number instead.' : (e && e.message) || 'Camera unavailable';
      onError(msg);
    }
  }
  function stopScanner() {
    active = false;
    clearTimeout(timer);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  // ---------- portion math ----------
  // Returns {k,p,c,f} for `qty` of portion index `pi` (pi === -1 means grams).
  function nutrition(food, pi, qty) {
    qty = Number(qty) || 0;
    if (pi === -1) {
      const b = food.per100;
      return b ? scale(b, qty / 100) : null;
    }
    const [, grams] = food.portions[pi] || [];
    if (grams && food.per100) return scale(food.per100, (grams * qty) / 100);
    if (food.perServing) return scale(food.perServing, qty);
    return null;
  }
  const scale = (b, m) => ({ k: Math.round(b.k * m), p: r1(b.p * m), c: r1(b.c * m), f: r1(b.f * m) });
  const r1 = (n) => Math.round(n * 10) / 10;

  function defaultPortion(food) {
    if (!food.portions.length) return -1;
    const pref = /\b(medium|large|serving|slice|piece|breast|fillet|scoop|bar|container|bottle|can|patty|link|egg|oz)\b/i;
    const i = food.portions.findIndex(([l]) => pref.test(l));
    return i >= 0 ? i : 0;
  }

  // Shorten verbose USDA names for the log: "Chicken, broilers or fryers, breast, meat only, cooked, roasted"
  // -> "Chicken, breast, meat only, cooked, roasted"
  function displayName(food) {
    if (food.source !== 'USDA') return food.brand && !food.name.toLowerCase().includes(food.brand.toLowerCase()) ? `${food.name} (${food.brand})` : food.name;
    return food.name.replace(/ ?\(Includes foods for USDA's Food Distribution Program\)/i, '').replace(/, broilers or fryers/i, '').replace(/, (enriched|unenriched|all commercial varieties|without salt|NFS)(?=,|$)/gi, '');
  }

  window.FoodLookup = { loadUSDA, searchCommon, searchHistory, searchPackaged, byBarcode, startScanner, stopScanner, nutrition, defaultPortion, displayName };
})();
