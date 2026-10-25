import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Download,
  Eye,
  FileImage,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ListChecks,
  Layers,
  ExternalLink,
  Menu,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
  X,
  Sparkles,
} from "lucide-react";
import { initScrollReveal } from "./scrollReveal";
import { createAuthSession } from "./authSession";
import { Badge, Button, Card, Skeleton, Tabs } from "./components/ui";
import { useInvoiceQueryState, type FilterOwner, type FilterVendor } from "./components/InvoiceFilters";
import { InvoicesWorkspacePage } from "./components/InvoicesWorkspacePage";
import { ProcurementWorkspacePage } from "./components/ProcurementWorkspacePage";
import { VendorsPage } from "./components/VendorsPage";
import { LogsPage } from "./components/LogsPage";
import { canAccessLogs, canCreateVendor, canSeeAdminNavigation } from "./accessControls";
import { userFacingErrorMessage } from "./errorMessages";
import {
  documentStatusLabel,
  isDocumentProcessing,
  isProcessingStatus,
  isRetryScheduled,
} from "./documentStatus";
import {
  UnknownVendorPrompt,
  type UnknownVendorInfo,
} from "./components/UnknownVendorPrompt";
import { VendorResolutionBanner } from "./components/VendorResolutionBanner";
import {
  documentActionAvailability,
  isValidDocumentId,
} from "./documentIds";
import { isSupportedUploadFilename, uploadLimitMessage } from "./uploadLimits";
import { addAndResolveVendor } from "./vendorResolution";
import {
  documentDetailSectionTitle,
  linkedRecordDestination,
} from "./documentNavigation";
import { sourceFilePreviewMime, sourceFileViewerMode } from "./sourceFileActions";
import { Sidebar, type WorkspacePage } from "./components/Sidebar";
import "./styles/globals.css";
import "./styles/modern.css";

const AUTH_URL = String(import.meta.env.VITE_AUTH_API_BASE_URL || "http://localhost:8001").replace(/\/$/, "");
const CORE_URL = String(import.meta.env.VITE_AP_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const iconProps = { size: 18, strokeWidth: 1.75, "aria-hidden": true as const };

declare module "axios" { interface InternalAxiosRequestConfig { authRetried?: boolean } }
const authSession = createAuthSession(async () => {
  const response = await axios.post<{ access_token?: string }>(`${AUTH_URL}/api/auth/refresh`, {}, {
    withCredentials: true, headers: { "X-CSRF-Protection": "1" },
  });
  return response.data.access_token || null;
});
axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authSession.getAccessToken();
  if (token && (config.url?.startsWith(CORE_URL) || (config.url?.startsWith(AUTH_URL) && !config.url?.includes("/api/auth/login") && !config.url?.includes("/api/auth/refresh")))) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});
axios.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config;
  const isAuthEndpoint = Boolean(config?.url?.includes("/api/auth/refresh") || config?.url?.includes("/api/auth/login"));
  if (error.response?.status !== 401 || !config || config.authRetried || isAuthEndpoint) throw error;
  config.authRetried = true;
  const token = await authSession.refresh();
  if (!token) throw error;
  config.headers.set("Authorization", `Bearer ${token}`);
  return axios.request(config);
});

type Doc = {
  id?: string | null; local_key?: string; original_filename: string; status: string; doc_type?: string | null;
  created_at?: string | null; updated_at?: string | null; failure_message?: string | null;
  failure_class?: string | null; next_retry_at?: string | null;
  extracted_json?: Record<string, unknown> | null; raw_text?: string | null;
  source?: string | null; email_sender?: string | null; email_subject?: string | null;
  email_received_at?: string | null; linked_invoice_id?: string | null;
  linked_invoice_status?: string | null; linked_po_id?: string | null; linked_gr_id?: string | null;
};
type FilePreviewState =
  | { kind: "loading"; filename: string }
  | { kind: "binary"; filename: string; url: string; mime: string }
  | { kind: "docx"; filename: string; document: Doc; fallback?: boolean };
type PageResponse<T> = { items?: T[]; total?: number; page?: number; page_size?: number; limit?: number; offset?: number };
type InvoiceItem = { invoice_id: string; source_document_id?: string | null; received_at?: string | null; source?: "upload" | "email" | null; email_sender?: string | null; email_subject?: string | null; invoice_no?: string | null; vendor_name?: string | null; invoice_date?: string | null; due_date?: string | null; total_amount?: number | string | null; currency?: string | null; status: "processing" | "needs_review" | "ready_to_pay" | "on_hold" | "rejected"; workflow_status?: string; final_status?: string | null; owner_user_id?: string | null; gl_code?: string | null; confidence?: number | null };
type InvoiceDetail = InvoiceItem & { vendor_id?: string | null; vendor_tax_id?: string | null; subtotal?: number | string | null; tax_amount?: number | string | null; po_number_raw?: string | null; payment_terms?: unknown; match_run_id?: string | null; updated_at?: string | null; line_items?: { description?: string | null; item_code?: string | null; qty?: number | string | null; unit_price?: number | string | null; amount?: number | string | null; line_amount?: number | string | null }[]; discrepancies?: { id?: string; field: string; invoice_value?: unknown; po_value?: unknown; gr_value?: unknown; severity: string; resolved?: boolean; reason?: string | null }[]; match_outcome?: { discrepancies?: { code: string; message: string; invoice_value?: unknown; expected_value?: unknown; difference?: unknown; next_action?: string; line_reference?: string }[] } };
type NoMatchDraft = { id: string; status: string; kind: string };
type EmailDraftDetail = NoMatchDraft & { subject: string; body: string; to_addresses: string[]; cc_addresses?: string[] };
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

