import { isValidDocumentId } from "./documentIds.ts";
export function sourceFileActionAvailability(sourceDocumentId?: string | null) {
  const available = isValidDocumentId(sourceDocumentId);
  return { disabled: !available, title: available ? undefined : "File is not available" };
}
