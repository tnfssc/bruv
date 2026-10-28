---
name: phone
description: How the web version reaches the phone (tunnel, installable app, push notifications), the choices made on 2026-10-29 and what was checked.
---

# The web version on the phone

- **Tunnel** (`src/web/tunnel.ts`): `web.tunnel` in bruv.json plus the saved Cloudflare key start it with
  the web version, reusing voice's `prepare`/`runTunnel`. cloudflared lives in `bruv/voice/bin`, shared with
  voice, so one download serves both. It is downloaded only after a yes from `/web tunnel`; at start a
  missing one is a notice. The host must differ from voice's: `prepare` names the tunnel after the host,
  so one host would point a single tunnel at two ports. `/qr.svg?t=` gives the phone's QR while it is up.
- **App** (`src/web/pwa.ts`): the manifest holds the key in `start_url`, so it is served only with the key
  (an inline script in `web/index.html` links it with the page's own `?t=`). Icons and `sw.js` are in
  `web/public`. The worker keeps nothing offline; it swaps a failed load for a waiting page and shows pushes.
- **Push by hand** (`src/web/webpush.ts`, node:crypto): VAPID (RFC 8292) and aes128gcm (RFC 8291) in about 80
  lines, instead of `@pushforge/builder`, to keep no new runtime dependency. A test repeats RFC 8291's worked
  example byte for byte, and a push through Mozilla's real service (register a channel with the VAPID key,
  push, decrypt what arrives) worked. Payload is Declarative Web Push's shape (`web_push: 8030`), which the
  worker also reads. VAPID keys in `bruv/web/vapid.json`, subscriptions in `push.json` (both 0600).
- **Routes**: `server.ts` answers 404 for paths it doesn't know, so `route()` in `pwa.ts` moves the server's
  request handler behind one that tries the parts' routes first. A route hook on `WebContext` would be cleaner.
- Pages tell the server when they go to the back (`visible`), so news becomes a push only when no page is in
  front. "Notify me" shows only in the installed app or on a desktop (iOS allows push only when installed).
- Headless Chrome crashes in `pushManager.subscribe`, and this machine's Xvfb is broken, so subscribing was
  not checked in a browser. Checked there: manifest with no installability errors (real profile), the
  worker registers, a push sent through CDP shows a notification, the waiting page when bruv is gone.
