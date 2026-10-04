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
      title: "Give the fix its own branch",
      text: "Delegate an independent change without mixing it into your checkout. Ask Bruv for a worktree, then review the diff before bringing it back.",
      example: [
        { kind: "label", text: "YOU ASK" },
        { kind: "prompt", text: "Fix the CSV importer in a separate worktree. Add a test for empty rows." },
        { kind: "gap", text: "" },
        { kind: "label", text: "WORK SPLIT" },
        { kind: "detail", text: "Your checkout  /  export UI" },
        { kind: "detail", text: "Agent worktree /  CSV fix + test" },
      ],
    },
    {
      title: "Use the time tests take",
      text: "Run a long test suite in the background and keep the conversation going. Bruv brings the result back when the job finishes.",
      example: [
        { kind: "label", text: "START A BACKGROUND JOB" },
        { kind: "prompt", text: "Run the tests in the background." },
        { kind: "gap", text: "" },
        { kind: "label", text: "KEEP WORKING" },
        { kind: "prompt", text: "While they run, explain how the cache gets invalidated." },
      ],
    },
    {
      title: "Pick up where you left off",
      text: "Ask Bruv to save decisions and unfinished work in your project's wisdom files. The next session can read those notes before changing the code.",
      example: [
        { kind: "label", text: "BEFORE YOU LEAVE" },
        { kind: "prompt", text: "Save why imports stream rows and what still needs testing." },
        { kind: "gap", text: "" },
        { kind: "label", text: "NEXT SESSION" },
        { kind: "prompt", text: "Read the project wisdom, then add coverage for large CSV files." },
      ],
    },
  ],
  installTitle: "Start in your repo",
  installNote:
    "Build Bruv with Bun 1.4.2 using the source guide. Configure your model provider, then run bruv from your project.",
  start: "$ cd your-project\n$ bruv",
  requirements: "Bring your own provider credentials. Linux x64/arm64, macOS Apple Silicon, or Android Termux arm64.",
};
