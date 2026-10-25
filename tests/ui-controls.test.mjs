import test from "node:test";
import assert from "node:assert/strict";
import { canAccessLogs, canSeeAdminNavigation } from "../src/accessControls.ts";
import { defaultSortLabel, toggleSortDirection } from "../src/sortControls.ts";
import { isSupportedUploadFilename, uploadLimitMessage } from "../src/uploadLimits.ts";

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

test("upload limits and supported filename checks", () => {
  assert.equal(uploadLimitMessage(5), null);
  assert.equal(uploadLimitMessage(6), "You can upload up to 5 files at a time");
  assert.equal(isSupportedUploadFilename("invoice.pdf"), true);
  assert.equal(isSupportedUploadFilename("SCAN_01.PNG"), true);
  assert.equal(isSupportedUploadFilename("bill.docx"), true);
  assert.equal(isSupportedUploadFilename("README"), false);
  assert.equal(isSupportedUploadFilename(""), false);
  assert.equal(isSupportedUploadFilename("file.exe"), false);
});
