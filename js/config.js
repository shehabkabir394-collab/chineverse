/* Replace placeholders with your Supabase Project URL and publishable/anon key.
   NEVER put a service_role or secret key in frontend code. */
window.CINEVERSE_CONFIG={SUPABASE_URL:"YOUR_SUPABASE_PROJECT_URL",SUPABASE_ANON_KEY:"YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"};
window.cineverseSupabase=null;
(()=>{const c=window.CINEVERSE_CONFIG;if(window.supabase&&c.SUPABASE_URL.startsWith("https://")&&c.SUPABASE_ANON_KEY&&!c.SUPABASE_URL.includes("YOUR_")&&!c.SUPABASE_ANON_KEY.includes("YOUR_"))window.cineverseSupabase=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY);})();
