# AI plan import setup (one time)

Lets the coach upload a PDF, Word (.docx), Excel (.xlsx), CSV/text or a photo of a program and get a GRIT plan.

1. **Anthropic API key:** at https://console.anthropic.com create an account, add a little credit (Billing),
   then API Keys → Create key. Copy it (starts with `sk-ant-`).
2. **Supabase → Edge Functions → Secrets:** add `ANTHROPIC_API_KEY` with that key.
3. **SQL Editor:** run `supabase/schema.sql` (adds the `plan_imports` table).
4. **Edge Functions → Deploy a new function → Via Editor:** name it `import-plan`, paste `index.ts` from this
   folder, Deploy.
5. In GRIT: Coach dashboard → Plan library → **Upload** → pick the file → **Convert with AI**. It appears under
   **AI imports**; when it says Ready, tap **Review**, check it in the plan editor, and Save / publish.

Cost: roughly 10¢–$1 per program (Claude Opus 5.5 at batch pricing). Most imports finish in a few minutes.
Very long programs (several months in one file) may need splitting into smaller files.
