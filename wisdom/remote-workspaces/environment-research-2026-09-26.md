# Remote tools and auth

Research date: 2026-09-26. Used installed tvly search and extract.
No real server tested. These are docs and design ideas, not die behavior.

## What other systems do

- [VS Code Remote SSH](https://code.visualstudio.com/docs/remote/ssh) puts UI extensions locally and most workspace extensions on the remote host. Its UI shows where each is installed and can install remote extensions from the client. Lesson: make placement visible; install tools where they run.
- [Coder external auth](https://coder.com/docs/admin/external-auth) injects OAuth tokens into HTTPS Git operations through GIT_ASKPASS. Its SSH Git path uses keys; a Coder-generated key must be added to the Git provider. Lesson: access to a server does not grant access to a repo. Host login and repo login are separate setup steps. Coder's control plane is an example, not a required new die service.
- [Coder admin overview](https://coder.com/docs/admin) separates shared workspace templates, dev containers and personal dotfiles. Lesson: project setup and personal tools should not be one opaque home-directory copy.
- [1Password Service Accounts](https://developer.1password.com/docs/service-accounts/) supports unattended CLI auth without tying it to an individual desktop login. Access can be limited to chosen vaults/Environments and actions, with usage reports. Lesson: a secret store can serve a remote worker while the laptop is off, but it still needs its own scoped bootstrap credential. It does not remove trust in the remote host.

## Proposed setup UX

One entry: SSH host + repo. Then a short readiness screen, not a config scavenger hunt.

Check separately:
1. SSH trust, Linux architecture, disk and outbound service access.
2. Remote die version and a service that outlives its SSH client.
3. Repo access, branch and isolated workspace. Existing uncommitted local files require an explicit snapshot choice; a clone will not include them.
4. Model auth on the remote host. Test parent and child agent use without a local proxy. Check refresh and expiry, not just one successful request.
5. Selected skills and CLI requirements. Sync plain skill text/config after review. Reinstall Linux tools from known recipes. Skills can contain machine paths, scripts and secret references too.
6. Each tool's auth. Mark ready, needs login, expires soon, or Mac-only.

Show a plan before changing a host or transferring secrets. Prefer per-host or per-repo scoped credentials. A secret in a file, environment, or injected process is still usable by code with that access. Do not promise secret isolation from arbitrary agent code on the same account.

Offer a deterministic setup path for known tools. For unknown tools, let an agent inspect the error, suggest a Linux recipe or alternative, then ask for needed permission. Save a working recipe. Do not create a universal plugin framework before there is a need.

Mac bridge is optional. It must name the host and capability. No automatic retry of a mutating Mac command after a lost reply. Mac-only dependencies mean work may block while the laptop is offline; display that before launch.

## Acceptance target

Ready to close your laptop means model requests, repo fetch/push, required CLI auth, skills and child agents no longer route through it. It does not mean jobs can never fail or never need a decision. Save pending questions and let independent work continue.

First proof: run on real Linux from a Mac client, cut the connection during work, and reconnect to the same task/result without resubmitting it. Test approval-needed and expired-auth paths too. Server restart recovery is a separate test and promise.

Values unchanged. These are specific uses of ownership, truthful status, safe recovery and user control already in values.md.

## Parent cross-check of product pages

Tavily hit its keyless hourly cap during worker research. Parent fetched primary pages directly with Python requests + BeautifulSoup. No paid fallback used.

- [Grok Bot](https://cursor.com/docs/grok-bot) returned 200. This is a real named product in Cursor's docs, and a plausible match for the user's “grogbot.” Do not silently replace it with OpenClaw. The page explicitly says its bots run on a persistent cloud computer and keep working with the laptop closed. Bots on one account share files, browser sessions and app logins. Setup is conversational; stable workflows can become skills. This is a useful UX precedent, not evidence that die can or should copy browser logins.
- [Cursor cloud agent security](https://cursor.com/docs/cloud-agent/security-network) returned 200. It documents runtime secret redaction, separate build secrets, OIDC identity tokens, isolated VMs and egress controls. It also says runtime secrets are still environment variables visible through the terminal. Redaction is useful output hygiene, not a security boundary against code execution.
- [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) returned 200. Its limitations explicitly advise tmux or screen to keep the remote machine session alive after SSH disconnect. This supports the distinction between remote access and persistent process ownership. Running on the Mac still depends on the Mac; running on an always-on server changes that dependency.
- Guessed Cursor overview and choose-where-cloud-agents-run URLs returned 404. Do not cite those as evidence. Await the product worker for exact current routes.
