export type DocumentLink = { status: string; doc_type?: string | null; linked_invoice_id?: string | null; linked_po_id?: string | null; linked_gr_id?: string | null };
export function linkedRecordDestination(document: DocumentLink) {
  if (["received", "reading", "parsing", "processing", "queued", "uploaded", "classified", "matching", "failed", "incomplete", "needs_data_review", "needs_vendor_review"].includes(document.status.toLowerCase())) return null;
  if (document.doc_type === "invoice" && document.linked_invoice_id) return { page: "invoices" as const, recordId: document.linked_invoice_id };
  if (["po", "purchase_order"].includes(document.doc_type || "") && document.linked_po_id) return { page: "purchase-orders" as const, recordId: document.linked_po_id };
  if (document.doc_type === "goods_receipt" && document.linked_gr_id) return { page: "goods-receipts" as const, recordId: document.linked_gr_id };
  return null;
}
export function documentDetailSectionTitle(docType?: string | null) {
  if (docType === "po" || docType === "purchase_order") return "Purchase Order";
  if (docType === "goods_receipt") return "Goods Receipt";
  if (docType === "invoice") return "Invoice";
  return "Document";
}
