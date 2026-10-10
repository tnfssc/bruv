import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const guidance = readFileSync(new URL("../prompts/review.md", import.meta.url), "utf8").trim();
const choices = ["Uncommitted changes", "Against a branch…", "A commit…"];

export function registerReview(pi: ExtensionAPI) {
  pi.registerCommand("review", {
    description: "Review current changes, a branch diff, or a commit.",
    async handler(args, ctx) {
      const git = async (args: string[]) => {
        const result = await pi.exec("git", args, { cwd: ctx.cwd });
        if (result.code !== 0) throw new Error(result.stderr.trim() || "Git could not read the review target.");
        return result.stdout.trim();
      };
      await git(["rev-parse", "--show-toplevel"]);
      let ref = args.trim();
      let kind = ref ? "ref" : "uncommitted";
      if (!ref) {
        if (!ctx.hasUI) throw new Error("Choose a branch or commit with /review <ref>.");
        const choice = await ctx.ui.select("Review", choices);
        if (choice === undefined) return;
        kind = ["uncommitted", "branch", "commit"][choices.indexOf(choice)];
      }
      if (kind === "branch" || kind === "ref") {
        const refs = (
          await git(["for-each-ref", "--format=%(refname)\t%(refname:short)\t%(symref)", "refs/heads", "refs/remotes"])
        )
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split("\t"));
        if (kind === "branch") {
          const branches = refs.filter(([full]) => full.startsWith("refs/heads/")).map(([full]) => full.slice(11));
          const remote =
            refs.find(([full]) => full === "refs/remotes/origin/HEAD") ?? refs.find(([, , target]) => target);
          const remoteBranch = remote?.[2]?.replace(/^refs\/remotes\/[^/]+\//, "");
          const defaultBranch = [remoteBranch, "main", "master"].find((name) => name && branches.includes(name));
          const ordered = [
            ...branches.filter((name) => name === defaultBranch),
            ...branches.filter((name) => name !== defaultBranch),
          ];
          if (!ordered.length) throw new Error("No local branches to review against.");
          const selected = await ctx.ui.select("Against a branch", ordered);
          if (selected === undefined) return;
          ref = selected;
        } else kind = refs.some(([full, name]) => ref === full || ref === name) ? "branch" : "commit";
      }
      if (kind === "commit" && !ref) {
        const commits = (await git(["log", "-20", "--format=%H%x09%s"])).split("\n").map((line) => {
          const [hash, ...subject] = line.split("\t");
          return { hash, label: `${hash.slice(0, 8)} ${subject.join("\t")}` };
        });
        const selected = await ctx.ui.select(
          "A commit",
          commits.map((commit) => commit.label),
        );
        if (selected === undefined) return;
        ref = commits[commits.findIndex((commit) => commit.label === selected)].hash;
      }
      let target = "Review all uncommitted changes: staged, unstaged, and untracked files.";
      if (ref) {
        const hash = await git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
        target =
          kind === "branch"
            ? `Review changes against branch ${JSON.stringify(ref)} (${hash}). Find its merge base with HEAD, then compare the current working tree with that base, including untracked files.`
            : `Review only the changes introduced by commit ${hash} (${JSON.stringify(ref)}).`;
      }
      pi.sendUserMessage(`${guidance}\n\n${target}`, { deliverAs: "followUp" });
    },
  });
}
