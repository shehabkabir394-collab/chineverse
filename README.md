# CineVerse 4K — Free starter

Responsive bilingual movie catalog built with HTML/CSS/JavaScript, Cloudflare Pages, GitHub and Supabase. This project stores movie metadata and authorized external links; it does not host movie files.

## Included
- `index.html`: homepage, search, genre/quality filters and movie cards
- `movie.html`: full movie details
- `admin.html`: admin login and catalog CRUD
- `css/style.css`: responsive dark cinematic design
- `js/config.js`: Supabase browser configuration
- `js/app.js`, `js/movie.js`, `js/admin.js`: app behavior
- `supabase/schema.sql`: tables, indexes and RLS policies

## 1. Supabase setup
1. Create a project at https://supabase.com/dashboard.
2. Open SQL Editor, paste `supabase/schema.sql`, and run it.
3. Find the Project URL and publishable key (or legacy anon key) in Project Settings/API.
4. Replace the two placeholders in `js/config.js`.
5. Never put a `service_role` or secret key in browser code. RLS protects data.

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
