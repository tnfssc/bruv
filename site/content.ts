/** Copy shared by the terminal page and its semantic HTML representation. */
export const siteContent = {
  name: "Bruv",
  description:
    "Bruv is a terminal coding agent built on Pi. Delegate changes in isolated Git worktrees and keep working while background tasks run.",
  repository: "https://github.com/tnfssc/bruv",
  install: "https://github.com/tnfssc/bruv#build-from-source",
};
export const landing = {
  eyebrow: "BRUV / TERMINAL CODING AGENT",
  title: "Keep coding",
  titleTail: "while your agents work.",
  intro:
    "Bruv is a coding agent built on Pi. Send a fix to a subagent in its own Git worktree while you work on the next change.",
  features: [
    {
      tag: "DELEGATE",
      title: "Give the fix its own branch",
      text: "Delegate an independent change without mixing it into your checkout. Ask Bruv for a worktree, then review the diff before bringing it back.",
    },
    {
      tag: "BACKGROUND JOBS",
      title: "Use the time tests take",
      text: "Run a long test suite in the background and keep the conversation going. Bruv brings the result back when the job finishes.",
    },
    {
      tag: "PROJECT WISDOM",
      title: "Pick up where you left off",
      text: "Ask Bruv to save decisions and unfinished work in your project's wisdom files. The next session can read those notes before changing the code.",
    },
  ],
  installTitle: "Start in your repo",
  installNote:
    "Build Bruv with Bun 1.4.2 using the source guide. Configure your model provider, then run bruv from your project.",
  start: "$ cd your-project\n$ bruv",
  requirements: "Bring your own provider credentials. Linux x64/arm64, macOS Apple Silicon, or Android Termux arm64.",
};
