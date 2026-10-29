import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// shadcn/ui's button (new-york), without borders, as the old voice page had.
const variants = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
};
const sizes = {
  default: "h-9 px-4 gap-2",
  sm: "h-8 px-2 gap-1.5 text-[13px]",
  icon: "size-9",
};

export function Button({
  className,
  variant = "default",
  size = "default",
  round = false,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants; size?: keyof typeof sizes; round?: boolean }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap font-medium text-sm transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg:not([class*='size-'])]:size-5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        round ? "rounded-full" : "rounded-md",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
