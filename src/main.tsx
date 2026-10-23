import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { createAuthSession } from "./authSession";
import { Badge, Button, Card, Skeleton } from "./components/ui";
import { CommandCenter, confidenceLevel, type CommandBill, type CommandBucket, type CommandSummary, type ConfidenceLevel, type ConfidenceResponse } from "./components/CommandCenter";
import { useInvoiceQueryState, type FilterOwner, type FilterVendor } from "./components/InvoiceFilters";
import { InvoicesWorkspacePage } from "./components/InvoicesWorkspacePage";
import "./styles/globals.css";
import "./styles/modern.css";

const AUTH_URL = String(import.meta.env.VITE_AUTH_API_BASE_URL || "http://localhost:8001").replace(/\/$/, "");
const CORE_URL = String(import.meta.env.VITE_AP_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

declare module "axios" { interface InternalAxiosRequestConfig { authRetried?: boolean } }
const authSession = createAuthSession(async () => {
  const response = await axios.post<{ access_token?: string }>(`${AUTH_URL}/api/auth/refresh`, {}, {
    withCredentials: true, headers: { "X-CSRF-Protection": "1" },
  });
  return response.data.access_token || null;
});
axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (config.url?.startsWith(CORE_URL) && authSession.getAccessToken()) {
    config.headers.set("Authorization", `Bearer ${authSession.getAccessToken()}`);
  }
  return config;
});
axios.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config;
  if (error.response?.status !== 401 || !config || config.authRetried || !config.url?.startsWith(CORE_URL)) throw error;
  config.authRetried = true;
  const token = await authSession.refresh();
  if (!token) throw error;
  config.headers.set("Authorization", `Bearer ${token}`);
  return axios.request(config);
});

type Doc = {
  id: string; original_filename: string; status: string; doc_type?: string | null;
  created_at?: string | null; updated_at?: string | null; failure_message?: string | null;
  extracted_json?: Record<string, unknown> | null; raw_text?: string | null;
  source?: string | null; email_sender?: string | null; email_subject?: string | null;
  email_received_at?: string | null; linked_invoice_id?: string | null;
  linked_invoice_status?: string | null;
};
type PageResponse<T> = { items?: T[]; total?: number; page?: number; page_size?: number; limit?: number; offset?: number };
type InvoiceItem = { invoice_id: string; source_document_id?: string | null; received_at?: string | null; source?: "upload" | "email" | null; email_sender?: string | null; email_subject?: string | null; invoice_no?: string | null; vendor_name?: string | null; invoice_date?: string | null; due_date?: string | null; total_amount?: number | string | null; currency?: string | null; status: "processing" | "needs_review" | "ready_to_pay" | "on_hold" | "rejected"; workflow_status?: string; final_status?: string | null; owner_user_id?: string | null; gl_code?: string | null; confidence?: number | null };
type InvoiceDetail = InvoiceItem & { vendor_id?: string | null; vendor_tax_id?: string | null; subtotal?: number | string | null; tax_amount?: number | string | null; po_number_raw?: string | null; payment_terms?: unknown; line_items?: { description?: string | null; item_code?: string | null; qty?: number | string | null; unit_price?: number | string | null; amount?: number | string | null }[]; discrepancies?: { field: string; invoice_value?: unknown; po_value?: unknown; gr_value?: unknown; severity: string; resolved?: boolean; reason?: string | null }[] };
type EmailMessageItem = { id: string; sender?: string | null; subject?: string | null; status: string; filter_reason?: string | null; failure_reason?: string | null; received_at?: string | null; retryable: boolean; document_id?: string | null; linked_invoice_id?: string | null; linked_invoice_status?: string | null };
type EmailStatus = { enabled: boolean; last_run_at?: string | null; next_poll_at?: string | null; docling_models_available: boolean; counts?: { processed?: number; failed?: number; needs_attention?: number; skipped_by_reason?: Record<string, number> }; last_result?: Record<string, number | Record<string, number> | string> };
type MatchCandidate = { match_id: string; po_id: string; po_number: string; vendor_name?: string | null; total_amount?: number | string | null; currency?: string | null; score: number; status: string };
type AuthProfile = { email: string; role: "admin" | "associate"; must_change_password: boolean; temp_password_expires_at?: string | null; name?: string };
type Associate = { id: string; name: string; email: string; is_active: boolean; created_at: string };
type AccessClaims = AuthProfile & { sub: string; scope?: string };

function readAccessClaims(token: string): AccessClaims | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as AccessClaims;
  } catch { return null; }
}

