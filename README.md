# meraki-web

## Project status

This project is meant to be temporary. Its end goal is to be discarded: this
repository and the GitHub Pages site are a stopgap, and I plan to archive them
once they're no longer needed. I may be getting the chance to contribute
directly upstream, with PR access to the official codebase. If that happens,
the point of this fork is to land its work in the real client: a better,
faster UI, plus features like draft recovery and what-if grades. At that point
this fork has no reason to exist.

Privacy and transparency come with it. This client has no backend. Your
credentials and tokens stay in your own browser and go only to Meraki's
servers, and the app's "Data & Privacy" tab lists exactly what it reads and
writes. I want upstream to hold to the same standard, so the aim is to carry
that over too, not just the look.

I also want to see whether an official, documented, read-only API can be made
available. Everything here is built on a reverse-engineered picture of the
backend, which I've written up in two reference documents:
[v1](https://github.com/Earth1283/meraki-web/releases/tag/api-pdf-docs) and the
[11/2 update](https://github.com/Earth1283/meraki-web/releases/tag/api-docs-2026-11-2).
An official API would make that guesswork unnecessary and keep third-party
clients from breaking whenever the backend changes. I can't promise it will
happen soon.

Until then, treat this as a working prototype and don't build anything
long-term on it. Expect the hosted copies to disappear and the repo to be
archived rather than maintained. I can't promise a date, because it depends on
that access coming through.

## About

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
