export const MAX_FILES_PER_UPLOAD = 5;
export const UPLOAD_LIMIT_MESSAGE = "You can upload up to 5 files at a time";
const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".docx",
  ".eml",
]);

export function uploadLimitMessage(fileCount: number): string | null {
  return fileCount > MAX_FILES_PER_UPLOAD ? UPLOAD_LIMIT_MESSAGE : null;
}

export function isSupportedUploadFilename(filename: string): boolean {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.has(extension);
}

export function isDocxFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".docx");
}
