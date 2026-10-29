import { AudioLinesIcon, MicIcon, SquareIcon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react";
import { type CSSProperties, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { act, down, getVoice, level, preload, setVoice, subscribeVoice, up, type VoiceState } from "./load";

const touch = matchMedia("(pointer: coarse)");

export function useVoice<T>(pick: (state: VoiceState) => T): T {
  return useSyncExternalStore(subscribeVoice, () => pick(getVoice()));
}

/** The colour of what is happening, as on the old voice page. */
export const tones = {
  idle: "var(--muted-foreground)",
  listening: "var(--done)",
  hearing: "var(--working)",
  thinking: "var(--needs)",
  speaking: "oklch(0.7 0.18 295)",
  error: "var(--destructive)",
};

export function toneOf(voice: VoiceState): keyof typeof tones {
  if (!voice.on) return "idle";
  if (voice.offline || voice.need) return voice.offline ? "error" : "idle";
  if (voice.holding) return "hearing";
  if (voice.state === "listening" && !voice.free) return "idle";
  return voice.state === "starting" ? "idle" : voice.state;
}

export function labelOf(voice: VoiceState) {
  if (voice.offline) return "Connecting";
  if (voice.muted && voice.playing) return "Muted";
  if (voice.holding) return "Hearing you";
  return {
    starting: "Loading voice",
    listening: voice.free ? "Listening" : "Ready",
    hearing: "Hearing you",
    thinking: "Thinking",
    speaking: "Speaking",
  }[voice.state];
}

/**
 * The talk button: hold to talk, tap for hands-free (and tap again to end it). The first press turns voice
 * on in this page. The voice level shows as its fill, from `--level`.
 */
export function TalkButton({ big = false }: { big?: boolean }) {
  // Voice waiting on its models can't hear yet, so the button doesn't look on.
  const on = useVoice((voice) => voice.on && !voice.need);
  const free = useVoice((voice) => voice.free && !voice.need);
  const holding = useVoice((voice) => voice.holding);
  const tone = useVoice(toneOf);
  const style = {
    "--tone": tones[tone],
    ...(on
      ? {
          color: holding ? "white" : "var(--tone)",
          background: holding
            ? "var(--tone)"
            : "color-mix(in oklch, var(--tone) calc(14% + var(--level, 0) * 30%), transparent)",
        }
      : {}),
  } as CSSProperties;
  return (
    <button
      ref={(element) => {
        level.element = element;
      }}
      type="button"
      data-talk=""
      aria-label={
        free ? "Hands-free is on. Tap to turn it off, or hold to talk" : "Hold to talk, or tap for hands-free"
      }
      aria-pressed={on}
      style={style}
      className={cn(
        "inline-flex shrink-0 cursor-pointer touch-none select-none items-center justify-center rounded-full transition-[color,background-color,transform] [-webkit-touch-callout:none] [&_svg]:pointer-events-none",
        big ? "size-32 [&_svg]:size-12" : "size-9 [&_svg]:size-5",
        big && holding && "scale-105",
        !on &&
          (big ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"),
      )}
      onPointerEnter={() => void preload()}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        down();
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(event) => event.preventDefault()}
    >
      {free ? <AudioLinesIcon /> : <MicIcon />}
    </button>
  );
}

/** A quiet line above the composer while voice is on: what it is doing, mute, stop speaking, and off. */
export function VoiceLine() {
  const voice = useVoice((state) => state);
  if (!voice.on && !voice.error) return null;
  const tone = toneOf(voice);
  const close = voice.on ? () => act((run) => run.off()) : () => setVoice({ error: "" });
  let text: string;
  if (voice.error) text = voice.error;
  else if (voice.need) text = voice.progress || `Voice needs ${voice.need} MB of speech models on this computer.`;
  else if (voice.partial) text = voice.partial;
  else
    text = voice.free
      ? "Just talk"
      : touch.matches
        ? "Hold to talk · tap for hands-free"
        : "Hold Space or the mic to talk";
  return (
    <div
      role="status"
      style={{ "--tone": tones[tone] } as CSSProperties}
      className="mx-auto flex h-9 max-w-2xl items-center gap-2 pr-1 pl-3 text-[13px]"
    >
      {voice.error ? null : (
        <>
          <span
            className={cn(
              "size-2 shrink-0 rounded-full bg-[var(--tone)] transition-colors",
              (tone === "hearing" || tone === "thinking" || voice.state === "starting") && "animate-blink",
            )}
          />
          {voice.need ? null : <span className="shrink-0 font-medium text-muted-foreground">{labelOf(voice)}</span>}
        </>
      )}
      <span className={cn("min-w-0 flex-1 truncate", voice.error ? "text-destructive" : "text-muted-foreground/80")}>
        {text}
      </span>
      {voice.need && !voice.progress ? (
        <Button variant="secondary" size="sm" onClick={() => act((run) => run.download())}>
          Download
        </Button>
      ) : null}
      {voice.on && !voice.need ? (
        <>
          {voice.playing ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Stop speaking"
              onClick={() => act((run) => run.hush())}
            >
              <SquareIcon className="size-3.5 fill-current" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={voice.muted ? "Unmute" : "Mute"}
            aria-pressed={voice.muted}
            onClick={() => act((run) => run.mute())}
          >
            {voice.muted ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
          </Button>
        </>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={voice.on ? "Turn voice off" : "Dismiss"}
        onClick={close}
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}
