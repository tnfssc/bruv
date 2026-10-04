/** Copy shared by the terminal page and its semantic HTML representation. */
export const siteContent = {
  name: "Bruv",
  description:
    "Bruv is a terminal coding agent built on Pi. Delegate changes in isolated Git worktrees and keep working while background tasks run.",
  repository: "https://github.com/tnfssc/bruv",
  install: "https://github.com/tnfssc/bruv#build-from-source",
};
export const landing = {
  title: "Keep coding",
  titleTail: "while your agents work.",
  intro:
    "Bruv is a coding agent built on Pi. Send a fix to a subagent in its own Git worktree while you work on the next change.",
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
  installNote:
    "Build Bruv with Bun 1.4.2 using the source guide. Configure your model provider, then run bruv from your project.",
  start: "$ cd your-project\n$ bruv",
  requirements: "Bring your own provider credentials. Linux x64/arm64, macOS Apple Silicon, or Android Termux arm64.",
};
