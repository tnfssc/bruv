import { type DemoId, demoDuration, demoFrame } from "./demos";
import { cellRowHtml, cellRowsHtml } from "./html-cells";
import { advance, type Playback } from "./playback";

class HtmlDemo {
  readonly screen: HTMLPreElement;
  readonly button: HTMLButtonElement;
  visible = false;
  private readonly id: DemoId;
  private readonly duration: number;
  private readonly playback: Playback;
  private cols = 68;

  constructor(
    private readonly root: Document,
    private readonly element: HTMLElement,
    reducedMotion: boolean,
  ) {
    this.id = element.dataset.demo as DemoId;
    this.duration = demoDuration(this.id);
    this.screen = element.querySelector<HTMLPreElement>(".demo-screen")!;
    this.button = element.querySelector<HTMLButtonElement>(".demo-toggle")!;
    this.playback = {
      elapsed: reducedMotion ? this.duration : 0,
      paused: reducedMotion,
      started: reducedMotion,
    };
  }

  get running() {
    return this.visible && !this.playback.paused;
  }

  enhance(reducedMotion: boolean) {
    this.screen.hidden = false;
    this.button.hidden = false;
    this.element.classList.add("demo-enhanced");
    this.measure();
    this.label(reducedMotion);
  }

  toggle(reducedMotion: boolean) {
    if (
      this.playback.paused &&
      (!this.playback.started || (reducedMotion && this.playback.elapsed === this.duration))
    ) {
      this.playback.elapsed = 0;
      this.playback.started = true;
    }
    this.playback.paused = !this.playback.paused;
    this.label(reducedMotion);
    this.render();
  }

  holdFinalFrame() {
    this.playback.elapsed = this.duration;
    this.playback.started = true;
    this.playback.paused = true;
    this.label(true);
    this.render();
  }

  advance(delta: number) {
    if (!this.running) return;
    advance(this.playback, delta, this.duration, true);
    this.render();
  }

  measure() {
    const style = getComputedStyle(this.screen);
    const probe = this.root.createElement("span");
    probe.textContent = "M";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    // The computed font shorthand may be empty when ligatures are disabled.
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontSize = style.fontSize;
    probe.style.fontWeight = style.fontWeight;
    probe.style.letterSpacing = style.letterSpacing;
    this.element.append(probe);
    const cellWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const width = this.screen.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    this.cols = Math.max(16, Math.min(74, Math.floor(width / cellWidth)));
    this.render();
  }

  private label(reducedMotion: boolean) {
    const verb = this.playback.paused
      ? reducedMotion && this.playback.elapsed === this.duration
        ? "Animate"
        : "Resume"
      : "Pause";
    const text = verb + " " + this.element.dataset.label + " demo";
    this.button.setAttribute("aria-label", text);
    this.button.title = text;
    this.button.textContent = this.playback.paused ? "▶" : "Ⅱ";
  }

  private render() {
    // Unseen demos and reduced-motion demos show the final UI, never an empty box.
    // Shared advance() owns looping and the final hold; the hold renders one fixed frame.
    const elapsed = this.playback.started ? Math.min(this.playback.elapsed, this.duration) : this.duration;
    const { rows } = demoFrame(this.id, this.cols, elapsed);
    const existing = [...this.screen.querySelectorAll<HTMLElement>(".demo-row")];
    if (existing.length !== rows.length) this.screen.innerHTML = cellRowsHtml(rows);
    else
      rows.forEach((row, index) => {
        const html = cellRowHtml(row);
        if (existing[index].innerHTML !== html) existing[index].innerHTML = html;
      });
  }
}

/** One small DOM renderer for the HTML view; the terminal owns its own renderer. */
export function mountHtmlDemos(root: Document = document) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const panels = [...root.querySelectorAll<HTMLElement>("[data-demo]")].map(
    (element) => new HtmlDemo(root, element, motion.matches),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = 0;
  const active = () => !root.hidden && panels.some((panel) => panel.running);
  const tick = () => {
    timer = undefined;
    if (!active()) {
      previous = 0;
      return;
    }
    const now = performance.now();
    const delta = previous ? Math.min(250, now - previous) : 0;
    previous = now;
    for (const panel of panels) panel.advance(delta);
    timer = setTimeout(tick, 80);
  };
  const schedule = () => {
    if (!active()) {
      clearTimeout(timer);
      timer = undefined;
      previous = 0;
    } else if (timer === undefined) {
      previous = performance.now();
      timer = setTimeout(tick, 80);
    }
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const panel = panels.find((p) => p.screen === entry.target)!;
        // At least eight rows, including on the taller narrow-width panels.
        panel.visible = entry.isIntersecting && entry.intersectionRatio >= 0.35;
      }
      schedule();
    },
    { threshold: [0, 0.35] },
  );
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) panels.find((p) => p.screen === entry.target)!.measure();
  });
  const listeners: (() => void)[] = [];
  for (const panel of panels) {
    panel.enhance(motion.matches);
    const toggle = () => {
      panel.toggle(motion.matches);
      schedule();
    };
    panel.button.addEventListener("click", toggle);
    listeners.push(() => panel.button.removeEventListener("click", toggle));
    observer.observe(panel.screen);
    resize.observe(panel.screen);
  }
  const preference = () => {
    if (motion.matches) for (const panel of panels) panel.holdFinalFrame();
    schedule();
  };
  root.addEventListener("visibilitychange", schedule);
  motion.addEventListener("change", preference);
  void root.fonts.ready.then(() => panels.forEach((panel) => panel.measure()));
  return () => {
    clearTimeout(timer);
    observer.disconnect();
    resize.disconnect();
    root.removeEventListener("visibilitychange", schedule);
    motion.removeEventListener("change", preference);
    listeners.forEach((remove) => remove());
  };
}

if (typeof document !== "undefined") mountHtmlDemos();
