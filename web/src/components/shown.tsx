import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import type { Shown } from "../../../src/web/protocol";

/**
 * Files the assistant showed: pictures, video and sound play in place, an HTML page runs in a frame of its
 * own (the server sends it sandboxed, so it can't reach this page or its key), text shows in a box, and a
 * PDF opens in a tab. Nothing loads until the line is near the screen, since the list is virtualized.
 */
export function ShownFiles({ files }: { files: Shown[] }) {
  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => (
        <ShownFile key={file.url} file={file} />
      ))}
    </div>
  );
}

function Open({ file }: { file: Shown }) {
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
    >
      Open
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </a>
  );
}

/** The name, the assistant's words for it if any, and a link to open it whole. */
function Header({ file }: { file: Shown }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{file.title ?? file.name}</span>
        {file.title && file.title !== file.name ? <span className="text-muted-foreground"> · {file.name}</span> : null}
      </span>
      <Open file={file} />
    </div>
  );
}

function ShownFile({ file }: { file: Shown }) {
  if (file.kind === "image")
    return (
      <a href={file.url} target="_blank" rel="noreferrer" className="block w-fit max-w-full">
        <img
          src={file.url}
          alt={file.title ?? file.name}
          loading="lazy"
          decoding="async"
          className="max-h-[28rem] w-auto max-w-full rounded-xl bg-card object-contain"
        />
      </a>
    );
  if (file.kind === "video")
    return (
      // biome-ignore lint/a11y/useMediaCaption: files the work made have no captions to give
      <video
        src={file.url}
        controls
        playsInline
        preload="metadata"
        className="max-h-[28rem] w-full rounded-xl bg-black"
        aria-label={file.title ?? file.name}
      />
    );
  if (file.kind === "audio")
    return (
      <div className="rounded-xl border bg-card">
        <Header file={file} />
        {/* biome-ignore lint/a11y/useMediaCaption: files the work made have no captions to give */}
        <audio src={file.url} controls preload="none" className="w-full px-3 pb-3" />
      </div>
    );
  if (file.kind === "html")
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <Header file={file} />
        <iframe
          src={file.url}
          title={file.title ?? file.name}
          sandbox="allow-scripts allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="block h-[26rem] max-h-[70dvh] w-full border-0 border-t bg-white"
        />
      </div>
    );
  if (file.kind === "pdf")
    return (
      <a
        href={file.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3 text-[13px] hover:bg-accent"
      >
        <FileTextIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{file.title ?? file.name}</span>
        <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </a>
    );
  return <TextFile file={file} />;
}

/** Text already fetched, by link, so scrolling a file out and back doesn't fetch it again. */
const texts = new Map<string, { text: string; cut: boolean }>();
const kept = 40;

function useText(url: string) {
  const [found, setFound] = useState(() => texts.get(url));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (texts.has(url)) return;
    let gone = false;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const value = { text: await response.text(), cut: response.headers.get("x-bruv-truncated") === "1" };
        texts.set(url, value);
        if (texts.size > kept) texts.delete(texts.keys().next().value as string);
        if (!gone) setFound(value);
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
    };
  }, [url]);
  return { found, failed };
}

function TextFile({ file }: { file: Shown }) {
  const { found, failed } = useText(file.url);
  const markdown = /\.(md|markdown)$/i.test(file.name);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Header file={file} />
      <div className="max-h-80 overflow-auto border-t px-3 py-2">
        {failed ? (
          <p className="text-[13px] text-muted-foreground">Couldn't load it.</p>
        ) : !found ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : markdown ? (
          <MarkdownText id={file.url} text={found.text} />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
            {found.text}
          </pre>
        )}
        {found?.cut ? <p className="pt-2 text-[12px] text-muted-foreground">Only the start of it.</p> : null}
      </div>
    </div>
  );
}

function MarkdownText({ id, text }: { id: string; text: string }) {
  const out = useMarkdown(id, text);
  return <div className={cn("md text-[14px]", !out && "whitespace-pre-wrap")}>{out ?? text}</div>;
}
