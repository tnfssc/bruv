import { KeyboardIcon, SquareIcon, Volume2Icon, VolumeOffIcon, VolumeXIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { setGo } from "@/state/go";
import { answer } from "@/state/optimistic";
import { send } from "@/state/socket";
import { useActivity, useStore } from "@/state/use-store";
import { act } from "@/voice/load";
import { labelOf, TalkButton, toneOf, tones, useVoice } from "@/voice/talk";
import { asks } from "./activity";

/** A round button big enough to hit without looking, with its word under it. */
function Big({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex w-20 cursor-pointer flex-col items-center gap-1.5 text-[13px] text-muted-foreground"
    >
      <span
        className={cn(
          "grid size-16 place-items-center rounded-full bg-muted text-foreground transition-colors active:bg-accent [&_svg]:size-7",
          pressed && "bg-foreground text-background active:bg-foreground/80",
        )}
      >
        {children}
      </span>
      {label}
    </button>
  );
}

/** The first thread waiting on a yes or no, with buttons that take a thumb. */
function Waiting() {
  const needs = useActivity().needs.filter((thread) => thread.requestId && thread.requestKind !== "user_input");
  const missed = useStore((state) => state.missed);
  const first = needs[0];
  if (!first) return null;
  return (
    <div className="mb-4 rounded-2xl bg-card p-4">
      <p className="truncate font-medium text-[17px]">{first.title}</p>
      <p className="mt-0.5 text-[15px] text-muted-foreground">
        {missed === first.requestId
          ? "That answer didn't go through"
          : (asks[first.requestKind ?? ""] ?? "waits on you")}
        {needs.length > 1 ? ` · ${needs.length - 1} more waiting` : ""}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => answer(first, "decline")}
          className="h-14 cursor-pointer rounded-xl bg-muted font-medium text-[17px] active:bg-accent"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => answer(first, "accept")}
          className="h-14 cursor-pointer rounded-xl bg-primary font-medium text-[17px] text-primary-foreground active:opacity-90"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

/**
 * On the go, in place of the keyboard: what the assistant is doing in big words, the words being heard,
 * one big button to talk (hold to talk, tap for hands-free), and big buttons for the rest.
 */
export function GoPanel() {
  const voice = useVoice((state) => state);
  const busy = useStore((state) => state.busy);
  const step = useStore((state) => state.step);
  const tone = toneOf(voice);
  const ready = voice.on && !voice.need;
  let status: string;
  let words: string;
  if (voice.error) {
    status = "Voice stopped";
    words = voice.error;
  } else if (!voice.on) {
    status = busy ? "Working" : "Ready";
    words = busy && step ? step : "Hold to talk · tap for hands-free";
  } else if (voice.need) {
    status = "Voice needs its models";
    words = voice.progress || `${voice.need} MB of speech models, once, on the computer running bruv.`;
  } else {
    status = labelOf(voice);
    words =
      voice.partial ||
      (voice.holding
        ? "Let go when you're done"
        : voice.state === "thinking"
          ? step || "Working on it"
          : voice.free
            ? "Just talk. Tap to stop hands-free."
            : "Hold to talk · tap for hands-free");
  }
  return (
    <div className="px-[max(1rem,env(safe-area-inset-left))] pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-md">
        <Waiting />
        <div role="status" style={{ "--tone": tones[tone] } as CSSProperties} className="text-center">
          <p className="flex items-center justify-center gap-2 font-semibold text-[22px] tracking-tight">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full bg-[var(--tone)] transition-colors",
                (tone === "hearing" || tone === "thinking" || (voice.on && voice.state === "starting")) &&
                  "animate-blink",
              )}
            />
            {status}
          </p>
          <p
            className={cn(
              "mt-1 line-clamp-2 min-h-[3.25rem] text-[17px] leading-snug",
              voice.error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {words}
          </p>
        </div>
        <div className="mt-3 flex items-center justify-between">
          {ready ? (
            <Big label={voice.muted ? "Unmute" : "Mute"} pressed={voice.muted} onClick={() => act((run) => run.mute())}>
              {voice.muted ? <VolumeXIcon /> : <Volume2Icon />}
            </Big>
          ) : (
            <Big label="Type" onClick={() => setGo(false)}>
              <KeyboardIcon />
            </Big>
          )}
          {voice.need && !voice.progress ? (
            <button
              type="button"
              onClick={() => act((run) => run.download())}
              className="h-32 w-32 cursor-pointer rounded-full bg-primary font-medium text-[17px] text-primary-foreground"
            >
              Download
            </button>
          ) : (
            <TalkButton big />
          )}
          {ready && voice.playing ? (
            <Big label="Quiet" onClick={() => act((run) => run.hush())}>
              <VolumeOffIcon />
            </Big>
          ) : busy ? (
            <Big label="Stop" onClick={() => send({ type: "stop" })}>
              <SquareIcon className="fill-current" />
            </Big>
          ) : ready ? (
            <Big label="Type" onClick={() => setGo(false)}>
              <KeyboardIcon />
            </Big>
          ) : (
            <span className="w-20" />
          )}
        </div>
        {ready ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => act((run) => run.off())}
              className="h-11 cursor-pointer rounded-full px-5 font-medium text-[15px] text-muted-foreground active:bg-accent"
            >
              Voice off
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
