// Tiny dependency-free SVG charts.
(function () {
  const W = 340, H = 170, PAD = { l: 34, r: 10, t: 12, b: 24 };

  function niceRange(min, max) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.12;
    return [min - pad, max + pad];
  }

  function shortDate(iso) {
    const [, m, d] = iso.split('-');
    return `${+m}/${+d}`;
  }

  // points: [{ x: 'YYYY-MM-DD', y: number }] sorted by x
  function line(points, opts = {}) {
    if (!points.length) return `<div class="empty">${opts.empty || 'No data yet'}</div>`;
    const t0 = Date.parse(points[0].x), t1 = Date.parse(points[points.length - 1].x);
    const span = Math.max(t1 - t0, 1);
    const ys = points.map((p) => p.y);
    if (opts.goal != null) ys.push(opts.goal);
    const [ymin, ymax] = niceRange(Math.min(...ys), Math.max(...ys));
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const X = (x) => PAD.l + (points.length === 1 ? iw / 2 : ((Date.parse(x) - t0) / span) * iw);
    const Y = (y) => PAD.t + (1 - (y - ymin) / (ymax - ymin)) * ih;
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    const area = `${d}L${X(points[points.length - 1].x).toFixed(1)},${PAD.t + ih}L${X(points[0].x).toFixed(1)},${PAD.t + ih}Z`;
    const dec = opts.decimals ?? 1;
    const ticks = [ymin + (ymax - ymin) * 0.15, (ymin + ymax) / 2, ymax - (ymax - ymin) * 0.15];
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label || 'chart'}">`;
    ticks.forEach((t) => {
      s += `<line class="axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(t)}" y2="${Y(t)}" opacity=".6"/>`;
      s += `<text x="${PAD.l - 4}" y="${Y(t) + 4}" text-anchor="end">${t.toFixed(dec === 0 ? 0 : 1)}</text>`;
    });
    if (opts.goal != null) s += `<line class="goal" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(opts.goal)}" y2="${Y(opts.goal)}"/>`;
    if (points.length > 1) s += `<path class="area" d="${area}"/>`;
    s += `<path class="line" d="${d}"/>`;
    const showDots = points.length <= 40;
    points.forEach((p, i) => {
      if (showDots || i === points.length - 1) s += `<circle class="dot" cx="${X(p.x)}" cy="${Y(p.y)}" r="${i === points.length - 1 ? 4 : 2.5}"><title>${shortDate(p.x)}: ${p.y}</title></circle>`;
    });
    s += `<text x="${PAD.l}" y="${H - 6}">${shortDate(points[0].x)}</text>`;
    if (points.length > 1) s += `<text x="${W - PAD.r}" y="${H - 6}" text-anchor="end">${shortDate(points[points.length - 1].x)}</text>`;
    return s + '</svg>';
  }

  // bars: [{ label, value }], target optional
  function bars(data, opts = {}) {
    if (!data.length || data.every((b) => !b.value)) return `<div class="empty">${opts.empty || 'No data yet'}</div>`;
    const max = Math.max(...data.map((b) => b.value), opts.target || 0) * 1.1 || 1;
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const bw = iw / data.length;
    const Y = (v) => PAD.t + (1 - v / max) * ih;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label || 'chart'}">`;
    s += `<line class="axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + ih}" y2="${PAD.t + ih}"/>`;
    s += `<text x="${PAD.l - 4}" y="${PAD.t + 8}" text-anchor="end">${Math.round(max)}</text>`;
    data.forEach((b, i) => {
      const x = PAD.l + i * bw + bw * 0.18, w = bw * 0.64;
      const over = opts.target && opts.overIsBad && b.value > opts.target * 1.05;
      if (b.value) s += `<rect class="bar${over ? ' over' : ''}" x="${x}" y="${Y(b.value)}" width="${w}" height="${PAD.t + ih - Y(b.value)}" rx="3"><title>${b.label}: ${b.value}</title></rect>`;
      if (data.length <= 14 || i % Math.ceil(data.length / 7) === 0) s += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${b.label}</text>`;
    });
    if (opts.target) s += `<line class="target" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(opts.target)}" y2="${Y(opts.target)}"/>`;
    return s + '</svg>';
  }

  function ring(value, target, size = 96) {
    const r = size / 2 - 8, c = 2 * Math.PI * r;
    const pct = target ? Math.min(value / target, 1) : 0;
    const over = target && value > target;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${over ? 'var(--warn)' : 'var(--accent)'}" stroke-width="10"
        stroke-linecap="round" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="54%" text-anchor="middle" font-size="18" font-weight="800" fill="var(--text)">${Math.round(pct * 100)}%</text>
    </svg>`;
  }

  function spark(points, w = 120, h = 36) {
    if (points.length < 2) return '';
    const ys = points.map((p) => p.y);
    const min = Math.min(...ys), max = Math.max(...ys), rng = max - min || 1;
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((p.y - min) / rng) * (h - 6)).toFixed(1)}`).join('');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  window.Charts = { line, bars, ring, spark, shortDate };
})();
