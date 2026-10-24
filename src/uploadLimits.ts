export const MAX_FILES_PER_UPLOAD = 5;
export const UPLOAD_LIMIT_MESSAGE = "You can upload up to 5 files at a time";

export function uploadLimitMessage(fileCount: number): string | null {
  return fileCount > MAX_FILES_PER_UPLOAD ? UPLOAD_LIMIT_MESSAGE : null;
}
