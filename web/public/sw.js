// The page needs bruv running, so nothing is kept offline. When bruv isn't reachable, opening the app shows
// a short page that waits for it and reloads, instead of the browser's error. It also shows the
// assistant's news as notifications.
const waiting = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light"><title>bruv</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: #09090b; color: #fafafa; }
  @media (prefers-color-scheme: light) { body { background: #fff; color: #09090b; } }
  main { max-width: 22rem; padding: 2rem; text-align: center; }
  p { margin: .25rem 0; opacity: .6; }
  code { font-family: ui-monospace, monospace; }
</style></head>
<body><main>
  <h1 style="font-size: 1.125rem; margin: 0 0 .5rem">bruv isn't reachable</h1>
  <p>Start it with <code>pi --web</code>. This page opens it when it's back.</p>
</main>
<script>
  setInterval(async () => {
    const response = await fetch(location.href, { cache: "no-store" }).catch(() => undefined);
    if (response?.ok) location.reload();
  }, 3000);
</script></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || event.request.destination !== "document") return;
  event.respondWith(
    // Through a tunnel, a stopped bruv answers with an error status rather than failing to connect.
    fetch(event.request)
      .then((response) => (response.status >= 500 ? wait() : response))
      .catch(wait),
  );
});

function wait() {
  return new Response(waiting, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}

// News comes in Declarative Web Push's shape ({ web_push: 8030, notification }), which Safari can show by
// itself; everywhere else it is shown from here. A push must always show something: Safari ends
// subscriptions that push silently.
self.addEventListener("push", (event) => {
  let note = {};
  try {
    note = event.data?.json().notification ?? {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(note.title || "bruv", {
      body: note.body,
      tag: note.tag,
      icon: "/icon-192.png",
      data: { url: note.navigate },
    }),
  );
});

// A tap brings an open page to the front, or opens one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || event.notification.navigate || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((pages) => {
      const page = pages.find((client) => new URL(client.url).origin === self.location.origin);
      return page ? page.focus() : self.clients.openWindow(url);
    }),
  );
});