const getError = userFacingErrorMessage;
function humanize(value?: string | null) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}
function friendlyStatus(value?: string | null) {
  const status = (value || "").toLowerCase();
  if (["needs_data_review", "needs_vendor_review"].includes(status)) return "Needs data review";
  if (status === "needs_attention") return "Needs attention";
  if (isProcessingStatus(status)) return "Processing";
  if (["ready", "extracted", "parsed", "processed"].includes(status)) return "Ready";
  if (status === "failed") return "Failed";
  return "Processing";
}
function statusClass(value?: string | null) {
  const s = (value || "unknown").toLowerCase();
  if (["failed", "rejected", "overdue", "match_issues", "no_match"].includes(s)) return "danger";
  if (["needs_data_review", "needs_vendor_review", "needs_attention"].includes(s)) return "warning";
  if (["approved", "paid", "match_approved", "processed", "extracted", "parsed", "ready_to_pay"].includes(s)) return "success";
  if (isProcessingStatus(s) || ["verifying", "resubmitted", "on_hold"].includes(s)) return "pending";
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
  const [activePage, setActivePage] = useState<WorkspacePage>(() => new URLSearchParams(window.location.search).get("page") === "logs" ? "logs" : "dashboard");
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
  const [bulkReprocessBusy, setBulkReprocessBusy] = useState(false);
  const [bulkReprocessProgress, setBulkReprocessProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [localFailedDocuments, setLocalFailedDocuments] = useState<Doc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [invoiceCounts, setInvoiceCounts] = useState<Record<InvoiceItem["status"], number>>({ processing: 0, needs_review: 0, ready_to_pay: 0, on_hold: 0, rejected: 0 });
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const setInvoiceSource = (source: "all" | "upload" | "email") => updateInvoiceQuery({ source });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activePage === "logs") params.set("page", "logs"); else params.delete("page");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [activePage]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [invoiceDrawerTab, setInvoiceDrawerTab] = useState<string>("details");
  useEffect(() => {
    const cleanup = initScrollReveal();
    return cleanup;
  }, [activePage, selectedInvoice, invoiceDrawerTab]);
  const [procurementRecordId, setProcurementRecordId] = useState<string | null>(null);
  const [noMatchDraft, setNoMatchDraft] = useState<NoMatchDraft | null>(null);
  const [emailDraftEditor, setEmailDraftEditor] = useState<EmailDraftDetail | null>(null);
  const [emailDraftSubject, setEmailDraftSubject] = useState("");
  const [emailDraftBody, setEmailDraftBody] = useState("");
  const [emailDraftRecipient, setEmailDraftRecipient] = useState("");
  const [emailDraftOpened, setEmailDraftOpened] = useState(false);
  const [emailDraftBusy, setEmailDraftBusy] = useState(false);
  const [emailDraftError, setEmailDraftError] = useState("");
  const [matchCandidates, setMatchCandidates] = useState<MatchCandidate[]>([]);
  const [decision, setDecision] = useState<{ invoiceId: string; action: "hold" | "reject" | "approve-exception" | "approve"; reason: string; expectedMatchRunId?: string | null; expectedUpdatedAt?: string | null } | null>(null);
  const [recentBatchIds, setRecentBatchIds] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem("ap-recent-upload-ids");
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch { return []; }
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
  const [isDraggingDocuments, setIsDraggingDocuments] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [unknownVendor, setUnknownVendor] = useState<UnknownVendorInfo | null>(null);
  const [unknownVendorBusy, setUnknownVendorBusy] = useState(false);
  const [unknownVendorError, setUnknownVendorError] = useState("");
  const [filePreview, setFilePreview] = useState<FilePreviewState | null>(null);
  const filePreviewRequestId = useRef(0);
  useEffect(() => {
    if (!filePreview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFilePreview();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (filePreview.kind === "binary") URL.revokeObjectURL(filePreview.url);
    };
  }, [filePreview]);
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
  const [filterVendors, setFilterVendors] = useState<FilterVendor[]>([]);
  const [filterOwners, setFilterOwners] = useState<FilterOwner[]>([]);
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
      const batchItems = docSource === "email" ? [] : await Promise.all(recentBatchIds.filter(isValidDocumentId).map(id =>
        axios.get<Doc>(`${CORE_URL}/api/documents/${encodeURIComponent(id)}`, { headers: authHeaders() }).then(result => result.data),
      ));
      let visibleItems = docSource === "latest" ? [...batchItems, ...localFailedDocuments] : batchItems;
      let visibleTotal = batchItems.length;
      if (docSource !== "latest") {
        const query = new URLSearchParams({ page: String(nextPage), page_size: "50", source: "email" });
        if (docStatus !== "all" && !["processing", "ready"].includes(docStatus)) query.set("status", docStatus);
        if (docType !== "all") query.set("doc_type", docType);
        const response = await axios.get<PageResponse<Doc> | Doc[]>(`${CORE_URL}/api/documents?${query}`, { headers: authHeaders() });
        const data = response.data;
        const items = Array.isArray(data) ? data : data.items || [];
        visibleItems = items;
        visibleTotal = Array.isArray(data) ? items.length : data.total ?? items.length;
        if (docSource === "all") {
          const emailIds = new Set(visibleItems.map(item => item.id));
          visibleItems = [...batchItems.filter(item => !emailIds.has(item.id)), ...visibleItems];
          visibleTotal += batchItems.filter(item => !emailIds.has(item.id)).length;
        }
        setDocPage(Array.isArray(data) ? nextPage : data.page ?? nextPage);
      } else {
        setDocPage(1);
      }
      setDocuments(visibleItems); setDocTotal(visibleTotal);
      setSelectedDoc(current => {
        const latest = current && visibleItems.find(item => item.id === current.id);
        return latest && current ? { ...current, status: latest.status, updated_at: latest.updated_at, failure_message: latest.failure_message, linked_invoice_id: latest.linked_invoice_id, linked_invoice_status: latest.linked_invoice_status } : current;
      });
    } catch (error) {
      const message = getError(error, "Could not load documents."); setDocError(message);
      if (axios.isAxiosError(error) && error.response?.status === 401) { clearSession(); notify("Your session expired. Please sign in again.", "error"); }
    } finally { setDocLoading(false); }
  }, [token, docPage, docStatus, docType, docSource, authHeaders, clearSession, notify, recentBatchIds, localFailedDocuments]);

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
        query.set("sort_dir", invoiceQuery.sort_dir);
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
    const running = invoices.some(invoice => invoice.status === "processing")
      || emailMessages.some(message => ["processing", "received", "failed"].includes(message.status));
    if (!running) return;
    const timer = window.setInterval(() => {
      void loadInvoices(); void loadEmailInbox();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [token, profileLoading, mustChangePassword, documents, invoices, emailMessages, docPage, loadDocuments, loadInvoices, loadEmailInbox]);
  useEffect(() => { if (activePage === "associates" || activePage === "logs") void loadAssociates(); }, [activePage, loadAssociates]);
  useEffect(() => { if ((activePage === "invoices" || activePage === "dashboard") && token && !profileLoading && !mustChangePassword) void loadInvoices(); }, [activePage, token, profileLoading, mustChangePassword, loadInvoices]);
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

  async function uploadFiles(chosen: File[]) {
    const limitMessage = uploadLimitMessage(chosen.length);
    if (limitMessage) {
      notify(limitMessage, "error");
      return;
    }
    if (!chosen.length) return;
    if (uploading) {
      notify("An upload is already in progress.", "info");
      return;
    }
    const tooLarge = chosen.filter(file => file.size > 20 * 1024 * 1024);
    const sizeValid = chosen.filter(file => file.size <= 20 * 1024 * 1024);
    if (tooLarge.length) notify(`${tooLarge.map(file => file.name).join(", ")}: each file must be 20 MB or smaller.`, "error");
    const valid: File[] = [];
    const rejectedDocs: Doc[] = [];
    const outcomes: { name: string; ok: boolean; message?: string }[] = [];
    for (const file of sizeValid) {
      if (isSupportedUploadFilename(file.name)) valid.push(file);
      else {
        const reason = "This file type is not supported. Upload a PDF, PNG, JPG, DOCX or EML file.";
        rejectedDocs.push({ id: null, local_key: `rejected-${Date.now()}-${rejectedDocs.length}`, original_filename: file.name, status: "failed", failure_message: reason });
        outcomes.push({ name: file.name, ok: false, message: reason });
      }
    }
    if (!valid.length && !rejectedDocs.length) return;
    setDocSource("latest");
    setRecentBatchIds([]);
    setLocalFailedDocuments([]);
    try { sessionStorage.removeItem("ap-recent-upload-ids"); } catch { /* Browser storage may be disabled. */ }
    setDocuments(rejectedDocs); setDocTotal(rejectedDocs.length); setDocPage(1); setSelectedDoc(null);
    setUploading(true); setUploadProgress(0);
    const batchDocs: Doc[] = [...rejectedDocs];
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
        else if (result.status === "failed" || !isValidDocumentId(result.id)) {
          const message = "Something went wrong with this file. Please retry or upload it again.";
          batchDocs.push({ ...result, id: null, local_key: `rejected-${Date.now()}-${index}`, original_filename: result.original_filename || file.name, status: "failed", failure_message: message });
          outcomes.push({ name: result.original_filename || file.name, ok: false, message });
        } else { batchDocs.push(result); outcomes.push({ name: result.original_filename || file.name, ok: true, message: friendlyStatus(result.status || "received") }); }
      } catch (error) { outcomes.push({ name: file.name, ok: false, message: getError(error, "Upload failed") }); }
      setUploadProgress(Math.round(((index + 1) / Math.max(valid.length, 1)) * 100));
    }
    setUploading(false);
    const batchIds = batchDocs.map(doc => doc.id).filter(isValidDocumentId);
    setRecentBatchIds(batchIds);
    try { sessionStorage.setItem("ap-recent-upload-ids", JSON.stringify(batchIds)); } catch { /* Keep the batch in React state for this page session. */ }
    setDocuments(batchDocs); setDocTotal(batchDocs.length); setDocPage(1);
    setLocalFailedDocuments(batchDocs.filter(doc => !isValidDocumentId(doc.id)));
    const successes = outcomes.filter(item => item.ok).length;
    setModalError("");
    setUploadResult({ outcomes, successes, total: valid.length });
  }
  const [uploadResult, setUploadResult] = useState<{ outcomes: { name: string; ok: boolean; message?: string }[]; successes: number; total: number } | null>(null);

  async function checkUnknownVendor(info: UnknownVendorInfo) {
    if (!info.vendorName.trim() && !info.taxId.trim()) return;
    const key = `ap-unknown-vendor:${info.recordType}:${info.recordId}`;
    let alreadyShown = false;
    try { alreadyShown = Boolean(sessionStorage.getItem(key)); } catch { /* Continue without session storage. */ }
    try {
      const response = await axios.get<{ status: string; vendor?: { id: string; name: string }; candidates?: { id: string; name: string }[] }>(`${CORE_URL}/api/vendors/resolve-extracted`, { params: { name: info.vendorName || undefined, tax_id: info.taxId || undefined }, headers: authHeaders() });
      if (response.data.status === "resolved") { setUnknownVendor(current => current?.recordId === info.recordId ? null : current); return; }
      if (alreadyShown) return;
      try { sessionStorage.setItem(key, "shown"); } catch { /* Session storage may be unavailable. */ }
      setUnknownVendor({ ...info, suggestedVendors: response.data.candidates || [] }); setUnknownVendorError("");
    } catch (error) { notify(getError(error, "Could not check the vendor directory.", { conflict: "vendor" }), "error"); }
  }
  async function addUnknownVendor(values: { name: string; tax_id: string }) {
    if (!unknownVendor || !values.name.trim()) return;
    setUnknownVendorBusy(true); setUnknownVendorError("");
    try {
      const info = unknownVendor;
      const created = await addAndResolveVendor({ name: values.name, taxId: values.tax_id, create: async payload => (await axios.post<{ id: string }>(`${CORE_URL}/api/vendors`, payload, { headers: authHeaders() })).data, resolve: async (vendorId, payload) => { await axios.post(`${CORE_URL}/api/vendors/${vendorId}/resolve-extracted`, payload, { headers: authHeaders() }); } });
      setUnknownVendor(null); notify("Vendor added. Matching has been requested.", "success");
      if (info.recordType === "invoice" && info.linkedId) await openInvoice(info.linkedId);
      if ((info.recordType === "purchase_order" || info.recordType === "goods_receipt") && info.linkedId) setProcurementRecordId(info.linkedId);
      await Promise.all([loadDocuments(1), loadInvoices()]);
    } catch (error) { setUnknownVendorError(getError(error, "Could not add or match this vendor.", { conflict: "vendor" })); }
    finally { setUnknownVendorBusy(false); }
  }
  async function selectExistingVendor(vendorId: string) {
    if (!unknownVendor || !vendorId) return;
    setUnknownVendorBusy(true); setUnknownVendorError("");
    try {
      const info = unknownVendor;
      await axios.post(`${CORE_URL}/api/vendors/${vendorId}/resolve-extracted`, { name: info.vendorName, tax_id: info.taxId || null, create_alias: true }, { headers: authHeaders() });
      setUnknownVendor(null); notify("Vendor linked. Matching has been requested.", "success");
      if (info.recordType === "invoice" && info.linkedId) await openInvoice(info.linkedId);
      if ((info.recordType === "purchase_order" || info.recordType === "goods_receipt") && info.linkedId) setProcurementRecordId(info.linkedId);
      await Promise.all([loadDocuments(1), loadInvoices()]);
    } catch (error) { setUnknownVendorError(getError(error, "Could not link this vendor.", { conflict: "vendor" })); }
    finally { setUnknownVendorBusy(false); }
  }

  async function openDocument(doc: Doc) {
    setSelectedDoc(doc); setModalError(""); setDetailLoading(true);
    try {
      if (!isValidDocumentId(doc.id)) return;
      const response = await axios.get<Doc>(`${CORE_URL}/api/documents/${doc.id}`, { headers: authHeaders() });
      const detail = response.data;
      const extracted = detail.extracted_json || {};
      void checkUnknownVendor({ recordId: detail.linked_invoice_id || detail.linked_po_id || detail.linked_gr_id || detail.id!, recordType: detail.linked_invoice_id ? "invoice" : detail.linked_po_id ? "purchase_order" : detail.linked_gr_id ? "goods_receipt" : "document", docType: detail.doc_type, linkedId: detail.linked_invoice_id || detail.linked_po_id || detail.linked_gr_id, sourceDocumentId: detail.id, status: detail.status, vendorName: String(extracted.vendor || extracted.vendor_name || ""), taxId: String(extracted.vendor_tax_id || extracted.tax_id || ""), filename: detail.original_filename });
      const destination = linkedRecordDestination(detail);
      if (destination?.page === "invoices") {
        setSelectedDoc(null);
        setActivePage("invoices");
        await openInvoice(destination.recordId, "details");
        return;
      }
      if (destination?.page === "purchase-orders" || destination?.page === "goods-receipts") {
        setSelectedDoc(null); setProcurementRecordId(destination.recordId); setActivePage(destination.page); return;
      }
      setSelectedDoc(detail);
    } catch (error) { setModalError(getError(error, "Could not load document details.")); }
    finally { setDetailLoading(false); }
  }
  async function openInvoice(invoiceId: string, tab: string = "details") {
    setInvoiceDrawerTab(tab);
    setNoMatchDraft(null); setEmailDraftEditor(null); setEmailDraftOpened(false); setEmailDraftError("");
    try {
      const [detail, candidates] = await Promise.all([
        axios.get<InvoiceDetail>(`${CORE_URL}/api/invoices/${invoiceId}`, { headers: authHeaders() }),
        axios.get<{ candidates: MatchCandidate[] }>(`${CORE_URL}/api/invoices/${invoiceId}/match-candidates`, { headers: authHeaders() }),
      ]);
      setSelectedInvoice(detail.data); setMatchCandidates(candidates.data.candidates || []);
      if (detail.data.status === "rejected") {
        try {
          const drafts = await axios.get<{ items?: NoMatchDraft[] }>(`${CORE_URL}/api/email-drafts`, { params: { invoice: invoiceId, kind: "no_match", status: "draft", page: 1, page_size: 10 }, headers: authHeaders() });
          setNoMatchDraft((drafts.data.items || []).find(item => item.kind === "no_match" && item.status === "draft") || null);
        } catch { setNoMatchDraft(null); }
      }
    } catch (error) { notify(getError(error, "Could not load invoice details."), "error"); }
  }
  async function reviewNoMatchDraft() {
    if (!noMatchDraft) return;
    setEmailDraftError(""); setEmailDraftBusy(true);
    try {
      const response = await axios.get<EmailDraftDetail>(`${CORE_URL}/api/email-drafts/${noMatchDraft.id}`, { headers: authHeaders() });
      setEmailDraftEditor(response.data); setEmailDraftSubject(response.data.subject || ""); setEmailDraftBody(response.data.body || "");
      setEmailDraftRecipient((response.data.to_addresses || []).join(", ")); setEmailDraftOpened(true);
    } catch (error) { setEmailDraftError(getError(error, "Could not open the email draft.")); }
    finally { setEmailDraftBusy(false); }
  }
  async function sendNoMatchDraft() {
    if (!emailDraftEditor || !emailDraftOpened) return;
    setEmailDraftBusy(true); setEmailDraftError("");
    try {
      await axios.patch(`${CORE_URL}/api/email-drafts/${emailDraftEditor.id}`, {
        subject: emailDraftSubject, body: emailDraftBody,
        to_addresses: emailDraftRecipient.split(",").map(value => value.trim()).filter(Boolean),
        cc_addresses: emailDraftEditor.cc_addresses || [],
      }, { headers: authHeaders() });
      const response = await axios.post<{ sent?: boolean; message?: string }>(`${CORE_URL}/api/email-drafts/${emailDraftEditor.id}/send`, { reason: "No match notification reviewed by associate" }, { headers: authHeaders() });
      if (!response.data.sent) { setEmailDraftError(response.data.message || "The email was not sent."); return; }
      notify("Email sent.", "success"); setEmailDraftEditor(null); setNoMatchDraft(null); setSelectedInvoice(null);
      await loadInvoices();
    } catch (error) { setEmailDraftError(getError(error, "Could not send the email.")); }
    finally { setEmailDraftBusy(false); }
  }
  async function submitInvoiceDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!decision) return;
    try {
      const endpoint = decision.action === "approve"
        ? `${CORE_URL}/api/invoices/${decision.invoiceId}/approve`
        : `${CORE_URL}/api/invoices/${decision.invoiceId}/${decision.action}`;
      const payload = decision.action === "approve"
        ? { comment: decision.reason || "Approved by reviewer" }
        : { reason: decision.reason, ...(decision.expectedMatchRunId ? { expected_match_run_id: decision.expectedMatchRunId } : {}), ...(decision.expectedUpdatedAt ? { expected_updated_at: decision.expectedUpdatedAt } : {}) };
      await axios.post(endpoint, payload, { headers: authHeaders() });
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
  function closeFilePreview() {
    filePreviewRequestId.current += 1;
    setFilePreview(null);
  }
  async function openOriginalFile(doc: Doc) {
    if (!isValidDocumentId(doc.id)) return;
    const viewerMode = sourceFileViewerMode(doc.original_filename);
    if (viewerMode === "unsupported") {
      notify("This file cannot be previewed in the browser. Use Download to open it.", "info");
      return;
    }
    const isDocx = viewerMode === "extracted-preview";
    const requestId = ++filePreviewRequestId.current;
    setFilePreview({ kind: "loading", filename: doc.original_filename });
    try {
      const response = await axios.get<Blob>(`${CORE_URL}/api/documents/${doc.id}/${isDocx ? "preview" : "file"}`, {
        ...(isDocx ? {} : { params: { disposition: "inline" } }), headers: authHeaders(), responseType: "blob",
      });
      const mime = isDocx ? "application/pdf" : sourceFilePreviewMime(doc.original_filename);
      if (!mime) {
        setFilePreview(null);
        notify("This file cannot be previewed in the browser. Use Download to open it.", "info");
        return;
      }
      const url = URL.createObjectURL(new Blob([response.data], { type: mime }));
      if (requestId !== filePreviewRequestId.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setFilePreview({ kind: "binary", url, mime, filename: doc.original_filename });
    } catch (error) {
      if (requestId === filePreviewRequestId.current) {
        if (isDocx) {
          setFilePreview({ kind: "docx", filename: doc.original_filename, document: doc, fallback: true });
        } else {
          setFilePreview(null);
          notify(getError(error, "Could not open the original file."), "error");
        }
      }
    }
  }
  async function downloadOriginalFile(doc: Doc) {
    if (!isValidDocumentId(doc.id)) return;
    try {
      const response = await axios.get<Blob>(`${CORE_URL}/api/documents/${doc.id}/file`, {
        params: { disposition: "attachment" }, headers: authHeaders(), responseType: "blob",
      });
      const contentType = response.headers["content-type"];
      const mime = (typeof contentType === "string" ? contentType : "") || response.data.type || "application/octet-stream";
      const url = URL.createObjectURL(new Blob([response.data], { type: mime }));
      const link = document.createElement("a");
      link.href = url; link.download = doc.original_filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { notify(getError(error, "Could not download the original file."), "error"); }
  }
  async function openOriginalSource(sourceDocumentId: string | null | undefined, download = false) {
    if (!isValidDocumentId(sourceDocumentId)) return;
    try {
      const response = await axios.get<Doc>(`${CORE_URL}/api/documents/${sourceDocumentId}`, { headers: authHeaders() });
      const source = { ...response.data, id: sourceDocumentId };
      if (download) await downloadOriginalFile(source);
      else await openOriginalFile(source);
    } catch (error) { notify(getError(error, "Could not open the original file."), "error"); }
  }
  async function retryDocument(doc: Doc) {
    if (!isValidDocumentId(doc.id)) return;
    try {
      setDetailLoading(true);
      const endpoint = doc.status === "received" ? "parse" : "retry";
      await axios.post(`${CORE_URL}/api/documents/${doc.id}/${endpoint}`, {}, { headers: authHeaders() });
      notify("Reprocessing has been requested. The status will update when the backend finishes.", "success");
      await loadDocuments(1);
    } catch (error) { notify(getError(error, "Could not retry document processing."), "error"); }
    finally { setDetailLoading(false); }
  }
  async function reprocessAllDocuments() {
    if (profile?.role !== "admin" || bulkReprocessBusy) return;
    if (!window.confirm("Reprocess up to five eligible documents at a time? This will run the current processing code on documents marked for review or retry.")) return;
    setBulkReprocessBusy(true);
    setBulkReprocessProgress({ done: 0, total: 0, failed: 0 });
    let done = 0;
    let total = 0;
    let failed = 0;
    try {
      while (true) {
        const response = await axios.post<{ scanned: number; completed: number; failed: number; remaining: number }>(`${CORE_URL}/api/documents/admin/reprocess-all`, {}, { headers: authHeaders() });
        const batch = response.data;
        done += batch.completed;
        failed += batch.failed;
        total = Math.max(total, done + batch.remaining);
        setBulkReprocessProgress({ done, total, failed });
        await loadDocuments(1);
        if (batch.remaining <= 0 || batch.scanned === 0) break;
      }
      notify(`Reprocessing finished: ${done} documents handled, ${failed} failed.`, failed ? "error" : "success");
    } catch (error) {
      notify(getError(error, "Could not reprocess the documents."), "error");
    } finally {
      setBulkReprocessBusy(false);
    }
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


  const filteredDocs = useMemo(() => documents.filter(doc => {
    const q = `${docSearch} ${globalSearch}`.trim().toLowerCase();
    const actualType = String(doc.doc_type || (doc.extracted_json?.document_type as string | undefined) || "").toLowerCase();
    const matchesSearch = !q || [doc.original_filename, doc.id, actualType, doc.email_sender].some(value => String(value || "").toLowerCase().includes(q));
    const matchesType = docType === "all" || actualType === docType;
    const matchesStatus = docStatus === "all" || (docStatus === "processing" ? isDocumentProcessing(doc) : docStatus === "ready" ? ["parsed", "extracted", "processed"].includes(doc.status.toLowerCase()) : doc.status === docStatus);
    return matchesSearch && matchesType && matchesStatus;
  }), [documents, docSearch, globalSearch, docType, docStatus]);
  const docCounts = useMemo(() => ({ processing: documents.filter(isDocumentProcessing).length, completed: documents.filter(d => ["extracted", "processed", "match_approved", "approved"].includes(d.status)).length, attention: documents.filter(d => ["failed", "needs_data_review", "needs_vendor_review", "incomplete", "match_issues"].includes(d.status)).length }), [documents]);

  function navigateTo(page: WorkspacePage) {
    setActivePage(page);
    setMobileNavOpen(false);
    if (page === "invoices" && activePage !== "invoices" && invoiceQuery.status && !invoiceStatuses.includes(invoiceQuery.status as InvoiceItem["status"])) updateInvoiceQuery({ status: "" });
  }

  async function checkProcurementVendor(kind: "purchase_order" | "goods_receipt", row: { id: string; source_document_id?: string | null; vendor_name?: string | null }, purchaseOrder?: { vendor_name?: string | null }) {
    let source: Doc | null = null;
    if (row.source_document_id && isValidDocumentId(row.source_document_id)) {
      try { source = (await axios.get<Doc>(`${CORE_URL}/api/documents/${row.source_document_id}`, { headers: authHeaders() })).data; } catch { /* Keep the procurement drawer usable without source details. */ }
    }
    const extracted = source?.extracted_json || {};
    void checkUnknownVendor({ recordId: row.id, recordType: kind, linkedId: row.id, linkedPoId: kind === "goods_receipt" ? (purchaseOrder as { id?: string } | undefined)?.id : undefined, sourceDocumentId: row.source_document_id, docType: source?.doc_type, status: source?.status, vendorName: String(extracted.vendor || extracted.vendor_name || row.vendor_name || purchaseOrder?.vendor_name || ""), taxId: String(extracted.vendor_tax_id || extracted.tax_id || ""), filename: source?.original_filename || "" });
  }

  if (restoring && !token) return <main className="session-screen"><Loader title="Restoring secure session" subtitle="Checking your sign-in session..." /></main>;
  if (!token) return <main className="auth-shell page-enter">
    <section className="auth-hero"><div className="brand brand-light"><span className="brand-mark">G</span><span>GENWORX<small>FINANCE AUTOMATION</small></span></div><div className="hero-copy"><span className="eyebrow">ACCOUNTS PAYABLE WORKSPACE</span><h1>Clarity for every<br /><em>invoice and document.</em></h1><p>Bring your documents together, track invoice progress, and spot issues without losing sight of the source evidence.</p><div className="hero-points"><span><Check {...iconProps}/> Secure workspace</span><span><Check {...iconProps}/> Clear processing status</span><span><Check {...iconProps}/> Human-reviewed decisions</span></div></div><div className="hero-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-file"><FileText {...iconProps}/></div><span className="orbit-dot dot-one"/><span className="orbit-dot dot-two"/><span className="orbit-dot dot-three"/></div></section>
    <section className="auth-side"><form className="auth-card" onSubmit={submitAuth}><span className="eyebrow purple">WELCOME TO GENWORX</span><h2>Sign in to your workspace</h2><p className="muted">Use the work email and password provided by your administrator.</p>
      <label className="form-label">Work email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" /></label>
      <label className="form-label">Password<span className="password-control"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} minLength={1} required placeholder="Enter your password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label>
      {loginError && <div className="login-error" role="alert">{loginError}</div>}
      <button className="primary full" disabled={authBusy}>{authBusy ? <><span className="mini-spin"/> Please wait...</> : <>Sign in <ArrowRight {...iconProps}/></>}</button>
      <p className="security-note"><span>•</span> Your session is handled securely by GenWorx Auth.</p></form></section>
  </main>;

  if (profileLoading) return <main className="session-screen"><Loader title="Loading your workspace" subtitle="Checking your account permissions..." /></main>;
  if (mustChangePassword) return <main className="session-screen page-enter"><form className="auth-card" onSubmit={submitPasswordChange}><span className="eyebrow purple">SECURE YOUR ACCOUNT</span><h2>Change your temporary password</h2><p className="muted">Your administrator issued a temporary password. Set a new password before continuing. Use at least 12 characters with an uppercase letter, lowercase letter, number, and symbol.</p>{profile?.temp_password_expires_at && <p className="muted">Temporary password expires {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(profile.temp_password_expires_at))}.</p>}<label className="form-label">Temporary password<span className="password-control"><input type={showCurrentPassword ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required /><button type="button" aria-label={showCurrentPassword ? "Hide temporary password" : "Show temporary password"} onClick={() => setShowCurrentPassword(value => !value)}>{showCurrentPassword ? "Hide" : "Show"}</button></span></label><label className="form-label">New password<span className="password-control"><input type={showNewPassword ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={12} maxLength={128} required /><button type="button" aria-label={showNewPassword ? "Hide new password" : "Show new password"} onClick={() => setShowNewPassword(value => !value)}>{showNewPassword ? "Hide" : "Show"}</button></span></label><label className="form-label">Confirm new password<span className="password-control"><input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={12} maxLength={128} required /><button type="button" aria-label={showConfirmPassword ? "Hide confirmation" : "Show confirmation"} onClick={() => setShowConfirmPassword(value => !value)}>{showConfirmPassword ? "Hide" : "Show"}</button></span></label><button className="primary full" disabled={authBusy}>{authBusy ? "Saving..." : "Change password and continue"}</button><button className="secondary full" type="button" onClick={() => void logout()} disabled={authBusy}>Sign out</button></form></main>;

  return <div className="app-shell">
    <Sidebar
      activePage={activePage}
      isAdmin={profile?.role === "admin"}
      canAccessVendors={true}
      documentCount={docTotal}
      invoiceCount={Object.values(invoiceCounts).reduce((sum, count) => sum + count, 0)}
      emailAttentionCount={emailStatus?.counts?.needs_attention || 0}
      name={profile?.name || email || "Workspace user"}
      email={email}
      mobileOpen={mobileNavOpen}
      onMobileClose={() => setMobileNavOpen(false)}
      onNavigate={page => {
        setActivePage(page);
      }}
      onSignOut={() => void logout()}
      signOutDisabled={authBusy}
    />
    <main className="main-area"><header className="topbar"><button className="topbar-nav-toggle" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}><Menu {...iconProps}/></button><div className="topbar-title"><span className="muted">Workspace</span><span className="breadcrumb-separator">/</span><b>{activePage === "logs" ? "Logs" : activePage === "associates" && profile?.role === "admin" ? "Associates" : activePage === "invoices" ? "Invoices" : activePage === "purchase-orders" ? "Purchase Orders" : activePage === "goods-receipts" ? "Goods Receipts" : activePage === "vendors" ? "Vendors" : activePage === "documents" ? "Documents" : activePage === "email" ? "Email inbox" : "Dashboard"}</b></div>{activePage !== "logs" && <label className="topbar-search"><Search {...iconProps}/><input value={globalSearch} onChange={event => { setGlobalSearch(event.target.value); updateInvoiceQuery({ search: event.target.value }); }} placeholder="Search invoices or documents" aria-label="Search invoices or documents" /></label>}<button className="topbar-user" aria-label={`Signed in as ${email}`}><span className="avatar">{(email[0] || "U").toUpperCase()}</span><span className="topbar-user-email">{profile?.name || email}</span><ChevronDown {...iconProps}/></button></header>
      <div className="content">
      {activePage === "logs" ? canAccessLogs(profile?.role) ? <LogsPage coreUrl={CORE_URL} authHeaders={authHeaders} vendors={filterVendors} owners={filterOwners} userNames={{ ...Object.fromEntries(associates.map(user => [user.id, user.name])), ...(readAccessClaims(token)?.sub ? { [readAccessClaims(token)!.sub]: profile?.name || profile?.email || "Admin" } : {}) }} onOpenInvoice={id => { setActivePage("invoices"); void openInvoice(id); }}/> : <section className="panel"><p>You do not have access</p></section> : activePage === "email" ? <EmailInboxWorkspace status={emailStatus} messages={emailMessages} total={emailTotal} filter={emailFilter} onFilter={value => { setEmailPage(0); setEmailFilter(value); }} reason={emailReasonFilter} onReason={value => { setEmailPage(0); setEmailReasonFilter(value); }} page={emailPage} loading={emailLoading} busy={emailBusy} error={emailError} onPoll={() => void pollEmailNow()} onRetry={message => void retryEmailMessage(message)} onRefresh={() => void loadEmailInbox()} onPage={setEmailPage} onOpenDocument={id => { const doc = documents.find(item => item.id === id); if (doc) void openDocument(doc); else { setDocSource("email"); setActivePage("documents"); } }} onOpenInvoice={id => { setActivePage("invoices"); const found = invoices.find(invoice => invoice.invoice_id === id); if (found) void openInvoice(id); }} /> : activePage === "invoices" ? <InvoicesWorkspacePage invoices={invoices} counts={invoiceCounts} total={invoiceTotal} page={invoiceQuery.page} filters={invoiceQuery} vendors={filterVendors} owners={filterOwners} source={invoiceSource} loading={invoiceLoading} error={invoiceError} onFilter={patch => updateInvoiceQuery(patch)} onVendorSearch={searchFilterVendors} onSource={value => setInvoiceSource(value)} onPage={page => updateInvoiceQuery({ page }, false)} onRefresh={() => void loadInvoices()} onOpen={invoice => void openInvoice(invoice.invoice_id)} onOpenDocument={id => { setActivePage("documents"); const doc = documents.find(item => item.id === id); if (doc) void openDocument(doc); }} /> : activePage === "purchase-orders" || activePage === "goods-receipts" ? <ProcurementWorkspacePage kind={activePage === "purchase-orders" ? "purchase_order" : "goods_receipt"} coreUrl={CORE_URL} authHeaders={authHeaders} onOpenInvoice={id => { setActivePage("invoices"); void openInvoice(id); }} onOpenPurchaseOrder={id => { setActivePage("purchase-orders"); setProcurementRecordId(id); }} onViewOriginal={id => void openOriginalSource(id)} onDownloadOriginal={id => void openOriginalSource(id, true)} onCheckVendor={(kind, row, po) => void checkProcurementVendor(kind, row, po)} invoices={invoices} openRecordId={procurementRecordId} onRecordOpened={() => setProcurementRecordId(null)} vendorNotice={unknownVendor?.recordType === (activePage === "purchase-orders" ? "purchase_order" : "goods_receipt") ? unknownVendor : null} vendorVendors={filterVendors} canAddVendor={canCreateVendor(profile?.role)} vendorBusy={unknownVendorBusy} vendorError={unknownVendorError} onAddVendor={() => { if (unknownVendor) setUnknownVendor(unknownVendor); }} onSelectVendor={vendorId => void selectExistingVendor(vendorId)} /> : activePage === "vendors" ? <VendorsPage coreUrl={CORE_URL} authHeaders={authHeaders} isAdmin={profile?.role === "admin"} canCreateVendor={canCreateVendor(profile?.role)} /> : activePage === "associates" && profile?.role === "admin" ? <>
        <section className="panel admin-associate-panel">
          <div className="panel-head"><div><span className="eyebrow purple">ADMINISTRATION</span><h2>Add an associate</h2><p className="muted">Temporary password is valid for 24 hours. The associate must change it at first sign in.</p></div></div>
          <form className="toolbar" onSubmit={createAssociate}>
            <label className="form-label">Name<input value={associateName} onChange={e => setAssociateName(e.target.value)} minLength={2} maxLength={150} required /></label>
            <label className="form-label">Email<input type="email" value={associateEmail} onChange={e => setAssociateEmail(e.target.value)} required /></label>
            <label className="form-label">Temporary password (optional)<input type="password" value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} minLength={12} maxLength={128} /></label>
            <button className="primary" disabled={authBusy}>{authBusy ? "Creating..." : "Add associate"}</button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>Associates</h2><p className="muted">Active associate accounts</p></div><span className="count">{associates.filter(item => item.is_active).length} people</span></div>
          <div className="toolbar"><button className="secondary" onClick={() => void loadAssociates()} disabled={associatesLoading}>{associatesLoading ? "Loading..." : "Refresh list"}</button></div>
          {associatesError && <div className="notice error">{associatesError}<button onClick={() => void loadAssociates()}>Try again</button></div>}
          {associatesLoading ? <LoadingPanel title="Loading associates" subtitle="Retrieving active accounts..."/> : associates.filter(item => item.is_active).length ? <div className="table-wrap scroll-reveal"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>ADDED</th><th></th></tr></thead><tbody>{associates.filter(item => item.is_active).map(associate => <tr key={associate.id}><td>{associate.name}</td><td>{associate.email}</td><td>{dateLabel(associate.created_at)}</td><td className="associate-actions"><button className="secondary" onClick={() => void resetAssociatePassword(associate)} disabled={authBusy}>Reset password</button><button className="secondary" onClick={() => void removeAssociate(associate)}>Remove access</button></td></tr>)}</tbody></table></div> : <EmptyState title="No associates yet" description="Add an associate using the form above."/>}
        </section>
      </> : activePage === "dashboard" ? <DashboardWorkspace invoices={invoices} counts={invoiceCounts} loading={invoiceLoading} error={invoiceError} search={globalSearch} emailStatus={emailStatus} onEmail={() => setActivePage("email")} onPollEmail={() => void pollEmailNow()} onOpen={invoice => void openInvoice(invoice.invoice_id)} onInvoices={() => setActivePage("invoices")} onDocuments={() => setActivePage("documents")} onRefresh={() => void loadInvoices()} /> : <>
        <header className="welcome"><div><span className="eyebrow purple">FINANCE OPERATIONS</span><h1>Documents</h1><p className="muted">Upload, find, and monitor every document in one place.</p></div><label className={`primary upload ${uploading ? "disabled" : ""}`}><span>＋</span> {uploading ? "Uploading…" : "Upload documents"}<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.eml" onChange={event => { const files = Array.from(event.target.files || []); if (files.length) void uploadFiles(files); event.target.value = ""; }} disabled={uploading} hidden /></label></header>
        {uploading && <div className="compact-upload-progress panel">
          <div className="compact-upload-status"><DocumentLoader/><span>Uploading documents... {uploadProgress}%</span></div>
          <div className="progress-track"><span style={{ width: `${uploadProgress}%` }}/></div>
        </div>}
        <section className={`panel simple-documents ${isDraggingDocuments ? "is-dragging" : ""}`} onDragOver={event => { event.preventDefault(); setIsDraggingDocuments(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingDocuments(false); }} onDrop={event => { event.preventDefault(); setIsDraggingDocuments(false); void uploadFiles(Array.from(event.dataTransfer.files)); }}>
          <div className="document-drop-hint" aria-live="polite">Drop up to 5 files here, or use Upload documents.</div>
          <div className="panel-head"><div><h2>Your documents</h2><p className="muted">Select any card to preview the document details.</p></div><div className="panel-head-actions">{profile?.role === "admin" && <button className="secondary" onClick={() => void reprocessAllDocuments()} disabled={bulkReprocessBusy}>{bulkReprocessBusy ? "Reprocessing..." : "Reprocess all"}</button>}<span className="count">{docTotal} files</span></div></div>
          {bulkReprocessProgress && <div className="notice info" role="status">{bulkReprocessBusy ? "Reprocessing" : "Reprocessed"} {bulkReprocessProgress.done} of {bulkReprocessProgress.total} documents{bulkReprocessProgress.failed ? ` · ${bulkReprocessProgress.failed} failed` : ""}</div>}
          <div className="toolbar simple-toolbar">
            <label className="search"><Search {...iconProps}/><input value={docSearch} onChange={e => setDocSearch(e.target.value)} placeholder="Search documents..." /></label>
            <select value={docSource} onChange={e => { setDocPage(1); setDocSource(e.target.value as "latest" | "all" | "email"); }} aria-label="Filter documents by source"><option value="latest">Latest upload</option><option value="email">Email</option><option value="all">All</option></select>
            <select value={docType} onChange={e => { setDocPage(1); setDocType(e.target.value); }} aria-label="Filter by document type"><option value="all">All types</option><option value="invoice">Invoices</option><option value="po">Purchase orders</option><option value="goods_receipt">Goods receipts</option><option value="other">Other</option></select>
            <select value={docStatus} onChange={e => { setDocPage(1); setDocStatus(e.target.value); }} aria-label="Filter by document status"><option value="all">All statuses</option><option value="processing">Processing</option><option value="ready">Ready</option><option value="failed">Failed</option><option value="ignored">Ignored</option></select>
            <button className="icon-button" onClick={() => void loadDocuments(docPage)} disabled={docLoading} aria-label="Refresh documents"><RefreshCw {...iconProps}/></button>
          </div>
          {docError && <div className="notice error">{docError}<button onClick={() => void loadDocuments(docPage)}>Try again</button></div>}
          {docLoading ? <LoadingPanel title="Loading documents" subtitle="Syncing your latest uploads..."/> : filteredDocs.length ? <>
            <div className="document-card-grid">{filteredDocs.map((doc, index) => { const actionState = documentActionAvailability(doc.id); return <article role="button" aria-label={`Open ${doc.original_filename}`} tabIndex={0} className="document-card" key={doc.id || doc.local_key || `${doc.original_filename}-${index}`} style={{ "--row-index": index } as React.CSSProperties} onClick={() => void openDocument(doc)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); void openDocument(doc); } }}>
              <div className="document-card-heading"><FileTypeIcon filename={doc.original_filename}/><strong title={doc.original_filename}>{doc.original_filename}</strong></div>
              <div className="document-card-status"><span className={`pill ${statusClass(isDocumentProcessing(doc) ? "processing" : doc.status)}`}><i/>{documentStatusLabel(doc, friendlyStatus)}</span>
                {doc.status === "failed" && !isRetryScheduled(doc) && doc.failure_class !== "permanent" && <button type="button" className="document-retry" aria-label={`Retry ${doc.original_filename}`} title={actionState.title || "Retry processing"} onClick={event => { event.stopPropagation(); void retryDocument(doc); }} disabled={detailLoading || uploading || actionState.disabled}><RetryIcon/></button>}
              </div>
              <span className="document-card-reason" title={isDocumentProcessing(doc) ? undefined : (doc.failure_message || undefined)}>{isDocumentProcessing(doc) ? "Processing. Status refreshes automatically." : doc.failure_message || (doc.status === "failed" ? "Processing failed." : "Open document details.")}</span>{doc.status === "needs_vendor_review" && <button type="button" className="text-link" onClick={event => { event.stopPropagation(); void openDocument(doc); }}>Add vendor</button>}
            </article>; })}</div>
            <Pagination page={docPage} total={docTotal} pageSize={50} loading={docLoading} onChange={next => { setDocPage(next); void loadDocuments(next); }}/>
          </> : <EmptyState title={docSearch || docType !== "all" || docStatus !== "all" ? "No matching documents" : "Upload up to 5 bills to get started"} description={docSearch || docType !== "all" || docStatus !== "all" ? "Try changing your search or filters." : "Choose files above to upload your first document."} action={(docSearch || docType !== "all" || docStatus !== "all") ? <button className="secondary" onClick={() => { setDocSearch(""); setDocType("all"); setDocStatus("all"); }}>Clear filters</button> : null}/>}
        </section>
      </>}
      <footer className="footer"><span>GENWORX AP · DOCUMENT WORKSPACE</span><span>Statuses and decisions are provided by AP-Core.</span></footer>
      </div>
    </main>
    {toast && <div className={`toast ${toast.kind}`} role="status"><span className="toast-symbol">{toast.kind === "success" ? <CircleCheck {...iconProps}/> : toast.kind === "error" ? <CircleAlert {...iconProps}/> : <CircleHelp {...iconProps}/>}</span><span>{toast.text}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X {...iconProps}/></button></div>}
    {unknownVendor && <UnknownVendorPrompt info={unknownVendor} vendors={filterVendors} canAddVendor={canCreateVendor(profile?.role)} busy={unknownVendorBusy} error={unknownVendorError} onAdd={values => void addUnknownVendor(values)} onSelectExisting={vendorId => void selectExistingVendor(vendorId)} onClose={() => setUnknownVendor(null)}/>}
    {associateCredential && <div className="modal-backdrop credential-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAssociateCredential(null); }}><section className="modal credential-modal" role="dialog" aria-modal="true" aria-labelledby="credential-title"><header className="modal-head"><div><span className="eyebrow purple">TEMPORARY CREDENTIAL</span><h2 id="credential-title">Share with {associateCredential.email}</h2><p className="muted">This password is shown once. The associate must set a new password at sign in.</p></div><button className="modal-close" aria-label="Close" onClick={() => setAssociateCredential(null)}><X {...iconProps}/></button></header><div className="modal-body"><label className="form-label">Temporary password<input className="credential-value" readOnly value={associateCredential.password} onFocus={event => event.currentTarget.select()} /></label><p className="muted">Expires {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(associateCredential.expiresAt))}.</p><div className="modal-actions"><button className="secondary" onClick={() => setAssociateCredential(null)}>Close</button><button className="primary" onClick={() => void copyAssociateCredential()}>{credentialCopied ? "Copied" : "Copy password"}</button></div></div></section></div>}
    {selectedDoc && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedDoc(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header className="modal-head"><div><span className="eyebrow purple">RECORD DETAILS</span><h2 id="detail-title">{selectedDoc.original_filename}</h2></div><button className="modal-close" aria-label="Close details" onClick={() => setSelectedDoc(null)}><X {...iconProps}/></button></header>
      {detailLoading ? <LoadingPanel title="Opening record" subtitle="Fetching the latest information..."/> : modalError && <div className="notice error">{modalError}</div>}
    {selectedDoc && !detailLoading && <div className="modal-body"><div className="detail-summary"><span className={`pill ${statusClass(isDocumentProcessing(selectedDoc) ? "processing" : selectedDoc.status)}`}><i/>{documentStatusLabel(selectedDoc, friendlyStatus)}</span><span className="pill neutral">{humanize(selectedDoc.doc_type)}</span></div>{unknownVendor && unknownVendor.sourceDocumentId === selectedDoc.id && <VendorResolutionBanner info={unknownVendor} vendors={filterVendors} canAddVendor={canCreateVendor(profile?.role)} busy={unknownVendorBusy} error={unknownVendorError} onAdd={() => { if (unknownVendor) setUnknownVendor(unknownVendor); }} onSelect={vendorId => void selectExistingVendor(vendorId)}/>} {isDocumentProcessing(selectedDoc) ? <div className="notice info" role="status">Document is still processing. This view updates automatically.</div> : <div className="notice error">{selectedDoc.failure_message || "No linked record is available for this document."}</div>}<div className="field-grid"><DetailField label="Uploaded" value={dateLabel(selectedDoc.created_at)}/><DetailField label="Last updated" value={dateLabel(selectedDoc.updated_at)}/><DetailField label="Email sender" value={selectedDoc.email_sender}/><DetailField label="Email subject" value={selectedDoc.email_subject}/><DetailField label="Email received" value={selectedDoc.email_received_at ? dateTimeLabel(selectedDoc.email_received_at) : undefined}/></div><DocumentExtractedDetails doc={selectedDoc}/><div className="modal-actions">{(() => { const actionState = documentActionAvailability(selectedDoc.id); return <><button className="secondary" title={actionState.title} disabled={actionState.disabled} onClick={() => void openOriginalFile(selectedDoc)}><Eye {...iconProps}/> View document</button><button className="secondary" title={actionState.title} disabled={actionState.disabled} onClick={() => void downloadOriginalFile(selectedDoc)}><Download {...iconProps}/> Download</button>{["failed", "needs_data_review", "needs_vendor_review", "incomplete"].includes(selectedDoc.status.toLowerCase()) && !isRetryScheduled(selectedDoc) && (selectedDoc.status.toLowerCase() !== "failed" || selectedDoc.failure_class !== "permanent") && <button className="primary" title={actionState.title} onClick={() => void retryDocument(selectedDoc)} disabled={detailLoading || actionState.disabled}><RotateCcw {...iconProps}/> Retry processing</button>}</>; })()}</div></div>}
    </section></div>}
    {filePreview && <div className="modal-backdrop file-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeFilePreview(); }}><section className="modal file-preview-modal" role="dialog" aria-modal="true" aria-labelledby="file-preview-title"><header className="modal-head"><div><h2 id="file-preview-title">{filePreview.filename}</h2>{filePreview.kind === "docx" && <p className="muted">{filePreview.fallback ? "Preview unavailable, showing extracted text" : "Preview of extracted content"}</p>}</div><button className="modal-close" aria-label="Close file preview" onClick={closeFilePreview}><X {...iconProps}/></button></header>{filePreview.kind === "loading" ? <div className="file-preview-loading" role="status" aria-live="polite"><span className="spinner"/> Loading document preview...</div> : filePreview.kind === "docx" ? <DocxExtractedPreview doc={filePreview.document}/> : filePreview.mime.startsWith("image/") ? <div className="file-preview-content"><img alt={`Preview of ${filePreview.filename}`} src={filePreview.url}/></div> : <iframe title={`Preview of ${filePreview.filename}`} src={filePreview.url}/>}</section></div>}
    {selectedInvoice && (
      <div className="modal-backdrop drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedInvoice(null); }}>
        <InvoiceReviewDrawer
          invoice={selectedInvoice}
          initialTab={invoiceDrawerTab}
          authHeaders={authHeaders}
          onViewOriginal={id => void openOriginalSource(id)}
          onDownloadOriginal={id => void openOriginalSource(id, true)}
          candidates={matchCandidates}
          noMatchDraft={noMatchDraft}
          onReviewNoMatchDraft={() => void reviewNoMatchDraft()}
          onClose={() => setSelectedInvoice(null)}
          onMatch={(candidate, accept) => { void confirmSuggestedMatch(candidate, accept); }}
          onDecision={action => { setDecision({ invoiceId: selectedInvoice.invoice_id, action, reason: "", expectedMatchRunId: selectedInvoice.match_run_id, expectedUpdatedAt: selectedInvoice.updated_at }); }}
          vendorNotice={unknownVendor?.recordType === "invoice" && unknownVendor.recordId === selectedInvoice.invoice_id ? unknownVendor : null}
          vendorVendors={filterVendors}
          canAddVendor={canCreateVendor(profile?.role)}
          vendorBusy={unknownVendorBusy}
          vendorError={unknownVendorError}
          onAddVendor={() => { if (unknownVendor) setUnknownVendor(unknownVendor); }}
          onSelectVendor={vendorId => void selectExistingVendor(vendorId)}
          onRefreshInvoice={async () => {
            await openInvoice(selectedInvoice.invoice_id);
            await loadInvoices();
          }}
        />
      </div>
    )}
    {emailDraftEditor && emailDraftOpened && <div className="modal-backdrop email-draft-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !emailDraftBusy) setEmailDraftEditor(null); }}><section className="modal email-draft-modal" role="dialog" aria-modal="true" aria-labelledby="email-draft-title"><header className="modal-head"><div><span className="eyebrow">NO MATCH EMAIL</span><h2 id="email-draft-title">Review email draft</h2></div><button className="modal-close" aria-label="Close email draft" disabled={emailDraftBusy} onClick={() => setEmailDraftEditor(null)}>?</button></header><div className="modal-body"><label className="form-label">Recipient<input type="text" value={emailDraftRecipient} onChange={event => setEmailDraftRecipient(event.target.value)} required aria-label="Email recipient"/></label><label className="form-label">Subject<input value={emailDraftSubject} onChange={event => setEmailDraftSubject(event.target.value)} required/></label><label className="form-label">Body<textarea value={emailDraftBody} onChange={event => setEmailDraftBody(event.target.value)} required rows={10}/></label>{emailDraftError && <div className="notice error" role="alert">{emailDraftError}</div>}<div className="modal-actions"><Button variant="secondary" onClick={() => setEmailDraftEditor(null)} disabled={emailDraftBusy}>Close</Button><Button variant="primary" onClick={() => void sendNoMatchDraft()} disabled={!emailDraftOpened || emailDraftBusy || !emailDraftRecipient.trim() || !emailDraftSubject.trim() || !emailDraftBody.trim()}>{emailDraftBusy ? "Sending?" : "Send"}</Button></div></div></section></div>}
    {decision && <div className="modal-backdrop reason-backdrop" role="presentation"><form className="modal reason-modal" onSubmit={submitInvoiceDecision}><header className="modal-head"><div><span className="eyebrow purple">REVIEW DECISION</span><h2>{decision.action === "hold" ? "Place invoice on hold" : decision.action === "reject" ? "Reject invoice" : decision.action === "approve" ? "Approve invoice" : "Approve with exception"}</h2></div><button className="modal-close" type="button" onClick={() => setDecision(null)} aria-label="Cancel">×</button></header><div className="modal-body"><label className="form-label">{decision.action === "approve" ? "Approval notes (optional)" : "Reason"}<textarea value={decision.reason} onChange={event => setDecision({ ...decision, reason: event.target.value })} required={decision.action !== "approve"} minLength={decision.action === "approve" ? 0 : 3} maxLength={1000} rows={4} placeholder={decision.action === "approve" ? "Optional approval notes" : "Explain this decision"} /></label><div className="modal-actions"><button className="secondary" type="button" onClick={() => setDecision(null)}>Cancel</button><button className="primary" type="submit">{decision.action === "approve" ? "Confirm approval" : "Save decision"}</button></div></div></form></div>}
    {uploadResult && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setUploadResult(null); }}><section className="modal results-modal" role="dialog" aria-modal="true" aria-labelledby="upload-result-title"><header className="modal-head"><div><span className="eyebrow purple">UPLOAD SUMMARY</span><h2 id="upload-result-title">{uploadResult.successes} of {uploadResult.total} files uploaded</h2><p className="muted">Each result below comes from the upload request.</p></div><button className="modal-close" onClick={() => setUploadResult(null)} aria-label="Close upload summary">×</button></header><div className="modal-body"><div className="outcome-list">{uploadResult.outcomes.map((outcome, index) => <div className="outcome-row" key={`${outcome.name}-${index}`}><span className={`outcome-icon ${outcome.ok ? "ok" : "bad"}`}>{outcome.ok ? "✓" : "!"}</span><div><b>{outcome.name}</b><small>{outcome.message}</small></div></div>)}</div><div className="modal-actions"><button className="secondary" onClick={() => setUploadResult(null)}>Close</button><button className="primary" onClick={() => setUploadResult(null)}>View documents</button></div></div></section></div>}
  </div>;
}
function Loader({ title, subtitle }: { title: string; subtitle: string }) { return <div className="loader-screen"><DocumentLoader/><h2>{title}</h2><p>{subtitle}</p></div>; }
function DocumentLoader() { return <span className="document-loader" aria-hidden="true"><span className="loader-orbit orbit-a"/><span className="loader-orbit orbit-b"/><span className="loader-paper"><i/><i/><i/></span><span className="loader-point point-a"/><span className="loader-point point-b"/></span>; }
function LoadingPanel({ title, subtitle }: { title: string; subtitle: string }) { return <div className="loading-panel" role="status"><div className="skeleton-copy"><Skeleton/><Skeleton/><span><b>{title}</b> · {subtitle}</span></div><div className="skeleton-lines"><Skeleton/><Skeleton/><Skeleton/></div></div>; }
function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="empty"><div className="empty-icon"><FileText {...iconProps}/></div><h3>{title}</h3><p>{description}</p>{action}</div>; }
type AnyRecord = Record<string, unknown>;
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function pick(data: AnyRecord, keys: string[]) { for (const key of keys) { const value = data[key]; if (value !== null && value !== undefined && value !== "" && typeof value !== "object") return value; } return undefined; }
function displayDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}
function FileTypeIcon({ filename }: { filename: string }) {
  const imageFile = /\.(png|jpe?g|webp|tiff?)$/i.test(filename);
  return <span className="document-file-icon" aria-hidden="true">{imageFile ? <FileImage {...iconProps}/> : <FileText {...iconProps}/>}</span>;
}

