import { demoDuration, demoFrame, type DemoId } from "./demos";
import { cellRowHtml, cellRowsHtml } from "./html-cells";
import { advance, type Playback } from "./playback";

/** One small DOM renderer for the HTML view; the terminal owns its own renderer. */
export function mountHtmlDemos(root: Document = document) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const panels = [...root.querySelectorAll<HTMLElement>("[data-demo]")].map((element) => {
    const id = element.dataset.demo as DemoId;
    const screen = element.querySelector<HTMLPreElement>(".demo-screen")!;
    const button = element.querySelector<HTMLButtonElement>(".demo-toggle")!;
    const playback: Playback = {
      elapsed: motion.matches ? demoDuration(id) : 0,
      paused: motion.matches,
      started: motion.matches,
    };
    return { id, element, screen, button, playback, cols: 68, visible: false };
  });
  type Panel = (typeof panels)[number];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = 0;

  const label = (panel: Panel) => {
    const verb = panel.playback.paused
      ? motion.matches && panel.playback.elapsed === demoDuration(panel.id)
        ? "Animate"
        : "Resume"
      : "Pause";
    const text = verb + " " + panel.element.dataset.label + " demo";
    panel.button.setAttribute("aria-label", text);
    panel.button.title = text;
    panel.button.textContent = panel.playback.paused ? "▶" : "Ⅱ";
  };
  const render = (panel: Panel) => {
    // Unseen demos and reduced-motion demos show the final UI, never an empty box.
    // Shared advance() owns looping and the final hold; the hold renders one fixed frame.
    const elapsed = panel.playback.started
      ? Math.min(panel.playback.elapsed, demoDuration(panel.id))
      : demoDuration(panel.id);
    const { rows } = demoFrame(panel.id, panel.cols, elapsed);
    const existing = [...panel.screen.querySelectorAll<HTMLElement>(".demo-row")];
    if (existing.length !== rows.length) panel.screen.innerHTML = cellRowsHtml(rows);
    else
      rows.forEach((row, index) => {
        const html = cellRowHtml(row);
        if (existing[index].innerHTML !== html) existing[index].innerHTML = html;
      });
  };
  const measure = (panel: Panel) => {
    const style = getComputedStyle(panel.screen);
    const probe = root.createElement("span");
    probe.textContent = "M";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    // The computed font shorthand may be empty when ligatures are disabled.
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontSize = style.fontSize;
    probe.style.fontWeight = style.fontWeight;
    probe.style.letterSpacing = style.letterSpacing;
    panel.element.append(probe);
    const cellWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const width = panel.screen.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    panel.cols = Math.max(16, Math.min(74, Math.floor(width / cellWidth)));
    render(panel);
  };
  const active = () => !root.hidden && panels.some((panel) => panel.visible && !panel.playback.paused);
  const tick = () => {
    timer = undefined;
    if (!active()) {
      previous = 0;
      return;
    }
    const now = performance.now();
    const delta = previous ? Math.min(250, now - previous) : 0;
    previous = now;
    for (const panel of panels) {
      if (!panel.visible || panel.playback.paused) continue;
      advance(panel.playback, delta, demoDuration(panel.id), true);
      render(panel);
    }
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
    for (const entry of entries) measure(panels.find((p) => p.screen === entry.target)!);
  });
  const listeners: (() => void)[] = [];
  for (const panel of panels) {
    panel.screen.hidden = false;
    panel.button.hidden = false;
    panel.element.classList.add("demo-enhanced");
    measure(panel);
    label(panel);
    const toggle = () => {
      if (
        panel.playback.paused &&
        (!panel.playback.started || (motion.matches && panel.playback.elapsed === demoDuration(panel.id)))
      ) {
        panel.playback.elapsed = 0;
        panel.playback.started = true;
      }
      panel.playback.paused = !panel.playback.paused;
      label(panel);
      render(panel);
      schedule();
    };
    panel.button.addEventListener("click", toggle);
    listeners.push(() => panel.button.removeEventListener("click", toggle));
    observer.observe(panel.screen);
    resize.observe(panel.screen);
  }
  const preference = () => {
    if (motion.matches)
      for (const panel of panels) {
        panel.playback.elapsed = demoDuration(panel.id);
        panel.playback.started = true;
        panel.playback.paused = true;
        label(panel);
        render(panel);
      }
    schedule();
  };
  root.addEventListener("visibilitychange", schedule);
  motion.addEventListener("change", preference);
  void root.fonts.ready.then(() => panels.forEach(measure));
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
