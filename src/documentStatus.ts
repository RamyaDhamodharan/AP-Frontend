export type DocumentStatusState = {
  status?: string | null;
  failure_class?: string | null;
  next_retry_at?: string | null;
};

const processingStatuses = new Set(["uploaded", "queued", "received", "reading", "parsing", "processing", "classified", "matching"]);

export function isProcessingStatus(value?: string | null): boolean {
  return processingStatuses.has((value || "").toLowerCase());
}

export function isRetryScheduled(document: DocumentStatusState): boolean {
  return Boolean(document.next_retry_at) && document.failure_class === "retryable";
}

export function isDocumentProcessing(document: DocumentStatusState): boolean {
  return isProcessingStatus(document.status) || isRetryScheduled(document);
}

export function documentStatusLabel(document: DocumentStatusState, friendlyStatus: (status?: string | null) => string): string {
  return isDocumentProcessing(document) ? "Processing" : friendlyStatus(document.status);
}
