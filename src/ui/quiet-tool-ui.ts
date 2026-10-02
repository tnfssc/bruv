import { AssistantMessageComponent, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { Container, MouseRegion, Spacer, Text, type Component } from "@earendil-works/pi-tui";

// Pi 1.0.0 has no public option for either of these two presentation choices.
// Adapt its mutable UI methods locally; never change the shared SDK installation.
export function installQuietToolUi(): () => void {
  const assistant = AssistantMessageComponent.prototype;
  const nativeUpdate = assistant.updateContent;
  type AssistantSeam = { contentContainer: Container };
  function quietUpdate(this: AssistantMessageComponent, ...args: Parameters<typeof nativeUpdate>): void {
    nativeUpdate.apply(this, args);
    const container = (this as unknown as AssistantSeam).contentContainer;
    const children: Component[] = [];
    let removed = false;
    for (let index = 0; index < container.children.length; index++) {
      const child = container.children[index]!;
      // In this SDK only hidden thinking is a Text-backed MouseRegion. Visible
      // thinking and ordinary prose are Markdown, and stay entirely native.
      if (child instanceof MouseRegion && (child as unknown as { child: Component }).child instanceof Text) {
        removed = true;
        if (container.children[index + 1] instanceof Spacer) index++;
      } else children.push(child);
    }
    if (removed) {
      if (children.every((child) => child instanceof Spacer)) children.length = 0;
      container.children = children;
    }
  }
  const interactive = InteractiveMode.prototype as unknown as { showStatus: (message: string) => void };
  const nativeStatus = interactive.showStatus;
  type StatusSeam = {
    chatContainer: Container;
    lastStatusMessage?: string;
    lastStatusText?: Component;
    lastStatusSpacer?: Component;
    ui: { requestRender(): void };
  };
  function quietStatus(this: StatusSeam, message: string): void {
    if (message !== "Tool output: collapsed") {
      nativeStatus.call(this, message);
      return;
    }
    // Do not leave the preceding transient "expanded" notice lying about the
    // current mode. Remove only the still-current tool-output status pair.
    const children = this.chatContainer.children;
    if (
      this.lastStatusMessage === "Tool output: expanded" &&
      children.at(-1) === this.lastStatusText &&
      children.at(-2) === this.lastStatusSpacer
    ) {
      children.splice(-2);
      this.lastStatusText = undefined;
      this.lastStatusSpacer = undefined;
      this.lastStatusMessage = undefined;
      this.ui.requestRender();
    }
  }
  assistant.updateContent = quietUpdate;
  interactive.showStatus = quietStatus;
  return () => {
    if (assistant.updateContent === quietUpdate) assistant.updateContent = nativeUpdate;
    if (interactive.showStatus === quietStatus) interactive.showStatus = nativeStatus;
  };
}