function RetryIcon() { return <RotateCcw {...iconProps}/>; }

function DetailField({ label, value }: { label: string; value?: unknown }) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  return <div className="field"><span>{label}</span><strong>{String(value)}</strong></div>;
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
  const nested = doc.doc_type === "invoice" ? record(data.invoice) : {};
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
  const linesValue = pick(source, ["line_items", "items"]);
  const lines = Array.isArray(linesValue) ? linesValue.map(record) : [];
  const amountFields = [
    { label: "Subtotal", keys: ["subtotal", "sub_total"] },
    { label: "Tax", keys: ["tax", "tax_amount", "total_tax"] },
    { label: "Total", keys: ["total", "total_amount", "invoice_total", "grand_total"] },
  ];
  const documentFields = doc.doc_type === "po" || doc.doc_type === "purchase_order"
    ? [{ label: "PO Number", keys: ["po_number", "order_number"] }, { label: "PO Date", keys: ["po_date"], date: true }, { label: "Vendor", keys: ["vendor", "vendor_name"] }, { label: "Payment Terms", keys: ["payment_terms", "terms"] }]
    : doc.doc_type === "goods_receipt"
      ? [{ label: "Receipt Number", keys: ["gr_number", "receipt_number", "goods_receipt_number"] }, { label: "Receipt Date", keys: ["receipt_date"], date: true }, { label: "PO Number", keys: ["po_number", "order_number"] }, { label: "Vendor", keys: ["vendor", "vendor_name"] }]
      : doc.doc_type === "invoice" ? invoiceFields : [];
  const sectionTitle = documentDetailSectionTitle(doc.doc_type);
  const ownFieldsPresent = documentFields.some(field => pick(source, field.keys) !== undefined);
  return <div className="extracted-details">
    {ownFieldsPresent && <section className="extracted-section scroll-reveal"><h3 className="section-title">{sectionTitle}</h3><div className="field-grid">{documentFields.map(field => {
      const value = pick(source, field.keys);
      return <DetailField key={field.label} label={field.label} value={field.date ? displayDate(value) : value}/>;
    })}</div></section>}
    {amountFields.some(field => pick(source, field.keys) !== undefined) && <section className="extracted-section scroll-reveal"><h3 className="section-title">Amounts</h3><div className="field-grid">{amountFields.map(field => {
      const value = pick(source, field.keys);
      return <DetailField key={field.label} label={field.label} value={formatAmount(value)}/>;
    })}</div></section>}
    {lines.length > 0 && <section className="extracted-section scroll-reveal"><h3 className="section-title">Line Items</h3><div className="table-wrap scroll-reveal"><table className="line-items-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>{lines.map((line, index) => {
      const description = pick(line, ["description", "item_description", "name"]);
      const quantity = pick(line, ["qty", "quantity"]);
      const price = pick(line, ["unit_price", "price"]);
      const amount = pick(line, ["amount", "line_amount", "line_total", "total"]);
      return <tr key={index}><td>{description == null ? "" : String(description)}</td><td>{formatQuantity(quantity) || ""}</td><td>{formatAmount(price) || ""}</td><td>{formatAmount(amount) || ""}</td></tr>;
    })}</tbody></table></div></section>}
    {!ownFieldsPresent && !amountFields.some(field => pick(source, field.keys) !== undefined) && !lines.length && <p className="muted">No {sectionTitle.toLowerCase()} details are available yet.</p>}
  </div>;
}

