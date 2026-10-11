/** Copy shared by the terminal page and its HTML view. */
export const siteContent = {
  name: "bruv",
  description:
    "bruv is a coding agent built on Pi. It keeps going until the job is done, a fresh agent checks the work, and you get a receipt.",
  repository: "https://github.com/tnfssc/bruv",
  install: "https://github.com/tnfssc/bruv#readme",
};
export const landing = {
  title: "bruv",
  titleTail: "Done means checked.",
  intro:
    "A coding agent for your ChatGPT plan, built on Pi. It keeps going until the job is done, a fresh agent checks the work, and you get a receipt.",
  features: [
    {
      title: "It doesn't stop halfway",
      text: "GPT models like to stop and tell you what they'll do next. bruv keeps the run going until the work is done, needs you, or is blocked. Type to steer it any time.",
    },
    {
      title: "A fresh agent checks before done",
      text: "When the model says done, a new agent that only sees your request and the changes tries the result. Gaps go back to be fixed. Then you get a receipt.",
    },
    {
      title: "Long work runs in the background",
      text: "Tests, builds and agents run while you keep talking. A short board shows what's running, and results come back to the conversation.",
    },
  ],
  installTitle: "Start in your repo",
  installNote: "Installs Pi if you don't have it, then adds bruv.",
  start: "$ cd your-project\n$ pi\n/login\n/bruv-setup",
  requirements:
    "Sign in with /login. A ChatGPT plan works, and so does any provider Pi supports. Already have Pi? Run pi install git:github.com/tnfssc/bruv. Coming from Codex? /import-codex brings your settings.",
};
