import test from "node:test";
import assert from "node:assert/strict";
import { canAccessLogs, canSeeAdminNavigation } from "../src/accessControls.ts";
import { defaultSortLabel, toggleSortDirection } from "../src/sortControls.ts";
import { MAX_FILES_PER_UPLOAD, UPLOAD_LIMIT_MESSAGE, uploadLimitMessage } from "../src/uploadLimits.ts";
import { userFacingErrorMessage } from "../src/errorMessages.ts";
import { documentActionAvailability, isValidDocumentId } from "../src/documentIds.ts";
import axios from "axios";

test("Logs navigation and access are admin-only", () => {
  assert.equal(canSeeAdminNavigation("admin"), true);
  assert.equal(canAccessLogs("admin"), true);
  assert.equal(canSeeAdminNavigation("associate"), false);
  assert.equal(canAccessLogs("associate"), false);
  assert.equal(canAccessLogs(null), false);
});

test("sort direction toggles and labels the current server order", () => {
  assert.equal(toggleSortDirection("asc"), "desc");
  assert.equal(toggleSortDirection("desc"), "asc");
  assert.equal(defaultSortLabel("Due date", "asc"), "Due Date ascending");
  assert.equal(defaultSortLabel("Amount", "desc"), "Amount descending");
});

test("upload selection allows five files and rejects larger batches clearly", () => {
  assert.equal(MAX_FILES_PER_UPLOAD, 5);
  assert.equal(uploadLimitMessage(5), null);
  assert.equal(uploadLimitMessage(6), UPLOAD_LIMIT_MESSAGE);
});

test("file API errors are mapped to plain user messages", () => {
  const cases = [
    [401, "Your session has expired. Sign in again to continue."],
    [403, "You do not have permission to do this. Contact your administrator if you need access."],
    [404, "This file or record could not be found. Refresh and try again."],
    [413, "This file is too large. Choose a smaller file and try again."],
    [415, "This file type is not supported. Choose a supported file and try again."],
    [422, "Something went wrong with this file. Please retry or upload it again."],
    [503, "The service is temporarily unavailable. Wait a moment, then try again."],
  ];
  const debug = console.debug;
  console.debug = () => {};
  try {
    for (const [status, message] of cases) {
      const error = Object.assign(new Error("raw secret detail"), { isAxiosError: true, response: { status, data: { detail: [{ msg: "private content" }] } } });
      assert.equal(userFacingErrorMessage(error), message);
    }
    assert.equal(userFacingErrorMessage(Object.assign(new Error("private"), { isAxiosError: true })), "Could not reach the service. Check your connection and try again.");
  } finally { console.debug = debug; }
});

test("document actions are disabled when the id is missing or not a UUID", () => {
  for (const id of [null, undefined, "", "null", "not-a-uuid"]) {
    assert.equal(isValidDocumentId(id), false);
    assert.deepEqual(documentActionAvailability(id), { disabled: true, title: "File is not available" });
  }
  const id = "e6ab4db7-39ab-4a67-a533-231bf915c933";
  assert.equal(isValidDocumentId(id), true);
  assert.deepEqual(documentActionAvailability(id), { disabled: false, title: undefined });
});
