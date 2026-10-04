/** One GitHub-hosted installer, independent of the landing page's origin. */
export const INSTALL_URL = "https://raw.githubusercontent.com/tnfssc/bruv/develop/scripts/install.sh";
export const INSTALL_SOURCE_URL = "https://github.com/tnfssc/bruv/blob/develop/scripts/install.sh";
export const INSTALL_COMMAND = "curl -fsSL '" + INSTALL_URL + "' | sh";
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
  const command = INSTALL_COMMAND;
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
