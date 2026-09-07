# meraki-web

A self-hosted browser client for Meraki. There is no backend: this is a
static HTML/CSS/JS bundle, and every logged-in browser talks to Meraki's
Supabase project directly over HTTPS. The server that serves these files
never sees a password, an access token, or a refresh token — those live
only in each visitor's own browser `localStorage`, exactly as they would
using the official site. See the app's own "Data & Privacy" tab for the
full breakdown of what's read and written.

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
