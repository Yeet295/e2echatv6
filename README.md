# Anonymous E2E Chat — accounts, roster, DMs, connect gate, admin panel

## What's new: Admin panel

- A small "⚙ admin" link, top-right of the page.
- Click it, enter the admin password once — your browser is now an
  admin (remembered via your account cookie, no need to re-enter it
  again unless you clear cookies).
- Once unlocked, the panel lets you set the site's title (shown as the
  big heading) and a background image (any direct image URL) — applies
  live to everyone visiting the site, no code changes needed.
- Set your own password via the ADMIN_PASSWORD environment variable
  before deploying (Render: Dashboard -> Environment). If you don't set
  one, it falls back to an insecure default meant only for local testing.

Note: site settings (title/background) live in the server's memory —
they reset if the server restarts or redeploys. Say the word if you'd
like these to persist properly across restarts instead.

## Local setup

1. `npm install`
2. `ADMIN_PASSWORD=your-own-password npm start`
3. Open http://localhost:8080, click "⚙ admin", enter that password
4. Set a title and/or background image URL, click Apply

## Deploying

Push to GitHub, Manual Deploy on Render as usual. Add ADMIN_PASSWORD
as an environment variable on Render too, matching what you use locally.
