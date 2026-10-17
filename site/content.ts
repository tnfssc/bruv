/** Copy shared by the terminal page and its HTML view. */
export const siteContent = {
  name: "bruv",
  description:
    "bruv is a coding agent you talk to, from the terminal or your phone. It answers out loud, shows you what it finds, and keeps working until the job is done and checked.",
  repository: "https://github.com/tnfssc/bruv",
  install: "https://github.com/tnfssc/bruv#readme",
};
export const landing = {
  title: "bruv",
  titleTail: "Talk to your coding agent.",
  intro:
    "Talk from your terminal or your phone. bruv answers out loud, shows you pages, pictures and video, and stops the moment you talk over it. Speech runs on your machine, so it costs nothing extra. Built on Pi, for your ChatGPT plan or any model Pi supports.",
  video: { src: "./assets/voice.mp4", poster: "./assets/voice-poster.jpg", label: "Watch it" },
  features: [
    {
      title: "Talk, don't type",
      text: "Type /voice and talk. Replies are spoken as they stream, and the agent puts what's better seen on screen: a chart, a page, a picture. Talk over a reply to cut in. /voice web opens the same session on your phone.",
    },
    {
      title: "It doesn't stop halfway",
      text: "GPT models like to stop and tell you what they'll do next. bruv keeps the run going until the work is done, needs you, or is blocked. Talk or type to steer it any time.",
    },
    {
      title: "A fresh agent checks before done",
      text: "When the model says done, a new agent that only sees your request and the changes tries the result. Gaps go back to be fixed. Then you get a receipt.",
    },
  ],
  installTitle: "Start in your repo",
  installNote: "Installs Pi if you don't have it, then adds bruv.",
  start: "$ cd your-project\n$ pi\n/login\n/bruv-setup\n/voice",
  requirements:
    "Sign in with /login. A ChatGPT plan works, and so does any provider Pi supports. The first /voice downloads the speech models (about 560 MB). Already have Pi? Run pi install git:github.com/tnfssc/bruv. Coming from Codex? /import-codex brings your settings.",
};
