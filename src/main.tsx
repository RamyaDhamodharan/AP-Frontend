import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { createAuthSession } from "./authSession";
import "./styles/globals.css";


const AUTH_URL = import.meta.env.VITE_AUTH_API_BASE_URL;
const CORE_URL = import.meta.env.VITE_AP_API_BASE_URL;

declare module "axios" {
  interface InternalAxiosRequestConfig {
    authRetried?: boolean;
  }
}

const authSession = createAuthSession(async () => {
  const response = await axios.post<{ access_token: string }>(
    `${AUTH_URL}/api/auth/refresh`,
    {},
    {
      withCredentials: true,
      headers: { "X-CSRF-Protection": "1" },
    },
  );
  return response.data.access_token || null;
});

axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (
    typeof CORE_URL === "string" &&
    config.url?.startsWith(CORE_URL) &&
    authSession.getAccessToken()
  ) {
    config.headers.set(
      "Authorization",
      `Bearer ${authSession.getAccessToken()}`,
    );
  }
  return config;
});

axios.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config;
  if (
    error.response?.status !== 401 ||
    !config ||
    config.authRetried ||
    typeof CORE_URL !== "string" ||
    !config.url?.startsWith(CORE_URL)
  ) {
    return Promise.reject(error);
  }
  config.authRetried = true;
  const refreshed = await authSession.refresh();
  if (!refreshed) return Promise.reject(error);
  config.headers.set("Authorization", `Bearer ${refreshed}`);
  return axios.request(config);
});


type Doc = {
  id: string;
  original_filename: string;
  status: string;
  extracted_json?: Record<string, unknown> | null;
  raw_text?: string | null;
  doc_type?: string | null;
  failure_message?: string | null;
  created_at?: string;
  updated_at?: string;
  audit_history?: { action: string; result: string; message?: string | null; created_by?: string | null; created_at: string }[];
};

type DocumentListResponse = { items: Doc[]; total: number; page: number; page_size: number };

type Invoice = {
  invoice_id: string;
  source_document_id?: string | null;
  processing_status?: string | null;
  invoice_no?: string | null;
  vendor_name?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  total_amount?: number | string | null;
  currency?: string | null;
  match_status?: string | null;
  final_status?: string | null;
};

type InvoiceResponse = {
  items: Invoice[];
  total: number;
  page: number;
  page_size: number;
};

type GoodsReceipt = {
  id: string; gr_number: string; po_id: string; vendor_id: string;
  receipt_date: string; source_document_id?: string | null;
  lines: { id: string; po_line_id: string; item_code?: string | null; description?: string | null; received_qty: number | string; accepted_qty: number | string; rejected_qty: number | string }[];
};

type PurchaseOrderLine = {
  id: string; po_id: string; item_code: string | null; description: string | null;
  uom: string | null; qty: number | string | null; unit_price: number | string | null;
  line_amount: number | string | null;
};
type PurchaseOrder = {
  id: string; po_number: string; version_no: number; is_current: boolean;
  vendor_id: string | null; vendor_name: string | null; currency: string;
  total_amount: number | string | null; lines: PurchaseOrderLine[];
  payment_terms?: unknown; delivery_details?: unknown;
};
type Vendor = { id: string; name: string; tax_id: string | null; is_active: boolean };
type Workflow = {
  document_id: string; status: string; available_documents: { id: string; type: string; reference?: string | null }[];
  missing_document_types: string[];
  candidates: { record_type: "purchase_order" | "goods_receipt" | "invoice"; id: string; evidence: Record<string, unknown> }[];
  checks: { finding_id?: string | null; category?: string | null; finding_status?: "supported" | "open" | "not_verifiable" | null; evidence_record_ids?: string[]; name: string; outcome: "passed" | "mismatch" | "not_possible"; severity: string; expected?: string | number | null; actual?: string | number | null; difference?: string | number | null; reason: string }[];
  recommended_next_actions: string[]; human_review_required: boolean; human_decision_required: boolean;
  invoice_approval_required: boolean; decision?: string | null; decision_reason?: string | null;
};
type MatchingResult = {
  invoice_id?: string; matched: boolean; requires_review: boolean; issues?: string[]; status?: string;
  processing_status?: string; matching_status?: string; review_status?: string;
  approval_status?: string; payment_status?: "unknown";
  supporting_records?: { id: string; type: string; reference?: string | null }[];
  discrepancies?: Workflow["checks"];
  reason_codes?: string[]; next_recommended_action?: string;
  missing_document_types?: string[]; available_documents?: Workflow["available_documents"];
  candidates?: Workflow["candidates"]; checks?: Workflow["checks"];
  recommended_next_actions?: string[]; human_review_required?: boolean;
  human_decision_required?: boolean; invoice_approval_required?: boolean;
};

const labels: Record<string, string> = {
  received: "Received", parsing: "Parsing", parsed: "Parsed",
  classified: "Classified", extracted: "Extracted", failed: "Failed",
  duplicate_blocked: "Duplicate", needs_vendor_review: "Needs review",
  incomplete: "Incomplete", processed: "Processed", ignored: "Ignored",
};
const labelFor = (s: string) => labels[s] ?? s.replaceAll("_", " ");
const valueFor = (v: unknown) => v == null || v === "" ? "Not available" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);