function getError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") return JSON.stringify(detail);
    if (!error.response) return `Cannot reach the API. Check that AP-Core/AP-Auth are running and the frontend API URLs are correct. (${error.message})`;
    return error.message || fallback;
  }
  return fallback;
}
function humanize(value?: string | null) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}
const processingStatuses = new Set(["uploaded", "queued", "received", "reading", "parsing", "processing", "classified", "matching"]);
function friendlyStatus(value?: string | null) {
  const status = (value || "").toLowerCase();
  if (["needs_data_review", "needs_vendor_review"].includes(status)) return "Needs data review";
  if (status === "needs_attention") return "Needs attention";
  if (processingStatuses.has(status)) return "Processing";
  if (["ready", "extracted", "parsed", "processed"].includes(status)) return "Ready";
  if (status === "failed") return "Failed";
  return "Processing";
}
function isProcessing(value?: string | null) { return processingStatuses.has((value || "").toLowerCase()); }
function statusClass(value?: string | null) {
  const s = (value || "unknown").toLowerCase();
  if (["failed", "rejected", "overdue", "match_issues", "no_match"].includes(s)) return "danger";
  if (["needs_data_review", "needs_vendor_review", "needs_attention"].includes(s)) return "warning";
  if (["approved", "paid", "match_approved", "processed", "extracted", "parsed", "ready_to_pay"].includes(s)) return "success";
  if (processingStatuses.has(s) || ["verifying", "resubmitted", "on_hold"].includes(s)) return "pending";
  return "neutral";
}
function dateLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function dateTimeLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
function emailPollCount(status: EmailStatus | null, key: string, fallback: string) {
  const result = status?.last_result || {};
  const value = result[key] ?? result[fallback];
  return typeof value === "number" ? value : 0;
}
function App() {
  const [activePage, setActivePage] = useState<"dashboard" | "command-center" | "documents" | "invoices" | "email" | "associates">("dashboard");
  const { filters: invoiceQuery, update: updateInvoiceQuery } = useInvoiceQueryState();
  const invoiceSource = (invoiceQuery.source || "all") as "all" | "upload" | "email";
  const [globalSearch, setGlobalSearch] = useState(invoiceQuery.search || "");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [credentialCopied, setCredentialCopied] = useState(false);
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [associateName, setAssociateName] = useState("");
  const [associateEmail, setAssociateEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [associates, setAssociates] = useState<Associate[]>([]);
  const [associatesLoading, setAssociatesLoading] = useState(false);
  const [associatesError, setAssociatesError] = useState("");
  const [associateCredential, setAssociateCredential] = useState<{ email: string; password: string; expiresAt: string } | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: "success" | "error" | "info" } | null>(null);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [invoiceCounts, setInvoiceCounts] = useState<Record<InvoiceItem["status"], number>>({ processing: 0, needs_review: 0, ready_to_pay: 0, on_hold: 0, rejected: 0 });
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const setInvoiceSource = (source: "all" | "upload" | "email") => updateInvoiceQuery({ source });
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [matchCandidates, setMatchCandidates] = useState<MatchCandidate[]>([]);
  const [decision, setDecision] = useState<{ invoiceId: string; action: "hold" | "reject" | "approve-exception"; reason: string } | null>(null);
  const [recentBatchIds, setRecentBatchIds] = useState<string[]>(() => {
    try { const saved = sessionStorage.getItem("ap-recent-upload-ids"); return saved ? JSON.parse(saved) as string[] : []; } catch { return []; }
  });
  const [docTotal, setDocTotal] = useState(0);
  const [docPage, setDocPage] = useState(1);
  const [docSearch, setDocSearch] = useState("");
  const [docType, setDocType] = useState("all");
  const [docStatus, setDocStatus] = useState("all");
  const [docSource, setDocSource] = useState<"latest" | "all" | "email">("latest");
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [emailMessages, setEmailMessages] = useState<EmailMessageItem[]>([]);
  const [emailTotal, setEmailTotal] = useState(0);
  const [emailFilter, setEmailFilter] = useState("all");
  const [emailReasonFilter, setEmailReasonFilter] = useState("");
  const [emailPage, setEmailPage] = useState(0);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [commandSummary, setCommandSummary] = useState<Partial<Record<CommandBucket, CommandSummary>>>({});
  const [commandBills, setCommandBills] = useState<CommandBill[]>([]);
  const [commandTotal, setCommandTotal] = useState(0);
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandError, setCommandError] = useState("");
  const [commandConfidences, setCommandConfidences] = useState<Record<string, ConfidenceLevel>>({});
  const [filterVendors, setFilterVendors] = useState<FilterVendor[]>([]);
  const [filterOwners, setFilterOwners] = useState<FilterOwner[]>([]);
  const [commandAction, setCommandAction] = useState<{ bill: CommandBill; action: string } | null>(null);
  const [commandActionReason, setCommandActionReason] = useState("");
  const [commandOwnerId, setCommandOwnerId] = useState("");
  const [commandPaidDate, setCommandPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [commandPaymentMethod, setCommandPaymentMethod] = useState("bank_transfer");
  const [commandPaymentReference, setCommandPaymentReference] = useState("");
  const [commandActionBusy, setCommandActionBusy] = useState(false);
  const notifiedEmailInvoiceIds = useRef<Set<string> | null>(null);

  const notify = useCallback((text: string, kind: "success" | "error" | "info" = "info") => {
    setToast({ text, kind });
  }, []);
  const clearSession = useCallback(() => {
    authSession.clear(); setToken(""); setProfile(null); setActivePage("dashboard"); setMustChangePassword(false); setProfileLoading(false); setDocuments([]); setSelectedDoc(null); setAssociateCredential(null);
  }, []);
  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${authSession.getAccessToken()}` }), []);

  useEffect(() => { setGlobalSearch(invoiceQuery.search); }, [invoiceQuery.search]);

  useEffect(() => {
    let active = true;
    void authSession.restore().then(restored => { if (active && restored) setToken(restored); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const claims = readAccessClaims(token);
    if (claims?.must_change_password) {
      setProfile({
        email: claims.email || "",
        role: claims.role,
        name: claims.name,
        must_change_password: true,
        temp_password_expires_at: claims.temp_password_expires_at,
      });
      setEmail(claims.email || "");
      setMustChangePassword(true);
      setProfileLoading(false);
      return () => { active = false; };
    }
    setProfileLoading(true);
    void axios.get<AuthProfile>(`${AUTH_URL}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => {
        if (!active) return;
        setProfile(response.data);
        setEmail(response.data.email);
        setMustChangePassword(response.data.must_change_password);
      })
      .catch(error => {
        if (!active) return;
        clearSession();
        notify(getError(error, "Could not load your account."), "error");
      })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [token, clearSession, notify]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.kind === "error" ? 6500 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadDocuments = useCallback(async (nextPage = docPage) => {
    if (!token) return;
    setDocLoading(true); setDocError("");
    try {
      const query = new URLSearchParams({ page: String(nextPage), page_size: "50" });
      if (docStatus !== "all" && !["processing", "ready"].includes(docStatus)) query.set("status", docStatus);
      if (docType !== "all") query.set("doc_type", docType);
      if (docSource === "email") query.set("source", "email");
      else if (docSource === "latest") query.set("source", "upload");
      const response = await axios.get<PageResponse<Doc> | Doc[]>(`${CORE_URL}/api/documents?${query}`, { headers: authHeaders() });
      const data = response.data;
      const items = Array.isArray(data) ? data : data.items || [];
      const visibleItems = docSource === "latest" && recentBatchIds.length ? items.filter(item => recentBatchIds.includes(item.id)) : items;
      setDocuments(visibleItems); setDocTotal(docSource === "latest" && recentBatchIds.length ? visibleItems.length : (Array.isArray(data) ? items.length : data.total ?? items.length));
      setDocPage(Array.isArray(data) ? nextPage : data.page ?? nextPage);
      setSelectedDoc(current => {
        const latest = current && visibleItems.find(item => item.id === current.id);
        return latest && current ? { ...current, status: latest.status, updated_at: latest.updated_at, failure_message: latest.failure_message } : current;
      });
    } catch (error) {
      const message = getError(error, "Could not load documents."); setDocError(message);
      if (axios.isAxiosError(error) && error.response?.status === 401) { clearSession(); notify("Your session expired. Please sign in again.", "error"); }
    } finally { setDocLoading(false); }
  }, [token, docPage, docStatus, docType, docSource, authHeaders, clearSession, notify, recentBatchIds]);

  const loadAssociates = useCallback(async () => {
    if (!token || profile?.role !== "admin") return;
    setAssociatesLoading(true); setAssociatesError("");
    try {
      const response = await axios.get<Associate[]>(`${AUTH_URL}/admin/associates`, { headers: authHeaders() });
      setAssociates(response.data);
    } catch (error) {
      setAssociatesError(getError(error, "Could not load associate accounts."));
    } finally { setAssociatesLoading(false); }
  }, [token, profile?.role, authHeaders]);

  const loadInvoices = useCallback(async () => {
    if (!token) return;
    setInvoiceLoading(true); setInvoiceError("");
    try {
      const makeQuery = (includeStatus: boolean, pageSize: number) => {
        const query = new URLSearchParams({ page: String(invoiceQuery.page), page_size: String(pageSize) });
        if (includeStatus && invoiceStatuses.includes(invoiceQuery.status as InvoiceItem["status"])) query.set("status", invoiceQuery.status);
        if (invoiceSource !== "all") query.set("source", invoiceSource);
        if (invoiceQuery.vendor_id) query.set("vendor_id", invoiceQuery.vendor_id);
        if (invoiceQuery.due_date_from) query.set("due_date_from", invoiceQuery.due_date_from);
        if (invoiceQuery.due_date_to) query.set("due_date_to", invoiceQuery.due_date_to);
        if (invoiceQuery.amount_min) query.set("amount_min", invoiceQuery.amount_min);
        if (invoiceQuery.amount_max) query.set("amount_max", invoiceQuery.amount_max);
        if (invoiceQuery.gl_code) query.set("gl_code", invoiceQuery.gl_code);
        if (invoiceQuery.owner_user_id) query.set("owner_user_id", invoiceQuery.owner_user_id);
        if (invoiceQuery.sort_by) query.set("sort_by", invoiceQuery.sort_by);
        if (globalSearch.trim()) query.set("search", globalSearch.trim());
        return query;
      };
      const countQuery = makeQuery(false, 1);
      const [list, ...counts] = await Promise.all([
        axios.get<PageResponse<InvoiceItem>>(`${CORE_URL}/api/invoices?${makeQuery(true, 25)}`, { headers: authHeaders() }),
        ...invoiceStatuses.map(status => {
          const query = new URLSearchParams(countQuery);
          query.set("status", status);
          return axios.get<PageResponse<InvoiceItem>>(`${CORE_URL}/api/invoices?${query}`, { headers: authHeaders() });
        }),
      ]);
      const nextInvoices = list.data.items || [];
      const nextEmailIds = new Set(nextInvoices.filter(invoice => invoice.source === "email").map(invoice => invoice.invoice_id));
      if (invoiceSource === "all" && notifiedEmailInvoiceIds.current) {
        const arrived = nextInvoices.find(invoice => invoice.source === "email" && !notifiedEmailInvoiceIds.current?.has(invoice.invoice_id));
        if (arrived) notify(`New email invoice received${arrived.vendor_name ? ` from ${arrived.vendor_name}` : ""}.`, "info");
      }
      if (invoiceSource === "all") notifiedEmailInvoiceIds.current = nextEmailIds;
      setInvoices(nextInvoices);
      setInvoiceTotal(list.data.total || 0);
      setInvoiceCounts(Object.fromEntries(invoiceStatuses.map((status, index) => [status, counts[index].data.total || 0])) as Record<InvoiceItem["status"], number>);
    } catch (error) { setInvoiceError(getError(error, "Could not load invoices.")); }
    finally { setInvoiceLoading(false); }
  }, [token, authHeaders, invoiceSource, invoiceQuery, globalSearch, notify]);

  const loadCommandCenter = useCallback(async () => {
    if (!token) return;
    setCommandLoading(true); setCommandError("");
    try {
      const bucket = (invoiceQuery.bucket || "ready_to_pay") as CommandBucket;
      const query = new URLSearchParams({ bucket, page: String(invoiceQuery.page), page_size: "25" });
      const sortBy = bucket === "overdue" && invoiceQuery.sort_by === "date_received" ? "days_overdue" : invoiceQuery.sort_by;
      query.set("sort_by", sortBy);
      if (invoiceQuery.status) query.set("workflow_status", invoiceQuery.status);
      if (invoiceQuery.vendor_id) query.set("vendor_id", invoiceQuery.vendor_id);
      if (invoiceQuery.due_date_from) query.set("due_date_from", invoiceQuery.due_date_from);
      if (invoiceQuery.due_date_to) query.set("due_date_to", invoiceQuery.due_date_to);
      if (invoiceQuery.amount_min) query.set("amount_min", invoiceQuery.amount_min);
      if (invoiceQuery.amount_max) query.set("amount_max", invoiceQuery.amount_max);
      if (invoiceQuery.gl_code) query.set("gl_code", invoiceQuery.gl_code);
      if (invoiceQuery.owner_user_id) query.set("owner_user_id", invoiceQuery.owner_user_id);
      const [summaryResponse, listResponse] = await Promise.all([
        axios.get<{ buckets: Record<string, CommandSummary> }>(`${CORE_URL}/api/command-center/summary`, { headers: authHeaders() }),
        axios.get<{ items: CommandBill[]; total: number; page: number; page_size: number }>(`${CORE_URL}/api/command-center/bills?${query}`, { headers: authHeaders() }),
      ]);
      const allBuckets = summaryResponse.data.buckets || {};
      setCommandSummary({ ready_to_pay: allBuckets.ready_to_pay, overdue: allBuckets.overdue, rejected: allBuckets.rejected });
      const items = listResponse.data.items || [];
      setCommandBills(items);
      setCommandTotal(listResponse.data.total || 0);
      const verified = await Promise.allSettled(items.map(bill => axios.get<ConfidenceResponse>(`${CORE_URL}/api/invoices/${bill.invoice_id}/verification`, { headers: authHeaders() })));
      const nextConfidence: Record<string, ConfidenceLevel> = {};
      verified.forEach((result, index) => { if (result.status === "fulfilled") nextConfidence[items[index].invoice_id] = confidenceLevel(result.value.data); });
      setCommandConfidences(nextConfidence);
    } catch (error) {
      const message = axios.isAxiosError(error) && error.response?.status === 403 ? "You do not have permission to view the Command Center." : getError(error, "Could not load the Command Center.");
      setCommandError(message);
    } finally { setCommandLoading(false); }
  }, [token, authHeaders, invoiceQuery]);

  const vendorSearchTimer = useRef<number | undefined>(undefined);
  const searchFilterVendors = useCallback((search: string) => {
    if (vendorSearchTimer.current) window.clearTimeout(vendorSearchTimer.current);
    if (search.trim().length < 2) return;
    vendorSearchTimer.current = window.setTimeout(() => {
      const query = new URLSearchParams({ search: search.trim(), page: "1", page_size: "100" });
      void axios.get<FilterVendor[]>(`${CORE_URL}/api/vendors?${query}`, { headers: authHeaders() })
        .then(response => setFilterVendors(response.data.map(vendor => ({ id: vendor.id, name: vendor.name }))))
        .catch(() => undefined);
    }, 250);
  }, [authHeaders]);

  useEffect(() => {
    if (!token || profileLoading || mustChangePassword) return;
    void Promise.all([
      axios.get<{ items: FilterOwner[] }>(`${CORE_URL}/api/users/assignable`, { headers: authHeaders() }),
      axios.get<FilterVendor[]>(`${CORE_URL}/api/vendors?page=1&page_size=100`, { headers: authHeaders() }),
    ]).then(([usersResponse, vendorsResponse]) => {
      setFilterOwners(usersResponse.data.items || []);
      setFilterVendors(vendorsResponse.data.map(vendor => ({ id: vendor.id, name: vendor.name })));
    }).catch(() => undefined);
  }, [token, profileLoading, mustChangePassword, authHeaders]);

  const loadEmailInbox = useCallback(async () => {
    if (!token) return;
    setEmailLoading(true); setEmailError("");
    try {
      const query = new URLSearchParams({ limit: "25", offset: String(emailPage * 25) });
      if (emailFilter !== "all") query.set("status", emailFilter);
      if (emailReasonFilter.trim()) query.set("reason", emailReasonFilter.trim());
      const [status, messages] = await Promise.all([
        axios.get<EmailStatus>(`${CORE_URL}/api/email/status`, { headers: authHeaders() }),
        axios.get<PageResponse<EmailMessageItem>>(`${CORE_URL}/api/email/messages?${query}`, { headers: authHeaders() }),
      ]);
      setEmailStatus(status.data); setEmailMessages(messages.data.items || []); setEmailTotal(messages.data.total || 0);
    } catch (error) { setEmailError(getError(error, "Could not load the email inbox.")); }
    finally { setEmailLoading(false); }
  }, [token, authHeaders, emailPage, emailFilter, emailReasonFilter]);

  useEffect(() => { if (token && !profileLoading && !mustChangePassword) void loadDocuments(1); }, [token, profileLoading, mustChangePassword, docStatus, docType, docSource]);
  useEffect(() => {
    if (!token || profileLoading || mustChangePassword) return;
    const running = documents.some(doc => isProcessing(doc.status))
      || invoices.some(invoice => invoice.status === "processing")
      || emailMessages.some(message => ["processing", "received", "failed"].includes(message.status));
    if (!running) return;
    const timer = window.setInterval(() => {
      void loadDocuments(docPage); void loadInvoices(); void loadEmailInbox();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [token, profileLoading, mustChangePassword, documents, invoices, emailMessages, docPage, loadDocuments, loadInvoices, loadEmailInbox]);
  useEffect(() => { if (activePage === "associates") void loadAssociates(); }, [activePage, loadAssociates]);
  useEffect(() => { if ((activePage === "invoices" || activePage === "dashboard") && token && !profileLoading && !mustChangePassword) void loadInvoices(); }, [activePage, token, profileLoading, mustChangePassword, loadInvoices]);
  useEffect(() => { if (activePage === "command-center" && token && !profileLoading && !mustChangePassword) void loadCommandCenter(); }, [activePage, token, profileLoading, mustChangePassword, loadCommandCenter]);
  useEffect(() => {
    if (activePage !== "command-center" || !token || profileLoading || mustChangePassword) return;
    const timer = window.setInterval(() => { void loadCommandCenter(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [activePage, token, profileLoading, mustChangePassword, loadCommandCenter]);
  useEffect(() => { if (token && !profileLoading && !mustChangePassword && ["email", "dashboard"].includes(activePage)) void loadEmailInbox(); }, [token, profileLoading, mustChangePassword, activePage, loadEmailInbox]);

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true); setToast(null); setLoginError("");
    try {
      const response = await axios.post<{ access_token?: string }>(`${AUTH_URL}/api/auth/login`, { email: email.trim(), password }, { withCredentials: true });
      if (!response.data.access_token) throw new Error("The sign-in response did not contain an access token.");
      setProfileLoading(true);
      authSession.setAccessToken(response.data.access_token); setToken(response.data.access_token);
    } catch (error) {
      setPassword("");
      const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
      const detail = axios.isAxiosError(error) ? String(error.response?.data?.detail || "").toLowerCase() : "";
      setLoginError(statusCode === 429 ? "Too many attempts. Please try again in a few minutes."
        : statusCode === 403 && detail.includes("inactive") ? "Your account is inactive. Please contact your admin."
        : statusCode === 401 && detail.includes("temporary password") ? "Your temporary password has expired. Please contact your admin for a new one."
        : statusCode === 401 ? "Invalid email or password. Please try again."
        : "Something went wrong. Please try again later.");
    }
    finally { setAuthBusy(false); }
  }
  async function logout() {
    setAuthBusy(true);
    try {
      await axios.post(`${AUTH_URL}/api/auth/logout`, {}, { withCredentials: true, headers: { "X-CSRF-Protection": "1" } });
      clearSession(); setPassword(""); notify("You have signed out.", "success");
    } catch (error) { notify(getError(error, "Could not safely sign out. Try again."), "error"); }
    finally { setAuthBusy(false); }
  }

  async function submitPasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) { notify("The new passwords do not match.", "error"); return; }
    setAuthBusy(true);
    try {
      const response = await axios.post<{ access_token: string }>(`${AUTH_URL}/auth/set-password`, {
        current_password: currentPassword, new_password: newPassword,
      }, { headers: authHeaders(), withCredentials: true });
      authSession.setAccessToken(response.data.access_token);
      setToken(response.data.access_token); setMustChangePassword(false);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      notify("Password changed. Your workspace is ready.", "success");
    } catch (error) { notify(getError(error, "Could not change password."), "error"); }
    finally { setAuthBusy(false); }
  }

  async function createAssociate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true);
    try {
      const response = await axios.post<{ temp_password_expires_at: string; temporary_password: string }>(`${AUTH_URL}/admin/associates`, {
        name: associateName.trim(), email: associateEmail.trim(),
        ...(temporaryPassword.trim() ? { temporary_password: temporaryPassword } : {}),
      }, { headers: authHeaders() });
      setAssociateCredential({ email: associateEmail.trim(), password: response.data.temporary_password, expiresAt: response.data.temp_password_expires_at });
      setAssociateName(""); setAssociateEmail(""); setTemporaryPassword("");
      notify("Associate created. Share the temporary password shown below; it will not be shown again.", "success");
      await loadAssociates();
    } catch (error) { notify(getError(error, "Could not create associate account."), "error"); }
    finally { setAuthBusy(false); }
  }

  async function removeAssociate(associate: Associate) {
    if (!window.confirm(`Remove ${associate.name} (${associate.email})? They will no longer be able to sign in.`)) return;
    try {
      await axios.delete(`${AUTH_URL}/admin/associates/${associate.id}`, { headers: authHeaders() });
      setAssociates(current => current.map(item => item.id === associate.id ? { ...item, is_active: false } : item));
      notify(`${associate.name}'s access has been removed.`, "success");
    } catch (error) { notify(getError(error, "Could not remove this associate."), "error"); }
  }

  async function resetAssociatePassword(associate: Associate) {
    setAuthBusy(true);
    try {
      const response = await axios.post<{ temporary_password: string; temp_password_expires_at: string }>(
        `${AUTH_URL}/admin/associates/${associate.id}/reset-password`, {}, { headers: authHeaders() },
      );
      setCredentialCopied(false);
      setAssociateCredential({ email: associate.email, password: response.data.temporary_password, expiresAt: response.data.temp_password_expires_at });
      notify("Password reset. Share this temporary password with the associate.", "success");
    } catch (error) { notify(getError(error, "Could not reset this associate's password."), "error"); }
    finally { setAuthBusy(false); }
  }

  async function copyAssociateCredential() {
    if (!associateCredential) return;
    try {
      await navigator.clipboard.writeText(associateCredential.password);
      setCredentialCopied(true);
    } catch { notify("Could not access the clipboard. Select and copy the password manually.", "error"); }
  }

  async function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files || []); event.target.value = "";
    if (!chosen.length) return;
    const tooLarge = chosen.filter(file => file.size > 20 * 1024 * 1024);
    const valid = chosen.filter(file => file.size <= 20 * 1024 * 1024);
    if (tooLarge.length) notify(`${tooLarge.map(file => file.name).join(", ")}: each file must be 20 MB or smaller.`, "error");
    if (!valid.length) return;
    setUploading(true); setUploadProgress(0);
    const outcomes: { name: string; ok: boolean; message?: string }[] = [];
    const batchDocs: Doc[] = [];
    for (let index = 0; index < valid.length; index++) {
      const file = valid[index];
      try {
        const body = new FormData(); body.append("file", file);
        const response = await axios.post<Doc>(`${CORE_URL}/api/documents/upload`, body, {
          headers: authHeaders(), onUploadProgress: progress => {
            if (progress.total) setUploadProgress(Math.round(((index + progress.loaded / progress.total) / valid.length) * 100));
          },
        });
        const result = response.data;
        if (result.status === "duplicate_blocked") outcomes.push({ name: file.name, ok: false, message: "Already uploaded (duplicate)" });
        else { batchDocs.push(result); outcomes.push({ name: result.original_filename || file.name, ok: true, message: friendlyStatus(result.status || "received") }); }
      } catch (error) { outcomes.push({ name: file.name, ok: false, message: getError(error, "Upload failed") }); }
      setUploadProgress(Math.round(((index + 1) / valid.length) * 100));
    }
    setUploading(false);
    const batchIds = batchDocs.map(doc => doc.id);
    setRecentBatchIds(batchIds);
    sessionStorage.setItem("ap-recent-upload-ids", JSON.stringify(batchIds));
    setDocuments(batchDocs); setDocTotal(batchDocs.length); setDocPage(1);
    const successes = outcomes.filter(item => item.ok).length;
    setModalError("");
    setUploadResult({ outcomes, successes, total: valid.length });
  }
  const [uploadResult, setUploadResult] = useState<{ outcomes: { name: string; ok: boolean; message?: string }[]; successes: number; total: number } | null>(null);

  async function openDocument(doc: Doc) {
    setSelectedDoc(doc); setModalError(""); setDetailLoading(true);
    try {
      const response = await axios.get<Doc>(`${CORE_URL}/api/documents/${doc.id}`, { headers: authHeaders() });
      setSelectedDoc(response.data);
    } catch (error) { setModalError(getError(error, "Could not load document details.")); }
    finally { setDetailLoading(false); }
  }
  async function openInvoice(invoiceId: string) {
    try {
      const [detail, candidates] = await Promise.all([
        axios.get<InvoiceDetail>(`${CORE_URL}/api/invoices/${invoiceId}`, { headers: authHeaders() }),
        axios.get<{ candidates: MatchCandidate[] }>(`${CORE_URL}/api/invoices/${invoiceId}/match-candidates`, { headers: authHeaders() }),
      ]);
      setSelectedInvoice(detail.data); setMatchCandidates(candidates.data.candidates || []);
    } catch (error) { notify(getError(error, "Could not load invoice details."), "error"); }
  }
  async function submitInvoiceDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!decision) return;
    try {
      await axios.post(`${CORE_URL}/api/invoices/${decision.invoiceId}/${decision.action}`, { reason: decision.reason }, { headers: authHeaders() });
      notify("Invoice decision saved.", "success"); setDecision(null); setSelectedInvoice(null); await loadInvoices();
    } catch (error) { notify(getError(error, "Could not save the invoice decision."), "error"); }
  }
  async function confirmSuggestedMatch(candidate: MatchCandidate, accept: boolean) {
    if (!selectedInvoice) return;
    try {
      if (accept) await axios.post(`${CORE_URL}/api/invoices/${selectedInvoice.invoice_id}/match`, { po_id: candidate.po_id }, { headers: authHeaders() });
      else await axios.post(`${CORE_URL}/api/invoices/${selectedInvoice.invoice_id}/match/reject`, { po_id: candidate.po_id }, { headers: authHeaders() });
      await openInvoice(selectedInvoice.invoice_id); await loadInvoices();
    } catch (error) { notify(getError(error, "Could not update the suggested match."), "error"); }
  }
  async function openOriginalFile(doc: Doc) {
    try {
      const response = await axios.get(`${CORE_URL}/api/documents/${doc.id}/file`, { headers: authHeaders(), responseType: "blob" });
      const url = URL.createObjectURL(response.data); const tab = window.open(url, "_blank", "noopener,noreferrer");
      if (!tab) { const link = document.createElement("a"); link.href = url; link.download = doc.original_filename; link.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { notify(getError(error, "Could not open the original file."), "error"); }
  }
  async function retryDocument(doc: Doc) {
    try {
      setDetailLoading(true);
      const endpoint = doc.status === "received" ? "parse" : "retry";
      await axios.post(`${CORE_URL}/api/documents/${doc.id}/${endpoint}`, {}, { headers: authHeaders() });
      notify("Reprocessing has been requested. The status will update when the backend finishes.", "success");
      await loadDocuments(1);
    } catch (error) { notify(getError(error, "Could not retry document processing."), "error"); }
    finally { setDetailLoading(false); }
  }
  async function pollEmailNow() {
    setEmailBusy(true);
    try {
      const response = await axios.post<Record<string, unknown>>(`${CORE_URL}/api/email/poll`, {}, { headers: authHeaders() });
      const summary = response.data;
      notify(`Email poll complete. ${Number(summary.new_documents || 0)} new documents, ${Number(summary.failed || 0)} failed.`, Number(summary.failed || 0) ? "error" : "success");
      await Promise.all([loadEmailInbox(), loadDocuments(1), loadInvoices()]);
    } catch (error) { notify(getError(error, "Could not poll the email inbox."), "error"); }
    finally { setEmailBusy(false); }
  }
  async function retryEmailMessage(message: EmailMessageItem) {
    setEmailBusy(true);
    try {
      await axios.post(`${CORE_URL}/api/email/messages/${message.id}/retry`, {}, { headers: authHeaders() });
      notify("Email retry queued.", "success"); await loadEmailInbox();
    } catch (error) { notify(getError(error, "Could not retry this email."), "error"); }
    finally { setEmailBusy(false); }
  }

  async function submitCommandAction() {
    if (!commandAction) return;
    const { bill, action } = commandAction;
    const base = `${CORE_URL}/api/invoices/${bill.invoice_id}`;
    let endpoint = "";
    let body: Record<string, unknown> = {};
    if (action === "approve") endpoint = "approve";
    else if (action === "reject" || action === "hold" || action === "escalate") {
      if (commandActionReason.trim().length < 3) { notify("Enter a reason with at least 3 characters.", "error"); return; }
      endpoint = action;
      body = { reason: commandActionReason.trim() };
    } else if (action === "reassign") {
      if (commandActionReason.trim().length < 3) { notify("Enter a reason with at least 3 characters.", "error"); return; }
      if (!commandOwnerId) { notify("Choose an active associate.", "error"); return; }
      endpoint = action;
      body = { reason: commandActionReason.trim(), owner_user_id: commandOwnerId };
    } else if (action === "pay") {
      if (!commandPaidDate || !commandPaymentReference.trim()) { notify("Enter the payment date and reference.", "error"); return; }
      endpoint = action;
      body = { paid_date: commandPaidDate, method: commandPaymentMethod, reference: commandPaymentReference.trim() };
    } else if (action === "resubmit") endpoint = "resubmit";
    else { notify("This action is not available yet.", "info"); return; }

    setCommandActionBusy(true);
    try {
      await axios.post(`${base}/${endpoint}`, body, { headers: authHeaders() });
      notify(`${humanize(action)} completed.`, "success");
      setCommandAction(null);
      await Promise.all([loadCommandCenter(), loadInvoices()]);
    } catch (error) {
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : undefined;
      const detailRecord = detail && typeof detail === "object" ? detail as Record<string, unknown> : undefined;
      const serverMessage = typeof detail === "string" ? detail : typeof detailRecord?.message === "string" ? detailRecord.message : typeof detailRecord?.detail === "string" ? detailRecord.detail : undefined;
      const message = axios.isAxiosError(error) && error.response?.status === 403
        ? `You do not have permission to perform this action.${typeof serverMessage === "string" ? ` ${serverMessage}` : ""}`
        : typeof serverMessage === "string" ? serverMessage
          : axios.isAxiosError(error) && error.response ? `Could not ${action} this invoice. (HTTP ${error.response.status})`
            : getError(error, `Could not ${action} this invoice.`);
      notify(message, "error");
    } finally { setCommandActionBusy(false); }
  }

  const filteredDocs = useMemo(() => documents.filter(doc => {
    const q = `${docSearch} ${globalSearch}`.trim().toLowerCase();
    const actualType = String(doc.doc_type || (doc.extracted_json?.document_type as string | undefined) || "").toLowerCase();
    const matchesSearch = !q || [doc.original_filename, doc.id, actualType, doc.email_sender].some(value => String(value || "").toLowerCase().includes(q));
    const matchesType = docType === "all" || actualType === docType;
    const matchesStatus = docStatus === "all" || (docStatus === "processing" ? isProcessing(doc.status) : docStatus === "ready" ? ["parsed", "extracted", "processed"].includes(doc.status.toLowerCase()) : doc.status === docStatus);
    return matchesSearch && matchesType && matchesStatus;
  }), [documents, docSearch, globalSearch, docType, docStatus]);
  const docCounts = useMemo(() => ({ processing: documents.filter(d => ["received", "reading", "parsing", "parsed", "classified", "matching"].includes(d.status)).length, completed: documents.filter(d => ["extracted", "processed", "match_approved", "approved"].includes(d.status)).length, attention: documents.filter(d => ["failed", "needs_data_review", "needs_vendor_review", "incomplete", "match_issues"].includes(d.status)).length }), [documents]);

  if (restoring && !token) return <main className="session-screen"><Loader title="Restoring secure session" subtitle="Checking your sign-in session…" /></main>;
  if (!token) return <main className="auth-shell page-enter">
    <section className="auth-hero"><div className="brand brand-light"><span className="brand-mark">G</span><span>GENWORX<small>FINANCE AUTOMATION</small></span></div><div className="hero-copy"><span className="eyebrow">ACCOUNTS PAYABLE WORKSPACE</span><h1>Clarity for every<br /><em>invoice and document.</em></h1><p>Bring your documents together, track invoice progress, and spot issues without losing sight of the source evidence.</p><div className="hero-points"><span>✓ Secure workspace</span><span>✓ Clear processing status</span><span>✓ Human-reviewed decisions</span></div></div><div className="hero-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-file">▤</div><span className="orbit-dot dot-one"/><span className="orbit-dot dot-two"/><span className="orbit-dot dot-three"/></div></section>
    <section className="auth-side"><form className="auth-card" onSubmit={submitAuth}><span className="eyebrow purple">WELCOME TO GENWORX</span><h2>Sign in to your workspace</h2><p className="muted">Use the work email and password provided by your administrator.</p>
      <label className="form-label">Work email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" /></label>
      <label className="form-label">Password<span className="password-control"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} minLength={1} required placeholder="Enter your password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label>
      {loginError && <div className="login-error" role="alert">{loginError}</div>}
      <button className="primary full" disabled={authBusy}>{authBusy ? <><span className="mini-spin"/> Please wait…</> : "Sign in →"}</button>
      <p className="security-note"><span>●</span> Your session is handled securely by GenWorx Auth.</p></form></section>
  </main>;

  if (profileLoading) return <main className="session-screen"><Loader title="Loading your workspace" subtitle="Checking your account permissions…" /></main>;
  if (mustChangePassword) return <main className="session-screen page-enter"><form className="auth-card" onSubmit={submitPasswordChange}><span className="eyebrow purple">SECURE YOUR ACCOUNT</span><h2>Change your temporary password</h2><p className="muted">Your administrator issued a temporary password. Set a new password before continuing. Use at least 12 characters with an uppercase letter, lowercase letter, number, and symbol.</p>{profile?.temp_password_expires_at && <p className="muted">Temporary password expires {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(profile.temp_password_expires_at))}.</p>}<label className="form-label">Temporary password<span className="password-control"><input type={showCurrentPassword ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required /><button type="button" aria-label={showCurrentPassword ? "Hide temporary password" : "Show temporary password"} onClick={() => setShowCurrentPassword(value => !value)}>{showCurrentPassword ? "Hide" : "Show"}</button></span></label><label className="form-label">New password<span className="password-control"><input type={showNewPassword ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={12} maxLength={128} required /><button type="button" aria-label={showNewPassword ? "Hide new password" : "Show new password"} onClick={() => setShowNewPassword(value => !value)}>{showNewPassword ? "Hide" : "Show"}</button></span></label><label className="form-label">Confirm new password<span className="password-control"><input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={12} maxLength={128} required /><button type="button" aria-label={showConfirmPassword ? "Hide confirmation" : "Show confirmation"} onClick={() => setShowConfirmPassword(value => !value)}>{showConfirmPassword ? "Hide" : "Show"}</button></span></label><button className="primary full" disabled={authBusy}>{authBusy ? "Saving…" : "Change password and continue"}</button><button className="secondary full" type="button" onClick={() => void logout()} disabled={authBusy}>Sign out</button></form></main>;

  return <div className="app-shell">
    <aside className={mobileNavOpen ? "sidebar sidebar-open" : "sidebar"}>
      <div className="sidebar-brand-row"><div className="brand"><span className="brand-mark">G</span><span>GENWORX<small>FINANCE AUTOMATION</small></span></div><button className="nav-toggle" aria-label="Toggle navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}>☰</button></div>
      <p className="side-label">WORKSPACE</p>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={activePage === "dashboard" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("dashboard"); setMobileNavOpen(false); }}><span className="nav-icon">▦</span><span>Dashboard</span></button>
        <button className={activePage === "command-center" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("command-center"); setMobileNavOpen(false); if (activePage !== "command-center") updateInvoiceQuery({ status: "" }); }}><span className="nav-icon">▤</span><span>Command Center</span></button>
        <button className={activePage === "documents" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("documents"); setMobileNavOpen(false); }}><span className="nav-icon">▤</span><span>Documents</span><b>{docTotal}</b></button>
        <button className={activePage === "invoices" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("invoices"); setMobileNavOpen(false); if (activePage !== "invoices" && invoiceQuery.status && !invoiceStatuses.includes(invoiceQuery.status as InvoiceItem["status"])) updateInvoiceQuery({ status: "" }); }}><span className="nav-icon">＄</span><span>Invoices</span><b>{Object.values(invoiceCounts).reduce((sum, count) => sum + count, 0)}</b></button>
        <button className={activePage === "email" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("email"); setMobileNavOpen(false); }}><span className="nav-icon">✉</span><span>Email inbox</span><b>{emailStatus?.counts?.needs_attention || 0}</b></button>
        {profile?.role === "admin" && <button className={activePage === "associates" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("associates"); setMobileNavOpen(false); }}><span className="nav-icon">♙</span><span>Associates</span></button>}
      </nav>
      <div className="sidebar-bottom"><div className="profile"><span className="avatar">{(email[0] || "U").toUpperCase()}</span><div><b>{profile?.name || email || "Workspace user"}</b><small>{email}</small></div></div><button className="signout" onClick={() => void logout()} disabled={authBusy}>↪ <span>Sign out</span></button></div>
    </aside>
    <main className="main-area"><header className="topbar"><button className="topbar-nav-toggle" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}>☰</button><div className="topbar-title"><span className="muted">Workspace</span><span className="breadcrumb-separator">/</span><b>{activePage === "associates" && profile?.role === "admin" ? "Associates" : activePage === "command-center" ? "Command Center" : activePage === "invoices" ? "Invoices" : activePage === "documents" ? "Documents" : activePage === "email" ? "Email inbox" : "Dashboard"}</b></div>{activePage !== "command-center" && <label className="topbar-search"><span aria-hidden="true">⌕</span><input value={globalSearch} onChange={event => { setGlobalSearch(event.target.value); updateInvoiceQuery({ search: event.target.value }); }} placeholder="Search invoices or documents" aria-label="Search invoices or documents" /></label>}<button className="topbar-user" aria-label={`Signed in as ${email}`}><span className="avatar">{(email[0] || "U").toUpperCase()}</span><span className="topbar-user-email">{profile?.name || email}</span><span aria-hidden="true">⌄</span></button></header>
      <div className="content">
      {activePage === "email" ? <EmailInboxWorkspace status={emailStatus} messages={emailMessages} total={emailTotal} filter={emailFilter} onFilter={value => { setEmailPage(0); setEmailFilter(value); }} reason={emailReasonFilter} onReason={value => { setEmailPage(0); setEmailReasonFilter(value); }} page={emailPage} loading={emailLoading} busy={emailBusy} error={emailError} onPoll={() => void pollEmailNow()} onRetry={message => void retryEmailMessage(message)} onRefresh={() => void loadEmailInbox()} onPage={setEmailPage} onOpenDocument={id => { const doc = documents.find(item => item.id === id); if (doc) void openDocument(doc); else { setDocSource("email"); setActivePage("documents"); } }} onOpenInvoice={id => { setActivePage("invoices"); const found = invoices.find(invoice => invoice.invoice_id === id); if (found) void openInvoice(id); }} /> : activePage === "invoices" ? <InvoicesWorkspacePage invoices={invoices} counts={invoiceCounts} total={invoiceTotal} page={invoiceQuery.page} filters={invoiceQuery} vendors={filterVendors} owners={filterOwners} source={invoiceSource} loading={invoiceLoading} error={invoiceError} onFilter={patch => updateInvoiceQuery(patch)} onVendorSearch={searchFilterVendors} onSource={value => setInvoiceSource(value)} onPage={page => updateInvoiceQuery({ page }, false)} onRefresh={() => void loadInvoices()} onOpen={invoice => void openInvoice(invoice.invoice_id)} onOpenDocument={id => { setActivePage("documents"); const doc = documents.find(item => item.id === id); if (doc) void openDocument(doc); }} /> : activePage === "associates" && profile?.role === "admin" ? <>
        <section className="panel admin-associate-panel">
          <div className="panel-head"><div><span className="eyebrow purple">ADMINISTRATION</span><h2>Add an associate</h2><p className="muted">Temporary password is valid for 24 hours. The associate must change it at first sign in.</p></div></div>
          <form className="toolbar" onSubmit={createAssociate}>
            <label className="form-label">Name<input value={associateName} onChange={e => setAssociateName(e.target.value)} minLength={2} maxLength={150} required /></label>
            <label className="form-label">Email<input type="email" value={associateEmail} onChange={e => setAssociateEmail(e.target.value)} required /></label>
            <label className="form-label">Temporary password (optional)<input type="password" value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} minLength={12} maxLength={128} /></label>
            <button className="primary" disabled={authBusy}>{authBusy ? "Creating…" : "Add associate"}</button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>Associates</h2><p className="muted">Active associate accounts</p></div><span className="count">{associates.filter(item => item.is_active).length} people</span></div>
          <div className="toolbar"><button className="secondary" onClick={() => void loadAssociates()} disabled={associatesLoading}>{associatesLoading ? "Loading…" : "Refresh list"}</button></div>
          {associatesError && <div className="notice error">{associatesError}<button onClick={() => void loadAssociates()}>Try again</button></div>}
          {associatesLoading ? <LoadingPanel title="Loading associates" subtitle="Retrieving active accounts…"/> : associates.filter(item => item.is_active).length ? <div className="table-wrap"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>ADDED</th><th></th></tr></thead><tbody>{associates.filter(item => item.is_active).map(associate => <tr key={associate.id}><td>{associate.name}</td><td>{associate.email}</td><td>{dateLabel(associate.created_at)}</td><td className="associate-actions"><button className="secondary" onClick={() => void resetAssociatePassword(associate)} disabled={authBusy}>Reset password</button><button className="secondary" onClick={() => void removeAssociate(associate)}>Remove access</button></td></tr>)}</tbody></table></div> : <EmptyState title="No associates yet" description="Add an associate using the form above."/>}
        </section>
      </> : activePage === "command-center" ? <CommandCenter bucket={(invoiceQuery.bucket || "ready_to_pay") as CommandBucket} summary={commandSummary} bills={commandBills} total={commandTotal} page={invoiceQuery.page} pageSize={25} filters={invoiceQuery} vendors={filterVendors} owners={filterOwners} confidences={commandConfidences} loading={commandLoading} error={commandError} onBucket={bucket => updateInvoiceQuery({ bucket, sort_by: bucket === "overdue" ? "days_overdue" : "date_received" })} onFilter={patch => updateInvoiceQuery(patch)} onVendorSearch={searchFilterVendors} onPage={page => updateInvoiceQuery({ page }, false)} onRefresh={() => void loadCommandCenter()} onOpen={id => void openInvoice(id)} onAction={(bill, action) => { setCommandAction({ bill, action }); setCommandActionReason(""); setCommandOwnerId(""); setCommandPaymentReference(""); setCommandPaidDate(new Date().toISOString().slice(0, 10)); }}/>: activePage === "dashboard" ? <DashboardWorkspace invoices={invoices} counts={invoiceCounts} loading={invoiceLoading} error={invoiceError} search={globalSearch} emailStatus={emailStatus} onEmail={() => setActivePage("email")} onPollEmail={() => void pollEmailNow()} onOpen={invoice => void openInvoice(invoice.invoice_id)} onInvoices={() => setActivePage("invoices")} onDocuments={() => setActivePage("documents")} onRefresh={() => void loadInvoices()} /> : <>
        <header className="welcome"><div><span className="eyebrow purple">FINANCE OPERATIONS</span><h1>Documents</h1><p className="muted">Upload, find, and monitor every document in one place.</p></div><label className={`primary upload ${uploading ? "disabled" : ""}`}><span>＋</span> {uploading ? "Uploading…" : "Upload documents"}<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.doc,.docx,.eml" onChange={uploadFiles} disabled={uploading} hidden /></label></header>
        {uploading && <div className="compact-upload-progress panel">
          <div className="compact-upload-status"><DocumentLoader/><span>Uploading documents… {uploadProgress}%</span></div>
          <div className="progress-track"><span style={{ width: `${uploadProgress}%` }}/></div>
        </div>}
        <section className="panel simple-documents">
          <div className="panel-head"><div><h2>Your documents</h2><p className="muted">Select any card to preview the document details.</p></div><span className="count">{docTotal} files</span></div>
          <div className="toolbar simple-toolbar">
            <label className="search"><span>⌕</span><input value={docSearch} onChange={e => setDocSearch(e.target.value)} placeholder="Search documents…" /></label>
            <select value={docSource} onChange={e => { setDocPage(1); setDocSource(e.target.value as "latest" | "all" | "email"); }} aria-label="Filter documents by source"><option value="latest">Latest upload</option><option value="email">Email</option><option value="all">All</option></select>
            <select value={docType} onChange={e => { setDocPage(1); setDocType(e.target.value); }} aria-label="Filter by document type"><option value="all">All types</option><option value="invoice">Invoices</option><option value="po">Purchase orders</option><option value="goods_receipt">Goods receipts</option><option value="other">Other</option></select>
            <select value={docStatus} onChange={e => { setDocPage(1); setDocStatus(e.target.value); }} aria-label="Filter by document status"><option value="all">All statuses</option><option value="processing">Processing</option><option value="ready">Ready</option><option value="failed">Failed</option><option value="ignored">Ignored</option></select>
            <button className="icon-button" onClick={() => void loadDocuments(docPage)} disabled={docLoading} aria-label="Refresh documents">↻</button>
          </div>
          {docError && <div className="notice error">{docError}<button onClick={() => void loadDocuments(docPage)}>Try again</button></div>}
          {docLoading ? <LoadingPanel title="Loading documents" subtitle="Syncing your latest uploads…"/> : filteredDocs.length ? <>
            <div className="document-card-grid">{filteredDocs.map((doc, index) => <article role="button" tabIndex={0} className="document-card" key={doc.id} style={{ "--row-index": index } as React.CSSProperties} onClick={() => void openDocument(doc)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); void openDocument(doc); } }}>
              <div className="document-card-top"><span className="file-badge">{(doc.original_filename.split(".").pop() || "FILE").slice(0, 4).toUpperCase()}</span><span className={`pill ${statusClass(doc.status)}`}><i/>{friendlyStatus(doc.status)}</span></div>
              <div className="document-card-icon">▤</div>
              <strong title={doc.original_filename}>{doc.original_filename}</strong>
              <span className="document-card-type">{humanize(doc.doc_type || (doc.extracted_json?.document_type as string | undefined) || "Document")}</span>
              <span className="document-source-badge">{doc.source === "email" ? "Email" : "Upload"}</span>
              {doc.linked_invoice_id ? <button type="button" className="text-link document-card-invoice" onClick={event => { event.stopPropagation(); const invoice = invoices.find(item => item.invoice_id === doc.linked_invoice_id); if (invoice) void openInvoice(invoice.invoice_id); else setActivePage("invoices"); }}>View invoice · {doc.linked_invoice_status ? invoiceStatusLabels[doc.linked_invoice_status as InvoiceItem["status"]] || humanize(doc.linked_invoice_status) : "Linked"}</button> : <span className="document-card-reason">{doc.failure_message || "Invoice not created yet"}</span>}
              <span className="document-card-date">Uploaded {dateLabel(doc.created_at)}</span>
              <span className="document-card-preview">Preview details ↗</span>
            </article>)}</div>
            <Pagination page={docPage} total={docTotal} pageSize={50} loading={docLoading} onChange={next => { setDocPage(next); void loadDocuments(next); }}/>
          </> : <EmptyState title={docSearch || docType !== "all" || docStatus !== "all" ? "No matching documents" : "No documents uploaded yet"} description={docSearch || docType !== "all" || docStatus !== "all" ? "Try changing your search or filters." : "Choose files above to upload your first document."} action={(docSearch || docType !== "all" || docStatus !== "all") ? <button className="secondary" onClick={() => { setDocSearch(""); setDocType("all"); setDocStatus("all"); }}>Clear filters</button> : null}/>}
        </section>
      </>}
      <footer className="footer"><span>GENWORX AP · DOCUMENT WORKSPACE</span><span>Statuses and decisions are provided by AP-Core.</span></footer>
      </div>
    </main>
    {toast && <div className={`toast ${toast.kind}`} role="status"><span className="toast-symbol">{toast.kind === "success" ? "✓" : toast.kind === "error" ? "!" : "i"}</span><span>{toast.text}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button></div>}
    {associateCredential && <div className="modal-backdrop credential-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAssociateCredential(null); }}><section className="modal credential-modal" role="dialog" aria-modal="true" aria-labelledby="credential-title"><header className="modal-head"><div><span className="eyebrow purple">TEMPORARY CREDENTIAL</span><h2 id="credential-title">Share with {associateCredential.email}</h2><p className="muted">This password is shown once. The associate must set a new password at sign in.</p></div><button className="modal-close" aria-label="Close" onClick={() => setAssociateCredential(null)}>×</button></header><div className="modal-body"><label className="form-label">Temporary password<input className="credential-value" readOnly value={associateCredential.password} onFocus={event => event.currentTarget.select()} /></label><p className="muted">Expires {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(associateCredential.expiresAt))}.</p><div className="modal-actions"><button className="secondary" onClick={() => setAssociateCredential(null)}>Close</button><button className="primary" onClick={() => void copyAssociateCredential()}>{credentialCopied ? "Copied" : "Copy password"}</button></div></div></section></div>}
    {selectedDoc && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedDoc(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header className="modal-head"><div><span className="eyebrow purple">RECORD DETAILS</span><h2 id="detail-title">{selectedDoc.original_filename}</h2></div><button className="modal-close" aria-label="Close details" onClick={() => setSelectedDoc(null)}>×</button></header>
      {detailLoading ? <LoadingPanel title="Opening record" subtitle="Fetching the latest information…"/> : modalError && <div className="notice error">{modalError}</div>}
      {selectedDoc && !detailLoading && <div className="modal-body"><div className="detail-summary"><span className={`pill ${statusClass(selectedDoc.status)}`}><i/>{friendlyStatus(selectedDoc.status)}</span><span className="pill neutral">{humanize(selectedDoc.doc_type)}</span></div>{selectedDoc.failure_message && <div className="notice error">{selectedDoc.failure_message}</div>}<div className="field-grid"><DetailField label="Uploaded" value={dateLabel(selectedDoc.created_at)}/><DetailField label="Last updated" value={dateLabel(selectedDoc.updated_at)}/><DetailField label="Email sender" value={selectedDoc.email_sender}/><DetailField label="Email subject" value={selectedDoc.email_subject}/><DetailField label="Email received" value={selectedDoc.email_received_at ? dateTimeLabel(selectedDoc.email_received_at) : undefined}/></div><DocumentExtractedDetails doc={selectedDoc}/><div className="modal-actions"><button className="secondary" onClick={() => void openOriginalFile(selectedDoc)}>↗ Open original file</button>{selectedDoc.status.toLowerCase() === "failed" && <button className="primary" onClick={() => void retryDocument(selectedDoc)} disabled={detailLoading}>↻ Retry processing</button>}</div></div>}
    </section></div>}
    {selectedInvoice && (
      <div className="modal-backdrop drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedInvoice(null); }}>
        <InvoiceReviewDrawer
          invoice={selectedInvoice}
          candidates={matchCandidates}
          onClose={() => setSelectedInvoice(null)}
          onMatch={(candidate, accept) => { void confirmSuggestedMatch(candidate, accept); }}
          onDecision={action => { setDecision({ invoiceId: selectedInvoice.invoice_id, action, reason: "" }); }}
        />
      </div>
    )}
    {commandAction && <div className="modal-backdrop command-action-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !commandActionBusy) setCommandAction(null); }}><form className="modal command-action-modal" role="dialog" aria-modal="true" aria-labelledby="command-action-title" onSubmit={event => { event.preventDefault(); void submitCommandAction(); }}><header className="modal-head"><div><span className="eyebrow">INVOICE ACTION</span><h2 id="command-action-title">{humanize(commandAction.action)} invoice</h2></div><button className="modal-close" type="button" onClick={() => setCommandAction(null)} disabled={commandActionBusy} aria-label="Cancel">×</button></header><div className="modal-body"><p>Confirm {humanize(commandAction.action).toLowerCase()} for <strong>{commandAction.bill.vendor_name || "Unknown vendor"}</strong> · <strong>{formatInvoiceMoney(commandAction.bill.total_amount, commandAction.bill.currency)}</strong>?</p>{commandAction.action === "pay" && <><label className="form-label">Payment date<input type="date" value={commandPaidDate} onChange={event => setCommandPaidDate(event.target.value)} required/></label><label className="form-label">Payment method<select value={commandPaymentMethod} onChange={event => setCommandPaymentMethod(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="other">Other</option></select></label><label className="form-label">Payment reference<input value={commandPaymentReference} onChange={event => setCommandPaymentReference(event.target.value)} required maxLength={200}/></label></>}{["reject", "hold", "escalate", "reassign"].includes(commandAction.action) && <label className="form-label">Reason<textarea value={commandActionReason} onChange={event => setCommandActionReason(event.target.value)} required minLength={3} maxLength={1000} rows={4} placeholder="Enter a reason"/></label>}{commandAction.action === "reassign" && <label className="form-label">Assign to<select value={commandOwnerId} onChange={event => setCommandOwnerId(event.target.value)} required><option value="">Choose an associate</option>{filterOwners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>}<div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setCommandAction(null)} disabled={commandActionBusy}>Cancel</Button><Button type="submit" variant={commandAction.action === "reject" ? "danger" : "primary"} disabled={commandActionBusy}>{commandActionBusy ? "Saving…" : `Confirm ${humanize(commandAction.action).toLowerCase()}`}</Button></div></div></form></div>}{decision && <div className="modal-backdrop reason-backdrop" role="presentation"><form className="modal reason-modal" onSubmit={submitInvoiceDecision}><header className="modal-head"><div><span className="eyebrow purple">REVIEW DECISION</span><h2>{decision.action === "hold" ? "Place invoice on hold" : decision.action === "reject" ? "Reject invoice" : "Approve with exception"}</h2></div><button className="modal-close" type="button" onClick={() => setDecision(null)} aria-label="Cancel">×</button></header><div className="modal-body"><label className="form-label">Reason<textarea value={decision.reason} onChange={event => setDecision({ ...decision, reason: event.target.value })} required minLength={3} maxLength={1000} rows={4} placeholder="Explain this decision" /></label><div className="modal-actions"><button className="secondary" type="button" onClick={() => setDecision(null)}>Cancel</button><button className="primary" type="submit">Save decision</button></div></div></form></div>}
    {uploadResult && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setUploadResult(null); }}><section className="modal results-modal" role="dialog" aria-modal="true" aria-labelledby="upload-result-title"><header className="modal-head"><div><span className="eyebrow purple">UPLOAD SUMMARY</span><h2 id="upload-result-title">{uploadResult.successes} of {uploadResult.total} files uploaded</h2><p className="muted">Each result below comes from the upload request.</p></div><button className="modal-close" onClick={() => setUploadResult(null)} aria-label="Close upload summary">×</button></header><div className="modal-body"><div className="outcome-list">{uploadResult.outcomes.map((outcome, index) => <div className="outcome-row" key={`${outcome.name}-${index}`}><span className={`outcome-icon ${outcome.ok ? "ok" : "bad"}`}>{outcome.ok ? "✓" : "!"}</span><div><b>{outcome.name}</b><small>{outcome.message}</small></div></div>)}</div><div className="modal-actions"><button className="secondary" onClick={() => setUploadResult(null)}>Close</button><button className="primary" onClick={() => setUploadResult(null)}>View documents</button></div></div></section></div>}
  </div>;
}
function Loader({ title, subtitle }: { title: string; subtitle: string }) { return <div className="loader-screen"><DocumentLoader/><h2>{title}</h2><p>{subtitle}</p></div>; }
function DocumentLoader() { return <span className="document-loader" aria-hidden="true"><span className="loader-orbit orbit-a"/><span className="loader-orbit orbit-b"/><span className="loader-paper"><i/><i/><i/></span><span className="loader-point point-a"/><span className="loader-point point-b"/></span>; }
function LoadingPanel({ title, subtitle }: { title: string; subtitle: string }) { return <div className="loading-panel" role="status"><div className="skeleton-copy"><Skeleton/><Skeleton/><span><b>{title}</b> · {subtitle}</span></div><div className="skeleton-lines"><Skeleton/><Skeleton/><Skeleton/></div></div>; }
function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="empty"><div className="empty-icon">▤</div><h3>{title}</h3><p>{description}</p>{action}</div>; }
type AnyRecord = Record<string, unknown>;
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function pick(data: AnyRecord, keys: string[]) { for (const key of keys) { const value = data[key]; if (value !== null && value !== undefined && value !== "" && typeof value !== "object") return value; } return undefined; }
function confidenceFor(data: AnyRecord, keys: string[]) {
  const confidence = record(data.field_confidence || data.confidence);
  for (const key of keys) {
    const entry = confidence[key];
    const raw = typeof entry === "object" && entry !== null ? record(entry).confidence ?? record(entry).score : entry;
    const number = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(number)) return number < 1 ? number * 100 < 80 : number < 80;
  }
  return false;
}
function displayDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}
function DetailField({ label, value, verify = false }: { label: string; value?: unknown; verify?: boolean }) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  return <div className="field"><span>{label}</span><strong>{String(value)}{verify && <small className="verify-warning" title="Please verify" aria-label="Please verify"> ⚠ Please verify</small>}</strong></div>;
}
const invoiceFields: { label: string; keys: string[]; date?: boolean }[] = [
  { label: "Vendor", keys: ["vendor", "vendor_name", "supplier", "supplier_name"] },
  { label: "Vendor Tax ID", keys: ["vendor_tax_id", "tax_id", "gstin", "vat_number"] },
  { label: "Invoice Number", keys: ["invoice_number", "invoice_no", "number"] },
  { label: "Invoice Date", keys: ["invoice_date", "date"], date: true },
  { label: "Due Date", keys: ["due_date"], date: true },
  { label: "PO/Order Number", keys: ["po_number", "purchase_order_number", "order_number", "po_no"] },
  { label: "Payment Terms", keys: ["payment_terms", "terms"] },
  { label: "Currency", keys: ["currency", "currency_code"] },
];
function DocumentExtractedDetails({ doc }: { doc: Doc }) {
  const data = record(doc.extracted_json);
  const nested = record(data.invoice);
  const source = { ...data, ...nested };
  const currencyValue = pick(source, ["currency", "currency_code"]);
  const currency = typeof currencyValue === "string" && /^[A-Za-z]{3}$/.test(currencyValue) ? currencyValue.toUpperCase() : "";
  const formatAmount = (value: unknown) => {
    if (value == null || value === "" || (typeof value !== "number" && typeof value !== "string")) return undefined;
    const amount = Number(value);
    if (!Number.isFinite(amount)) return String(value);
    try { return new Intl.NumberFormat("en-IN", currency ? { style: "currency", currency, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }).format(amount); }
    catch { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(amount); }
  };
  const formatQuantity = (value: unknown) => {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    const amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(amount) : String(value);
  };
  const confidenceKeys = (keys: string[]) => keys;
  const linesValue = pick(source, ["line_items", "items"]);
  const lines = Array.isArray(linesValue) ? linesValue.map(record) : [];
  const amountFields = [
    { label: "Subtotal", keys: ["subtotal", "sub_total"] },
    { label: "Tax", keys: ["tax", "tax_amount", "total_tax"] },
    { label: "Total", keys: ["total", "total_amount", "invoice_total", "grand_total"] },
  ];
  const invoicePresent = invoiceFields.some(field => pick(source, field.keys) !== undefined);
  return <div className="extracted-details">
    {invoicePresent && <section className="extracted-section"><h3 className="section-title">Invoice</h3><div className="field-grid">{invoiceFields.map(field => {
      const value = pick(source, field.keys);
      return <DetailField key={field.label} label={field.label} value={field.date ? displayDate(value) : value} verify={value !== undefined && confidenceFor(source, confidenceKeys(field.keys))}/>;
    })}</div></section>}
    {amountFields.some(field => pick(source, field.keys) !== undefined) && <section className="extracted-section"><h3 className="section-title">Amounts</h3><div className="field-grid">{amountFields.map(field => {
      const value = pick(source, field.keys);
      return <DetailField key={field.label} label={field.label} value={formatAmount(value)} verify={value !== undefined && confidenceFor(source, field.keys)}/>;
    })}</div></section>}
    {lines.length > 0 && <section className="extracted-section"><h3 className="section-title">Line Items</h3><div className="table-wrap"><table className="line-items-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>{lines.map((line, index) => {
      const description = pick(line, ["description", "item_description", "name"]);
      const quantity = pick(line, ["qty", "quantity"]);
      const price = pick(line, ["unit_price", "price"]);
      const amount = pick(line, ["amount", "line_amount", "line_total", "total"]);
      return <tr key={index}><td>{description == null ? "" : String(description)}{description != null && confidenceFor(line, ["description", "item_description"]) && <small className="verify-warning"> ⚠ Please verify</small>}</td><td>{formatQuantity(quantity) || ""}{quantity != null && confidenceFor(line, ["qty", "quantity"]) && <small className="verify-warning"> ⚠ Please verify</small>}</td><td>{formatAmount(price) || ""}{price != null && confidenceFor(line, ["unit_price"]) && <small className="verify-warning"> ⚠ Please verify</small>}</td><td>{formatAmount(amount) || ""}{amount != null && confidenceFor(line, ["amount", "line_amount", "line_total"]) && <small className="verify-warning"> ⚠ Please verify</small>}</td></tr>;
    })}</tbody></table></div></section>}
    {!invoicePresent && !amountFields.some(field => pick(source, field.keys) !== undefined) && !lines.length && <p className="muted">No invoice details are available yet.</p>}
  </div>;
}
function Pagination({ page, total, pageSize, loading, onChange }: { page: number; total: number; pageSize: number; loading: boolean; onChange: (page: number) => void }) { const pages = Math.max(1, Math.ceil(total / pageSize)); return <div className="pagination"><span>Showing page <b>{page}</b> of <b>{pages}</b> · {total} records</span><div><button className="secondary" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>← Previous</button><button className="secondary" disabled={loading || page >= pages} onClick={() => onChange(page + 1)}>Next →</button></div></div>; }

