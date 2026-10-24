import test from "node:test";
import assert from "node:assert/strict";
import { canAccessLogs, canSeeAdminNavigation } from "../src/accessControls.ts";
import { defaultSortLabel, toggleSortDirection } from "../src/sortControls.ts";
import { MAX_FILES_PER_UPLOAD, UPLOAD_LIMIT_MESSAGE, uploadLimitMessage } from "../src/uploadLimits.ts";

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
