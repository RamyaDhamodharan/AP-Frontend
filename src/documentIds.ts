const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidDocumentId(id: unknown): id is string {
  return typeof id === "string" && UUID_PATTERN.test(id);
}

export function documentActionAvailability(id: unknown) {
  return isValidDocumentId(id)
    ? { disabled: false, title: undefined as string | undefined }
    : { disabled: true, title: "File is not available" };
}
