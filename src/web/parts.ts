import type { WebPart } from "./part";
import { pushPart } from "./push";
import { appPart } from "./pwa";
import { tunnelPart } from "./tunnel";
import { voicePart } from "./voice";

/** The parts the web version starts with its server, in order. */
export function webParts(): WebPart[] {
  return [appPart(), pushPart(), tunnelPart(), voicePart()];
}
