/** Shell-quote the real served URL, including deployment subpaths. */
export const installCommand = (url: string) => "curl -fsSL '" + url.replaceAll("'", "'\"'\"'") + "' | sh";
export function browserInstallUrl() {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="bruv-install-url"]')?.content ||
    new URL("./install.sh", location.href).href
  );
}
export async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command);
  } catch {
    const input = document.createElement("textarea");
    input.value = command;
    input.style.cssText = "position:fixed;opacity:0";
    document.body.append(input);
    const focus = document.activeElement as HTMLElement | null;
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    focus?.focus({ preventScroll: true });
    if (!copied) throw new Error("Select and copy the install command in HTML view.");
  }
}
export function enhanceInstall() {
  const command = installCommand(browserInstallUrl());
  document.querySelectorAll<HTMLElement>("[data-install-command]").forEach((el) => {
    el.textContent = command;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-copy-install]").forEach((button) => {
    button.hidden = false;
    let timer: ReturnType<typeof setTimeout>;
    button.addEventListener("click", async () => {
      try {
        await copyCommand(command);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select command to copy";
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = "Copy command";
      }, 1800);
    });
  });
}