function DocxExtractedPreview({ doc }: { doc: Doc }) {
  const data = record(doc.extracted_json);
  const source = {
    ...data,
    ...record(data.extraction),
    ...record(data.fields),
    ...record(data.invoice),
    ...record(data.purchase_order),
    ...record(data.goods_receipt),
  };
  const lineValue = pick(source, ["line_items", "items"]);
  const lines = Array.isArray(lineValue) ? lineValue.map(record) : [];
  const hiddenKeys = new Set(["raw_text", "text", "line_items", "items", "confidence", "field_confidence"]);
  const fields = Object.entries(source).filter(([key, value]) =>
    !hiddenKeys.has(key.toLowerCase()) &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
    String(value).trim().length > 0
  );
  const text = stripPreviewMarkdown(doc.raw_text?.trim() || (typeof source.text === "string" ? source.text.trim() : ""));
  if (!text && !fields.length && !lines.length) {
    return <div className="file-preview-content"><p className="muted" role="status">No extracted content is available to preview for this document.</p></div>;
  }
  const lineValueText = (line: Record<string, unknown>, keys: string[]) => {
    const value = pick(line, keys);
    return value == null ? "" : String(value);
  };
  return <div className="file-preview-content docx-extracted-preview">
    {text && <section><h3>Extracted text</h3><pre>{text}</pre></section>}
    {fields.length > 0 && <section><h3>Extracted fields</h3><dl className="docx-preview-fields">{fields.map(([key, value]) => <Fragment key={key}><dt>{humanize(key)}</dt><dd>{String(value)}</dd></Fragment>)}</dl></section>}
    {lines.length > 0 && <section><h3>Extracted line items</h3><div className="table-wrap scroll-reveal"><table className="line-items-table"><thead><tr><th>Description</th><th>Item code</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{lines.map((line, index) => <tr key={index}><td>{lineValueText(line, ["description", "item_description", "name"])}</td><td>{lineValueText(line, ["item_code", "sku", "code"])}</td><td>{lineValueText(line, ["qty", "quantity"])}</td><td>{lineValueText(line, ["unit_price", "price"])}</td><td>{lineValueText(line, ["amount", "line_amount", "line_total", "total"])}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

function stripPreviewMarkdown(value: string) {
  return value.replaceAll("**", "").replace(/^\s*#+\s?/gm, "");
}

function Pagination({ page, total, pageSize, loading, onChange }: { page: number; total: number; pageSize: number; loading: boolean; onChange: (page: number) => void }) { const pages = Math.max(1, Math.ceil(total / pageSize)); return <div className="pagination"><span>Showing page <b>{page}</b> of <b>{pages}</b> · {total} records</span><div><button className="secondary" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}><ArrowLeft {...iconProps}/> Previous</button><button className="secondary" disabled={loading || page >= pages} onClick={() => onChange(page + 1)}>Next <ArrowRight {...iconProps}/></button></div></div>; }

const invoiceStatuses: InvoiceItem["status"][] = ["processing", "needs_review", "ready_to_pay", "on_hold", "rejected"];
const invoiceStatusLabels: Record<InvoiceItem["status"], string> = { processing: "In progress", needs_review: "Needs review", ready_to_pay: "Ready to pay", on_hold: "On hold", rejected: "Rejected" };
function invoiceStatusClass(status: InvoiceItem["status"]) { return ({ processing: "invoice-status-processing", needs_review: "invoice-status-review", ready_to_pay: "invoice-status-ready", on_hold: "invoice-status-hold", rejected: "invoice-status-rejected" })[status]; }
function invoiceStatusTone(status: InvoiceItem["status"]): "blue" | "amber" | "green" | "gray" | "red" { return ({ processing: "blue", needs_review: "amber", ready_to_pay: "green", on_hold: "gray", rejected: "red" } as const)[status]; }
function InvoicesWorkspace({ invoices, counts, status, onStatus, source, onSource, loading, error, search, onRefresh, onOpen, onOpenDocument }: { invoices: InvoiceItem[]; counts: Record<InvoiceItem["status"], number>; status: InvoiceItem["status"] | "all"; onStatus: (status: InvoiceItem["status"] | "all") => void; source: "all" | "upload" | "email"; onSource: (source: "all" | "upload" | "email") => void; loading: boolean; error: string; search: string; onRefresh: () => void; onOpen: (invoice: InvoiceItem) => void; onOpenDocument: (id: string) => void }) {
  const statusFiltered = status === "all" ? invoices : invoices.filter(invoice => invoice.status === status);
  const query = search.trim().toLowerCase();
  const visible = statusFiltered.filter(invoice => (source === "all" || invoice.source === source) && (!query || `${invoice.vendor_name || ""} ${invoice.invoice_no || ""} ${invoice.status} ${invoice.email_sender || ""} ${invoice.email_subject || ""}`.toLowerCase().includes(query)));
  return <><header className="welcome"><div><span className="eyebrow purple">FINANCE OPERATIONS</span><h1>Invoices</h1><p className="muted">Review invoice details and resolve purchase order discrepancies.</p></div><Button variant="secondary" onClick={onRefresh} disabled={loading}><RefreshCw {...iconProps}/> Refresh</Button></header>
    <Card className="panel invoice-workspace"><div className="invoice-status-tabs" role="tablist" aria-label="Invoice status"><button className={status === "all" ? "active" : ""} onClick={() => onStatus("all")}>All <b>{Object.values(counts).reduce((sum, count) => sum + count, 0)}</b></button>{invoiceStatuses.map(item => <button key={item} className={status === item ? "active" : ""} onClick={() => onStatus(item)}><span className={`status-dot ${invoiceStatusClass(item)}`}/>{invoiceStatusLabels[item]} <b>{counts[item]}</b></button>)}</div>
      <div className="email-filter-row"><label className="form-label">Source<select value={source} onChange={event => onSource(event.target.value as "all" | "upload" | "email")}><option value="all">All sources</option><option value="upload">Upload</option><option value="email">Email</option></select></label></div>
      {error && <div className="notice error">{error}<button onClick={onRefresh}>Try again</button></div>}
      {loading ? <LoadingPanel title="Loading invoices" subtitle="Retrieving invoice review status..."/> : visible.length ? <div className="table-wrap scroll-reveal"><table className="invoice-table"><thead><tr><th>Vendor</th><th>Invoice No</th><th>Source</th><th>Sender / subject</th><th>Invoice Date</th><th>Due Date</th><th className="amount-cell">Total</th><th>Status</th><th>Source file</th></tr></thead><tbody>{visible.map(invoice => <tr key={invoice.invoice_id} onClick={() => onOpen(invoice)} tabIndex={0} onKeyDown={event => { if (event.key === "Enter") onOpen(invoice); }}><td>{invoice.vendor_name || ""}</td><td>{invoice.invoice_no || ""}</td><td><Badge tone={invoice.source === "email" ? "amber" : "neutral"}>{invoice.source === "email" ? "Email" : "Upload"}</Badge></td><td className="invoice-source-cell">{invoice.source === "email" ? <><span>{invoice.email_sender || "Unknown sender"}</span><small>{invoice.email_subject || "No subject"}</small></> : "—"}</td><td>{invoice.invoice_date ? dateLabel(invoice.invoice_date) : ""}</td><td>{invoice.due_date ? dateLabel(invoice.due_date) : ""}</td><td className="amount-cell">{invoice.total_amount == null ? "" : formatInvoiceMoney(invoice.total_amount, invoice.currency)}</td><td><Badge tone={invoiceStatusTone(invoice.status)} dot>{invoiceStatusLabels[invoice.status]}</Badge></td><td>{invoice.source_document_id && <button className="text-link" onClick={event => { event.stopPropagation(); onOpenDocument(invoice.source_document_id!); }}>View document</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="No invoices in this status" description="Invoices received by upload or email will appear here after extraction."/>}
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
function EmailInboxWorkspace({ status, messages, total, filter, onFilter, reason, onReason, page, loading, busy, error, onPoll, onRetry, onRefresh, onPage, onOpenDocument, onOpenInvoice, vendorNotice, vendorVendors, canAddVendor, vendorBusy, vendorError, onAddVendor, onSelectVendor }: {
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
  vendorNotice?: UnknownVendorInfo | null;
  vendorVendors?: FilterVendor[];
  canAddVendor?: boolean;
  vendorBusy?: boolean;
  vendorError?: string;
  onAddVendor?: () => void;
  onSelectVendor?: (id: string) => void;
}) {
  const last = status?.last_result || {};
  return <div className="email-inbox-page page-enter">
    <header className="welcome"><div><span className="eyebrow purple">MAIL INTAKE</span><h1>Email inbox</h1><p className="muted">Vendor emails and their invoice attachments.</p></div><div className="toolbar"><Button variant="secondary" onClick={onRefresh} disabled={loading}>Refresh</Button><Button variant="primary" onClick={onPoll} disabled={busy || !status?.enabled}>{busy ? "Polling..." : "Poll now"}</Button></div></header>
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
      {loading ? <LoadingPanel title="Loading email messages" subtitle="Syncing the inbox status..."/> : messages.length ? <div className="table-wrap scroll-reveal"><table className="email-message-table"><thead><tr><th>Sender</th><th>Subject</th><th>Received</th><th>Outcome</th><th>Reason</th><th>Invoice</th><th>Action</th></tr></thead><tbody>{messages.map(message => <tr key={message.id} className={message.status === "needs_attention" || message.status.startsWith("failed") ? "email-action-row" : ""}><td>{message.sender || "Unknown sender"}</td><td>{message.subject || "No subject"}</td><td>{dateTimeLabel(message.received_at)}</td><td><Badge tone={message.status === "processed" ? "green" : message.status.startsWith("failed") ? "red" : message.status === "needs_attention" ? "amber" : "gray"} dot>{emailOutcome(message.status)}</Badge></td><td>{message.failure_reason || message.filter_reason || "—"}{vendorNotice?.recordId === (message.document_id || message.linked_invoice_id) && vendorNotice && <VendorResolutionBanner info={vendorNotice} vendors={vendorVendors || []} canAddVendor={Boolean(canAddVendor)} busy={vendorBusy} error={vendorError} onAdd={onAddVendor || (() => undefined)} onSelect={onSelectVendor || (() => undefined)}/>}</td><td>{message.linked_invoice_id ? <button className="text-link" onClick={() => onOpenInvoice(message.linked_invoice_id!)}>{message.linked_invoice_status ? humanize(message.linked_invoice_status) : "View invoice"}</button> : message.document_id ? <button className="text-link" onClick={() => onOpenDocument(message.document_id!)}>View document</button> : "—"}</td><td>{message.retryable ? <Button variant="secondary" disabled={busy} onClick={() => onRetry(message)}>Retry</Button> : message.document_id && !message.linked_invoice_id ? <button className="text-link" onClick={() => onOpenDocument(message.document_id!)}>Open source</button> : "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="No email messages found" description={filter !== "all" || reason ? "Change your filters to view more messages." : "Email messages will appear here after polling begins."} action={filter !== "all" || reason ? <Button variant="secondary" onClick={() => { onFilter("all"); onReason(""); }}>Clear filters</Button> : null}/>}
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
    <header className="welcome dashboard-welcome"><div><span className="eyebrow purple">ACCOUNTS PAYABLE OVERVIEW</span><h1>Dashboard</h1><p className="muted">A clear view of invoices that need attention and payment.</p></div><div className="dashboard-actions"><Button variant="secondary" onClick={onRefresh} disabled={loading}><RefreshCw {...iconProps}/> Refresh data</Button><Button variant="primary" onClick={onDocuments}><Upload {...iconProps}/> Upload documents</Button></div></header>
    {error && <div className="notice error" role="alert">{error}<button onClick={onRefresh}>Try again</button></div>}
    <section className="kpi-grid" aria-label="Invoice summary">
      <KpiCard label="Total invoices" value={total} tone="accent" icon={<FileText {...iconProps}/>} onClick={onInvoices}/>
      <KpiCard label="Needs review" value={counts.needs_review} tone="amber" icon="!" onClick={onInvoices}/>
      <KpiCard label="Ready to pay" value={counts.ready_to_pay} tone="green" icon={<Check {...iconProps}/>} onClick={onInvoices}/>
      <KpiCard label="On hold" value={counts.on_hold} tone="gray" icon={<Clock {...iconProps}/>} onClick={onInvoices}/>
    </section>
    <section className="dashboard-grid">
      <Card className="dashboard-card status-distribution"><div className="section-heading"><div><span className="eyebrow purple">PORTFOLIO</span><h2>Status distribution</h2><p className="muted">Current invoice totals by workflow status.</p></div><button className="text-link" onClick={onInvoices}>View invoices <span aria-hidden="true"><ArrowRight {...iconProps}/></span></button></div>
        {loading ? <DashboardChartSkeleton/> : total === 0 ? <EmptyState title="No invoice data yet" description="Invoice status distribution will appear after invoices are uploaded." action={<Button onClick={onDocuments}>Go to documents</Button>}/> : <div className="distribution-list">{chartStatuses.map(status => { const count = counts[status]; const percent = total ? Math.round(count / total * 100) : 0; return <div className="distribution-row" key={status}><div className="distribution-label"><Badge tone={invoiceStatusTone(status)} dot>{invoiceStatusLabels[status]}</Badge><span>{count.toLocaleString("en-IN")}</span></div><div className="distribution-track"><span className={`distribution-fill ${invoiceStatusClass(status)}`} style={{ width: `${percent}%` }}/></div><small>{percent}%</small></div>; })}</div>}
      </Card>
      <Card className="dashboard-card attention-card"><div className="section-heading"><div><span className="eyebrow purple">ACTION REQUIRED</span><h2>Needs attention</h2><p className="muted">Recent invoices waiting for review.</p></div><Badge tone="amber" dot>{counts.needs_review} open</Badge></div>
        {loading ? <AttentionSkeleton/> : attention.length ? <div className="attention-list">{attention.map((invoice, index) => <button className="attention-row" key={invoice.invoice_id} onClick={() => onOpen(invoice)} style={{ "--row-index": index } as React.CSSProperties}><span className="attention-vendor-icon">{(invoice.vendor_name || "V").slice(0, 1).toUpperCase()}</span><span className="attention-copy"><b>{invoice.vendor_name || "Unknown vendor"}</b><small>{invoice.invoice_no || "Invoice"}{invoice.invoice_date ? ` · ${dateLabel(invoice.invoice_date)}` : ""}</small></span><span className="attention-amount">{invoice.total_amount == null ? "" : formatInvoiceMoney(invoice.total_amount, invoice.currency)}</span><span className="attention-arrow" aria-hidden="true"><ArrowRight {...iconProps}/></span></button>)}<Button variant="ghost" className="attention-more" onClick={onInvoices}>Review all invoices <span aria-hidden="true"><ArrowRight {...iconProps}/></span></Button></div> : <EmptyState title="You're all caught up" description="There are no invoices waiting for review."/>}
      </Card>
    </section>
    <Card className="panel email-dashboard-card"><div className="panel-head"><div><span className="eyebrow purple">INBOUND DOCUMENTS</span><h2>Email inbox</h2><p className="muted">Review vendor emails and document intake.</p></div><div className="toolbar"><Button variant="secondary" onClick={onEmail}>Open inbox</Button><Button variant="primary" onClick={onPollEmail}>Poll now</Button></div></div><div className="email-inbox-status"><span><small>Last poll</small><b>{emailStatus?.last_run_at ? dateTimeLabel(emailStatus.last_run_at) : "Not polled yet"}</b></span><span><small>Fetched</small><b>{emailPollCount(emailStatus, "mails_found", "emails")}</b></span><span><small>Skipped</small><b>{emailPollCount(emailStatus, "skipped", "filtered")}</b></span><span><small>Processed</small><b>{emailPollCount(emailStatus, "new_documents", "documents_created")}</b></span><span><small>Failed</small><b>{emailStatus?.counts?.failed || 0}</b></span></div>{emailStatus && !emailStatus.docling_models_available && <div className="notice error">OCR models are not installed. Ask an admin to run the model download.</div>}</Card>
    <div className="dashboard-footer-note"><span className="dashboard-note-icon">i</span><span>Dashboard metrics reflect the invoice data available to your account.</span></div>
  </div>;
}

function KpiCard({ label, value, tone, icon, onClick }: { label: string; value: number; tone: "accent" | "amber" | "green" | "gray"; icon: React.ReactNode; onClick: () => void }) {
  return <Card className={`kpi-card kpi-${tone}`}><button className="kpi-card-button" onClick={onClick}><span className="kpi-icon">{icon}</span><span className="kpi-label">{label}</span><CountUp value={value}/><span className="kpi-link">View details <span aria-hidden="true"><ArrowRight {...iconProps}/></span></span></button></Card>;
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
function InvoiceComparisonRow({
  item,
  currency,
  onResolve,
  onAutoHandle,
  onReopen,
  onCustomResolve,
  busy,
}: {
  item: NonNullable<InvoiceDetail["discrepancies"]>[number];
  currency?: string | null;
  onResolve?: (action: string, reason?: string) => void;
  onAutoHandle?: () => void;
  onReopen?: () => void;
  onCustomResolve?: () => void;
  busy?: boolean;
}) {
  const amountField = /total|tax|price|amount/i.test(item.field);
  const render = (value: unknown) => amountField && value != null ? formatInvoiceMoney(value, currency) : safeCompareValue(value);
  const result = item.resolved ? "Resolved" : item.severity === "within_tolerance" ? "Within tolerance" : "Mismatch";
  const cls = item.resolved ? "matched" : item.severity === "error" ? "mismatch" : "within-tolerance";
  return (
    <tr className={`comparison-row comparison-row-${cls}`}>
      <td>
        <strong style={{ display: "block" }}>{humanize(item.field)}</strong>
        <small className="muted" style={{ fontSize: "11px" }}>{item.field.toUpperCase()}</small>
      </td>
      <td>{render(item.invoice_value) || "—"}</td>
      <td>{render(item.po_value) || "—"}</td>
      <td>{render(item.gr_value) || "—"}</td>
      <td><span className={`comparison-result ${cls}`}>{result}</span></td>
      <td>
        {item.resolved ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span className="pill green" style={{ fontSize: "11px", padding: "2px 6px" }}>
              ✓ {item.reason || "Resolved"}
            </span>
            {onReopen && (
              <button
                type="button"
                className="secondary"
                style={{ padding: "2px 6px", fontSize: "10px", height: "auto" }}
                disabled={busy}
                onClick={onReopen}
                title="Reopen discrepancy"
              >
                Reopen
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap" }}>
            {onAutoHandle && (
              <button
                type="button"
                className="secondary"
                style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
                disabled={busy}
                onClick={onAutoHandle}
                title="Smart auto-resolution (auto-link GR, accept variance under tolerance)"
              >
                Auto-Fix
              </button>
            )}
            {onResolve && (
              <button
                type="button"
                className="primary"
                style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
                disabled={busy}
                onClick={() => onResolve("accept_variance", "Variance accepted by reviewer")}
                title="Accept variance"
              >
                Accept
              </button>
            )}
            {onResolve && (
              <button
                type="button"
                className="secondary"
                style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
                disabled={busy}
                onClick={() => onResolve("waive", "Waived by reviewer")}
                title="Waive discrepancy"
              >
                Waive
              </button>
            )}
            {onCustomResolve && (
              <button
                type="button"
                className="secondary"
                style={{ padding: "2px 6px", fontSize: "11px", height: "auto" }}
                disabled={busy}
                onClick={onCustomResolve}
                title="Enter custom resolution explanation"
              >
                Notes...
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
function InvoiceReviewDrawer({  invoice,
  candidates,
  noMatchDraft,
  onReviewNoMatchDraft,
  onClose,
  onMatch,
  onDecision,
  initialTab,
  authHeaders: _authHeaders,
  onViewOriginal: _onViewOriginal,
  onDownloadOriginal: _onDownloadOriginal,
  vendorNotice,
  vendorVendors,
  canAddVendor,
  vendorBusy,
  vendorError,
  onAddVendor,
  onSelectVendor,
  onRefreshInvoice,
}: {
  invoice: InvoiceDetail;
  candidates: MatchCandidate[];
  noMatchDraft: NoMatchDraft | null;
  onReviewNoMatchDraft: () => void;
  onClose: () => void;
  onMatch: (candidate: MatchCandidate, accept: boolean) => void;
  onDecision: (action: "hold" | "reject" | "approve-exception" | "approve") => void;
  initialTab?: string;
  authHeaders?: () => { Authorization: string };
  onViewOriginal?: (id: string | null | undefined) => void;
  onDownloadOriginal?: (id: string | null | undefined) => void;
  vendorNotice?: UnknownVendorInfo | null;
  vendorVendors?: FilterVendor[];
  canAddVendor?: boolean;
  vendorBusy?: boolean;
  vendorError?: string;
  onAddVendor?: () => void;
  onSelectVendor?: (vendorId: string) => void;
  onRefreshInvoice?: () => void | Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"matching" | "lines" | "details">("matching");
  const [discrepancyBusy, setDiscrepancyBusy] = useState<string | null>(null);
  const [discrepancyError, setDiscrepancyError] = useState<string>("");
  const [promptModal, setPromptModal] = useState<{ id?: string; field?: string; isAll?: boolean } | null>(null);
  const [customReasonText, setCustomReasonText] = useState("");

  const handleResolve = async (discrepancyId: string, action: string, reason?: string) => {
    if (!invoice.invoice_id) return;
    setDiscrepancyBusy(discrepancyId);
    setDiscrepancyError("");
    try {
      await axios.post(
        `${CORE_URL}/api/invoices/${invoice.invoice_id}/discrepancies/${discrepancyId}/resolve`,
        { action, reason: reason || "Resolved by reviewer" },
        { headers: _authHeaders ? _authHeaders() : undefined }
      );
      if (onRefreshInvoice) await onRefreshInvoice();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "response" in err && (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setDiscrepancyError(typeof msg === "string" ? msg : "Failed to resolve discrepancy");
    } finally {
      setDiscrepancyBusy(null);
    }
  };

  const handleReopen = async (discrepancyId: string) => {
    if (!invoice.invoice_id) return;
    setDiscrepancyBusy(discrepancyId);
    setDiscrepancyError("");
    try {
      await axios.post(
        `${CORE_URL}/api/invoices/${invoice.invoice_id}/discrepancies/${discrepancyId}/reopen`,
        {},
        { headers: _authHeaders ? _authHeaders() : undefined }
      );
      if (onRefreshInvoice) await onRefreshInvoice();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "response" in err && (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setDiscrepancyError(typeof msg === "string" ? msg : "Failed to reopen discrepancy");
    } finally {
      setDiscrepancyBusy(null);
    }
  };

  const handleAutoHandle = async (discrepancyId: string) => {
    if (!invoice.invoice_id) return;
    setDiscrepancyBusy(discrepancyId);
    setDiscrepancyError("");
    try {
      await axios.post(
        `${CORE_URL}/api/invoices/${invoice.invoice_id}/discrepancies/${discrepancyId}/auto-handle`,
        {},
        { headers: _authHeaders ? _authHeaders() : undefined }
      );
      if (onRefreshInvoice) await onRefreshInvoice();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "response" in err && (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setDiscrepancyError(typeof msg === "string" ? msg : "Auto-handle could not resolve discrepancy");
    } finally {
      setDiscrepancyBusy(null);
    }
  };

  const handleResolveAll = async (customReason?: string) => {
    if (!invoice.invoice_id) return;
    setDiscrepancyBusy("all");
    setDiscrepancyError("");
    try {
      await axios.post(
        `${CORE_URL}/api/invoices/${invoice.invoice_id}/discrepancies/resolve-all`,
        { reason: customReason || "All discrepancies accepted and approved by reviewer" },
        { headers: _authHeaders ? _authHeaders() : undefined }
      );
      if (onRefreshInvoice) await onRefreshInvoice();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "response" in err && (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setDiscrepancyError(typeof msg === "string" ? msg : "Failed to resolve all discrepancies");
    } finally {
      setDiscrepancyBusy(null);
    }
  };

  const rows = [...(invoice.discrepancies || [])].sort((a, b) => Number(Boolean(a.resolved)) - Number(Boolean(b.resolved)) || (a.severity === "error" ? -1 : 1));
  const issues = rows.filter(item => !item.resolved);
  const resolvedItems = rows.filter(item => item.resolved);
  const labels: [string, (keyof InvoiceDetail)[]][] = [
    ["Vendor", ["vendor_name"]],
    ["Vendor Tax ID", ["vendor_tax_id"]],
    ["Invoice Number", ["invoice_no"]],
    ["Invoice Date", ["invoice_date"]],
    ["Due Date", ["due_date"]],
    ["PO / Order Reference", ["po_number_raw"]],
    ["Payment Terms", ["payment_terms"]],
    ["Currency", ["currency"]],
  ];
  const hasNoReceipt = issues.some(item => item.field.includes("accepted_quantity") || item.field.includes("goods_receipt"));
  const isMatchOk = issues.length === 0;

  return (
    <section className="modal invoice-detail-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title">
      <header className="modal-head" style={{ padding: "18px 24px", alignItems: "center" }}>
        <div>
          <span className="eyebrow purple" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <Layers size={13} /> INVOICE VERIFICATION & WORKFLOW
          </span>
          <h2 id="invoice-detail-title" style={{ display: "flex", alignItems: "center", gap: "10px", margin: "2px 0 0" }}>
            {invoice.invoice_no || "Invoice Details"}
            <span className={`invoice-status ${invoiceStatusClass(invoice.status)}`} style={{ fontSize: "12px", padding: "2px 8px" }}>
              {invoiceStatusLabels[invoice.status]}
            </span>
          </h2>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close invoice">
          <X size={18} />
        </button>
      </header>

      {/* Segmented Top Tabs */}
      <div className="drawer-segmented-tabs scroll-reveal" role="tablist">
        <button
          type="button"
          className={`drawer-tab-btn ${activeTab === "matching" ? "active" : ""}`}
          onClick={() => setActiveTab("matching")}
        >
          <Sparkles size={14} /> Matching & Discrepancies
          {issues.length > 0 ? (
            <b style={{ background: "rgba(229, 72, 77, 0.15)", color: "#b91c1c" }}>{issues.length}</b>
          ) : (
            <b style={{ background: "rgba(43, 182, 115, 0.15)", color: "#15803d" }}>✓</b>
          )}
        </button>
        <button
          type="button"
          className={`drawer-tab-btn ${activeTab === "lines" ? "active" : ""}`}
          onClick={() => setActiveTab("lines")}
        >
          <ListChecks size={14} /> Line Items
          {(invoice.line_items || []).length > 0 && <b>{(invoice.line_items || []).length}</b>}
        </button>
        <button
          type="button"
          className={`drawer-tab-btn ${activeTab === "details" ? "active" : ""}`}
          onClick={() => setActiveTab("details")}
        >
          <FileText size={14} /> Invoice Data & Source
        </button>
      </div>

      <div className="modal-body" style={{ padding: "20px 24px" }}>
        {vendorNotice && (
          <VendorResolutionBanner
            info={vendorNotice}
            vendors={vendorVendors || []}
            canAddVendor={Boolean(canAddVendor)}
            busy={vendorBusy}
            error={vendorError}
            onAdd={onAddVendor || (() => undefined)}
            onSelect={onSelectVendor || (() => undefined)}
          />
        )}

        {noMatchDraft && (
          <div className="notice info no-match-draft-banner">
            <strong>Draft ready to review</strong>
            <p>A no-match email is ready. Review and edit it before sending.</p>
            <Button variant="secondary" onClick={onReviewNoMatchDraft}>
              Review email draft
            </Button>
          </div>
        )}

        {/* TAB 1: MATCHING & DISCREPANCIES */}
        {activeTab === "matching" && (
          <>
            {/* Match Hero Status Card */}
            <div className={`match-hero-card scroll-reveal ${isMatchOk ? "clean" : "issues"}`}>
              <div className="match-hero-left">
                <div className={`match-score-badge ${isMatchOk ? "clean" : "issues"}`}>
                  {isMatchOk ? "100%" : `${Math.max(50, 100 - issues.length * 15)}%`}
                </div>
                <div>
                  <div className="match-hero-title">
                    {isMatchOk ? "Match Verified & Clean" : `${issues.length} Discrepanc${issues.length === 1 ? "y" : "ies"} Detected`}
                  </div>
                  <div className="match-hero-meta">
                    <span className="pill neutral" style={{ fontSize: "11px" }}>
                      Vendor: <strong>{invoice.vendor_name || "Unknown"}</strong>
                    </span>
                    <span className="pill neutral" style={{ fontSize: "11px" }}>
                      PO: <strong>{invoice.po_number_raw || "None linked"}</strong>
                    </span>
                    <span className={`pill ${isMatchOk ? "success" : "attention"}`} style={{ fontSize: "11px" }}>
                      {isMatchOk ? "Ready for Payment" : "Needs Review"}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <strong style={{ fontSize: "18px", color: "var(--navy)", display: "block", textAlign: "right" }}>
                  {formatInvoiceMoney(invoice.total_amount, invoice.currency)}
                </strong>
                <small className="muted" style={{ display: "block", textAlign: "right" }}>
                  Total Invoiced
                </small>
              </div>
            </div>

            {/* Active Discrepancies Table */}
            <section className="extracted-section scroll-reveal">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <h3 className="section-title" style={{ margin: 0, fontSize: "16px" }}>
                    Match Rules & Tolerances
                  </h3>
                  <small className="muted">
                    {issues.length} active issue{issues.length === 1 ? "" : "s"} · {resolvedItems.length} resolved
                  </small>
                </div>
                {issues.length > 0 && (
                  <div style={{ display: "inline-flex", gap: "6px" }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "4px 10px", fontSize: "12px", height: "auto" }}
                      disabled={Boolean(discrepancyBusy)}
                      onClick={() => setPromptModal({ isAll: true })}
                    >
                      Resolve All with Note...
                    </button>
                    <button
                      type="button"
                      className="primary"
                      style={{ padding: "4px 10px", fontSize: "12px", height: "auto" }}
                      disabled={Boolean(discrepancyBusy)}
                      onClick={() => void handleResolveAll()}
                    >
                      {discrepancyBusy === "all" ? "Resolving..." : `Auto-Resolve All (${issues.length})`}
                    </button>
                  </div>
                )}
              </div>

              {discrepancyError && (
                <div className="notice error" style={{ marginBottom: "12px" }}>
                  {discrepancyError}
                </div>
              )}

              {issues.length > 0 ? (
                <>
                  <div className="discrepancy-badges" style={{ marginBottom: "10px" }}>
                    {issues.map(item => (
                      <span
                        key={`${item.field}-${item.reason}`}
                        className={`discrepancy-badge ${item.severity === "error" ? "mismatch" : "within-tolerance"}`}
                      >
                        <AlertTriangle size={11} />
                        {item.field.includes("po_found")
                          ? "No PO"
                          : item.field.includes("unit_price") || item.field.includes("line_price")
                          ? "Price mismatch"
                          : item.field.includes("goods_receipt") || item.field.includes("accepted_quantity")
                          ? "No goods receipt"
                          : item.field.includes("quantity")
                          ? "Qty exceeds PO"
                          : humanize(item.field)}
                      </span>
                    ))}
                  </div>

                  <div className="table-wrap scroll-reveal">
                    <table className="comparison-table">
                      <thead>
                        <tr>
                          <th>Discrepancy / Field</th>
                          <th>Invoice Value</th>
                          <th>PO Value</th>
                          <th>Goods Receipt</th>
                          <th>Status</th>
                          <th>Resolution Action</th>
                        </tr>
                      </thead>
                      <tbody className="reveal-stagger">
                        {issues.map(item => (
                          <InvoiceComparisonRow
                            key={`${item.id || item.field}-${item.reason}`}
                            item={item}
                            currency={invoice.currency}
                            onResolve={(action, reason) => item.id && handleResolve(item.id, action, reason)}
                            onAutoHandle={item.id ? () => handleAutoHandle(item.id!) : undefined}
                            onCustomResolve={item.id ? () => setPromptModal({ id: item.id, field: item.field }) : undefined}
                            busy={discrepancyBusy === item.id || discrepancyBusy === "all"}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div style={{ padding: "20px", textAlign: "center", background: "rgba(43, 182, 115, 0.06)", borderRadius: "var(--radius-sm)" }}>
                  <CheckCircle2 size={32} color="#16a34a" style={{ margin: "0 auto 8px" }} />
                  <strong style={{ display: "block", color: "var(--navy)" }}>All Matching Rules Satisfied</strong>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: "13px" }}>
                    All 2-way and 3-way tolerances verified. This invoice is clear for approval.
                  </p>
                </div>
              )}

              {/* Resolved Discrepancies History */}
              {resolvedItems.length > 0 && (
                <details className="matched-fields" style={{ marginTop: "16px" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--navy)" }}>
                    Show resolved items ({resolvedItems.length})
                  </summary>
                  <div className="table-wrap" style={{ marginTop: "8px" }}>
                    <table className="comparison-table">
                      <thead>
                        <tr>
                          <th>Discrepancy / Field</th>
                          <th>Invoice</th>
                          <th>PO</th>
                          <th>Goods Receipt</th>
                          <th>Status</th>
                          <th>Resolution Note / Undo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resolvedItems.map(item => (
                          <InvoiceComparisonRow
                            key={`${item.id || item.field}-${item.reason}`}
                            item={item}
                            currency={invoice.currency}
                            onReopen={item.id ? () => handleReopen(item.id!) : undefined}
                            busy={discrepancyBusy === item.id}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </section>

            {/* PO Suggestions */}
            {invoice.status === "needs_review" && !invoice.po_number_raw && candidates.length > 0 && (
              <div className="suggestion-card">
                <small>SUGGESTED PURCHASE ORDER</small>
                <h3>
                  This invoice matches {candidates[0].po_number} ({candidates[0].vendor_name || "vendor"}, amount, items — {Math.round(candidates[0].score)}% match). Match this PO?
                </h3>
                <p>Matched signals: vendor, total amount, and item descriptions.</p>
                <div>
                  <button className="primary" onClick={() => onMatch(candidates[0], true)}>
                    Yes, match this PO
                  </button>
                  <button className="secondary" onClick={() => onMatch(candidates[0], false)}>
                    No
                  </button>
                </div>
              </div>
            )}

            {invoice.status === "needs_review" && !invoice.po_number_raw && !candidates.length && (
              <p className="muted" style={{ fontSize: "13px", marginTop: "12px" }}>
                No purchase order match found for this invoice.
              </p>
            )}

            {hasNoReceipt && invoice.status === "needs_review" && (
              <div className="notice info" style={{ marginTop: "12px" }}>
                No goods receipt was found. You can hold this invoice while waiting for delivery, approve with an exception (2-way match), or reject it.
              </div>
            )}
          </>
        )}

        {/* TAB 2: LINE ITEMS & QUANTITIES */}
        {activeTab === "lines" && (
          <section className="extracted-section scroll-reveal">
            <h3 className="section-title" style={{ margin: "0 0 12px", fontSize: "16px" }}>
              Extracted Line Items ({(invoice.line_items || []).length})
            </h3>
            {(invoice.line_items || []).length > 0 ? (
              <div className="table-wrap scroll-reveal">
                <table className="line-items-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Description / Item Code</th>
                      <th style={{ textAlign: "right" }}>Quantity</th>
                      <th style={{ textAlign: "right" }}>Unit Price</th>
                      <th style={{ textAlign: "right" }}>Line Total</th>
                      <th>Arithmetic Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.line_items!.map((line, index) => {
                      const qty = Number(line.qty);
                      const price = Number(line.unit_price);
                      const amount = Number(line.line_amount || line.amount);
                      const expectedAmount = Number.isFinite(qty) && Number.isFinite(price) ? qty * price : null;
                      const hasVariance = expectedAmount != null && Number.isFinite(amount) && Math.abs(amount - expectedAmount) > 0.02;

                      return (
                        <tr key={index}>
                          <td style={{ color: "var(--text-secondary)", fontSize: "12px" }}>{index + 1}</td>
                          <td>
                            <strong>{line.description || line.item_code || `Line ${index + 1}`}</strong>
                            {line.item_code && line.description && (
                              <small className="muted" style={{ display: "block" }}>
                                Code: {line.item_code}
                              </small>
                            )}
                          </td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {line.qty == null || !Number.isFinite(qty) ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(qty)}
                          </td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {line.unit_price == null ? "—" : formatInvoiceMoney(line.unit_price, invoice.currency)}
                          </td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            <strong>{line.line_amount == null && line.amount == null ? "—" : formatInvoiceMoney(line.line_amount ?? line.amount, invoice.currency)}</strong>
                          </td>
                          <td>
                            {hasVariance ? (
                              <span className="discrepancy-badge mismatch" style={{ fontSize: "10px" }}>
                                ⚠️ Variance
                              </span>
                            ) : (
                              <span className="discrepancy-badge match" style={{ fontSize: "10px" }}>
                                ✓ Verified
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No line items extracted for this invoice.</p>
            )}
          </section>
        )}

        {/* TAB 3: INVOICE DATA & SOURCE FILE */}
        {activeTab === "details" && (
          <>
            <section className="extracted-section scroll-reveal">
              <h3 className="section-title" style={{ margin: "0 0 12px", fontSize: "16px" }}>
                Invoice Financial Summary
              </h3>
              <div className="field-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: "16px" }}>
                <div className="field">
                  <span>Subtotal</span>
                  <strong>{invoice.subtotal == null ? "—" : formatInvoiceMoney(invoice.subtotal, invoice.currency)}</strong>
                </div>
                <div className="field">
                  <span>Tax Amount</span>
                  <strong>{invoice.tax_amount == null ? "—" : formatInvoiceMoney(invoice.tax_amount, invoice.currency)}</strong>
                </div>
                <div className="field" style={{ background: "rgba(255, 244, 239, 0.5)" }}>
                  <span>Total Amount</span>
                  <strong style={{ color: "var(--orange-hover)", fontSize: "18px" }}>
                    {invoice.total_amount == null ? "—" : formatInvoiceMoney(invoice.total_amount, invoice.currency)}
                  </strong>
                </div>
              </div>

              <h3 className="section-title" style={{ margin: "16px 0 12px", fontSize: "16px" }}>
                Extracted Header Fields
              </h3>
              <div className="field-grid">
                {labels.map(([label, keys]) => {
                  const value = keys.map(key => invoice[key]).find(item => item != null && item !== "");
                  if (value == null || (typeof value !== "string" && typeof value !== "number")) return null;
                  const shown = ["invoice_date", "due_date"].includes(String(keys[0])) ? dateLabel(String(value)) : String(value);
                  return <DetailField key={label} label={label} value={shown} />;
                })}
              </div>
            </section>

            {invoice.source === "email" && (
              <section className="extracted-section scroll-reveal">
                <h3 className="section-title" style={{ margin: "0 0 12px", fontSize: "16px" }}>
                  Email Provenance
                </h3>
                <div className="field-grid">
                  <DetailField label="Sender" value={invoice.email_sender} />
                  <DetailField label="Subject" value={invoice.email_subject} />
                  <DetailField label="Received At" value={invoice.received_at ? dateTimeLabel(invoice.received_at) : undefined} />
                </div>
              </section>
            )}

            {invoice.source_document_id && (
              <section className="extracted-section" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <strong style={{ display: "block", color: "var(--navy)" }}>Original Document File</strong>
                  <small className="muted">View or download the source PDF/scan for audit reference.</small>
                </div>
                <div style={{ display: "inline-flex", gap: "8px" }}>
                  {_onViewOriginal && (
                    <Button variant="secondary" onClick={() => _onViewOriginal(invoice.source_document_id)}>
                      <Eye size={14} /> View Document
                    </Button>
                  )}
                  {_onDownloadOriginal && (
                    <Button variant="secondary" onClick={() => _onDownloadOriginal(invoice.source_document_id)}>
                      <Download size={14} /> Download
                    </Button>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Custom Reason Prompt Modal */}
      {promptModal && (
        <div className="modal-backdrop prompt-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setPromptModal(null); }}>
          <div className="modal" style={{ maxWidth: "450px" }} role="dialog">
            <header className="modal-head">
              <div>
                <span className="eyebrow purple">DISCREPANCY RESOLUTION</span>
                <h2>{promptModal.isAll ? "Resolve All Discrepancies" : `Resolve ${humanize(promptModal.field || "Issue")}`}</h2>
              </div>
              <button className="modal-close" type="button" onClick={() => setPromptModal(null)}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <label className="form-label">
                Resolution explanation
                <textarea
                  value={customReasonText}
                  onChange={e => setCustomReasonText(e.target.value)}
                  placeholder="Enter justification (e.g. verified with vendor / PO adjustment)"
                  rows={3}
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setPromptModal(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!customReasonText.trim()}
                  onClick={() => {
                    const reason = customReasonText.trim();
                    setPromptModal(null);
                    setCustomReasonText("");
                    if (promptModal.isAll) {
                      void handleResolveAll(reason);
                    } else if (promptModal.id) {
                      void handleResolve(promptModal.id, "resolve", reason);
                    }
                  }}
                >
                  Confirm Resolution
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Bottom Drawer Action Footer */}
      <footer className="drawer-footer-actions">
        <div className="drawer-footer-left">
          <small className="muted">Esc to close</small>
        </div>
        <div className="drawer-footer-right">
          <button className="secondary" onClick={() => onDecision("hold")} disabled={invoice.status === "rejected"}>
            Hold
          </button>
          <button className="danger-button" onClick={() => onDecision("reject")} disabled={invoice.status === "rejected"}>
            Reject
          </button>
          {invoice.status === "needs_review" && (
            <button className="primary" onClick={() => onDecision("approve-exception")}>
              Approve with Exception
            </button>
          )}
          {invoice.status === "ready_to_pay" && (
            <button className="primary btn-approve-success" onClick={() => onDecision("approve")}>
              <CheckCircle2 size={16} /> Approve Invoice
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
