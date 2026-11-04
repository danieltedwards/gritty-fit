// GRIT: AI plan import. The coach uploads a PDF, Word/Excel export, text or photo of a program; Claude turns it
// into a GRIT plan (JSON), which the coach reviews in the plan editor before publishing.
// Runs as a Message Batch so long programs never hit the function time limit (and it costs half).
//   POST {action:"start", filename, kind:"pdf"|"image"|"text", mediaType?, data, notes?}  -> {id}
//   POST {action:"check", id}                                                          -> import row
// Secret to set in Supabase → Edge Functions → Secrets: ANTHROPIC_API_KEY
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'claude-opus-5-5';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = `You convert workout programs into GRIT plan files. GRIT is a coaching app; a plan is one JSON object.

Output ONLY the JSON object: no markdown fences, no commentary.

Plan format:
{
  "schema": 1, "id": "kebab-case-unique-id", "name": "Program name", "phase": "e.g. 12-week strength block",
  "subtitle": "e.g. 4 days a week", "weeks": <number of weeks>, "daysPerWeek": "4", "tags": ["Strength", ...],
  "summary": "1-3 sentences, plain language",
  "weekGuide": [{"weeks":[1,2,3], "label":"Build", "effort":"RPE 7-8", "note":"short", "deload": false}],
  "warmups": {"wu-lower": {"name":"Lower warm-up", "note":"optional", "items":[{"name":"Hip airplanes","dose":"5 each"}]}},
  "days": [ <day>, ... ],                       // week 1
  "schedule": [{"weeks":[1], "days":[...]}, {"weeks":[2,3], "days":[...]}],   // ONLY if days change week to week
  "sections": [{"title":"How to run this plan", "body":[{"p":"..."}, {"ul":["...","..."]}]}]
}
Day: {"id":"d1", "label":"Day 1", "name":"Lower strength", "focus":"optional one line", "warmup":"wu-lower" (optional key into warmups),
      "instructions":"optional free text, one paragraph per line (conditioning options, cool-down, notes)", "blocks":[ <block>, ... ]}
Block: {"type":"single"|"superset", "name":"optional (e.g. 'A', 'Finisher', 'AMRAP x 12 min', '3 rounds for time', 'EMOM x 10 min')",
        "note":"optional instructions for the block", "rest":"optional, after a superset round", "exercises":[ <exercise>, ... ]}
Exercise: {"id":"kebab-id", "name":"Back Squat", "sets":4, "reps":"6" (string: "8-10", "5/3/1", "30 sec", "400m", "max"),
           "role":"main"|"accessory"|"isolation"|"core", "rest":"2 min", "tempo":"3110", "each":true (per side), "effort":"RPE 8",
           "notes":"cues / load / substitutions", "bodyweight":true,
           "pct":0.75 or [0.7,0.75] with "of":"squat"|"bench"|"deadlift"|"press"|"fsquat"|"snatch"|"clean"|"jerk"|"cj"|"pullup" (when load is a % of a max),
           "scheme":[{"sets":1,"reps":"5","pct":0.75},{"sets":1,"reps":"3","pct":0.85}] (when sets differ in reps or %; keep sets/reps as totals)}

Rules:
- Keep every exercise, set, rep, percentage, rest, tempo and note the program gives. Do not invent training content; leave fields out rather than guess.
- Use the same day ids (d1, d2...) and the same exercise id for the same exercise across weeks, so the app can show "last time".
- Exercise ids must be unique within a day (add -2, -3 when an exercise appears twice).
- Supersets/circuits/giant sets: one "superset" block. Straight sets: one "single" block per exercise.
- Conditioning pieces (AMRAP, for time, EMOM, Tabata, intervals): one block whose "name" states the format and time cap, e.g. "AMRAP x 12 min", "For time (cap 15 min)", "EMOM x 10 min"; movements as exercises with their reps; Rx loads in notes. The app scores these automatically from the block name.
- Warm-ups and cool-downs: warm-ups go in "warmups" and are referenced from the day; cool-downs and extra notes go in day "instructions".
- If weeks repeat identically, use only "days". If they change, use "schedule" with consecutive identical weeks grouped, and put week 1 in "days" too.
- Write "summary" and "sections" in your own words (short, plain, practical). Never copy long passages of the source text.
- If the document is a single workout, make a 1-week plan with one day.
- If the document is not a training program, return {"error":"short reason"}.`;

