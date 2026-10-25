import { isValidDocumentId } from "./documentIds.ts";
export function sourceFileActionAvailability(sourceDocumentId?: string | null) {
  const available = isValidDocumentId(sourceDocumentId);
  return { disabled: !available, title: available ? undefined : "File is not available" };
}

export function sourceFileViewerMode(filename: string): "inline" | "extracted-preview" | "unsupported" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "extracted-preview";
  if ([".pdf", ".png", ".jpg", ".jpeg"].some(extension => lower.endsWith(extension))) return "inline";
  return "unsupported";
}

export function sourceFilePreviewMime(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return null;
}
