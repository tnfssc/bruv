import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui's sheet on Base UI's dialog: a panel over the page from the right. It fades in rather than
 * sliding, so nothing on the page seems to move.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-opacity duration-150" />
        <Dialog.Popup
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-background shadow-float outline-none transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            className,
          )}
        >
          <div className="flex items-center justify-between gap-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-1 pl-5">
            <Dialog.Title className="font-medium text-base">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="grid size-9 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
