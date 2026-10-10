// Copy the static site into dist/ for Cloudflare.
import { cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
for (const path of ["index.html", "styles.css", "app.js", "assets"]) cpSync(path, `dist/${path}`, { recursive: true });
