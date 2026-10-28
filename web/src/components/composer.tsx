import { ArrowUpIcon, ImagePlusIcon, SquareIcon, XIcon } from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toEnd } from "@/lib/events";
import { cn } from "@/lib/utils";
import { pictures, shrink } from "@/state/images";
import { onLate, say } from "@/state/optimistic";
import { send } from "@/state/socket";
import { useStore } from "@/state/use-store";
import { TalkButton, VoiceLine } from "@/voice/talk";
import { Button } from "./ui/button";

const draftKey = "bruv:draft";
/** Phones have no Shift key, so there Enter starts a new line and the button sends. */
const touch = matchMedia("(pointer: coarse)");
let picked = 0;

/** The box at the bottom: text, pictures, send, and stop while the assistant works. */
export function Composer() {
  const busy = useStore((state) => state.busy);
  const online = useStore((state) => state.online);
  const [text, setText] = useState(() => sessionStorage.getItem(draftKey) ?? "");
  const [images, setImages] = useState<{ id: number; url: string }[]>([]);
  const [reading, setReading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [unsent, setUnsent] = useState(false);
  /** Words given back after a send that didn't get through, to take back if it did after all. */
  const restored = useRef<{ id: string; text: string; images: typeof images }>(undefined);

  // A line given back reached the server late: it shows in the conversation, so the copy here goes, unless
  // the user has changed it since.
  useEffect(
    () =>
      onLate((id) => {
        const was = restored.current;
        if (was?.id !== id) return;
        restored.current = undefined;
        setUnsent(false);
        setText((now) => (now === was.text ? "" : now));
        setImages((now) => (now === was.images ? [] : now));
      }),
    [],
  );
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Grow with the text, up to a limit, then scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again whenever the text changes
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (text) sessionStorage.setItem(draftKey, text);
    else sessionStorage.removeItem(draftKey);
  }, [text]);

  const add = async (files: File[]) => {
    if (files.length === 0) return;
    setReading((n) => n + files.length);
    for (const file of files) {
      try {
        const url = await shrink(file);
        setImages((list) => [...list, { id: ++picked, url }]);
      } catch {}
      setReading((n) => n - 1);
    }
  };

  // Pictures dropped anywhere on the page land here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: add only uses state setters
  useEffect(() => {
    const files = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const over = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      setDragging(false);
      add(pictures(event.dataTransfer?.files));
    };
    addEventListener("dragover", over);
    addEventListener("dragleave", leave);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragover", over);
      removeEventListener("dragleave", leave);
      removeEventListener("drop", drop);
    };
  }, []);

  const empty = !text.trim() && images.length === 0;
  const submit = () => {
    if (empty || reading > 0 || !online) return;
    const words = text;
    const kept = images;
    restored.current = undefined;
    // The line shows at once; if it never reaches the server it goes, and the words come back here.
    const { id, sent } = say(
      words.trim(),
      kept.map((image) => image.url),
    );
    sent.catch(() => {
      setText((now) => now || words);
      setImages((now) => (now.length ? now : kept));
      restored.current = { id, text: words, images: kept };
      setUnsent(true);
    });
    setText("");
    setImages([]);
    setUnsent(false);
    toEnd();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || touch.matches) return;
    event.preventDefault();
    submit();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = pictures(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    add(files);
  };

  return (
    <div className="px-[max(0.75rem,env(safe-area-inset-right))] pt-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <VoiceLine />
      {unsent ? (
        <p role="status" className="mx-auto max-w-2xl px-4 pb-1.5 text-[13px] text-muted-foreground">
          That didn't send. It's back in the box.
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={cn(
          "mx-auto flex max-w-2xl flex-col rounded-2xl bg-muted/70 transition-shadow",
          dragging && "ring-2 ring-ring",
        )}
      >
        {images.length > 0 || reading > 0 ? (
          <div className="flex gap-2 overflow-x-auto px-3 pt-3">
            {images.map((image) => (
              <div key={image.id} className="relative size-16 shrink-0">
                <img src={image.url} alt="" className="size-full rounded-lg object-cover" />
                <button
                  type="button"
                  aria-label="Remove picture"
                  onClick={() => setImages((list) => list.filter((other) => other !== image))}
                  className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full bg-background/80 text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            ))}
            {Array.from({ length: reading }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to key on
              <div key={index} className="size-16 shrink-0 animate-blink rounded-lg bg-background/50" />
            ))}
          </div>
        ) : null}
        <textarea
          ref={box}
          value={text}
          rows={1}
          onChange={(event) => {
            setText(event.target.value);
            setUnsent(false);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Ask for anything"
          aria-label="Message"
          enterKeyHint={touch.matches ? "enter" : "send"}
          className="max-h-48 min-h-11 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-none"
        />
        <div className="flex items-center gap-1 p-2">
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              add(pictures(event.target.files));
              event.target.value = "";
            }}
          />
          <Button variant="ghost" size="icon" aria-label="Add pictures" onClick={() => picker.current?.click()}>
            <ImagePlusIcon />
          </Button>
          <div className="flex-1" />
          <TalkButton />
          {busy ? (
            <Button variant="ghost" size="icon" aria-label="Stop" onClick={() => send({ type: "stop" })}>
              <SquareIcon className="size-4 fill-current" />
            </Button>
          ) : null}
          <Button type="submit" size="icon" aria-label="Send" disabled={empty || reading > 0 || !online} round>
            <ArrowUpIcon />
          </Button>
        </div>
      </form>
    </div>
  );
}