const invoiceStatuses: InvoiceItem["status"][] = ["processing", "needs_review", "ready_to_pay", "on_hold", "rejected"];
const invoiceStatusLabels: Record<InvoiceItem["status"], string> = { processing: "In progress", needs_review: "Needs review", ready_to_pay: "Ready to pay", on_hold: "On hold", rejected: "Rejected" };
function invoiceStatusClass(status: InvoiceItem["status"]) { return ({ processing: "invoice-status-processing", needs_review: "invoice-status-review", ready_to_pay: "invoice-status-ready", on_hold: "invoice-status-hold", rejected: "invoice-status-rejected" })[status]; }
function invoiceStatusTone(status: InvoiceItem["status"]): "blue" | "amber" | "green" | "gray" | "red" { return ({ processing: "blue", needs_review: "amber", ready_to_pay: "green", on_hold: "gray", rejected: "red" } as const)[status]; }
function InvoicesWorkspace({ invoices, counts, status, onStatus, source, onSource, loading, error, search, onRefresh, onOpen, onOpenDocument }: { invoices: InvoiceItem[]; counts: Record<InvoiceItem["status"], number>; status: InvoiceItem["status"] | "all"; onStatus: (status: InvoiceItem["status"] | "all") => void; source: "all" | "upload" | "email"; onSource: (source: "all" | "upload" | "email") => void; loading: boolean; error: string; search: string; onRefresh: () => void; onOpen: (invoice: InvoiceItem) => void; onOpenDocument: (id: string) => void }) {
  const statusFiltered = status === "all" ? invoices : invoices.filter(invoice => invoice.status === status);
  const query = search.trim().toLowerCase();
  const visible = statusFiltered.filter(invoice => (source === "all" || invoice.source === source) && (!query || `${invoice.vendor_name || ""} ${invoice.invoice_no || ""} ${invoice.status} ${invoice.email_sender || ""} ${invoice.email_subject || ""}`.toLowerCase().includes(query)));
  return <><header className="welcome"><div><span className="eyebrow purple">FINANCE OPERATIONS</span><h1>Invoices</h1><p className="muted">Review invoice details and resolve purchase order discrepancies.</p></div><Button variant="secondary" onClick={onRefresh} disabled={loading}>↻ Refresh</Button></header>
    <Card className="panel invoice-workspace"><div className="invoice-status-tabs" role="tablist" aria-label="Invoice status"><button className={status === "all" ? "active" : ""} onClick={() => onStatus("all")}>All <b>{Object.values(counts).reduce((sum, count) => sum + count, 0)}</b></button>{invoiceStatuses.map(item => <button key={item} className={status === item ? "active" : ""} onClick={() => onStatus(item)}><span className={`status-dot ${invoiceStatusClass(item)}`}/>{invoiceStatusLabels[item]} <b>{counts[item]}</b></button>)}</div>
      <div className="email-filter-row"><label className="form-label">Source<select value={source} onChange={event => onSource(event.target.value as "all" | "upload" | "email")}><option value="all">All sources</option><option value="upload">Upload</option><option value="email">Email</option></select></label></div>
      {error && <div className="notice error">{error}<button onClick={onRefresh}>Try again</button></div>}
      {loading ? <LoadingPanel title="Loading invoices" subtitle="Retrieving invoice review status…"/> : visible.length ? <div className="table-wrap"><table className="invoice-table"><thead><tr><th>Vendor</th><th>Invoice No</th><th>Source</th><th>Sender / subject</th><th>Invoice Date</th><th>Due Date</th><th className="amount-cell">Total</th><th>Status</th><th>Source file</th></tr></thead><tbody>{visible.map(invoice => <tr key={invoice.invoice_id} onClick={() => onOpen(invoice)} tabIndex={0} onKeyDown={event => { if (event.key === "Enter") onOpen(invoice); }}><td>{invoice.vendor_name || ""}</td><td>{invoice.invoice_no || ""}</td><td><Badge tone={invoice.source === "email" ? "amber" : "neutral"}>{invoice.source === "email" ? "Email" : "Upload"}</Badge></td><td className="invoice-source-cell">{invoice.source === "email" ? <><span>{invoice.email_sender || "Unknown sender"}</span><small>{invoice.email_subject || "No subject"}</small></> : "—"}</td><td>{invoice.invoice_date ? dateLabel(invoice.invoice_date) : ""}</td><td>{invoice.due_date ? dateLabel(invoice.due_date) : ""}</td><td className="amount-cell">{invoice.total_amount == null ? "" : formatInvoiceMoney(invoice.total_amount, invoice.currency)}</td><td><Badge tone={invoiceStatusTone(invoice.status)} dot>{invoiceStatusLabels[invoice.status]}</Badge></td><td>{invoice.source_document_id && <button className="text-link" onClick={event => { event.stopPropagation(); onOpenDocument(invoice.source_document_id!); }}>View document</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="No invoices in this status" description="Invoices received by upload or email will appear here after extraction."/>}
    </Card>
  </>;
}

function emailOutcome(status?: string) {
  if (status === "processed") return "Processed";
  if (status === "ignored") return "Skipped";
  if (status === "needs_attention") return "Needs attention";
  if (status === "failed" || status === "failed_final") return "Failed";
  if (status === "processing" || status === "received") return "Processing";
  return humanize(status);
}
function EmailInboxWorkspace({ status, messages, total, filter, onFilter, reason, onReason, page, loading, busy, error, onPoll, onRetry, onRefresh, onPage, onOpenDocument, onOpenInvoice }: {
  status: EmailStatus | null;
  messages: EmailMessageItem[];
  total: number;
  filter: string;
  onFilter: (value: string) => void;
  reason: string;
  onReason: (value: string) => void;
  page: number;
  loading: boolean;
  busy: boolean;
  error: string;
  onPoll: () => void;
  onRetry: (message: EmailMessageItem) => void;
  onRefresh: () => void;
  onPage: (value: number) => void;
  onOpenDocument: (id: string) => void;
  onOpenInvoice: (id: string) => void;
}) {
  const last = status?.last_result || {};
  return <div className="email-inbox-page page-enter">
    <header className="welcome"><div><span className="eyebrow purple">MAIL INTAKE</span><h1>Email inbox</h1><p className="muted">Vendor emails and their invoice attachments.</p></div><div className="toolbar"><Button variant="secondary" onClick={onRefresh} disabled={loading}>Refresh</Button><Button variant="primary" onClick={onPoll} disabled={busy || !status?.enabled}>{busy ? "Polling…" : "Poll now"}</Button></div></header>
    <section className="email-inbox-status" aria-label="Email polling status">
      <Card><small>Last poll</small><b>{status?.last_run_at ? dateTimeLabel(status.last_run_at) : "Not polled yet"}</b><span>{status?.enabled ? "Polling enabled" : "Polling disabled"}</span></Card>
      <Card><small>Next poll</small><b>{status?.next_poll_at ? dateTimeLabel(status.next_poll_at) : "—"}</b></Card>
      <Card><small>Fetched</small><b>{emailPollCount(status, "mails_found", "emails")}</b></Card>
      <Card><small>Skipped</small><b>{emailPollCount(status, "skipped", "filtered")}</b></Card>
      <Card><small>Processed</small><b>{emailPollCount(status, "new_documents", "documents_created")}</b></Card>
      <Card><small>Failed</small><b>{status?.counts?.failed || 0}</b></Card>
    </section>
    {status && !status.docling_models_available && <div className="notice error" role="status"><b>OCR models unavailable.</b> Ask an admin to run the model download.</div>}
    {error && <div className="notice error" role="alert">{error}<button onClick={onRefresh}>Try again</button></div>}
    <Card className="panel email-message-panel">
      <div className="email-filter-row"><label className="form-label">Outcome<select value={filter} onChange={event => onFilter(event.target.value)}><option value="all">All</option><option value="processed">Processed</option><option value="skipped">Skipped</option><option value="failed">Failed</option><option value="needs_attention">Needs attention</option></select></label><label className="form-label">Reason<input value={reason} onChange={event => onReason(event.target.value)} placeholder="Filter by reason" /></label></div>
      {loading ? <LoadingPanel title="Loading email messages" subtitle="Syncing the inbox status…"/> : messages.length ? <div className="table-wrap"><table className="email-message-table"><thead><tr><th>Sender</th><th>Subject</th><th>Received</th><th>Outcome</th><th>Reason</th><th>Invoice</th><th>Action</th></tr></thead><tbody>{messages.map(message => <tr key={message.id} className={message.status === "needs_attention" || message.status.startsWith("failed") ? "email-action-row" : ""}><td>{message.sender || "Unknown sender"}</td><td>{message.subject || "No subject"}</td><td>{dateTimeLabel(message.received_at)}</td><td><Badge tone={message.status === "processed" ? "green" : message.status.startsWith("failed") ? "red" : message.status === "needs_attention" ? "amber" : "gray"} dot>{emailOutcome(message.status)}</Badge></td><td>{message.failure_reason || message.filter_reason || "—"}</td><td>{message.linked_invoice_id ? <button className="text-link" onClick={() => onOpenInvoice(message.linked_invoice_id!)}>{message.linked_invoice_status ? humanize(message.linked_invoice_status) : "View invoice"}</button> : message.document_id ? <button className="text-link" onClick={() => onOpenDocument(message.document_id!)}>View document</button> : "—"}</td><td>{message.retryable ? <Button variant="secondary" disabled={busy} onClick={() => onRetry(message)}>Retry</Button> : message.document_id && !message.linked_invoice_id ? <button className="text-link" onClick={() => onOpenDocument(message.document_id!)}>Open source</button> : "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="No email messages found" description={filter !== "all" || reason ? "Change your filters to view more messages." : "Email messages will appear here after polling begins."} action={filter !== "all" || reason ? <Button variant="secondary" onClick={() => { onFilter("all"); onReason(""); }}>Clear filters</Button> : null}/>}
      {total > 25 && <div className="pagination"><span>{total} messages</span><div><Button variant="secondary" disabled={loading || page === 0} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="secondary" disabled={loading || (page + 1) * 25 >= total} onClick={() => onPage(page + 1)}>Next</Button></div></div>}
    </Card>
    <p className="muted email-model-note">Docling OCR and layout models: {status?.docling_models_available ? "available" : "not available"}.</p>
  </div>;
}

function DashboardWorkspace({ invoices, counts, loading, error, search, emailStatus, onEmail, onPollEmail, onOpen, onInvoices, onDocuments, onRefresh }: {
  invoices: InvoiceItem[];
  counts: Record<InvoiceItem["status"], number>;
  loading: boolean;
  error: string;
  search: string;
  emailStatus: EmailStatus | null;
  onEmail: () => void;
  onPollEmail: () => void;
  onOpen: (invoice: InvoiceItem) => void;
  onInvoices: () => void;
  onDocuments: () => void;
  onRefresh: () => void;
}) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const reviewInvoices = invoices.filter(invoice => invoice.status === "needs_review");
  const query = search.trim().toLowerCase();
  const attention = reviewInvoices.filter(invoice => !query || `${invoice.vendor_name || ""} ${invoice.invoice_no || ""}`.toLowerCase().includes(query)).slice(0, 5);
  const chartStatuses = invoiceStatuses;
  return <div className="dashboard-page page-enter">
    <header className="welcome dashboard-welcome"><div><span className="eyebrow purple">ACCOUNTS PAYABLE OVERVIEW</span><h1>Dashboard</h1><p className="muted">A clear view of invoices that need attention and payment.</p></div><div className="dashboard-actions"><Button variant="secondary" onClick={onRefresh} disabled={loading}>Refresh data</Button><Button variant="primary" onClick={onDocuments}>Upload documents</Button></div></header>
    {error && <div className="notice error" role="alert">{error}<button onClick={onRefresh}>Try again</button></div>}
    <section className="kpi-grid" aria-label="Invoice summary">
      <KpiCard label="Total invoices" value={total} tone="accent" icon="▤" onClick={onInvoices}/>
      <KpiCard label="Needs review" value={counts.needs_review} tone="amber" icon="!" onClick={onInvoices}/>
      <KpiCard label="Ready to pay" value={counts.ready_to_pay} tone="green" icon="✓" onClick={onInvoices}/>
      <KpiCard label="On hold" value={counts.on_hold} tone="gray" icon="Ⅱ" onClick={onInvoices}/>
    </section>
    <section className="dashboard-grid">
      <Card className="dashboard-card status-distribution"><div className="section-heading"><div><span className="eyebrow purple">PORTFOLIO</span><h2>Status distribution</h2><p className="muted">Current invoice totals by workflow status.</p></div><button className="text-link" onClick={onInvoices}>View invoices <span aria-hidden="true">→</span></button></div>
        {loading ? <DashboardChartSkeleton/> : total === 0 ? <EmptyState title="No invoice data yet" description="Invoice status distribution will appear after invoices are uploaded." action={<Button onClick={onDocuments}>Go to documents</Button>}/> : <div className="distribution-list">{chartStatuses.map(status => { const count = counts[status]; const percent = total ? Math.round(count / total * 100) : 0; return <div className="distribution-row" key={status}><div className="distribution-label"><Badge tone={invoiceStatusTone(status)} dot>{invoiceStatusLabels[status]}</Badge><span>{count.toLocaleString("en-IN")}</span></div><div className="distribution-track"><span className={`distribution-fill ${invoiceStatusClass(status)}`} style={{ width: `${percent}%` }}/></div><small>{percent}%</small></div>; })}</div>}
      </Card>
      <Card className="dashboard-card attention-card"><div className="section-heading"><div><span className="eyebrow purple">ACTION REQUIRED</span><h2>Needs attention</h2><p className="muted">Recent invoices waiting for review.</p></div><Badge tone="amber" dot>{counts.needs_review} open</Badge></div>
        {loading ? <AttentionSkeleton/> : attention.length ? <div className="attention-list">{attention.map((invoice, index) => <button className="attention-row" key={invoice.invoice_id} onClick={() => onOpen(invoice)} style={{ "--row-index": index } as React.CSSProperties}><span className="attention-vendor-icon">{(invoice.vendor_name || "V").slice(0, 1).toUpperCase()}</span><span className="attention-copy"><b>{invoice.vendor_name || "Unknown vendor"}</b><small>{invoice.invoice_no || "Invoice"}{invoice.invoice_date ? ` · ${dateLabel(invoice.invoice_date)}` : ""}</small></span><span className="attention-amount">{invoice.total_amount == null ? "" : formatInvoiceMoney(invoice.total_amount, invoice.currency)}</span><span className="attention-arrow" aria-hidden="true">→</span></button>)}<Button variant="ghost" className="attention-more" onClick={onInvoices}>Review all invoices <span aria-hidden="true">→</span></Button></div> : <EmptyState title="You’re all caught up" description="There are no invoices waiting for review."/>}
      </Card>
    </section>
    <Card className="panel email-dashboard-card"><div className="panel-head"><div><span className="eyebrow purple">INBOUND DOCUMENTS</span><h2>Email inbox</h2><p className="muted">Review vendor emails and document intake.</p></div><div className="toolbar"><Button variant="secondary" onClick={onEmail}>Open inbox</Button><Button variant="primary" onClick={onPollEmail}>Poll now</Button></div></div><div className="email-inbox-status"><span><small>Last poll</small><b>{emailStatus?.last_run_at ? dateTimeLabel(emailStatus.last_run_at) : "Not polled yet"}</b></span><span><small>Fetched</small><b>{emailPollCount(emailStatus, "mails_found", "emails")}</b></span><span><small>Skipped</small><b>{emailPollCount(emailStatus, "skipped", "filtered")}</b></span><span><small>Processed</small><b>{emailPollCount(emailStatus, "new_documents", "documents_created")}</b></span><span><small>Failed</small><b>{emailStatus?.counts?.failed || 0}</b></span></div>{emailStatus && !emailStatus.docling_models_available && <div className="notice error">OCR models are not installed. Ask an admin to run the model download.</div>}</Card>
    <div className="dashboard-footer-note"><span className="dashboard-note-icon">i</span><span>Dashboard metrics reflect the invoice data available to your account.</span></div>
  </div>;
}

function KpiCard({ label, value, tone, icon, onClick }: { label: string; value: number; tone: "accent" | "amber" | "green" | "gray"; icon: string; onClick: () => void }) {
  return <Card className={`kpi-card kpi-${tone}`}><button className="kpi-card-button" onClick={onClick}><span className="kpi-icon">{icon}</span><span className="kpi-label">{label}</span><CountUp value={value}/><span className="kpi-link">View details <span aria-hidden="true">→</span></span></button></Card>;
}

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || value <= 0) { setDisplay(value); return; }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 650);
      setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  return <strong className="kpi-value">{display.toLocaleString("en-IN")}</strong>;
}

function DashboardChartSkeleton() { return <div className="distribution-skeleton">{Array.from({ length: 4 }, (_, index) => <div key={index}><Skeleton/><Skeleton/></div>)}</div>; }
function AttentionSkeleton() { return <div className="attention-skeleton">{Array.from({ length: 4 }, (_, index) => <div key={index}><Skeleton/><Skeleton/><Skeleton/></div>)}</div>; }
function formatInvoiceMoney(value: unknown, currency?: string | null) {
  const amount = Number(value); if (!Number.isFinite(amount)) return "";
  try { return new Intl.NumberFormat("en-IN", currency ? { style: "currency", currency, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }).format(amount); }
  catch { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(amount); }
}
function safeCompareValue(value: unknown) { return (typeof value === "string" || typeof value === "number" || typeof value === "boolean") ? String(value) : ""; }
function InvoiceComparisonRow({ item, currency }: { item: NonNullable<InvoiceDetail["discrepancies"]>[number]; currency?: string | null }) {
  const amountField = /total|tax|price|amount/i.test(item.field);
  const render = (value: unknown) => amountField && value != null ? formatInvoiceMoney(value, currency) : safeCompareValue(value);
  const result = item.resolved ? "Match" : item.severity === "within_tolerance" ? "Within tolerance" : "Mismatch";
  const cls = item.resolved ? "matched" : item.severity === "error" ? "mismatch" : "within-tolerance";
  return <tr className={`comparison-row comparison-row-${cls}`}><td>{humanize(item.field)}</td><td>{render(item.invoice_value)}</td><td>{render(item.po_value)}</td><td>{render(item.gr_value)}</td><td><span className={`comparison-result ${cls}`}>{result}</span></td></tr>;
}
function InvoiceReviewDrawer({ invoice, candidates, onClose, onMatch, onDecision }: { invoice: InvoiceDetail; candidates: MatchCandidate[]; onClose: () => void; onMatch: (candidate: MatchCandidate, accept: boolean) => void; onDecision: (action: "hold" | "reject" | "approve-exception") => void }) {
  const rows = [...(invoice.discrepancies || [])].sort((a, b) => Number(Boolean(a.resolved)) - Number(Boolean(b.resolved)) || (a.severity === "error" ? -1 : 1));
  const issues = rows.filter(item => !item.resolved);
  const labels: [string, (keyof InvoiceDetail)[]][] = [["Vendor", ["vendor_name"]], ["Vendor Tax ID", ["vendor_tax_id"]], ["Invoice Number", ["invoice_no"]], ["Invoice Date", ["invoice_date"]], ["Due Date", ["due_date"]], ["PO/Order Number", ["po_number_raw"]], ["Payment Terms", ["payment_terms"]], ["Currency", ["currency"]]];
  const hasNoReceipt = issues.some(item => item.field.includes("accepted_quantity") || item.field.includes("goods_receipt"));
  return <section className="modal invoice-detail-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title"><header className="modal-head"><div><span className="eyebrow purple">INVOICE REVIEW</span><h2 id="invoice-detail-title">{invoice.invoice_no || "Invoice details"}</h2></div><button className="modal-close" onClick={onClose} aria-label="Close invoice">×</button></header><div className="modal-body"><div className="detail-summary"><span className={`invoice-status ${invoiceStatusClass(invoice.status)}`}>{invoiceStatusLabels[invoice.status]}</span><span className="pill neutral">{invoice.vendor_name || "Vendor"}</span><Badge tone={invoice.source === "email" ? "amber" : "neutral"}>{invoice.source === "email" ? "Email" : "Upload"}</Badge></div>
    {invoice.source === "email" && <section className="extracted-section"><h3 className="section-title">Email source</h3><div className="field-grid"><DetailField label="Sender" value={invoice.email_sender}/><DetailField label="Subject" value={invoice.email_subject}/><DetailField label="Received" value={invoice.received_at ? dateTimeLabel(invoice.received_at) : undefined}/></div></section>}
    <section className="extracted-section"><h3 className="section-title">Invoice</h3><div className="field-grid">{labels.map(([label, keys]) => { const value = keys.map(key => invoice[key]).find(item => item != null && item !== ""); if (value == null || (typeof value !== "string" && typeof value !== "number")) return null; const shown = ["invoice_date", "due_date"].includes(String(keys[0])) ? dateLabel(String(value)) : String(value); return <DetailField key={label} label={label} value={shown}/>; })}</div></section>
    <section className="extracted-section"><h3 className="section-title">Amounts</h3><div className="field-grid"><DetailField label="Subtotal" value={invoice.subtotal == null ? undefined : formatInvoiceMoney(invoice.subtotal, invoice.currency)}/><DetailField label="Tax" value={invoice.tax_amount == null ? undefined : formatInvoiceMoney(invoice.tax_amount, invoice.currency)}/><DetailField label="Total" value={invoice.total_amount == null ? undefined : formatInvoiceMoney(invoice.total_amount, invoice.currency)}/></div></section>
    {(invoice.line_items || []).length > 0 && <section className="extracted-section"><h3 className="section-title">Line Items</h3><div className="table-wrap"><table className="line-items-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>{invoice.line_items!.map((line, index) => { const qty = Number(line.qty); return <tr key={index}><td>{line.description || line.item_code || ""}</td><td>{line.qty == null || !Number.isFinite(qty) ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(qty)}</td><td>{line.unit_price == null ? "" : formatInvoiceMoney(line.unit_price, invoice.currency)}</td><td>{line.amount == null ? "" : formatInvoiceMoney(line.amount, invoice.currency)}</td></tr>; })}</tbody></table></div></section>}
    {rows.length > 0 && <section className="extracted-section"><h3 className="section-title">Match review</h3><div className="discrepancy-badges">{issues.map(item => <span key={`${item.field}-${item.reason}`} className={`discrepancy-badge ${item.severity === "error" ? "mismatch" : "within-tolerance"}`}>{item.field.includes("po_found") ? "No PO" : item.field.includes("unit_price") || item.field.includes("line_price") ? "Price mismatch" : item.field.includes("goods_receipt") || item.field.includes("accepted_quantity") ? "No goods receipt" : item.field.includes("quantity") ? "Qty exceeds PO" : humanize(item.field)}</span>)}</div><div className="table-wrap"><table className="comparison-table"><thead><tr><th>Field</th><th>Invoice</th><th>PO</th><th>Goods Receipt</th><th>Status</th></tr></thead><tbody>{issues.map(item => <InvoiceComparisonRow key={`${item.field}-${item.reason}`} item={item} currency={invoice.currency}/> )}</tbody></table></div>{rows.some(item => item.resolved) && <details className="matched-fields"><summary>Show matched fields ({rows.filter(item => item.resolved).length})</summary><div className="table-wrap"><table className="comparison-table"><thead><tr><th>Field</th><th>Invoice</th><th>PO</th><th>Goods Receipt</th><th>Status</th></tr></thead><tbody>{rows.filter(item => item.resolved).map(item => <InvoiceComparisonRow key={`${item.field}-${item.reason}`} item={item} currency={invoice.currency}/>)}</tbody></table></div></details>}</section>}
    {invoice.status === "needs_review" && !invoice.po_number_raw && candidates.length > 0 && <div className="suggestion-card"><small>SUGGESTED PURCHASE ORDER</small><h3>This invoice matches {candidates[0].po_number} ({candidates[0].vendor_name || "vendor"}, amount, items — {Math.round(candidates[0].score)}% match). Match this PO?</h3><p>Matched signals: vendor, total amount, and item descriptions.</p><div><button className="primary" onClick={() => onMatch(candidates[0], true)}>Yes, match this PO</button><button className="secondary" onClick={() => onMatch(candidates[0], false)}>No</button></div></div>}
    {invoice.status === "needs_review" && !invoice.po_number_raw && !candidates.length && <p className="muted">No match found for this invoice.</p>}
    {hasNoReceipt && invoice.status === "needs_review" && <div className="notice info">No goods receipt was found. You can hold this invoice while waiting for the receipt, approve with an exception, or reject it.</div>}
    <div className="modal-actions"><button className="secondary" onClick={() => onDecision("hold")} disabled={invoice.status === "rejected"}>Hold</button><button className="danger-button" onClick={() => onDecision("reject")} disabled={invoice.status === "rejected"}>Reject</button>{invoice.status === "needs_review" && <button className="primary" onClick={() => onDecision("approve-exception")}>Approve with exception</button>}</div>
  </div></section>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
