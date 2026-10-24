import test from "node:test";
import assert from "node:assert/strict";
import { canAccessLogs, canSeeAdminNavigation } from "../src/accessControls.ts";
import { defaultSortLabel, toggleSortDirection } from "../src/sortControls.ts";
import { isDocxFilename, isSupportedUploadFilename, MAX_FILES_PER_UPLOAD, UPLOAD_LIMIT_MESSAGE, uploadLimitMessage } from "../src/uploadLimits.ts";
import { userFacingErrorMessage } from "../src/errorMessages.ts";
import { documentActionAvailability, isValidDocumentId } from "../src/documentIds.ts";
import { documentDetailSectionTitle, linkedRecordDestination } from "../src/documentNavigation.ts";
import { vendorMatches } from "../src/vendorMatching.ts";
import { sourceFileActionAvailability, sourceFilePreviewMime, sourceFileViewerMode } from "../src/sourceFileActions.ts";
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

test("DOCX is a supported upload and View document uses extracted content", () => {
  assert.equal(isSupportedUploadFilename("invoice.docx"), true);
  assert.equal(isSupportedUploadFilename("invoice.DOCX"), true);
  assert.equal(isSupportedUploadFilename("invoice.docm"), false);
  assert.equal(isSupportedUploadFilename("invoice.doc"), false);
  assert.equal(isDocxFilename("invoice.DOCX"), true);
  assert.equal(isDocxFilename("invoice.docm"), false);
  assert.equal(sourceFileViewerMode("invoice.docx"), "extracted-preview");
  assert.equal(sourceFileViewerMode("invoice.pdf"), "inline");
  assert.equal(sourceFileViewerMode("photo.png"), "inline");
  assert.equal(sourceFilePreviewMime("invoice.pdf"), "application/pdf");
  assert.equal(sourceFilePreviewMime("photo.jpg"), "image/jpeg");
  assert.equal(sourceFileViewerMode("message.eml"), "unsupported");
  assert.equal(sourceFilePreviewMime("message.eml"), null);
});

test("file API errors are mapped to plain user messages", () => {
  const cases = [
    [401, "Your session has expired. Sign in again to continue."],
    [403, "You do not have permission to do this. Contact your administrator if you need access."],
    [404, "This file or record could not be found. Refresh and try again."],
    [413, "This file is too large. Choose a smaller file and try again."],
    [415, "This file type is not supported. Choose a supported file and try again."],
    [422, "Something went wrong with this file. Please retry or upload it again."],
    [409, "This conflicts with an existing record. Check the name or tax ID and try again."],
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

test("drawer source-file actions are disabled without a valid source document id", () => {
  for (const id of [null, undefined, "", "null", "not-a-uuid"]) {
    assert.deepEqual(sourceFileActionAvailability(id), { disabled: true, title: "File is not available" });
  }
  assert.deepEqual(sourceFileActionAvailability("e6ab4db7-39ab-4a67-a533-231bf915c933"), { disabled: false, title: undefined });
});

test("document cards route to linked records and keep failed or unlinked documents in the modal", () => {
  assert.deepEqual(linkedRecordDestination({ status: "extracted", doc_type: "invoice", linked_invoice_id: "i-1" }), { page: "invoices", recordId: "i-1" });
  assert.deepEqual(linkedRecordDestination({ status: "extracted", doc_type: "po", linked_po_id: "p-1" }), { page: "purchase-orders", recordId: "p-1" });
  assert.deepEqual(linkedRecordDestination({ status: "extracted", doc_type: "goods_receipt", linked_gr_id: "g-1" }), { page: "goods-receipts", recordId: "g-1" });
  assert.deepEqual(linkedRecordDestination({ status: "failed", doc_type: "goods_receipt", linked_gr_id: "g-1" }), { page: "goods-receipts", recordId: "g-1" });
  assert.deepEqual(linkedRecordDestination({ status: "needs_data_review", doc_type: "purchase_order", linked_po_id: "p-2" }), { page: "purchase-orders", recordId: "p-2" });
  assert.equal(linkedRecordDestination({ status: "extracted", doc_type: "goods_receipt" }), null);
});

test("vendor matching recognizes canonical name or tax id and flags unknown vendors", () => {
  const vendors = [{ name: "Acme Supplies", tax_id: "GST-123" }];
  assert.equal(vendorMatches({ name: "  ACME   SUPPLIES " }, vendors), true);
  assert.equal(vendorMatches({ name: "Different", tax_id: "GST-123" }, vendors), true);
  assert.equal(vendorMatches({ name: "Acme Supplies", tax_id: "GST-999" }, vendors), false);
  assert.equal(vendorMatches({ name: "Unknown Co", tax_id: "GST-999" }, vendors), false);
});

test("document detail section headings follow document type", () => {
  assert.equal(documentDetailSectionTitle("goods_receipt"), "Goods Receipt");
  assert.equal(documentDetailSectionTitle("po"), "Purchase Order");
  assert.equal(documentDetailSectionTitle("invoice"), "Invoice");
  assert.equal(documentDetailSectionTitle(null), "Document");
});
