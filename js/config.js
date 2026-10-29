/* Supabase public client configuration.
   Never put a service_role or secret key in frontend code. */
window.CINEVERSE_CONFIG={SUPABASE_URL:"https://bqvlkprluentrsovfpcy.supabase.co",SUPABASE_ANON_KEY:"sb_publishable_7Kna5pXHrSnKiO_s8Wr3bA_T5AAj4me"};
window.cineverseSupabase=null;
(()=>{const c=window.CINEVERSE_CONFIG;if(window.supabase&&c.SUPABASE_URL.startsWith("https://")&&c.SUPABASE_ANON_KEY&&!c.SUPABASE_URL.includes("YOUR_")&&!c.SUPABASE_ANON_KEY.includes("YOUR_"))window.cineverseSupabase=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY);})();
