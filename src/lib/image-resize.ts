const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

// Heic/heif can be displayed by Safari but NOT embedded by pdf-lib, so those
// files must always be re-encoded to JPEG, even if the result is not smaller.
const mustConvert = (file: File) => /hei[cf]/i.test(file.type);

export async function decodeImageFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/**
 * Shrinks a camera/library photo for upload: longest edge at most 1600px,
 * JPEG quality ~0.8. Keeps the original file only if decoding fails or if
 * re-encoding would grow a non-HEIC file.
 */
export async function resizeImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const image = await decodeImageFile(file);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (longest === 0) return file;
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;
    if (blob.size >= file.size && !mustConvert(file)) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "foto";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  }
}
