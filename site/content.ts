/** Copy shared by the terminal page and its semantic HTML representation. */
export const siteContent = {
  name: "Bruv",
  description: "Bruv is an opinionated coding agent built on Pi, with background jobs, subagents and project wisdom.",
  repository: "https://github.com/tnfssc/bruv",
  install: "https://github.com/tnfssc/bruv#build-from-source",
};
export const landing = {
  title: "Bruv",
  titleTail: "An opinionated coding agent.",
  intro: "Built on Pi, with background jobs, subagents and project wisdom.",
  features: [
    {
      title: "Give the fix its own branch",
      text: "Ask Bruv to put an independent change in a Git worktree. Review its diff before merging into your branch.",
    },
    {
      title: "Use the time tests take",
      text: "Keep talking to Bruv while a test suite runs. The result returns to the conversation when the job finishes.",
    },
    {
      title: "Pick up where you left off",
      text: "Save decisions and unfinished work in your project's wisdom files so the next session can read them before editing.",
    },
  ],
  installTitle: "Start in your repo",
  installNote: "Install Bruv, configure your model provider, then run bruv from your project.",
  start: "$ cd your-project\n$ bruv",
  requirements: "Bring your own provider credentials. Linux x64/arm64, macOS Apple Silicon, or Android Termux arm64.",
};
