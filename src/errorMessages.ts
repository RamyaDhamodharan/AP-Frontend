import axios from "axios";

type ErrorResponse = { status?: number; data?: { detail?: unknown } };

function safeMetadata(error: unknown) {
  if (axios.isAxiosError(error)) {
    return { name: "AxiosError", status: error.response?.status, code: error.code, hasResponse: Boolean(error.response) };
  }
  return { name: error instanceof Error ? error.name : typeof error };
}

export function userFacingErrorMessage(error: unknown, fallback = "The request could not be completed. Try again.") {
  console.debug("Request failed", safeMetadata(error));
  const response = axios.isAxiosError(error) ? error.response as ErrorResponse | undefined : undefined;
  if (!response) {
    return axios.isAxiosError(error) && !error.response
      ? "Could not reach the service. Check your connection and try again."
      : fallback;
  }
  switch (response.status) {
    case 401: return "Your session has expired. Sign in again to continue.";
    case 403: return "You do not have permission to do this. Contact your administrator if you need access.";
    case 404: return "This file or record could not be found. Refresh and try again.";
    case 413: return "This file is too large. Choose a smaller file and try again.";
    case 415: return "This file type is not supported. Choose a supported file and try again.";
    case 422: return "Something went wrong with this file. Please retry or upload it again.";
    case 429: return "Too many requests. Wait a moment and try again.";
    case 409: return "This conflicts with an existing record. Check the name or tax ID and try again.";
    default: return (response.status || 0) >= 500
      ? "The service is temporarily unavailable. Wait a moment, then try again."
      : fallback;
  }
}
