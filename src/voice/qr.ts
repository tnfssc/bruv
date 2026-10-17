import { renderSVG, renderUnicodeCompact } from "uqr";

/**
 * QR codes for the voice page's address, so a phone is one scan away. Terminals are dark, so the light
 * squares are the ones drawn: the code then reads dark on light, as every scanner expects.
 */
export function qrLines(url: string) {
  return renderUnicodeCompact(url, { ecc: "M", border: 2 }).split("\n");
}

/** The same code as SVG, for the voice page on a computer. */
export function qrSvg(url: string) {
  return renderSVG(url, { ecc: "M", border: 2, pixelSize: 6, whiteColor: "#ffffff", blackColor: "#000000" });
}
