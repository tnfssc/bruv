/** Copy shared by the terminal page and its semantic HTML representation. */
export const siteContent = {
  name: "bruv CLI",
  description: "A Pi-based coding agent for the terminal, with background jobs, subagents, and project wisdom.",
  repository: "https://github.com/tnfssc/bruv",
  install: "https://github.com/tnfssc/bruv#install",
};
export const landing = {
  eyebrow: "BRUV / BUILT ON PI",
  title: "Code in your terminal",
  intro: "Run a coding agent in your project. Give a change to a subagent while you keep working.",
  captureTitle: "Inside Bruv",
  features: [
    {
      title: "A checkout for each task",
      text: "Ask for a Git worktree when you delegate. The subagent gets its own checkout and branch; background jobs keep running between turns.",
    },
    {
      title: "Notes for the next session",
      text: "Keep decisions, checks and handoffs in wisdom/. The next session has something concrete to pick up.",
    },
  ],
  installNote: "Build from source with Bun. Add your provider credentials when you run Bruv.",
};
