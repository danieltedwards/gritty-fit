// GRIT backend settings. The publishable key is designed to be public: access is
// controlled by the row-level security rules in supabase/schema.sql.
window.GRIT_CONFIG = {
  supabaseUrl: 'https://brinlhdxwtkyqrmdhvbt.supabase.co',
  supabaseKey: 'sb_publishable_FRQFl71OHsVW05J_-iuGaA_UGqj3Zpm',
  // public half of the web-push key pair (the private half is only in Supabase Edge Function secrets)
  vapidPublicKey: 'BCe9edDQwYhlvYrHE05EGI52Fq4wnD_T9byef31-OnfiKgx5uAhiUHQlbPXtkWlb7-3PtDDTW9u4JEkmpNSSVl4',
};
