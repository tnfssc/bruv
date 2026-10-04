const [port, token, helloFile] = process.argv.slice(2);
const hello = await Bun.file(helloFile).json();
const events: any[] = [];
let cursor = 0;
for (let pages = 0; pages < 160; pages++) {
  const r = await fetch(
    "http://127.0.0.1:" +
      port +
      "/events?identity=" +
      encodeURIComponent(hello.identity) +
      "&epoch=" +
      hello.epoch +
      "&cursor=" +
      cursor,
    { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(2500) },
  );
  if (!r.ok) throw Error("events " + r.status);
  const page = await r.json();
  if (
    !Array.isArray(page.events) ||
    page.events.length > 10 ||
    page.next !== cursor + page.events.length ||
    page.next > 160 ||
    (page.hasMore && page.next <= cursor)
  )
    throw Error("invalid or stalled event page");
  events.push(...page.events);
  cursor = page.next;
  if (!page.hasMore) break;
}
console.log(JSON.stringify({ events }));

export {};