function App() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [token, setToken] = useState("");
  const [restoringSession, setRestoringSession] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docsTotal, setDocsTotal] = useState(0);
  const [docsPage, setDocsPage] = useState(1);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState("");
  const [selected, setSelected] = useState<Doc | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [goodsReceipts, setGoodsReceipts] = useState<GoodsReceipt[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<GoodsReceipt | null>(null);
  const [workspacePage, setWorkspacePage] = useState<"documents" | "purchase-orders" | "goods-receipts" | "invoice-review">("documents");
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendorChoice, setVendorChoice] = useState("");
  const [vendorReviewNewMode, setVendorReviewNewMode] = useState(false);
  const [vendorReviewError, setVendorReviewError] = useState("");
  const [vendorReviewBusy, setVendorReviewBusy] = useState(false);
  const [newVendor, setNewVendor] = useState({ name: "", tax_id: "", contact_name: "", contact_email: "", contact_phone: "" });
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [poPage, setPoPage] = useState(1);
  const [poTotal, setPoTotal] = useState(0);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [workflowDocument, setWorkflowDocument] = useState<string | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [matchingBusyId, setMatchingBusyId] = useState<string | null>(null);
  const [matchingResult, setMatchingResult] = useState<MatchingResult | null>(null);
  const [matchingInvoiceId, setMatchingInvoiceId] = useState<string | null>(null);
  const [matchingError, setMatchingError] = useState("");
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [receiptForm, setReceiptForm] = useState({ gr_number: "", receipt_date: new Date().toISOString().slice(0, 10), po_id: "" });
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, { received: string; accepted: string; rejected: string }>>({});
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  function authHeaders() { return { Authorization: `Bearer ${authSession.getAccessToken()}` }; }
  function clearAuthenticatedSession() {
    authSession.clear();
    setToken("");
    setDocs([]);
    setDocsTotal(0);
    setDocsPage(1);
    setDocsError("");
    setSelected(null);
    setInvoices([]);
    setGoodsReceipts([]);
    setSelectedReceipt(null);
    setPurchaseOrders([]);
    setSelectedPO(null);
    setWorkflow(null);
    setWorkflowDocument(null);
    setMatchingResult(null);
    setMatchingInvoiceId(null);
    setMatchingError("");
    setWorkspacePage("documents");
    setReceiptForm({ gr_number: "", receipt_date: new Date().toISOString().slice(0, 10), po_id: "" });
    setReceiptQuantities({});
    setReceiptError("");
  }

  useEffect(() => {
    let mounted = true;
    void authSession.restore().then(restoredToken => {
      if (mounted && restoredToken) setToken(restoredToken);
    }).finally(() => {
      if (mounted) setRestoringSession(false);
    });
    return () => { mounted = false; };
  }, []);
  function reportApiError(error: unknown, fallback: string) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearAuthenticatedSession();
      setMessage("Your session expired. Sign in again to continue.");
      return;
    }
    setMessage(axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : fallback);
  }

  async function loadDocuments(page = docsPage, status = filter) {
    if (!token) { setDocs([]); setDocsTotal(0); return; }
    setDocsLoading(true);
    setDocsError("");
    try {
      const query = new URLSearchParams({ page: String(page), page_size: "20" });
      if (status !== "all") query.set("status", status);
      const response = await axios.get<DocumentListResponse>(`${CORE_URL}/api/documents?${query}`, { headers: authHeaders() });
      setDocs(response.data.items ?? []);
      setDocsTotal(response.data.total ?? 0);
      setDocsPage(response.data.page ?? page);
      setSelected(current => current ? response.data.items.find(item => item.id === current.id) ?? current : null);
    } catch (error) {
      const detail = axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : "Could not load documents.";
      setDocsError(detail);
      reportApiError(error, "Could not load documents.");
    } finally { setDocsLoading(false); }
  }

  async function loadDocumentDetail(documentId: string) {
    try {
      const response = await axios.get<Doc>(`${CORE_URL}/api/documents/${documentId}`, { headers: authHeaders() });
      updateDoc(response.data);
      return response.data;
    } catch (error) {
      reportApiError(error, "Could not load document details.");
      return null;
    }
  }

  async function pollDocument(documentId: string) {
    const terminal = new Set(["extracted", "needs_vendor_review", "incomplete", "failed", "processed", "ignored"]);
    let latest: Doc | null = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 1500));
      latest = await loadDocumentDetail(documentId);
      if (!latest || terminal.has(latest.status)) break;
    }
    if (!latest) return;
    if (terminal.has(latest.status)) {
      setMessage(latest.status === "failed" ? latest.failure_message ?? "Processing failed." : `Processing finished: ${labelFor(latest.status)}.`);
      await Promise.all([loadWorkflow(documentId, false), loadInvoices(), loadGoodsReceipts(), loadPurchaseOrders()]);
    } else {
      setMessage("Processing is still underway. Refresh the document to check again.");
    }
    await loadDocuments();
  }

  async function loadGoodsReceipts() {
    if (!token) { setGoodsReceipts([]); return; }
    try {
      const response = await axios.get<GoodsReceipt[]>(`${CORE_URL}/api/goods-receipts?page=1&page_size=100`, { headers: authHeaders() });
      setGoodsReceipts(response.data ?? []);
    } catch (error) {
      reportApiError(error, "Could not load goods receipts.");
    }
  }

  async function loadPurchaseOrders() {
    if (!token) { setPurchaseOrders([]); return; }
    try {
      const response = await axios.get<{ items: PurchaseOrder[]; total: number }>(`${CORE_URL}/api/purchase-orders?page=${poPage}&page_size=20`, { headers: authHeaders() });
      setPurchaseOrders(response.data.items ?? []);
      setPoTotal(response.data.total ?? 0);
    } catch (error) { reportApiError(error, "Could not load purchase orders."); }
  }

  async function loadVendors(search = "") {
    try {
      const query = new URLSearchParams({ page: "1", page_size: "100" });
      if (search.trim()) query.set("search", search.trim());
      const response = await axios.get<Vendor[]>(`${CORE_URL}/api/vendors?${query}`, { headers: authHeaders() });
      setVendors((response.data ?? []).filter(vendor => vendor.is_active));
    } catch (error) { reportApiError(error, "Could not load vendors."); }
  }

  async function loadPurchaseOrderDetail(poId: string) {
    try {
      const response = await axios.get<PurchaseOrder>(`${CORE_URL}/api/purchase-orders/${poId}`, { headers: authHeaders() });
      setSelectedPO(response.data);
    } catch (error) { reportApiError(error, "Could not load purchase order details."); }
  }

  async function resolvePurchaseOrderVendor(document: Doc) {
    setVendorReviewBusy(true);
    setVendorReviewError("");
    try {
      let payload: Record<string, unknown>;
      if (vendorReviewNewMode) {
        if (!window.confirm(`Create vendor “${newVendor.name.trim()}” and save this purchase order?`)) return;
        payload = { new_vendor: {
          name: newVendor.name,
          tax_id: newVendor.tax_id.trim() || null,
          contact_name: newVendor.contact_name.trim() || null,
          contact_email: newVendor.contact_email.trim() || null,
          contact_phone: newVendor.contact_phone.trim() || null,
        } };
      } else {
        if (!vendorChoice) { setVendorReviewError("Select an existing vendor first."); return; }
        payload = { vendor_id: vendorChoice };
      }
      const response = await axios.post<{ document: Doc }>(
        `${CORE_URL}/api/documents/${document.id}/resolve-po-vendor`,
        payload,
        { headers: authHeaders() }
      );
      updateDoc(response.data.document);
      setMessage("Vendor resolved and purchase order saved.");
      await Promise.all([loadDocuments(), loadPurchaseOrders(), loadWorkflow(document.id, false)]);
    } catch (error) {
      const detail = axios.isAxiosError(error) ? String(error.response?.data?.detail?.validation_issues?.join?.("; ") ?? error.response?.data?.detail ?? error.message) : "Could not resolve the PO vendor.";
      setVendorReviewError(detail);
      reportApiError(error, "Could not resolve the PO vendor.");
    } finally { setVendorReviewBusy(false); }
  }

  async function loadGoodsReceiptDetail(receiptId: string) {
    try {
      const response = await axios.get<GoodsReceipt>(`${CORE_URL}/api/goods-receipts/${receiptId}`, { headers: authHeaders() });
      setSelectedReceipt(response.data);
    } catch (error) { reportApiError(error, "Could not load goods receipt details."); }
  }

  async function loadInvoices() {
    if (!token) {
      setInvoices([]);
      return;
    }
    setInvoiceLoading(true);
    setInvoiceError("");
    try {
      const response = await axios.get<InvoiceResponse>(
        `${CORE_URL}/api/invoices/review-queue?page=1&page_size=100`,
        { headers: authHeaders() }
      );
      setInvoices(response.data.items ?? []);
    } catch (error) {
      setInvoiceError(axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : "Could not load invoice review queue.");
      reportApiError(error, "Could not load invoice review queue.");
    } finally { setInvoiceLoading(false); }
  }

  useEffect(() => {
    void loadInvoices();
    void loadGoodsReceipts();
    void loadPurchaseOrders();
  }, [token]);

  useEffect(() => {
    if (token) void loadDocuments(docsPage, filter);
  }, [token, docsPage, filter]);

  useEffect(() => {
    if (token && selected?.doc_type === "po" && selected.status === "needs_vendor_review") {
      setVendorChoice("");
      setVendorSearch("");
      setVendorReviewNewMode(false);
      setVendorReviewError("");
      void loadVendors();
    }
  }, [token, selected?.id, selected?.doc_type, selected?.status]);

  useEffect(() => {
    if (token) void loadPurchaseOrders();
  }, [poPage]);

  async function reviewInvoice(
    invoice: Invoice,
    decision: "approved" | "rejected" | "on_hold"
  ) {
    const invoiceLabel = invoice.invoice_no ?? invoice.invoice_id;

    if (!window.confirm(`Confirm ${decision} for invoice ${invoiceLabel}?`)) {
      return;
    }

    setReviewBusyId(invoice.invoice_id);
    setMessage("");

    try {
      await axios.post(
        `${CORE_URL}/api/invoices/${invoice.invoice_id}/review`,
        { decision },
        { headers: authHeaders() }
      );

      setMessage(`Invoice ${invoiceLabel}: ${decision}.`);
      await loadInvoices();
    } catch (error) {
      reportApiError(error, "Review action failed.");
    } finally {
      setReviewBusyId(null);
    }
  }
  function updateDoc(doc: Doc) {
    setDocs(old => old.some(d => d.id === doc.id) ? old.map(d => d.id === doc.id ? { ...d, ...doc } : d) : [doc, ...old]);
    setSelected(old => old?.id === doc.id ? { ...old, ...doc } : doc);
  }

  async function authSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      if (mode === "register") {
        await axios.post(`${AUTH_URL}/api/auth/register`, { email, password, full_name: fullName });
        setMode("login"); setPassword(""); setMessage("Registration successful. Please sign in.");
      } else {
        const r = await axios.post(`${AUTH_URL}/api/auth/login`, { email, password }, { withCredentials: true });
        const t = r.data.access_token;
        if (t) { authSession.setAccessToken(t); setToken(t); } else setMessage("Login response did not include an access token.");
      }
    } catch (e) {
      setMessage(axios.isAxiosError(e) ? String(e.response?.data?.detail ?? e.message) : "Something went wrong.");
    } finally { setBusy(false); }
  }

  async function logoutSession() {
    setBusy(true);
    try {
      await axios.post(
        `${AUTH_URL}/api/auth/logout`,
        {},
        {
          withCredentials: true,
          headers: { "X-CSRF-Protection": "1" },
        },
      );
      clearAuthenticatedSession();
      setMessage("");
    } catch (error) {
      setMessage(
        axios.isAxiosError(error)
          ? String(error.response?.data?.detail ?? error.message)
          : "Secure sign out failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
  const files = Array.from(e.target.files ?? []);
  e.target.value = "";
  if (!files.length) return;

  const validFiles = files.filter(file => {
    if (file.size > 20 * 1024 * 1024) {
      setMessage(`${file.name}: exceeds the 20 MB limit.`);
      return false;
    }
    return true;
  });

  if (!validFiles.length) return;

  setBusy(true);
  let success = 0;
  const failures: string[] = [];

  try {
    for (const file of validFiles) {
      try {
        const fd = new FormData();
        fd.append("file", file);

        const response = await axios.post(
          `${CORE_URL}/api/documents/upload`,
          fd,
          { headers: authHeaders() }
        );

        const doc: Doc = {
          ...response.data,
          id: response.data.id,
          original_filename: response.data.original_filename ?? file.name,
          status: response.data.status ?? "received",
        };

        if (doc.status === "duplicate_blocked") {
          failures.push(`${file.name}: duplicate`);
        } else {
          updateDoc(doc);
          success++;
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          reportApiError(error, "Session expired. Sign in again.");
          return;
        }

        failures.push(
          `${file.name}: ${
            axios.isAxiosError(error)
              ? String(error.response?.data?.detail ?? error.message)
              : "Upload failed"
          }`
        );
      }
    }

    await loadDocuments(1, filter);

    setMessage(
      `Upload finished: ${success} uploaded, ${failures.length} failed or duplicate.` +
      (failures.length ? ` Details: ${failures.join("; ")}` : "")
    );
  } finally {
    setBusy(false);
  }
}
  async function loadWorkflow(documentId: string, showLoading = true) {
    if (showLoading) setWorkflowBusy(true);
    setWorkflowDocument(documentId);
    try {
      const response = await axios.get<Workflow>(`${CORE_URL}/api/document-workflows/${documentId}`, { headers: authHeaders() });
      setWorkflow(response.data);
      return response.data;
    } catch (error) { reportApiError(error, "Could not load document workflow."); return null; }
    finally { if (showLoading) setWorkflowBusy(false); }
  }

  async function decideWorkflow(action: "confirm_candidate" | "reject_candidate" | "hold" | "request_partial_review" | "retry_match", candidate?: Workflow["candidates"][number]) {
    if (!workflowDocument) return;
    const label = action.replaceAll("_", " ");
    if (!window.confirm(`Confirm workflow action: ${label}${candidate ? ` (${candidate.record_type} ${candidate.id})` : ""}?`)) return;
    setWorkflowBusy(true); setMessage("");
    try {
      await axios.post(`${CORE_URL}/api/document-workflows/${workflowDocument}/decisions`, {
        action, ...(candidate ? { candidate_id: candidate.id, candidate_type: candidate.record_type } : {}),
      }, { headers: authHeaders() });
      setMessage(`Workflow action recorded: ${label}.`);
      await loadWorkflow(workflowDocument, false);
    } catch (error) { reportApiError(error, "Could not record workflow decision."); }
    finally { setWorkflowBusy(false); }
  }

  async function retryDocument(doc: Doc) {
    setBusy(true);
    try {
      if (doc.status === "received") {
        setMessage("Processing started. Extraction may take a few minutes.");
        updateDoc({ ...doc, status: "parsing" });
        const [response] = await Promise.all([
          axios.post<Doc>(
            `${CORE_URL}/api/documents/${doc.id}/parse`,
            {},
            { headers: authHeaders() }
          ),
          pollDocument(doc.id),
        ]);
        updateDoc({ ...doc, ...response.data });
        setMessage(`Processing finished: ${labelFor(response.data.status)}.`);
        await Promise.all([loadDocuments(), loadInvoices(), loadGoodsReceipts(), loadPurchaseOrders()]);
        return;
      }
      await axios.post(`${CORE_URL}/api/documents/${doc.id}/retry`, {}, { headers: authHeaders() });
      updateDoc({ ...doc, status: "received", failure_message: null });
      setMessage("Retry requested. Checking processing status...");
      await pollDocument(doc.id);
    } catch (error) { reportApiError(error, "Could not retry document processing."); }
    finally { setBusy(false); }
  }

  async function runInvoiceMatch(invoice: Invoice) {
    setMatchingInvoiceId(invoice.invoice_id); setMatchingBusyId(invoice.invoice_id); setMatchingResult(null); setMatchingError(""); setMessage("");
    try {
      const response = await axios.post<MatchingResult>(`${CORE_URL}/api/invoices/${invoice.invoice_id}/three-way-match`, {}, { headers: authHeaders() });
      setMatchingResult(response.data);
      setMessage(response.data.matched && response.data.status === "matched" ? "Three-way comparison completed: matched." : "Matching completed. Review the returned status and findings.");
    } catch (error) {
      setMatchingError(axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : "Invoice matching failed.");
      reportApiError(error, "Invoice matching failed.");
    }
    finally { setMatchingBusyId(null); }
  }

  async function loadInvoiceRecommendation(invoice: Invoice) {
    setMatchingInvoiceId(invoice.invoice_id); setMatchingBusyId(invoice.invoice_id); setMatchingResult(null); setMatchingError("");
    try {
      const response = await axios.get<MatchingResult>(`${CORE_URL}/api/invoices/${invoice.invoice_id}/recommendation`, { headers: authHeaders() });
      setMatchingResult(response.data);
    } catch (error) {
      setMatchingError(axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : "Could not load invoice recommendation.");
      reportApiError(error, "Could not load invoice recommendation.");
    } finally { setMatchingBusyId(null); }
  }

  async function createGoodsReceipt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const po = purchaseOrders.find(item => item.id === receiptForm.po_id);
    if (!po || !po.vendor_id) { setReceiptError("Select a purchase order with a resolved vendor."); return; }
    const lines = po.lines.map(line => {
      const quantities = receiptQuantities[line.id];
      return quantities ? { po_line_id: line.id, item_code: line.item_code, description: line.description, uom: line.uom,
        received_qty: quantities.received, accepted_qty: quantities.accepted, rejected_qty: quantities.rejected } : null;
    }).filter((line): line is NonNullable<typeof line> => line !== null);
    if (!lines.length) { setReceiptError("Enter quantities for at least one PO line."); return; }
    for (const line of lines) {
      const received = Number(line.received_qty); const accepted = Number(line.accepted_qty); const rejected = Number(line.rejected_qty);
      if (!(received > 0) || accepted < 0 || rejected < 0 || Math.round(accepted * 1000) + Math.round(rejected * 1000) !== Math.round(received * 1000)) {
        setReceiptError("Each line must have received quantity greater than zero, and accepted plus rejected must equal received."); return;
      }
    }
    setReceiptBusy(true); setReceiptError("");
    try {
      await axios.post(`${CORE_URL}/api/goods-receipts`, { gr_number: receiptForm.gr_number.trim(), po_id: po.id,
        vendor_id: po.vendor_id, receipt_date: receiptForm.receipt_date, lines }, { headers: authHeaders() });
      setMessage("Goods receipt created successfully."); setReceiptForm({ gr_number: "", receipt_date: new Date().toISOString().slice(0, 10), po_id: "" });
      setReceiptQuantities({}); await loadGoodsReceipts();
    } catch (error) { setReceiptError(axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : "Could not create goods receipt."); reportApiError(error, "Could not create goods receipt."); }
    finally { setReceiptBusy(false); }
  }

  function openDocument(doc: Doc) {
    setSelected(doc);
    setMatchingResult(null);
    void loadWorkflow(doc.id);
    void loadDocumentDetail(doc.id);
  }

  const filtered = useMemo(() => docs.filter(d =>
    !search || d.original_filename.toLowerCase().includes(search.toLowerCase())
  ), [docs, search]);
  const count = (statuses: string[]) => docs.filter(d => statuses.includes(d.status)).length;

  if (restoringSession && !token) return <main className="auth-shell"><section className="auth-side"><div className="auth-card"><span className="eyebrow purple">GENWORX</span><h2>Restoring your secure session</h2><p className="muted">Checking your sign-in securely...</p></div></section></main>;

  if (!token) return <main className="auth-shell">
    <section className="auth-hero">
      <div className="brand brand-light"><span className="brand-mark">G</span><span>GENWORX<small>FINANCE AUTOMATION</small></span></div>
      <div className="hero-copy"><span className="eyebrow">ACCOUNTS PAYABLE | AI WORKSPACE</span><h1>Less paperwork.<br /><em>More clarity.</em></h1><p>Invoices, payment advice, and purchase documents in one intelligent workspace.</p></div>
      <small className="hero-foot">â— Document intelligence platform</small>
    </section>
    <section className="auth-side"><div className="auth-card">
      <div className="brand mobile-brand"><span className="brand-mark">G</span> GENWORX</div>
      <span className="eyebrow purple">WELCOME TO GENWORX</span><h2>{mode === "login" ? "Sign in to your workspace" : "Create your account"}</h2><p className="muted">{mode === "login" ? "Pick up where your finance team left off." : "Set up your finance workspace access."}</p>
      <div className="tabs"><button className={mode === "login" ? "active" : ""} type="button" onClick={() => { setMode("login"); setMessage(""); }}>Sign in</button><button className={mode === "register" ? "active" : ""} type="button" onClick={() => { setMode("register"); setMessage(""); }}>Register</button></div>
      <form className="form-stack" onSubmit={authSubmit}>
        {mode === "register" && <label>Full name<input value={fullName} onChange={e => setFullName(e.target.value)} minLength={2} maxLength={150} placeholder="Your name" required /></label>}
        <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={mode === "register" ? 12 : 1} maxLength={128} placeholder="Enter your password" autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        <button className="primary full" disabled={busy}>{busy ? "Please wait..." : mode === "login" ? "Sign in ->" : "Create account ->"}</button>
      </form>
      {message && <p className="notice">{message}</p>}<p className="auth-foot">Secure access | GenWorx AP Assistant</p>
    </div></section>
  </main>;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">G</span><span>GENWORX<small>AP ASSISTANT</small></span></div>
      <p className="side-label">WORKSPACE</p><button className={workspacePage === "documents" ? "nav-active" : "nav-item"} onClick={() => setWorkspacePage("documents")}>▣ <span>Documents</span><b>{docsTotal}</b></button><button className={workspacePage === "purchase-orders" ? "nav-active" : "nav-item"} onClick={() => { setWorkspacePage("purchase-orders"); void loadPurchaseOrders(); }}>▤ <span>Purchase orders</span><b>{purchaseOrders.length}</b></button><button className={workspacePage === "goods-receipts" ? "nav-active" : "nav-item"} onClick={() => { setWorkspacePage("goods-receipts"); void loadGoodsReceipts(); }}>▧ <span>Goods receipts</span><b>{goodsReceipts.length}</b></button><button className={workspacePage === "invoice-review" ? "nav-active" : "nav-item"} onClick={() => { setWorkspacePage("invoice-review"); void loadInvoices(); }}>▣ <span>Invoice review</span><b>{invoices.length}</b></button>
      <div className="side-bottom"><div className="ai-note"><span>*</span><div><b>AI-powered processing</b><small>Parse | Classify | Extract</small></div></div><button className="signout" disabled={busy} onClick={() => void logoutSession()}>&larr; <span>{busy ? "Signing out..." : "Sign out"}</span></button><div className="profile"><span className="avatar">{(email[0] ?? "U").toUpperCase()}</span><div><b>{email}</b><small>Finance workspace</small></div></div></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div>Workspace <span>/</span> <b>{workspacePage.replaceAll("-", " ")}</b></div><div className="top-right"><i /> System workspace <span className="avatar">{(email[0] ?? "U").toUpperCase()}</span></div></header>
      <div className="content">
        {message && <div className={`notice ${message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") || message.toLowerCase().includes("expired") ? "error" : ""}`}>{message}</div>}
        {workspacePage === "goods-receipts" ? <>
          <header className="welcome"><div><span className="eyebrow purple">PURCHASING OPERATIONS</span><h1>Goods receipts</h1><p className="muted">Record deliveries and accepted or rejected quantities.</p></div><button className="secondary" onClick={() => { void loadGoodsReceipts(); void loadPurchaseOrders(); }}>Refresh</button></header>
          <section className="panel"><div className="panel-head"><div><h2>Create goods receipt</h2><p className="muted">Select a PO and enter delivered quantities against its lines.</p></div></div>
            {receiptError && <div className="notice error">{receiptError}</div>}
            <form className="form-stack" style={{ padding: "0 22px 22px" }} onSubmit={createGoodsReceipt}>
              <div className="field-grid"><label>GR number<input required maxLength={60} value={receiptForm.gr_number} onChange={event => setReceiptForm(old => ({ ...old, gr_number: event.target.value }))} /></label><label>Receipt date<input type="date" required value={receiptForm.receipt_date} onChange={event => setReceiptForm(old => ({ ...old, receipt_date: event.target.value }))} /></label><label>Purchase order<select required value={receiptForm.po_id} onChange={event => { setReceiptForm(old => ({ ...old, po_id: event.target.value })); setReceiptQuantities({}); }}><option value="">Select PO</option>{purchaseOrders.filter(po => po.is_current).map(po => <option key={po.id} value={po.id}>{po.po_number} · {po.vendor_name ?? "Vendor unresolved"}</option>)}</select></label></div>
              {purchaseOrders.find(po => po.id === receiptForm.po_id)?.lines.map(line => <div className="panel" key={line.id} style={{ padding: 14 }}><b>{line.item_code ?? line.description ?? "PO line"}</b><small className="muted"> · Ordered {line.qty ?? "unknown"} {line.uom ?? ""} · {line.id}</small><div className="field-grid" style={{ marginTop: 10 }}>{(["received", "accepted", "rejected"] as const).map(field => <label key={field}>{field[0].toUpperCase() + field.slice(1)} quantity<input type="number" min="0" step="0.001" value={receiptQuantities[line.id]?.[field] ?? ""} onChange={event => setReceiptQuantities(old => ({ ...old, [line.id]: { received: old[line.id]?.received ?? "", accepted: old[line.id]?.accepted ?? "", rejected: old[line.id]?.rejected ?? "", [field]: event.target.value } }))} /></label>)}</div></div>)}
              <button className="primary" disabled={receiptBusy || !purchaseOrders.length}>{receiptBusy ? "Saving..." : "Create goods receipt"}</button>
            </form>
          </section>
          <section className="panel"><div className="panel-head"><div><h2>Receipt register</h2><p className="muted">Select a receipt to inspect its lines.</p></div><span className="count">{goodsReceipts.length} receipts</span></div>
            {goodsReceipts.length ? <div className="table-wrap"><table><thead><tr><th>GR number</th><th>Receipt date</th><th>PO reference</th><th>Vendor</th><th>Lines</th></tr></thead><tbody>{goodsReceipts.map(gr => <tr key={gr.id} className={selectedReceipt?.id === gr.id ? "selected-row" : ""} onClick={() => void loadGoodsReceiptDetail(gr.id)}><td>{gr.gr_number}</td><td>{gr.receipt_date}</td><td>{gr.po_id}</td><td>{gr.vendor_id}</td><td>{gr.lines.length}</td></tr>)}</tbody></table></div> : <div className="empty"><h3>No goods receipts recorded</h3><p>Create a receipt here or upload a GR document.</p></div>}
          </section>
          {selectedReceipt && <section className="panel details"><div className="panel-head"><div><span className="eyebrow purple">GOODS RECEIPT DETAIL</span><h2>{selectedReceipt.gr_number}</h2><p className="muted">Received {selectedReceipt.receipt_date} · PO {selectedReceipt.po_id} · Vendor {selectedReceipt.vendor_id}</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>PO line</th><th>Received</th><th>Accepted</th><th>Rejected</th></tr></thead><tbody>{selectedReceipt.lines.map(line => <tr key={line.id}><td>{line.item_code ?? line.description ?? "—"}</td><td>{line.po_line_id}</td><td>{line.received_qty}</td><td>{line.accepted_qty}</td><td>{line.rejected_qty}</td></tr>)}</tbody></table></div></section>}
        </> : workspacePage === "purchase-orders" ? <>
          <header className="welcome"><div><span className="eyebrow purple">PURCHASING OPERATIONS</span><h1>Purchase orders</h1><p className="muted">Select a PO to inspect its vendor, totals, and lines.</p></div><button className="secondary" onClick={() => void loadPurchaseOrders()}>Refresh</button></header>
          <section className="panel"><div className="panel-head"><div><h2>Purchase order register</h2></div><span className="count">{poTotal} total</span></div>{purchaseOrders.length ? <div className="table-wrap"><table><thead><tr><th>PO number</th><th>Vendor</th><th>Currency</th><th>Total</th><th>Version</th></tr></thead><tbody>{purchaseOrders.map(po => <tr key={po.id} className={selectedPO?.id === po.id ? "selected-row" : ""} onClick={() => void loadPurchaseOrderDetail(po.id)}><td>{po.po_number}</td><td>{po.vendor_name ?? "Vendor unresolved"}</td><td>{po.currency}</td><td>{valueFor(po.total_amount)}</td><td>{po.version_no}{po.is_current ? " (current)" : ""}</td></tr>)}</tbody></table></div> : <div className="empty"><h3>No purchase orders found</h3><p>Upload and process a PO document, then refresh.</p></div>}<div className="panel-head"><button className="secondary" disabled={poPage <= 1} onClick={() => setPoPage(page => page - 1)}>Previous</button><span>Page {poPage} of {Math.max(1, Math.ceil(poTotal / 20))}</span><button className="secondary" disabled={poPage >= Math.ceil(poTotal / 20)} onClick={() => setPoPage(page => page + 1)}>Next</button></div></section>
          {selectedPO && <section className="panel details"><div className="panel-head"><div><span className="eyebrow purple">PURCHASE ORDER DETAIL</span><h2>{selectedPO.po_number}</h2><p className="muted">{selectedPO.vendor_name ?? "Vendor unresolved"} · {selectedPO.currency} · Total {valueFor(selectedPO.total_amount)}</p></div><button className="secondary" onClick={() => { setReceiptForm(old => ({ ...old, po_id: selectedPO.id })); setWorkspacePage("goods-receipts"); }}>Create receipt for this PO</button></div><div className="mx-5 mb-4 grid grid-cols-1 gap-3 md:grid-cols-2"><article className="rounded-lg border border-slate-200 p-3"><span className="block text-xs text-slate-500">Payment terms</span><strong className="mt-1 block text-sm">{valueFor(selectedPO.payment_terms)}</strong></article><article className="rounded-lg border border-slate-200 p-3"><span className="block text-xs text-slate-500">Delivery details</span><strong className="mt-1 block text-sm">{valueFor(selectedPO.delivery_details)}</strong></article></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Description</th><th>Quantity</th><th>Unit</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{selectedPO.lines.map(line => <tr key={line.id}><td>{line.item_code ?? "—"}</td><td>{line.description ?? "—"}</td><td>{valueFor(line.qty)}</td><td>{line.uom ?? "—"}</td><td>{valueFor(line.unit_price)}</td><td>{valueFor(line.line_amount)}</td></tr>)}</tbody></table></div></section>}
        </> : workspacePage === "invoice-review" ? <>
          <header className="welcome"><div><span className="eyebrow purple">FINANCE OPERATIONS</span><h1>Invoice review</h1><p className="muted">Run advisory matching separately from invoice approval.</p></div><button className="secondary" onClick={() => void loadInvoices()}>Refresh</button></header>
          {invoiceLoading ? <div className="empty"><h3>Loading your invoices...</h3></div> : invoiceError ? <div className="empty"><h3>Invoice review queue could not be loaded</h3><p>{invoiceError}</p><button className="secondary" onClick={() => void loadInvoices()}>Retry</button></div> : invoices.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Processing</th><th>Matching</th><th>Review</th><th>Approval</th><th>Payment</th><th>Actions</th></tr></thead><tbody>{invoices.map(invoice => <tr key={invoice.invoice_id}><td>{invoice.invoice_no ?? invoice.invoice_id}</td><td>{invoice.vendor_name ?? "Unknown vendor"}</td><td>{invoice.currency ?? ""} {valueFor(invoice.total_amount)}</td><td>{invoice.processing_status ?? "Unavailable"}</td><td>{invoice.match_status ?? "pending"}</td><td>{invoice.final_status ? "Reviewed" : "Human review pending"}</td><td>{invoice.final_status ?? "Awaiting decision"}</td><td>Unknown</td><td><button className="secondary" disabled={matchingBusyId === invoice.invoice_id} onClick={() => void loadInvoiceRecommendation(invoice)}>{matchingBusyId === invoice.invoice_id ? "Loading..." : "View evidence"}</button><button className="secondary" disabled={matchingBusyId === invoice.invoice_id} onClick={() => void runInvoiceMatch(invoice)}>{matchingBusyId === invoice.invoice_id ? "Matching..." : "Run matching"}</button><button className="primary" disabled={reviewBusyId === invoice.invoice_id || ["pending", "needs_vendor_review", "waiting_for_po", "needs_po_confirmation", "match_issues", "no_match"].includes(invoice.match_status ?? "pending")} onClick={() => void reviewInvoice(invoice, "approved")}>Approve</button><button className="secondary" disabled={reviewBusyId === invoice.invoice_id} onClick={() => void reviewInvoice(invoice, "rejected")}>Reject</button></td></tr>)}</tbody></table></div> : <div className="empty"><h3>No invoices in your review queue</h3><p>Only invoices created by your account or linked to your uploaded documents are included.</p></div>}
          {matchingError && <div className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{matchingError}<button className="ml-3 underline" onClick={() => { const target = invoices.find(invoice => invoice.invoice_id === matchingInvoiceId); if (target) void loadInvoiceRecommendation(target); }}>Retry</button></div>}
          {matchingResult && <section className="panel details"><div className="panel-head"><div><span className="eyebrow purple">EVIDENCE-BASED RECOMMENDATION</span><h2>{matchingResult.matching_status ?? matchingResult.status ?? "Review required"}</h2><p className="muted">Recommendation is advisory. Approval and payment remain separate and are never initiated here.</p></div></div><div className="mx-5 mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5"><article className="rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="block text-xs text-slate-500">Processing status</span><strong className="mt-1 block text-sm text-slate-900">{matchingResult.processing_status ?? "Unavailable"}</strong></article><article className="rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="block text-xs text-slate-500">Matching status</span><strong className="mt-1 block text-sm text-slate-900">{matchingResult.matching_status ?? matchingResult.status ?? "Unknown"}</strong></article><article className="rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="block text-xs text-slate-500">Review status</span><strong className="mt-1 block text-sm text-slate-900">{matchingResult.review_status ?? (matchingResult.requires_review ? "Required" : "Pending approval")}</strong></article><article className="rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="block text-xs text-slate-500">Approval status</span><strong className="mt-1 block text-sm text-slate-900">{matchingResult.approval_status ?? "Awaiting decision"}</strong></article><article className="rounded-lg border border-amber-200 bg-amber-50 p-3"><span className="block text-xs text-amber-700">Payment status</span><strong className="mt-1 block text-sm text-amber-900">{matchingResult.payment_status ?? "Unknown"}</strong></article></div><div className="px-5 pb-5"><p><b>Evidence records:</b> {(matchingResult.supporting_records ?? matchingResult.available_documents ?? []).map(item => `${item.type} ${item.reference ?? item.id}`).join(" · ") || "No related records found"}</p><p><b>Missing records:</b> {(matchingResult.missing_document_types ?? []).join(", ") || "None reported"}</p><p><b>Reason codes:</b> {(matchingResult.reason_codes ?? []).join(", ") || "No discrepancies reported"}</p>{(() => { const checks = matchingResult.checks ?? []; const open = checks.filter(check => check.finding_status === "open").length; const unknown = checks.filter(check => check.finding_status === "not_verifiable").length; return <div className="my-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-800">{open} open findings</span><span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800">{unknown} not verifiable</span><span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-green-800">{checks.length - open - unknown} supported checks</span></div>; })()}<h3>Checks and discrepancies</h3>{(matchingResult.checks ?? []).map((check, index) => <article className="mb-2 rounded-lg border border-slate-200 p-3" key={check.finding_id ?? `${check.name}-${index}`}><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{check.name.replaceAll("_", " ")}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{check.finding_status ?? check.outcome}</span><span className="rounded-full bg-slate-50 px-2 py-1 text-xs text-slate-600">{check.category ?? "evidence_availability"}</span><span className="text-xs text-slate-500">{(check as typeof check & { reason_code?: string }).reason_code ?? "evidence_check"}</span></div><p className="mt-2 text-sm text-slate-700">{check.reason}</p>{(check.expected != null || check.actual != null || check.difference != null) && <p className="text-xs text-slate-600">Expected {valueFor(check.expected)} · Actual {valueFor(check.actual)} · Difference {valueFor(check.difference)}</p>}<p className="mt-1 text-xs text-slate-500">Finding {check.finding_id ?? "Unavailable"} · Evidence records {(check.evidence_record_ids ?? []).join(", ") || "none"}</p></article>)}<p className="mt-4 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900"><b>Recommended next action:</b> {matchingResult.next_recommended_action ?? matchingResult.recommended_next_actions?.[0] ?? "Review available evidence."}</p></div></section>}
        </> : <>
        
<header className="welcome">
  <div>
    <span className="eyebrow purple">FINANCE OPERATIONS</span>
    <h1>Document workspace</h1>
    <p className="muted">Upload, process, and review your accounts payable documents.</p>
  </div>
  <label className={`primary upload ${busy ? "disabled" : ""}`}>
    + Upload documents
    <input
      type="file"
      multiple
      accept=".pdf,.png,.jpg,.jpeg,.eml"
      onChange={uploadDoc}
      disabled={busy}
      hidden
    />
  </label>
</header>

          <article><div>Total documents <span className="stat-icon violet">#</span></div><strong>{docsTotal}</strong><small>Your uploaded files</small></article>
          <article><div>Processing <span className="stat-icon amber">*</span></div><strong>{count(["received","parsing","parsed","classified"])}</strong><small>In the pipeline</small></article>
          <article><div>Extracted <span className="stat-icon green">OK</span></div><strong>{count(["extracted"])}</strong><small>Ready for review</small></article>
          <article><div>Needs attention <span className="stat-icon red">!</span></div><strong>{count(["failed"])}</strong><small>Failed processing</small></article>
        <section className="panel">
  <div className="panel-head">
    <div>
      <h2>Invoice review queue</h2>
      <p className="muted">Review extracted invoices and matching status.</p>
    </div>
    <button className="secondary" onClick={() => void loadInvoices()}>
      Refresh
    </button>
  </div>

  {invoices.length > 0 ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Match status</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map(invoice => {
            const blockedStatuses = [
              "pending",
              "needs_vendor_review",
              "waiting_for_po",
              "needs_po_confirmation",
              "match_issues",
              "no_match"
            ];
            const busy = reviewBusyId === invoice.invoice_id;
            const status = invoice.match_status ?? "pending";

            return (
              <tr key={invoice.invoice_id}>
                <td>{invoice.invoice_no ?? invoice.invoice_id}</td>
                <td>{invoice.vendor_name ?? "Unknown vendor"}</td>
                <td>
                  {invoice.total_amount == null
                    ? "—"
                    : `${invoice.currency ?? ""} ${invoice.total_amount}`}
                </td>
                <td>{status}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="secondary" disabled={matchingBusyId === invoice.invoice_id} onClick={() => void runInvoiceMatch(invoice)}>{matchingBusyId === invoice.invoice_id ? "Matching..." : "Run matching"}</button>
                    <button
                      className="primary"
                      disabled={busy || blockedStatuses.includes(status)}
                      onClick={() => void reviewInvoice(invoice, "approved")}
                    >
                      Approve
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void reviewInvoice(invoice, "rejected")}
                    >
                      Reject
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void reviewInvoice(invoice, "on_hold")}
                    >
                      Hold
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <p>No invoices in the review queue.</p>
  )}
</section>
<section className="panel">
          <div className="panel-head"><div><h2>Documents</h2><p className="muted">Your uploaded files and processing status.</p></div><span className="count">{docsTotal} files</span><button className="secondary" disabled={docsLoading} onClick={() => void loadDocuments(1, filter)}>{docsLoading ? "Loading..." : "Refresh"}</button></div>
          <div className="toolbar"><label className="search">X <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search this page..." /></label><select value={filter} onChange={e => { setDocsPage(1); setFilter(e.target.value); }} aria-label="Filter documents"><option value="all">All statuses</option><option value="received">Received</option><option value="parsing">Parsing</option><option value="parsed">Parsed</option><option value="classified">Classified</option><option value="extracted">Extracted</option><option value="needs_vendor_review">Needs vendor review</option><option value="incomplete">Incomplete</option><option value="processed">Processed</option><option value="failed">Failed</option><option value="ignored">Ignored</option></select></div>
          {docsError && <div className="notice error">{docsError}</div>}
           {docsError && (
            <div className="notice error">{docsError}</div>
          )}

          {docsLoading ? (
            <div className="empty">
              <h3>Loading your documents...</h3>
            </div>
          ) : filtered.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>DOCUMENT</th>
                    <th>STATUS</th>
                    <th>TYPE</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(d => (
                    <tr
                      key={d.id}
                      className={selected?.id === d.id ? "selected-row" : ""}
                      onClick={() => openDocument(d)}
                    >
                      <td>
                        <div className="file">
                          <span className="file-badge">FILE</span>
                          <div>
                            <b>{d.original_filename}</b>
                            <small>{d.id.slice(0, 8)}...</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${d.status}`}>
                          <i />
                          {labelFor(d.status)}
                        </span>
                      </td>
                      <td>
                        {d.doc_type ??
                          (d.extracted_json?.document_type as string | undefined) ??
                          "-"}
                      </td>
                      <td>
                        <button
                          className="view"
                          onClick={e => {
                            e.stopPropagation();
                            openDocument(d);
                          }}
                        >
                          View details →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">↑</div>
              <h3>
                {docsTotal
                  ? "No matching documents on this page"
                  : "Your workspace is ready"}
              </h3>
              <p>
                {docsTotal
                  ? "Try another search or status filter."
                  : "Upload a PO, goods receipt, or invoice to start the workflow."}
              </p>

              {!docsTotal && (
                <label className="secondary">
                  Choose documents
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.eml"
                    onChange={uploadDoc}
                    disabled={busy}
                    hidden
                  />
                </label>
              )}
            </div>
          )}

          <div className="panel-head">
            <button
              className="secondary"
              disabled={docsPage <= 1 || docsLoading}
              onClick={() => setDocsPage(page => page - 1)}
            >
              Previous
            </button>

            <span>
              Page {docsPage} of {Math.max(1, Math.ceil(docsTotal / 20))}
            </span>

            <button
              className="secondary"
              disabled={
                docsPage >= Math.ceil(docsTotal / 20) || docsLoading
              }
              onClick={() => setDocsPage(page => page + 1)}
            >
              Next
            </button>
          </div>
        {selected && <section className="panel details"><div className="panel-head"><div><span className="eyebrow purple">DOCUMENT REVIEW</span><h2>{selected.original_filename}</h2><p className="muted">ID: {selected.id}</p></div><span className={`pill ${selected.status}`}><i />{labelFor(selected.status)}</span></div>
          {selected.failure_message && <div className="notice error">{selected.failure_message}</div>}
          {selected.doc_type === "po" && selected.status === "needs_vendor_review" && <div className="extraction"><div className="extract-title"><div><h3>Resolve purchase order vendor</h3><p className="muted">Extracted vendor: {String(selected.extracted_json?.vendor ?? "Not identified")}. Choose an existing vendor or explicitly create one.</p></div></div><div className="field-grid"><label>Review option<select value={vendorReviewNewMode ? "new" : "existing"} onChange={event => { setVendorReviewNewMode(event.target.value === "new"); setVendorReviewError(""); }}><option value="existing">Select existing vendor</option><option value="new">Create new vendor</option></select></label>{!vendorReviewNewMode ? <><label>Search vendors<input value={vendorSearch} maxLength={120} onChange={event => { setVendorSearch(event.target.value); void loadVendors(event.target.value); }} /></label><label>Existing vendor<select value={vendorChoice} onChange={event => setVendorChoice(event.target.value)}><option value="">Select vendor</option>{vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.tax_id ? ` · ${vendor.tax_id}` : ""}</option>)}</select></label></> : <><label>Vendor name<input value={newVendor.name} maxLength={200} onChange={event => setNewVendor(old => ({ ...old, name: event.target.value }))} /></label><label>Tax ID<input value={newVendor.tax_id} maxLength={30} onChange={event => setNewVendor(old => ({ ...old, tax_id: event.target.value }))} /></label><label>Contact email<input type="email" value={newVendor.contact_email} maxLength={200} onChange={event => setNewVendor(old => ({ ...old, contact_email: event.target.value }))} /></label><label>Contact phone<input value={newVendor.contact_phone} maxLength={40} onChange={event => setNewVendor(old => ({ ...old, contact_phone: event.target.value }))} /></label><label>Contact name<input value={newVendor.contact_name} maxLength={120} onChange={event => setNewVendor(old => ({ ...old, contact_name: event.target.value }))} /></label></>}</div>{vendorReviewError && <p className="notice error">{vendorReviewError}</p>}<button className="primary" disabled={vendorReviewBusy || (!vendorReviewNewMode && !vendorChoice) || (vendorReviewNewMode && (!newVendor.name.trim() || !(newVendor.tax_id.trim() || newVendor.contact_email.trim() || newVendor.contact_phone.trim())))} onClick={() => void resolvePurchaseOrderVendor(selected)}>{vendorReviewBusy ? "Saving PO..." : vendorReviewNewMode ? "Create vendor and save PO" : "Confirm vendor and save PO"}</button></div>}
          {selected.extracted_json && Object.keys(selected.extracted_json).length ? <div className="extraction"><div className="extract-title"><div><h3>Extracted fields</h3><p className="muted">Values identified by the extraction pipeline.</p></div><b>OK Extraction saved</b></div><div className="field-grid">{Object.entries(selected.extracted_json).map(([key,value]) => <article className="field" key={key}><span>{key.replaceAll("_"," ")}</span><strong className={value == null ? "missing" : ""}>{valueFor(value)}</strong></article>)}</div></div> : <div className="detail-empty"><span>âŒ</span><div><b>{selected.status === "failed" ? "Processing needs attention" : "No extracted fields returned yet"}</b><p className="muted">Status: {labelFor(selected.status)}.{selected.failure_message ? ` ${selected.failure_message}` : " Extraction fields will appear here after processing finishes."}</p></div>{selected.status === "failed" && <button className="secondary" onClick={() => void retryDocument(selected)}>Retry processing</button>}</div>}
          {selected.status === "received" && <div className="detail-empty"><span>!</span><div><b>Processing has not started</b><p className="muted">Run processing now for this uploaded document.</p></div><button className="secondary" disabled={busy} onClick={() => void retryDocument(selected)}>{busy ? "Starting..." : "Process now"}</button></div>}
          {selected.status === "parsing" && <div className="detail-empty"><span>…</span><div><b>Processing document</b><p className="muted">Extraction is running. This can take a few minutes.</p></div></div>}
          {selected.raw_text && <details className="raw"><summary>View parsed text</summary><pre>{selected.raw_text}</pre></details>}
          {selected.audit_history?.length ? <details className="raw"><summary>Processing and review history</summary>{selected.audit_history.map((entry, index) => <p key={`${entry.created_at}-${index}`}><b>{entry.action}</b> · {entry.result}{entry.message ? ` · ${entry.message}` : ""} · {new Date(entry.created_at).toLocaleString()}</p>)}</details> : null}
          <div className="panel-head"><div><span className="eyebrow purple">DOCUMENT WORKFLOW</span><h3>{workflow?.status ?? (workflowBusy ? "Loading workflow..." : "Workflow not loaded")}</h3></div><button className="secondary" disabled={workflowBusy} onClick={() => void loadWorkflow(selected.id)}>{workflowBusy ? "Refreshing..." : "Refresh workflow"}</button></div>
          {workflow && workflowDocument === selected.id && <div style={{ padding: "0 22px 20px" }}>
            <div className="field-grid"><article className="field"><span>Available documents</span><strong>{workflow.available_documents.map(item => `${item.type}: ${item.reference ?? item.id}`).join(" · ") || "None"}</strong></article><article className="field"><span>Missing document types</span><strong>{workflow.missing_document_types.join(", ") || "None"}</strong></article><article className="field"><span>Human review</span><strong>{workflow.human_review_required ? "Required" : "Not required"}</strong></article><article className="field"><span>Human decision</span><strong>{workflow.human_decision_required ? "Required" : "Not required"}</strong></article></div>
            {workflow.checks.map((check, index) => <p key={`${check.name}-${index}`}><b>{check.outcome.toUpperCase()} · {check.name}</b> ({check.severity}): {check.reason}{check.expected != null && ` Expected ${check.expected};`}{check.actual != null && ` actual ${check.actual};`}{check.difference != null && ` difference ${check.difference}.`}</p>)}
            {workflow.candidates.length > 0 && <><h3>Candidate records</h3>{workflow.candidates.map(candidate => <article className="field" key={`${candidate.record_type}:${candidate.id}`} style={{ marginBottom: 8 }}><span>{candidate.record_type} · {candidate.id}</span><strong>{valueFor(candidate.evidence)}</strong><div style={{ display: "flex", gap: 8, marginTop: 8 }}><button className="secondary" disabled={workflowBusy || !["purchase_order", "invoice"].includes(candidate.record_type)} onClick={() => void decideWorkflow("confirm_candidate", candidate)}>Confirm association</button><button className="secondary" disabled={workflowBusy} onClick={() => void decideWorkflow("reject_candidate", candidate)}>Reject candidate</button></div></article>)}</>}
            <h3>Recommended next actions</h3>{workflow.recommended_next_actions.length ? workflow.recommended_next_actions.map((action, index) => <p key={index}>{action}</p>) : <p>None returned.</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="secondary" disabled={workflowBusy} onClick={() => void decideWorkflow("hold")}>Place on hold</button>{workflow.status === "partial_match" && <button className="secondary" disabled={workflowBusy} onClick={() => void decideWorkflow("request_partial_review")}>Request partial review</button>}<button className="secondary" disabled={workflowBusy} onClick={() => void decideWorkflow("retry_match")}>Retry matching</button>{selected.status === "failed" || selected.status === "needs_vendor_review" || selected.status === "incomplete" ? <button className="secondary" disabled={busy} onClick={() => void retryDocument(selected)}>Retry processing</button> : null}</div>
            {workflow.invoice_approval_required && <p className="notice">Matching is advisory. Invoice approval is a separate review decision.</p>}
          </div>}
        </section>}
        </section>
        <footer className="footer"><span>GENWORX AP ASSISTANT</span><span>Document intelligence | Finance operations</span></footer>
        </>}
      </div>
    </section>
  </main>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
