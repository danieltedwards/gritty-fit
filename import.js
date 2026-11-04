// GRIT: AI plan import (coach). PDF, Word (.docx), Excel (.xlsx), CSV/text and photos of programs are sent to the
// import-plan Edge Function, where Claude turns them into a GRIT plan. Word/Excel/text are read here in the
// browser (small, no extra libraries); PDFs and photos are sent as they are. Results wait in "AI imports" on the
// Coach dashboard until the coach reviews them in the plan editor.
(function () {
  let C, sb = null;
  const st = { list: null, loading: false, polling: null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getSb = () => sb || (sb = window.Cloud && Cloud._sb ? Cloud._sb() : null);
  const MAX_TEXT = 500000; // characters (~125k tokens)

  // ---------- reading files ----------
  const ext = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  // minimal zip reader (docx/xlsx are zip files): returns {name: Uint8Array} for the requested names
  async function unzip(buf, want) {
    const u = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This file looks damaged (not a valid .docx/.xlsx)');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const td = new TextDecoder(), files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = td.decode(u.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (!want(name)) continue;
      const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
      const data = u.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
      files[name] = method === 8 ? await inflate(data) : method === 0 ? data : null;
    }
    return files;
  }
  const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  async function docxText(buf) {
    const f = await unzip(buf, (n) => n === 'word/document.xml');
    if (!f['word/document.xml']) throw new Error('No document text found in this Word file');
    const xml = new TextDecoder().decode(f['word/document.xml']);
    return decodeXml(xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>\s*<\/w:tc>/g, ' | ').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''))
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  async function xlsxText(buf) {
    const f = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const td = new TextDecoder();
    const shared = f['xl/sharedStrings.xml'] ? [...td.decode(f['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))) : [];
    const names = f['xl/workbook.xml'] ? [...td.decode(f['xl/workbook.xml']).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decodeXml(m[1])) : [];
    const sheets = Object.keys(f).filter((n) => /worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);
    const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const out = [];
    sheets.forEach((sn, si) => {
      const xml = td.decode(f[sn]); const rows = [];
      for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1], inner = c[2] || '';
          const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1]; const t = (attrs.match(/t="(\w+)"/) || [])[1];
          let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (t === 's' && v != null) v = shared[+v];
          else if (t === 'inlineStr') v = decodeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
          else if (v != null) v = decodeXml(v);
          if (v != null && v !== '' && ref) cells[col(ref)] = v;
        }
        if (cells.some((x) => x != null && String(x).trim())) rows.push(Array.from(cells, (x) => (x == null ? '' : String(x).replace(/\s+/g, ' ').trim())).join('\t'));
      }
      if (rows.length) out.push(`=== Sheet: ${names[si] || 'Sheet ' + (si + 1)} ===\n${rows.join('\n')}`);
    });
    if (!out.length) throw new Error('No cells with text found in this spreadsheet');
    return out.join('\n\n');
  }
  async function shrinkImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image couldn\'t be opened. Use JPG or PNG')); i.src = url; });
      const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
    } finally { URL.revokeObjectURL(url); }
  }
  async function readFile(file) {
    const e = ext(file.name);
    if (e === 'pdf' || file.type === 'application/pdf') {
      if (file.size > 24 * 1024 * 1024) throw new Error('PDF is over 24 MB. Split it or export a smaller copy');
      return { kind: 'pdf', data: b64(await file.arrayBuffer()), label: 'PDF' };
    }
    if (/^(jpe?g|png|webp|gif)$/.test(e) || /^image\/(jpeg|png|webp|gif)$/.test(file.type)) return { kind: 'image', mediaType: 'image/jpeg', data: await shrinkImage(file), label: 'Photo' };
    if (/^(heic|heif)$/.test(e)) throw new Error('iPhone HEIC photos aren\'t supported yet. Share it as JPG (or take a screenshot) and upload that');
    if (e === 'docx') return { kind: 'text', data: await docxText(await file.arrayBuffer()), label: 'Word document' };
    if (e === 'xlsx' || e === 'xlsm') return { kind: 'text', data: await xlsxText(await file.arrayBuffer()), label: 'Spreadsheet' };
    if (e === 'doc' || e === 'xls' || e === 'pages' || e === 'numbers') throw new Error(`.${e} files can't be read. Save it as PDF, .docx or .xlsx (File → Save As / Export) and upload that`);
    if (/^(csv|tsv|txt|md|text|rtf)$/.test(e) || /^text\//.test(file.type)) return { kind: 'text', data: await file.text(), label: 'Text' };
    throw new Error('Unsupported file type. Use PDF, Word (.docx), Excel (.xlsx), CSV/text, JSON or a JPG/PNG photo');
  }

  // ---------- server calls ----------
  async function call(body) {
    const { data, error } = await sb.functions.invoke('import-plan', { body });
    if (error) {
      let msg = error.message || String(error);
      try { const j = error.context && typeof error.context.json === 'function' ? await error.context.json() : null; if (j && j.error) msg = j.error; } catch (_) { /* keep message */ }
      if (/Failed to send|not found|404|FunctionsFetchError|FunctionsRelayError/i.test(msg)) msg = 'The import-plan function isn\'t set up in Supabase yet (see the setup steps)';
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  async function loadList() {
    const { data, error } = await sb.from('plan_imports').select('id,filename,status,error,result,created_at,updated_at').order('created_at', { ascending: false }).limit(20);
    st.list = error ? [] : (data || []);
    schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(st.polling);
    if (!(st.list || []).some((x) => x.status === 'processing')) return;
    st.polling = setTimeout(async () => {
      if (C.ui.tab !== 'coach' || document.visibilityState !== 'visible') { schedulePoll(); return; }
      for (const x of st.list.filter((i) => i.status === 'processing')) {
        try { const r = await call({ action: 'check', id: x.id }); Object.assign(x, r); } catch (_) { /* try again next round */ }
      }
      if (C.ui.tab === 'coach') C.render();
      schedulePoll();
    }, 20000);
  }

  // ---------- UI ----------
  async function start(files) {
    const items = [];
    for (const f of files) {
      try { const r = await readFile(f); if (r.kind === 'text' && r.data.length > MAX_TEXT) r.data = r.data.slice(0, MAX_TEXT); items.push(Object.assign({ name: f.name, size: f.size }, r)); }
      catch (e) { items.push({ name: f.name, error: e.message }); }
    }
    const ok = items.filter((x) => !x.error);
    C.openModal(`<h2>Convert with AI</h2>
      <p class="sub" style="margin-top:0">Claude reads ${ok.length === 1 ? 'the file' : 'each file'} and builds a GRIT plan. It usually takes a few minutes (up to an hour when busy). You'll review it in the plan editor before anyone sees it.</p>
      <ul class="list">${items.map((x) => `<li><div class="grow"><div class="title">${esc(x.name)}</div><div class="meta ${x.error ? 'bad' : ''}">${x.error ? esc(x.error) : `${esc(x.label)}${x.kind === 'text' ? ` · ${x.data.length < 1000 ? x.data.length + ' characters' : Math.round(x.data.length / 1000) + 'k characters'}` : ''}`}</div></div></li>`).join('')}</ul>
      ${ok.length ? C.field('Notes for the AI (optional)', '<textarea name="notes" rows="3" placeholder="e.g. 12 weeks, 4 days a week. Percentages are of 1RM. Week 4 and 8 are deloads. Days 1–4 = Mon/Tue/Thu/Fri."></textarea>') : ''}
      <p class="hint">Cost: roughly 10¢–$1 per program in Anthropic API usage, billed to your Anthropic account.</p>`, ok.length ? async (fd) => {
      const notes = String(fd.get('notes') || '').trim();
      let started = 0; const errs = [];
      for (const x of ok) {
        try { C.toast(`Sending ${x.name}…`); await call({ action: 'start', filename: x.name, kind: x.kind, mediaType: x.mediaType, data: x.data, notes }); started++; }
        catch (e) { errs.push(`${x.name}: ${e.message}`); }
      }
      if (errs.length) { C.toast(errs.join(' · ')); if (!started) return false; }
      else C.toast(`Converting ${started} file${started === 1 ? '' : 's'}. Find ${started === 1 ? 'it' : 'them'} under AI imports`);
      await loadList(); C.render();
    } : null, ok.length ? { saveLabel: 'Convert with AI' } : { hideSave: true });
  }
  function card() {
    if (!getSb()) return '';
    if (st.list === null) { if (!st.loading) { st.loading = true; loadList().then(() => { st.loading = false; if (st.list.length && C.ui.tab === 'coach') C.render(); }); } return ''; }
    if (!st.list.length) return '';
    return `<div class="card"><div class="card-head"><h2>AI imports</h2></div><ul class="list">${st.list.map((x) => `<li><div class="grow" style="min-width:0"><div class="title">${esc(x.result && x.result.name ? x.result.name : x.filename || 'Upload')}</div>
      <div class="meta">${x.status === 'processing' ? '⏳ Converting… (checks every 20 seconds)' : x.status === 'error' ? `<span class="bad">${esc(x.error || 'Failed')}</span>` : x.status === 'used' ? 'Saved to your library ✓' : `Ready · ${(x.result.days || []).length} days · ${x.result.weeks || 1} week${(x.result.weeks || 1) === 1 ? '' : 's'}`} · ${esc(x.filename || '')}</div></div>
      ${x.status === 'done' ? `<button class="btn small primary" data-action="import-review" data-id="${x.id}">Review</button>` : ''}<button class="del" data-action="import-del" data-id="${x.id}" aria-label="Remove">×</button></li>`).join('')}</ul></div>`;
  }
  const actions = {
    'import-review': async (el) => {
      const x = (st.list || []).find((i) => i.id === el.dataset.id); if (!x || !x.result) return;
      const data = JSON.parse(JSON.stringify(x.result));
      const existing = ((Cloud.coachData && Cloud.coachData() && Cloud.coachData().plans) || []).map((p) => p.id);
      let id = String(data.id || data.name || 'imported-plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'imported-plan', n = 2;
      while (existing.includes(id)) id = `${data.id || 'imported-plan'}-${n++}`;
      data.id = id; data.schema = data.schema || 1; data.tags = [...new Set([...(data.tags || []), 'Imported'])];
      Editor.open({ data, isNew: true, row: { visibility: 'all', published: false } });
      C.toast('Check it over, then Save. It stays hidden from clients until you publish it');
    },
    'import-del': async (el) => {
      if (!confirm('Remove this import from the list?')) return;
      await sb.from('plan_imports').delete().eq('id', el.dataset.id);
      st.list = (st.list || []).filter((i) => i.id !== el.dataset.id); C.render();
    },
  };
  window.Import = {
    init(ctx) { C = ctx; Object.assign(ctx.actions, actions); },
    start, card, readFile,
    reset() { st.list = null; clearTimeout(st.polling); },
  };
})();
