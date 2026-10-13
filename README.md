# meraki-web

A self-hosted browser client for Meraki. There is no backend: this is a
static HTML/CSS/JS bundle, and every logged-in browser talks to Meraki's
Supabase project directly over HTTPS. The server that serves these files
never sees a password, an access token, or a refresh token — those live
only in each visitor's own browser `localStorage`, exactly as they would
using the official site. See the app's own "Data & Privacy" tab for the
full breakdown of what's read and written.

## Check it out

This is already hosted on [GitHub Pages](https://earth1283.github.io/meraki-web/) and on [Cloudflare Pages](https://meraki-web.josephcui921.workers.dev).

## Run it

```
docker compose up -d --build
```

Serves on `http://<host>:9090`. Point a reverse proxy (Caddy, Traefik,
nginx) at that port for a real domain and TLS — recommended, since this
still serves the page itself over your host, even though login and data
requests go straight to Supabase.

No build step, no Node runtime needed to deploy: `src/*.js` are plain ES
modules loaded directly by the browser.

## Draft recovery

Draft text, quiz answers and quiz timers recover automatically in the same
browser, scoped to the signed-in account. Assignment attachments are kept in
IndexedDB. Settings → Draft recovery & cloud sync chooses local-only
(the default), manual sync, sync after a 5/15/30-second pause, or sync every
30 seconds / 1 minute / 5 minutes. Cloud sync saves unsubmitted assignment
drafts to Meraki; those drafts may be visible to teachers. Quiz recovery is
local-only because the recorded quiz API exposes final submission, not a
cloud draft operation. Logging out stops sync but retains drafts for the
same account's next sign-in. Turn-in or “Use saved submission” removes the
local assignment draft.

## Develop

```
python3 -m http.server 8080
```

then open `http://localhost:8080`. Any static file server works.

## Test

```
node --test test/
```

Covers the pure logic (row shaping, error messages, palette matching) that
doesn't need a browser or a real Meraki login.