async function userFrom(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data } = await anon.auth.getUser();
  return data && data.user;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: 'Sign in first' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: prof } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!prof || prof.role !== 'coach') return json({ error: 'Only the coach can import plans' }, 403);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase Edge Function secrets' }, 500);
  const client = new Anthropic();
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  if (body.action === 'start') {
    const { filename = 'upload', kind, mediaType, data, notes } = body;
    if (!data || !['pdf', 'image', 'text'].includes(kind)) return json({ error: 'Nothing to import' }, 400);
    const source: any[] = kind === 'pdf'
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }]
      : kind === 'image'
        ? [{ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data } }]
        : [{ type: 'text', text: `File: ${filename}\n\n${String(data)}` }];
    const ask = `Convert this program into a GRIT plan.${notes ? `\n\nNotes from the coach: ${String(notes).slice(0, 2000)}` : ''}`;
    try {
      const batch = await client.messages.batches.create({
        requests: [{
          custom_id: 'plan',
          params: {
            model: MODEL,
            max_tokens: 64000,
            output_config: { effort: 'medium' },
            system: SYSTEM,
            messages: [{ role: 'user', content: [...source, { type: 'text', text: ask }] }],
          },
        }],
      });
      const { data: row, error } = await db.from('plan_imports').insert({ coach_id: user.id, filename: String(filename).slice(0, 200), status: 'processing', batch_id: batch.id, notes: notes || null }).select('id').single();
      if (error) return json({ error: error.message }, 500);
      return json({ id: row.id });
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) return json({ error: 'The file could not be read: ' + e.message }, 400);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key is invalid' }, 500);
      if (e instanceof Anthropic.RateLimitError) return json({ error: 'Too many requests right now. Try again in a minute' }, 429);
      if (e instanceof Anthropic.APIError) return json({ error: `AI service error ${e.status}` }, 502);
      throw e;
    }
  }

  if (body.action === 'check') {
    const { data: row } = await db.from('plan_imports').select('*').eq('id', body.id).eq('coach_id', user.id).maybeSingle();
    if (!row) return json({ error: 'Import not found' }, 404);
    if (row.status !== 'processing') return json(row);
    const batch = await client.messages.batches.retrieve(row.batch_id);
    if (batch.processing_status !== 'ended') return json(row);
    let update: any = { status: 'error', error: 'No result came back', updated_at: new Date().toISOString() };
    for await (const r of await client.messages.batches.results(row.batch_id)) {
      if (r.result.type === 'succeeded') {
        const msg = r.result.message;
        if (msg.stop_reason === 'refusal') { update.error = 'The AI declined to convert this file'; break; }
        if (msg.stop_reason === 'max_tokens') { update.error = 'The program was too long to convert in one go. Split it into smaller files (e.g. one phase or month each)'; break; }
        const text = msg.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim();
        const start = text.indexOf('{'), end = text.lastIndexOf('}');
        let plan: any = null;
        try { plan = JSON.parse(text.slice(start, end + 1)); } catch { update.error = 'The AI answer was not valid plan JSON. Try again'; break; }
        if (plan && plan.error) { update.error = String(plan.error); break; }
        if (!plan || !plan.name || !Array.isArray(plan.days) || !plan.days.length) { update.error = 'The AI answer had no workout days. Try again with notes about the program'; break; }
        update = { status: 'done', result: plan, error: null, updated_at: new Date().toISOString(), tokens: (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0) };
      } else if (r.result.type === 'errored') {
        update.error = r.result.error.error.type === 'invalid_request_error' ? 'The file could not be processed' : 'The AI service had an error. Try again';
      } else if (r.result.type === 'expired') {
        update.error = 'The import timed out. Try again';
      }
    }
    const { data: saved } = await db.from('plan_imports').update(update).eq('id', row.id).select('*').single();
    if (update.status === 'done') {
      await db.from('notifications').insert({ user_id: user.id, kind: 'plan', title: 'Plan import ready', body: `${update.result.name}: review and publish it`, link: { tab: 'coach' } });
    }
    return json(saved || Object.assign(row, update));
  }
  return json({ error: 'Unknown action' }, 400);
});
