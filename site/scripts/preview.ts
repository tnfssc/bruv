import { resolve, sep } from "node:path";
export function preview(port = Number(process.env.PORT || 4173)) {
  const root = resolve(import.meta.dir, "../dist");
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      const path = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
      if (!path.startsWith(root + sep)) return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      return (await file.exists())
        ? new Response(file, { headers: { "Cache-Control": "no-store" } })
        : new Response("Not found", { status: 404 });
    },
  });
}
if (import.meta.main) {
  const server = preview();
  console.log("Preview: " + server.url);
}
