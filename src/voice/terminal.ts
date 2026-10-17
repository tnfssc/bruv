import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, getCapabilities, hyperlink, Image, Text, type TUI } from "@earendil-works/pi-tui";
import type { Resolved } from "./show";

/**
 * Shown things in the terminal. The latest one sits above the input: pictures are drawn where the
 * terminal can draw them (Kitty, Ghostty, WezTerm, iTerm2), a video gets its first frame and a link to
 * play it, and a page gets a link to open it in the browser. It never goes to the model.
 */

/** Pictures terminals can draw. */
const drawable: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const maxBytes = 20_000_000;

export type InTerminal = {
  title?: string;
  picture?: { data: string; mime: string };
  link?: { label: string; url: string };
};

/** A video's first frame as PNG, when ffmpeg is installed. */
function firstFrame(path: string) {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
    { maxBuffer: maxBytes, timeout: 10_000 },
  );
  return result.status === 0 && result.stdout?.length ? result.stdout.toString("base64") : undefined;
}

/** A picture from a link, or nothing if it is too big, too slow or not one terminals draw. */
async function download(url: string, fetch: typeof globalThis.fetch) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const mime = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!response.ok || !Object.values(drawable).includes(mime)) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= maxBytes ? { data: bytes.toString("base64"), mime } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gets a shown thing ready for the terminal. `href` is its address on the page server, when that runs,
 * which works over SSH and through a tunnel; without it, links are files on this machine, and a page
 * written inline is saved in `dir` so it can be opened.
 */
export async function forTerminal(
  item: Resolved,
  dir: string,
  { href, fetch = globalThis.fetch }: { href?: string; fetch?: typeof globalThis.fetch } = {},
): Promise<InTerminal> {
  const { title } = item;
  const url = href ?? (item.path ? pathToFileURL(item.path).href : item.url);
  if (item.kind === "html") {
    if (href) return { title, link: { label: "Open the page in the browser", url: href } };
    let path = item.path;
    if (!path) {
      mkdirSync(dir, { recursive: true });
      path = join(dir, `${randomBytes(6).toString("hex")}.html`);
      writeFileSync(path, item.html ?? "");
    }
    return { title, link: { label: "Open the page in the browser", url: pathToFileURL(path).href } };
  }
  if (item.kind === "video") {
    const frame = item.path ? firstFrame(item.path) : undefined;
    return {
      title,
      picture: frame ? { data: frame, mime: "image/png" } : undefined,
      link: { label: "Play the video", url: url as string },
    };
  }
  const mime = item.path ? drawable[extname(item.path).toLowerCase()] : undefined;
  const picture =
    item.path && mime && statSync(item.path).size <= maxBytes
      ? { data: readFileSync(item.path).toString("base64"), mime }
      : item.url
        ? await download(item.url, fetch)
        : undefined;
  // The link opens it full size, and is all a terminal that can't draw pictures has.
  return { title, picture, link: { label: "Open the picture", url: url as string } };
}

/** Puts the shown thing above the input, replacing the last one. `undefined` clears it. */
export function showInTerminal(ui: ExtensionContext["ui"], item: InTerminal | undefined) {
  ui.setWidget(
    "bruv-shown",
    item &&
      ((_tui: TUI, theme: Theme) => {
        const box = new Container();
        box.addChild(new Text(`${theme.fg("accent", "▍")} ${theme.bold(item.title ?? "Shown")}`, 1, 0));
        if (item.picture)
          box.addChild(
            new Image(
              item.picture.data,
              item.picture.mime,
              { fallbackColor: (text) => theme.fg("dim", text) },
              { maxWidthCells: 60, maxHeightCells: 14 },
            ),
          );
        if (item.link) {
          const { label, url } = item.link;
          const text = getCapabilities().hyperlinks
            ? hyperlink(theme.fg("accent", label), url)
            : `${label}: ${theme.fg("dim", url)}`;
          box.addChild(new Text(`  ${text}`, 1, 0));
        }
        return box;
      }),
    { placement: "aboveEditor" },
  );
}
