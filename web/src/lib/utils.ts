import { type ClassValue, clsx } from "clsx";

/** Joins class names. No tailwind-merge (8 KB): components avoid passing classes that fight their own. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
