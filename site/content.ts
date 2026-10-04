import { captures } from "./gallery";
/** Shared copy for the browser terminal and equivalent semantic HTML. */
export type SiteLink = { label: string; href: string };

export type SitePage = {
  id: string;
  title: string;
  paragraphs: string[];
  links: SiteLink[];
};

export type SiteContent = {
  name: string;
  description: string;
  repository: string;
  installCommand: string;
  pages: SitePage[];
};

const installCommand = "bun install --frozen-lockfile\nbun run check\nbun run build\nbun run install:local";
const repository = "https://github.com/tnfssc/bruv";

export const landing = {
  eyebrow: "BRUV / BUILT ON PI",
  captureLabel: "INSIDE BRUV  /  the local settings menu",
  featureTitles: ["Give a task its own worktree", "Leave notes the next session can use"],
  installNote: "Build from source with Bun. Add your provider credentials when you run Bruv.",
};

export const siteContent: SiteContent = {
  name: "bruv CLI",
  description: "A Pi-based coding agent for the terminal, with background jobs, subagents, and project wisdom.",
  repository,
  installCommand,
  pages: [
    {
      id: "overview",
      title: "Code in your terminal",
      paragraphs: [
        "Run a Pi-based coding agent in your project. Delegate a change in its own Git worktree while you keep working in your terminal.",
        "Delegate an independent change to a subagent in a Git worktree. It gets its own checkout and branch; background work can continue after your foreground turn ends. Subagents share the current checkout unless you ask for a worktree.",
        "Bruv keeps project guidance and handoff notes in wisdom/. Ask the agent to record the decision and the checks it ran, so a later session has something concrete to pick up.",
      ],
      links: [
        { label: "Install Bruv", href: "#install" },
        { label: "View source", href: repository },
        { label: "How delegation works", href: `${repository}/blob/develop/wisdom/worktrees/subagent-workspaces.md` },
        { label: "Read about wisdom", href: `${repository}/blob/develop/wisdom/wisdom-system/project-wisdom.md` },
      ],
    },
    {
      id: "install",
      title: "Install Bruv",
      paragraphs: [
        "For a source build, clone the repository and install Bun 1.4.2. Run the commands below from the repository root, then put ~/.local/bin on PATH and start bruv.",
        installCommand,
        "Release targets are Linux x64/arm64, macOS Apple Silicon, and Android Termux arm64. Follow the README for the matched CLI and connector download, checksum checks, and license notices.",
        "The README advises building from source until an accepted paired release is available. Older releases may not include the connector. Stop active Bruv and connector sessions before replacing executables.",
        "Supply provider credentials and model configuration at runtime. The Bruv install does not install T3.",
      ],
      links: [
        { label: "Build from source", href: `${repository}#build-from-source` },
        { label: "Paired install instructions", href: `${repository}#install` },
        { label: "Release files", href: `${repository}/releases` },
      ],
    },
    {
      id: "workflows",
      title: "Work, resume, delegate",
      paragraphs: [
        'Start the interactive terminal with bruv. For one prompt and exit, run bruv -p "Describe this tree". Use bruv -c to continue the latest session or bruv -r to pick a saved session.',
        "Ask the agent to run background work or delegate a task. Separate worktrees give independent edits their own checkout and branch; the configured project setup runs there.",
        "Use /questions for the current conversation's question inbox. SSH task questions have a separate owner: open /remote to read and answer them.",
        "In a Herdr-managed terminal pane, Bruv reports working, idle, or waiting for input. Background jobs and subagents keep the pane marked as working. Herdr is optional.",
      ],
      links: [
        { label: "Common commands", href: `${repository}#common-commands` },
        { label: "Subagent workspaces", href: `${repository}/blob/develop/wisdom/worktrees/subagent-workspaces.md` },
        { label: "Project wisdom", href: `${repository}/blob/develop/wisdom/wisdom-system/project-wisdom.md` },
        { label: "Herdr integration", href: `${repository}/blob/develop/wisdom/integrations/herdr.md` },
      ],
    },
    {
      id: "live",
      title: "Talk in the same session",
      paragraphs: [
        "Type /live in the local terminal to start talking. Typed and spoken work share the coding backend. Starting Live sends audio to the selected provider and may incur API charges.",
        "Use /live model to choose a voice model and /live setup to check credentials. Credential readiness does not prove API access. OpenAI Live needs an OpenAI API key; Codex OAuth alone is not enough.",
        "macOS Apple Silicon builds include the native helper. Linux releases do not bundle it; Linux Live currently needs a separately built helper. Live is same-host audio, not browser microphone transport.",
        "Use /live stop to end voice. Jobs keep running, and interrupting speech does not cancel work. Ask explicitly to stop work when that is what you want.",
      ],
      links: [{ label: "Live setup and troubleshooting", href: `${repository}#live-voice` }],
    },
    {
      id: "gallery",
      title: "Real CLI screenshots",
      paragraphs: [
        "These captures use Bruv 0.16.0 built from the current source, with an empty home and workspace, no credentials, and network access disabled. Actual terminal output was replayed through Ghostty for the images.",
        "Captures appear inside the terminal viewport. Select an image to open the full-size capture and transcript. These show local settings and help, not a connected coding session.",
      ],
      links: [
        ...captures.map((c) => ({ label: "View " + c.title.toLowerCase(), href: "./shots/" + c.id + ".html" })),
        { label: "Capture commands and provenance", href: "./assets/cli-captures.md" },
      ],
    },
    {
      id: "help",
      title: "Website controls and CLI help",
      paragraphs: [
        "This is a static website rendered in character cells. No shell, agent session, microphone or provider connection runs here. Click the peach links, or use Tab and Enter. Number keys select pages; ? opens this help.",
        "Scroll with arrow keys, Page Up/Down, the mouse wheel or a touch swipe. Home/End jump within a page. Esc uses browser history. Use the arrow controls on a touch screen.",
        "Canvas text does not provide normal document semantics to screen readers. Press A or choose HTML for the equivalent text view, with headings, selectable text and ordinary links. This option is available to everyone and is the default without JavaScript. Tab past the last terminal control to leave the terminal.",
        "Inside bruv, type / to see available commands. Question menus support typing to search, arrow keys and Enter to select, and Escape to go back without submitting.",
        "bruv update --check checks for updates without changing files. bruv update updates the sibling CLI and connector together. Stop active Bruv/T3 sessions first and restart afterward.",
        "For the optional web frontend, bruv web prints setup guidance. Install external, unmodified T3 separately and follow the tested version and connector setup in the docs.",
        "Bruv stores state under ~/.bruv. It does not automatically read or migrate old ~/.die data. Keep install and troubleshooting details in the README close at hand.",
      ],
      links: [
        { label: "Questions and remote work", href: `${repository}#questions-and-remote-work` },
        { label: "External T3 setup", href: `${repository}/blob/develop/wisdom/claude-compat/external-t3-setup.md` },
        { label: "Report an issue", href: `${repository}/issues` },
      ],
    },
  ],
};
