# CineVerse 4K — Free starter

Responsive bilingual movie catalog built with HTML/CSS/JavaScript, Cloudflare Pages, GitHub and Supabase. This project stores movie metadata and authorized external links; it does not host movie files.

## Included
- `index.html`: homepage, search, genre/quality filters and movie cards
- `movie.html`: full movie details
- `admin.html`: admin login and catalog CRUD
- `css/style.css`: responsive dark cinematic design
- `js/config.js`: Supabase browser configuration
- `js/app.js`, `js/movie.js`, `js/admin.js`, `js/tmdb-import.js`: app behavior
- `functions/api/tmdb-movies.js`: authenticated TMDB metadata lookup for bulk import
- `js/ads.js`: opt-in, responsive AdSense ad placements (disabled until approved IDs are configured)
- `privacy.html`: starter privacy page to customize before applying to an ad provider
- `supabase/schema.sql`: tables, indexes and RLS policies

## 1. Supabase setup
1. Create a project at https://supabase.com/dashboard.
2. Open SQL Editor, paste `supabase/schema.sql`, and run it.
3. Find the Project URL and publishable key (or legacy anon key) in Project Settings/API.
4. Replace the two placeholders in `js/config.js`.
5. Never put a `service_role` or secret key in browser code. RLS protects data.

## Bulk add movie metadata without CSV
1. In Cloudflare Pages → Settings → Variables and Secrets, add `TMDB_API_READ_ACCESS_TOKEN` as a secret. The same token is used by the watch-provider lookup.
2. Sign in to `/admin.html` with an approved administrator account.
3. Under “Bulk add movie metadata from TMDB,” choose Popular, Now playing, Upcoming, or Top rated, then load 1–5 pages (up to 100 results).
4. Select the titles to add and choose “Import selected.” Existing TMDB IDs and matching title/year records are skipped.
5. Imports contain metadata only. Watch, video, and download links remain empty; add only links you own or have permission to share.

TMDB provides the curated movie lists and metadata. This project already displays TMDB attribution in its credits section. Check TMDB's current terms for your use case; its free developer API is limited to non-commercial use unless separately licensed.

## AdSense setup (only for eligible, rights-cleared content)
1. Apply at Google AdSense using your own site/domain and complete Google's ownership verification and site review. Ads will not serve until the site is approved.
2. Before applying, publish accurate About, Contact, and Privacy pages and make sure the site contains original, useful content and only material you have rights to publish. The privacy page in this starter has a contact placeholder and must be completed.
3. After approval, replace the publisher ID and three ad-unit IDs in `js/ads.js`. The three slots are on the homepage and movie details page. The script does nothing while IDs are placeholders.
4. Add Google's `ads.txt` record at the site root if AdSense requests it. Use the exact record shown in your AdSense account.
5. Keep ad placements clear of buttons and avoid forced redirects, popunders, or asking visitors to click ads. Follow the provider's current policies and applicable privacy/consent rules.

This integration is only a code scaffold. It does not create an AdSense account or guarantee account approval or earnings. Do not monetize copyrighted material or links unless you have permission to publish them.

## 2. Create the first admin
1. In Supabase → Authentication → Users, create/invite your admin account and set a strong password.
2. Copy that user's UUID.
3. In SQL Editor run, replacing the UUID:
   `insert into public.admin_users(user_id) values ('PASTE-AUTH-USER-UUID-HERE');`
4. Sign in at `/admin.html` with that email/password.
5. Admin membership cannot be granted from the public browser UI. Only trusted project owners should modify `admin_users` in SQL Editor.

## 3. Test locally
Use VS Code Live Server, or run `python -m http.server 8000` from this folder and open http://localhost:8000. Test public published entries and admin create/edit/delete.

## 4. GitHub
Create a repository named `cineverse-4k` at https://github.com/new. Upload the contents of this folder, not the zip file itself, or run:
```bash
git init
git add .
git commit -m "Initial CineVerse 4K website"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/cineverse-4k.git
git push -u origin main
```

## 5. Cloudflare Pages
1. Go to https://dash.cloudflare.com/ → Workers & Pages → Create → Pages → Connect to Git.
2. Select your repository and `main` branch.
3. Framework preset: None. Build command: leave blank. Build output directory: repository root (`/` in some dashboard versions).
4. Deploy; Cloudflare gives you a `*.pages.dev` address.
5. Visit the site, test Supabase and admin, then push future changes to redeploy.

## Security and scope
- RLS is enabled on both tables. Public visitors can read only published movies. Approved admins can manage the catalog and read drafts.
- No browser-side admin role assignment exists.
- Only use movie information, posters, trailers, and download links you own or have permission to share.
- Demo homepage cards are placeholders and are not real movie listings.
- Free plans have usage limits and can change; 4K video hosting is not included. This starter links to authorized external sources and does not scrape or host copyrighted videos.
