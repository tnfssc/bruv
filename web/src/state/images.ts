/** The longest side a picture keeps. Models scale down past this anyway. */
const longest = 2048;
const quality = 0.85;

/**
 * Shrinks a picture on the device and returns it as a data URL: WebP where the browser can write it,
 * else JPEG on white (JPEG has no transparency).
 */
export async function shrink(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) {
    bitmap.close();
    return webp;
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

/** The pictures among pasted or dropped files. */
export function pictures(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
}
