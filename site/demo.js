// Prewritten illustrative scenes only. No terminal, network calls or user input.
const scene = document.querySelector("#scene");
const initial = scene.innerHTML;
const scenes = {
  context: initial,
  delegate:
    '<p class="speaker">bruv</p><p>Let’s give each piece a little room.</p><div class="task-list"><div><span class="task-icon">↗</span><span>Research the approach</span><span class="task-state">sub-agent</span></div><div><span class="task-icon">↗</span><span>Build in a separate worktree</span><span class="task-state">isolated</span></div><div><span class="task-icon">→</span><span>Bring the findings together</span><span class="task-state">handoff</span></div></div><p class="terminal-note">Focused tasks. One main conversation.</p>',
  wisdom:
    '<p class="speaker">bruv</p><p>Leave a useful map for next time.</p><div class="task-list"><div><span class="task-icon">+</span><span>What we decided</span><span class="task-state">decision</span></div><div><span class="task-icon">+</span><span>Why we chose it</span><span class="task-state">reason</span></div><div><span class="task-icon">→</span><span>What to try next</span><span class="task-state">next step</span></div></div><p class="terminal-note">Project wisdom: notes that live beside your code.</p>',
};
const controls = document.querySelector(".scene-controls");
controls.hidden = false;
controls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-scene]");
  if (!button || button.getAttribute("aria-pressed") === "true") return;
  scene.innerHTML = scenes[button.dataset.scene];
  for (const control of controls.querySelectorAll("button"))
    control.setAttribute("aria-pressed", String(control === button));
});
