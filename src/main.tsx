import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { AnimatePresence, domAnimation, LazyMotion, m as motion, useReducedMotion } from "framer-motion";
import { createAuthSession } from "./authSession";
import { DashboardWorkspace } from "./components/DashboardWorkspace";
import { EmailInboxWorkspace, type EmailPollMessage, type EmailPollStatus } from "./components/EmailInboxWorkspace";
import { Avatar, Badge, Button, Card, EmptyState, Skeleton } from "./components/ui";
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
  email_received_at?: string | null; email_message_id?: string | null;
};
type PageResponse<T> = { items?: T[]; total?: number; page?: number; page_size?: number };
type InvoiceItem = { invoice_id: string; source_document_id?: string | null; source?: string | null; email_sender?: string | null; email_subject?: string | null; invoice_no?: string | null; vendor_name?: string | null; invoice_date?: string | null; due_date?: string | null; total_amount?: number | string | null; currency?: string | null; status: "processing" | "needs_review" | "ready_to_pay" | "on_hold" | "rejected" };
type InvoiceDetail = InvoiceItem & { vendor_id?: string | null; vendor_tax_id?: string | null; subtotal?: number | string | null; tax_amount?: number | string | null; po_number_raw?: string | null; payment_terms?: unknown; line_items?: { description?: string | null; item_code?: string | null; qty?: number | string | null; unit_price?: number | string | null; amount?: number | string | null }[]; discrepancies?: { field: string; invoice_value?: unknown; po_value?: unknown; gr_value?: unknown; severity: string; resolved?: boolean; reason?: string | null }[] };
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
  if (processingStatuses.has(status)) return "Processing";
  if (["extracted", "parsed", "processed", "match_approved", "approved"].includes(status)) return "Ready";
  if (status === "failed") return "Failed";
  if (["needs_attention", "ignored", "incomplete", "needs_vendor_review", "duplicate_blocked", "match_issues"].includes(status)) return "Needs attention";
  return "Processing";
}
function isProcessing(value?: string | null) { return processingStatuses.has((value || "").toLowerCase()); }
function statusClass(value?: string | null) {
  const s = (value || "unknown").toLowerCase();
  if (["failed", "rejected", "overdue", "match_issues", "no_match"].includes(s)) return "danger";
  if (["approved", "paid", "match_approved", "processed", "extracted", "parsed", "ready_to_pay"].includes(s)) return "success";
  if (processingStatuses.has(s) || ["verifying", "resubmitted", "on_hold"].includes(s)) return "pending";
  return "neutral";
}
function dateLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function App() {
  const reducedMotion = useReducedMotion();
  const [activePage, setActivePage] = useState<"dashboard" | "documents" | "invoices" | "associates" | "email-inbox">("dashboard");
  const [globalSearch, setGlobalSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
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
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceItem["status"] | "all">("all");
  const [invoiceSource, setInvoiceSource] = useState<"all" | "upload" | "email">("all");
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
  const [docSource, setDocSource] = useState<"latest" | "email" | "all">("latest");
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [emailPollStatus, setEmailPollStatus] = useState<EmailPollStatus | null>(null);
  const [emailPollMessages, setEmailPollMessages] = useState<EmailPollMessage[]>([]);
  const [emailPollBusy, setEmailPollBusy] = useState(false);
  const loadedEmailInvoiceIds = useRef<Set<string> | null>(null);

  const notify = useCallback((text: string, kind: "success" | "error" | "info" = "info") => {
    setToast({ text, kind });
  }, []);
  const clearSession = useCallback(() => {
    authSession.clear(); setToken(""); setProfile(null); setActivePage("dashboard"); setMustChangePassword(false); setProfileLoading(false); setDocuments([]); setSelectedDoc(null); setAssociateCredential(null);
  }, []);
  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${authSession.getAccessToken()}` }), []);

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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setCommandOpen(value => !value);
      } else if (event.key === "Escape") { setCommandOpen(false); setAvatarMenuOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadDocuments = useCallback(async (nextPage = docPage) => {
    if (!token) return;
    setDocLoading(true); setDocError("");
    try {
      const query = new URLSearchParams({ page: String(nextPage), page_size: "50" });
      if (docSource === "email") query.set("source", "email");
      if (docSource === "latest") query.set("source", "upload");
      if (docStatus !== "all" && !["processing", "ready"].includes(docStatus)) query.set("status", docStatus);
      if (docType !== "all") query.set("doc_type", docType);
      const response = await axios.get<PageResponse<Doc> | Doc[]>(`${CORE_URL}/api/documents?${query}`, { headers: authHeaders() });
      const data = response.data;
      const items = Array.isArray(data) ? data : data.items || [];
      const visibleItems = docSource === "latest" && recentBatchIds.length > 0 ? items.filter(item => recentBatchIds.includes(item.id)) : items;
      setDocuments(visibleItems); setDocTotal(docSource === "latest" && recentBatchIds.length > 0 ? recentBatchIds.length : (Array.isArray(data) ? items.length : data.total ?? items.length));
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
      const [list, ...counts] = await Promise.all([
        axios.get<PageResponse<InvoiceItem>>(`${CORE_URL}/api/invoices?page=1&page_size=100`, { headers: authHeaders() }),
        ...invoiceStatuses.map(status => axios.get<PageResponse<InvoiceItem>>(`${CORE_URL}/api/invoices?status=${status}&page=1&page_size=1`, { headers: authHeaders() })),
      ]);
      const nextInvoices = list.data.items || [];
      const emailIds = new Set(nextInvoices.filter(invoice => invoice.source === "email").map(invoice => invoice.invoice_id));
      const previousIds = loadedEmailInvoiceIds.current;
      if (previousIds && [...emailIds].some(id => !previousIds.has(id))) notify("A new invoice arrived by email.", "success");
      loadedEmailInvoiceIds.current = emailIds;
      setInvoices(nextInvoices);
      setInvoiceCounts(Object.fromEntries(invoiceStatuses.map((status, index) => [status, counts[index].data.total || 0])) as Record<InvoiceItem["status"], number>);
    } catch (error) { setInvoiceError(getError(error, "Could not load invoices.")); }
    finally { setInvoiceLoading(false); }
  }, [token, authHeaders, notify]);

  const loadEmailInbox = useCallback(async () => {
    if (!token || profile?.role !== "admin") return;
    try {
      const [statusResponse, messagesResponse] = await Promise.all([
        axios.get<EmailPollStatus>(`${CORE_URL}/api/email-polling/status`, { headers: authHeaders() }),
        axios.get<EmailPollMessage[]>(`${CORE_URL}/api/email-polling/messages?limit=100`, { headers: authHeaders() }),
      ]);
      setEmailPollStatus(statusResponse.data);
      setEmailPollMessages(messagesResponse.data);
    } catch (error) { notify(getError(error, "Could not load the email inbox status."), "error"); }
  }, [token, profile?.role, authHeaders, notify]);

  async function pollEmailNow() {
    setEmailPollBusy(true);
    try {
      await axios.post(`${CORE_URL}/api/email-polling/run`, {}, { headers: authHeaders() });
      notify("Email poll finished.", "success");
      await Promise.all([loadEmailInbox(), loadInvoices(), loadDocuments(1)]);
    } catch (error) { notify(getError(error, "Could not run the email poll."), "error"); }
    finally { setEmailPollBusy(false); }
  }

  async function retryEmailMessage(message: EmailPollMessage) {
    try {
      await axios.post(`${CORE_URL}/api/email-polling/messages/${message.id}/retry`, {}, { headers: authHeaders() });
      notify("Email reprocessing has been queued.", "success");
      await loadEmailInbox();
    } catch (error) { notify(getError(error, "Could not retry this email."), "error"); }
  }

  useEffect(() => { if (token && !profileLoading && !mustChangePassword) void loadDocuments(1); }, [token, profileLoading, mustChangePassword, docStatus, docType, docSource]);
  useEffect(() => {
    if (!token || profileLoading || mustChangePassword || (!documents.some(doc => isProcessing(doc.status)) && !invoices.some(invoice => invoice.status === "processing"))) return;
    const timer = window.setInterval(() => { void loadDocuments(docPage); void loadInvoices(); }, 5000);
    return () => window.clearInterval(timer);
  }, [token, profileLoading, mustChangePassword, documents, invoices, docPage, loadDocuments, loadInvoices]);
  useEffect(() => { if (activePage === "associates") void loadAssociates(); }, [activePage, loadAssociates]);
  useEffect(() => { if (token && !profileLoading && !mustChangePassword) void loadInvoices(); }, [token, profileLoading, mustChangePassword, loadInvoices]);
  useEffect(() => { if (activePage === "email-inbox" || activePage === "dashboard") void loadEmailInbox(); }, [activePage, loadEmailInbox]);
  useEffect(() => {
    if (!token || profile?.role !== "admin") return;
    const timer = window.setInterval(() => { void loadEmailInbox(); }, 30000);
    return () => window.clearInterval(timer);
  }, [token, profile?.role, loadEmailInbox]);

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
      notify("Temporary password copied to clipboard.", "success");
    } catch { notify("Could not access the clipboard. Select and copy the password manually.", "error"); }
  }

  async function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files || []); event.target.value = "";
    await uploadChosenFiles(chosen);
  }

  async function uploadChosenFiles(chosen: File[]) {
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

  const filteredDocs = useMemo(() => documents.filter(doc => {
    const q = `${docSearch} ${globalSearch}`.trim().toLowerCase();
    const actualType = String(doc.doc_type || (doc.extracted_json?.document_type as string | undefined) || "").toLowerCase();
    const matchesSearch = !q || [doc.original_filename, doc.id, actualType, doc.email_sender].some(value => String(value || "").toLowerCase().includes(q));
    const matchesType = docType === "all" || actualType === docType;
    const matchesStatus = docStatus === "all" || (docStatus === "processing" ? isProcessing(doc.status) : docStatus === "ready" ? ["parsed", "extracted", "processed"].includes(doc.status.toLowerCase()) : doc.status === docStatus);
    return matchesSearch && matchesType && matchesStatus;
  }), [documents, docSearch, globalSearch, docType, docStatus]);
  const docCounts = useMemo(() => ({ processing: documents.filter(d => ["received", "reading", "parsing", "parsed", "classified", "matching"].includes(d.status)).length, completed: documents.filter(d => ["extracted", "processed", "match_approved", "approved"].includes(d.status)).length, attention: documents.filter(d => ["failed", "needs_vendor_review", "incomplete", "match_issues"].includes(d.status)).length }), [documents]);

  if (restoring && !token) return <main className="session-screen"><Loader title="Restoring secure session" subtitle="Checking your sign-in sessionâ€¦" /></main>;
  if (!token) return <main className="auth-shell page-enter">
    <section className="auth-hero"><div className="brand brand-light"><span className="brand-mark">G</span><span>GENWORX<small>FINANCE AUTOMATION</small></span></div><div className="hero-copy"><span className="eyebrow">ACCOUNTS PAYABLE WORKSPACE</span><h1>Clarity for every<br /><em>invoice and document.</em></h1><p>Bring your documents together, track invoice progress, and spot issues without losing sight of the source evidence.</p><div className="hero-points"><span>âœ“ Secure workspace</span><span>âœ“ Clear processing status</span><span>âœ“ Human-reviewed decisions</span></div></div><div className="hero-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-file">â–¤</div><span className="orbit-dot dot-one"/><span className="orbit-dot dot-two"/><span className="orbit-dot dot-three"/></div></section>
    <section className="auth-side"><form className="auth-card" onSubmit={submitAuth}><span className="eyebrow purple">WELCOME TO GENWORX</span><h2>Sign in to your workspace</h2><p className="muted">Use the work email and password provided by your administrator.</p>
      <label className="form-label">Work email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" /></label>
      <label className="form-label">Password<span className="password-control"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} minLength={1} required placeholder="Enter your password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label>
      {loginError && <div key={loginError} className="login-error form-error-shake" role="alert">{loginError}</div>}
      <button className="primary full" disabled={authBusy}>{authBusy ? <><span className="mini-spin"/> Please waitâ€¦</> : "Sign in â†’"}</button>
      <p className="security-note"><span>â—</span> Your session is handled securely by GenWorx Auth.</p></form></section>
  </main>;

  if (profileLoading) return <main className="session-screen"><Loader title="Loading your workspace" subtitle="Checking your account permissionsâ€¦" /></main>;
  if (mustChangePassword) return <main className="auth-shell set-password-shell page-enter"><AuthBrandPanel/><section className="auth-side"><form className="auth-card" onSubmit={submitPasswordChange}><span className="eyebrow purple">SECURE YOUR ACCOUNT</span><h2>Change your temporary password</h2><p className="muted">Your administrator issued a temporary password. Set a new password before continuing. Use at least 12 characters with an uppercase letter, lowercase letter, number, and symbol.</p>{profile?.temp_password_expires_at && <p className="muted">Temporary password expires {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(profile.temp_password_expires_at))}.</p>}<label className="form-label">Temporary password<span className="password-control"><input type={showCurrentPassword ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required /><button type="button" aria-label={showCurrentPassword ? "Hide temporary password" : "Show temporary password"} onClick={() => setShowCurrentPassword(value => !value)}>{showCurrentPassword ? "Hide" : "Show"}</button></span></label><label className="form-label">New password<span className="password-control"><input type={showNewPassword ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={12} maxLength={128} required /><button type="button" aria-label={showNewPassword ? "Hide new password" : "Show new password"} onClick={() => setShowNewPassword(value => !value)}>{showNewPassword ? "Hide" : "Show"}</button></span></label><PasswordStrength value={newPassword}/><label className="form-label">Confirm new password<span className="password-control"><input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={12} maxLength={128} required /><button type="button" aria-label={showConfirmPassword ? "Hide confirmation" : "Show confirmation"} onClick={() => setShowConfirmPassword(value => !value)}>{showConfirmPassword ? "Hide" : "Show"}</button></span></label><button className="primary full" disabled={authBusy}>{authBusy ? "Savingâ€¦" : "Change password and continue"}</button><button className="secondary full" type="button" onClick={() => void logout()} disabled={authBusy}>Sign out</button></form></section></main>;

  return <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-brand-row"><div className="brand"><span className="brand-mark">G</span><span className="brand-wordmark">GENWORX<small>FINANCE AUTOMATION</small></span></div><button className="nav-toggle" aria-label="Toggle navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}>â˜°</button><button className="sidebar-collapse" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={sidebarCollapsed} onClick={() => setSidebarCollapsed(value => !value)}>â€¹</button></div>
      <p className="side-label">WORKSPACE</p>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={activePage === "dashboard" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("dashboard"); setMobileNavOpen(false); }}><span className="nav-icon">â–¦</span><span>Dashboard</span></button>
        <button className={activePage === "documents" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("documents"); setMobileNavOpen(false); }}><span className="nav-icon">â–¤</span><span>Documents</span><b>{docTotal}</b></button>
        <button className={activePage === "invoices" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("invoices"); setMobileNavOpen(false); }}><span className="nav-icon">ï¼„</span><span>Invoices</span><b>{Object.values(invoiceCounts).reduce((sum, count) => sum + count, 0)}</b></button>
        {profile?.role === "admin" && <button className={activePage === "associates" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("associates"); setMobileNavOpen(false); }}><span className="nav-icon">â™™</span><span>Associates</span></button>}
        {profile?.role === "admin" && <button className={activePage === "email-inbox" ? "nav-item nav-active" : "nav-item"} onClick={() => { setActivePage("email-inbox"); setMobileNavOpen(false); }}><span className="nav-icon">âœ‰</span><span>Email inbox</span><b>{(emailPollStatus?.counts?.failed || 0) + (emailPollStatus?.counts?.needs_attention || 0)}</b></button>}
      </nav>
      <div className="sidebar-bottom"><div className="profile"><span className="avatar">{(email[0] || "U").toUpperCase()}</span><div><b>{profile?.name || email || "Workspace user"}</b><small>{email}</small><em className="role-chip">{profile?.role || "user"}</em></div></div><button className="signout" onClick={() => void logout()} disabled={authBusy}>â†ª <span>Sign out</span></button></div>
    </aside>
    <main className="main-area"><header className="topbar"><button className="topbar-nav-toggle" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}>â˜°</button><div className="topbar-title"><span className="muted">Workspace</span><span className="breadcrumb-separator">/</span><b>{activePage === "associates" && profile?.role === "admin" ? "Associates" : activePage === "email-inbox" ? "Email inbox" : activePage === "invoices" ? "Invoices" : activePage === "documents" ? "Documents" : "Dashboard"}</b></div><label className="topbar-search"><span aria-hidden="true">âŒ•</span><input value={globalSearch} onChange={event => setGlobalSearch(event.target.value)} placeholder="Search invoices or documents" aria-label="Search invoices or documents" /><kbd>Ctrl K</kbd></label><button className="topbar-bell" aria-label={`${invoiceCounts.needs_review} invoices need review`} onClick={() => { setActivePage("invoices"); setInvoiceStatus("needs_review"); }}><span aria-hidden="true">â™§</span>{invoiceCounts.needs_review > 0 && <b>{invoiceCounts.needs_review}</b>}</button><div className="avatar-menu-wrap"><button className="topbar-user" aria-label="Open account menu" aria-expanded={avatarMenuOpen} onClick={() => setAvatarMenuOpen(value => !value)}><span className="avatar">{(email[0] || "U").toUpperCase()}</span><span className="topbar-user-email">{profile?.name || email}</span><span aria-hidden="true">âŒ„</span></button>{avatarMenuOpen && <div className="avatar-menu" role="menu"><span className="avatar-menu-email">{email}</span><span className="avatar-menu-role">{profile?.role || "user"}</span><button role="menuitem" onClick={() => void logout()} disabled={authBusy}>Sign out</button></div>}</div></header>
      <div className="content">
      <AnimatePresence mode="wait" initial={false}><motion.div key={activePage} className="page-transition" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: reducedMotion ? 0 : .2, ease: "easeOut" }}>
      {activePage === "invoices" ? <InvoicesWorkspace invoices={invoices} counts={invoiceCounts} status={invoiceStatus} onStatus={setInvoiceStatus} source={invoiceSource} onSource={setInvoiceSource} loading={invoiceLoading} error={invoiceError} onRefresh={() => void loadInvoices()} search={globalSearch} onOpen={invoice => void openInvoice(invoice.invoice_id)} /> : activePage === "associates" && profile?.role === "admin" ? <>
        <section className="panel admin-associate-panel">
          <div className="panel-head"><div><span className="eyebrow purple">ADMINISTRATION</span><h2>Add an associate</h2><p className="muted">Temporary password is valid for 24 hours. The associate must change it at first sign in.</p></div></div>
          <form className="toolbar" onSubmit={createAssociate}>
            <label className="form-label">Name<input value={associateName} onChange={e => setAssociateName(e.target.value)} minLength={2} maxLength={150} required /></label>
            <label className="form-label">Email<input type="email" value={associateEmail} onChange={e => setAssociateEmail(e.target.value)} required /></label>
            <label className="form-label">Temporary password (optional)<input type="password" value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} minLength={12} maxLength={128} /></label>
            <button className="primary" disabled={authBusy}>{authBusy ? "Creatingâ€¦" : "Add associate"}</button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>Associates</h2><p className="muted">Active associate accounts</p></div><span className="count">{associates.filter(item => item.is_active).length} people</span></div>
          <div className="toolbar"><button className="secondary" onClick={() => void loadAssociates()} disabled={associatesLoading}>{associatesLoading ? "Loadingâ€¦" : "Refresh list"}</button></div>
          {associatesError && <div className="notice error">{associatesError}<button onClick={() => void loadAssociates()}>Try again</button></div>}
          {associatesLoading ? <LoadingPanel title="Loading associates" subtitle="Retrieving active accountsâ€¦"/> : associates.filter(item => item.is_active).length ? <div className="table-wrap"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>ADDED</th><th></th></tr></thead><tbody>{associates.filter(item => item.is_active).map(associate => <tr key={associate.id}><td><span className="vendor-cell"><Avatar name={associate.name}/><b>{associate.name}</b><Badge tone="blue">Associate</Badge></span></td><td>{associate.email}</td><td>{dateLabel(associate.created_at)}</td><td className="associate-actions"><button className="secondary" onClick={() => void resetAssociatePassword(associate)} disabled={authBusy}>Reset password</button><button className="secondary" onClick={() => void removeAssociate(associate)}>Remove access</button></td></tr>)}</tbody></table></div> : <EmptyState title="No associates yet" description="Add an associate using the form above."/>}
        </section>
      </> : activePage === "email-inbox" && profile?.role === "admin" ? <EmailInboxWorkspace status={emailPollStatus} messages={emailPollMessages} busy={emailPollBusy} onPoll={() => void pollEmailNow()} onRetry={message => void retryEmailMessage(message)} dateLabel={dateLabel} /> : activePage === "dashboard" ? <DashboardWorkspace invoices={invoices} counts={invoiceCounts} loading={invoiceLoading} error={invoiceError} search={globalSearch} name={profile?.name || email.split("@")[0] || "there"} onOpen={invoice => void openInvoice(invoice.invoice_id)} onInvoices={() => setActivePage("invoices")} onReview={() => { setActivePage("invoices"); setInvoiceStatus("needs_review"); }} onDocuments={() => setActivePage("documents")} onRefresh={() => void loadInvoices()} formatMoney={formatInvoiceMoney} dateLabel={dateLabel} isAdmin={profile?.role === "admin"} emailStatus={emailPollStatus} emailAttentionCount={emailPollMessages.filter(message => ["failed", "failed_final", "needs_attention", "ignored"].includes(message.status)).length} onEmailInbox={() => setActivePage("email-inbox")} /> : <>
        <header className="welcome"><div><span className="eyebrow purple">FINANCE OPERATIONS</span><h1>Documents</h1><p className="muted">Upload, find, and monitor every document in one place.</p></div><label className={`primary upload upload-dropzone ${uploading ? "disabled" : ""} ${uploadDragging ? "is-dragging" : ""}`} onDragEnter={event => { event.preventDefault(); if (!uploading) setUploadDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setUploadDragging(false); }} onDrop={event => { event.preventDefault(); setUploadDragging(false); if (!uploading) void uploadChosenFiles(Array.from(event.dataTransfer.files)); }}><span>{uploadDragging ? "â†“" : "ï¼‹"}</span> {uploadDragging ? "Drop to upload" : uploading ? "Uploadingâ€¦" : "Upload documents"}<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.doc,.docx,.eml" onChange={uploadFiles} disabled={uploading} hidden /></label></header>
        {uploading && <div className="compact-upload-progress panel">
          <div className="compact-upload-status"><DocumentLoader/><span>Uploading documentsâ€¦ {uploadProgress}%</span></div>
          <div className="progress-track"><span style={{ width: `${uploadProgress}%` }}/></div>
        </div>}
        <section className="panel simple-documents">
          <div className="panel-head"><div><h2>Your documents</h2><p className="muted">Select any card to preview the document details.</p></div><span className="count">{docTotal} files</span></div>
          <div className="toolbar simple-toolbar">
            <label className="search"><span>âŒ•</span><input value={docSearch} onChange={e => setDocSearch(e.target.value)} placeholder="Search documentsâ€¦" /></label>
            <select value={docSource} onChange={e => { setDocPage(1); setDocSource(e.target.value as "latest" | "email" | "all"); }} aria-label="Filter by document source"><option value="latest">Latest upload</option><option value="email">Email</option><option value="all">All documents</option></select><select value={docType} onChange={e => { setDocPage(1); setDocType(e.target.value); }} aria-label="Filter by document type"><option value="all">All types</option><option value="invoice">Invoices</option><option value="po">Purchase orders</option><option value="goods_receipt">Goods receipts</option><option value="other">Other</option></select>
            <select value={docStatus} onChange={e => { setDocPage(1); setDocStatus(e.target.value); }} aria-label="Filter by document status"><option value="all">All statuses</option><option value="processing">Processing</option><option value="ready">Ready</option><option value="failed">Failed</option><option value="ignored">Ignored</option></select>
            <button className="icon-button" onClick={() => void loadDocuments(docPage)} disabled={docLoading} aria-label="Refresh documents">â†»</button>
          </div>
          {docError && <div className="notice error">{docError}<button onClick={() => void loadDocuments(docPage)}>Try again</button></div>}
          {docLoading ? <LoadingPanel title="Loading documents" subtitle="Syncing your latest uploadsâ€¦"/> : filteredDocs.length ? <>
            <div className="document-card-grid">{filteredDocs.map((doc, index) => <button type="button" className="document-card" key={doc.id} style={{ "--row-index": index } as React.CSSProperties} onClick={() => void openDocument(doc)}>
              <div className="document-card-top"><span className="file-badge">{(doc.original_filename.split(".").pop() || "FILE").slice(0, 4).toUpperCase()}</span><span className={`pill ${statusClass(doc.status)}`}><i/>{friendlyStatus(doc.status)}</span></div>
              <div className={`document-card-icon ${["parsed", "extracted", "processed"].includes(doc.status.toLowerCase()) ? "document-ready-icon" : ""}`}>{["parsed", "extracted", "processed"].includes(doc.status.toLowerCase()) ? "âœ“" : "â–¤"}</div>
              <strong title={doc.original_filename}>{doc.original_filename}</strong>
              <span className="document-source-line"><Badge tone={doc.source === "email" ? "blue" : "gray"}>{doc.source === "email" ? "Email" : "Upload"}</Badge>{doc.source === "email" && <small>{doc.email_sender || "Unknown sender"}{doc.email_subject ? ` · ${doc.email_subject}` : ""}</small>}</span>{doc.failure_message && <span className="document-failure-reason">{doc.failure_message}</span>}<span className="document-card-type">{humanize(doc.doc_type || (doc.extracted_json?.document_type as string | undefined) || "Document")}</span>
              {(doc.doc_type === "invoice" || doc.extracted_json?.document_type === "invoice") && doc.extracted_json && <span className="document-invoice-link" role="link" tabIndex={0} onClick={event => { event.stopPropagation(); setActivePage("invoices"); }} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); setActivePage("invoices"); } }}>View in Invoices â†’</span>}
              <span className="document-card-date">Uploaded {dateLabel(doc.created_at)}</span>
              <span className="document-card-preview">Preview details â†—</span>
            </button>)}</div>
            <Pagination page={docPage} total={docTotal} pageSize={50} loading={docLoading} onChange={next => { setDocPage(next); void loadDocuments(next); }}/>
          </> : <EmptyState title={docSearch || docType !== "all" || docStatus !== "all" ? "No matching documents" : "No documents uploaded yet"} description={docSearch || docType !== "all" || docStatus !== "all" ? "Try changing your search or filters." : "Choose files above to upload your first document."} action={(docSearch || docType !== "all" || docStatus !== "all") ? <button className="secondary" onClick={() => { setDocSearch(""); setDocType("all"); setDocStatus("all"); }}>Clear filters</button> : null}/>}
        </section>
      </>}
      </motion.div></AnimatePresence>
      <footer className="footer"><span>GENWORX AP Â· DOCUMENT WORKSPACE</span><span>Statuses and decisions are provided by AP-Core.</span></footer>
      </div>
    </main>
    {commandOpen && <div className="command-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCommandOpen(false); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Command menu"><div className="command-search"><span aria-hidden="true">âŒ•</span><input autoFocus value={globalSearch} onChange={event => setGlobalSearch(event.target.value)} placeholder="Search invoices or jump to a pageâ€¦" aria-label="Search invoices or jump to a page" /></div><p className="command-label">NAVIGATION</p>{(["dashboard", "documents", "invoices", ...(profile?.role === "admin" ? ["associates", "email-inbox"] : [])] as string[]).map(page => <button className="command-item" key={page} onClick={() => { setActivePage(page as typeof activePage); setCommandOpen(false); }}><span>{page === "dashboard" ? "â–¦" : page === "documents" ? "â–¤" : page === "invoices" ? "ï¼„" : "â™™"}</span><b>{page[0].toUpperCase() + page.slice(1)}</b><kbd>â†µ</kbd></button>)}<p className="command-hint">Tip: search filters invoices and documents as you type.</p></section></div>}
    {toast && <div className={`toast ${toast.kind}`} role="status"><span className="toast-symbol">{toast.kind === "success" ? "âœ“" : toast.kind === "error" ? "!" : "i"}</span><span>{toast.text}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}>Ã—</button></div>}
    {associateCredential && <div className="modal-backdrop credential-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAssociateCredential(null); }}><section className="modal credential-modal" role="dialog" aria-modal="true" aria-labelledby="credential-title"><header className="modal-head"><div><span className="eyebrow purple">TEMPORARY CREDENTIAL</span><h2 id="credential-title">Share with {associateCredential.email}</h2><p className="muted">This password is shown once. The associate must set a new password at sign in.</p></div><button className="modal-close" aria-label="Close" onClick={() => setAssociateCredential(null)}>Ã—</button></header><div className="modal-body"><label className="form-label">Temporary password<input className="credential-value" readOnly value={associateCredential.password} onFocus={event => event.currentTarget.select()} /></label><p className="muted">Expires {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(associateCredential.expiresAt))}.</p><div className="modal-actions"><button className="secondary" onClick={() => setAssociateCredential(null)}>Close</button><button className={`primary copy-button ${credentialCopied ? "copied" : ""}`} onClick={() => void copyAssociateCredential()}>{credentialCopied ? "âœ“ Copied" : "Copy password"}</button></div></div></section></div>}
    {selectedDoc && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedDoc(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header className="modal-head"><div><span className="eyebrow purple">RECORD DETAILS</span><h2 id="detail-title">{selectedDoc.original_filename}</h2></div><button className="modal-close" aria-label="Close details" onClick={() => setSelectedDoc(null)}>Ã—</button></header>
      {detailLoading ? <LoadingPanel title="Opening record" subtitle="Fetching the latest informationâ€¦"/> : modalError && <div className="notice error">{modalError}</div>}
      {selectedDoc && !detailLoading && <div className="modal-body"><div className="detail-summary"><span className={`pill ${statusClass(selectedDoc.status)}`}><i/>{friendlyStatus(selectedDoc.status)}</span><span className="pill neutral">{humanize(selectedDoc.doc_type)}</span><Badge tone={selectedDoc.source === "email" ? "blue" : "gray"}>{selectedDoc.source === "email" ? "Email" : "Upload"}</Badge></div>{selectedDoc.failure_message && <div className="notice error">{selectedDoc.failure_message}</div>}<div className="field-grid"><DetailField label="Uploaded" value={dateLabel(selectedDoc.created_at)}/><DetailField label="Last updated" value={dateLabel(selectedDoc.updated_at)}/><DetailField label="Email sender" value={selectedDoc.email_sender}/><DetailField label="Email subject" value={selectedDoc.email_subject}/><DetailField label="Email received" value={dateLabel(selectedDoc.email_received_at)}/></div><DocumentExtractedDetails doc={selectedDoc}/><div className="modal-actions"><button className="secondary" onClick={() => void openOriginalFile(selectedDoc)}>â†— Open original file</button>{selectedDoc.status.toLowerCase() === "failed" && <button className="primary" onClick={() => void retryDocument(selectedDoc)} disabled={detailLoading}>â†» Retry processing</button>}</div></div>}
    </section></div>}
    <AnimatePresence>{selectedInvoice && (
      <motion.div className="modal-backdrop drawer-backdrop" role="presentation" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reducedMotion ? undefined : { opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .18 }} onMouseDown={event => { if (event.target === event.currentTarget) setSelectedInvoice(null); }}>
        <InvoiceReviewDrawer
          invoice={selectedInvoice}
          candidates={matchCandidates}
          reducedMotion={reducedMotion}
          onClose={() => setSelectedInvoice(null)}
          onMatch={(candidate, accept) => { void confirmSuggestedMatch(candidate, accept); }}
          onDecision={action => { setDecision({ invoiceId: selectedInvoice.invoice_id, action, reason: "" }); }}
        />
      </motion.div>
    )}</AnimatePresence>
    {decision && <div className="modal-backdrop reason-backdrop" role="presentation"><form className="modal reason-modal" onSubmit={submitInvoiceDecision}><header className="modal-head"><div><span className="eyebrow purple">REVIEW DECISION</span><h2>{decision.action === "hold" ? "Place invoice on hold" : decision.action === "reject" ? "Reject invoice" : "Approve with exception"}</h2></div><button className="modal-close" type="button" onClick={() => setDecision(null)} aria-label="Cancel">Ã—</button></header><div className="modal-body"><label className="form-label">Reason<textarea value={decision.reason} onChange={event => setDecision({ ...decision, reason: event.target.value })} required minLength={3} maxLength={1000} rows={4} placeholder="Explain this decision" /></label><div className="modal-actions"><button className="secondary" type="button" onClick={() => setDecision(null)}>Cancel</button><button className="primary" type="submit">Save decision</button></div></div></form></div>}
    {uploadResult && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setUploadResult(null); }}><section className="modal results-modal" role="dialog" aria-modal="true" aria-labelledby="upload-result-title"><header className="modal-head"><div><span className="eyebrow purple">UPLOAD SUMMARY</span><h2 id="upload-result-title">{uploadResult.successes} of {uploadResult.total} files uploaded</h2><p className="muted">Each result below comes from the upload request.</p></div><button className="modal-close" onClick={() => setUploadResult(null)} aria-label="Close upload summary">Ã—</button></header><div className="modal-body"><div className="outcome-list">{uploadResult.outcomes.map((outcome, index) => <div className="outcome-row" key={`${outcome.name}-${index}`}><span className={`outcome-icon ${outcome.ok ? "ok" : "bad"}`}>{outcome.ok ? "âœ“" : "!"}</span><div><b>{outcome.name}</b><small>{outcome.message}</small></div></div>)}</div><div className="modal-actions"><button className="secondary" onClick={() => setUploadResult(null)}>Close</button><button className="primary" onClick={() => setUploadResult(null)}>View documents</button></div></div></section></div>}
  </div>;
}
function Loader({ title, subtitle }: { title: string; subtitle: string }) { return <div className="loader-screen"><DocumentLoader/><h2>{title}</h2><p>{subtitle}</p></div>; }
function DocumentLoader() { return <span className="document-loader" aria-hidden="true"><span className="loader-orbit orbit-a"/><span className="loader-orbit orbit-b"/><span className="loader-paper"><i/><i/><i/></span><span className="loader-point point-a"/><span className="loader-point point-b"/></span>; }
function LoadingPanel({ title, subtitle }: { title: string; subtitle: string }) { return <div className="loading-panel" role="status"><div className="skeleton-copy"><Skeleton/><Skeleton/><span><b>{title}</b> Â· {subtitle}</span></div><div className="skeleton-lines"><Skeleton/><Skeleton/><Skeleton/></div></div>; }
function AuthBrandPanel() { return <section className="auth-hero"><div className="brand brand-light"><span className="brand-mark">G</span><span>GENWORX<small>FINANCE AUTOMATION</small></span></div><div className="hero-copy"><span className="eyebrow">ACCOUNTS PAYABLE WORKSPACE</span><h1>Clarity for every<br/><em>invoice and document.</em></h1><p>Bring your documents together, track invoice progress, and resolve exceptions with confidence.</p><div className="hero-points"><span>âœ“ Secure workspace</span><span>âœ“ Clear processing status</span><span>âœ“ Human-reviewed decisions</span></div></div><div className="hero-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-file">â–¤</div><span className="orbit-dot dot-one"/><span className="orbit-dot dot-two"/><span className="orbit-dot dot-three"/></div></section>; }
function PasswordStrength({ value }: { value: string }) { const score = [value.length >= 12, /[A-Z]/.test(value), /[a-z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length; const label = !value ? "Use a strong password" : score < 3 ? "Weak" : score < 5 ? "Good" : "Strong"; return <div className={`password-strength strength-${score}`} aria-live="polite"><div className="strength-bars" aria-hidden="true">{[1, 2, 3, 4, 5].map(level => <i key={level} className={score >= level ? "filled" : ""}/>)}</div><span>{label}</span></div>; }
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
  return <div className="field"><span>{label}</span><strong>{String(value)}{verify && <small className="verify-warning" title="Please verify" aria-label="Please verify"> âš  Please verify</small>}</strong></div>;
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
      return <tr key={index}><td>{description == null ? "" : String(description)}{description != null && confidenceFor(line, ["description", "item_description"]) && <small className="verify-warning"> âš  Please verify</small>}</td><td>{formatQuantity(quantity) || ""}{quantity != null && confidenceFor(line, ["qty", "quantity"]) && <small className="verify-warning"> âš  Please verify</small>}</td><td>{formatAmount(price) || ""}{price != null && confidenceFor(line, ["unit_price"]) && <small className="verify-warning"> âš  Please verify</small>}</td><td>{formatAmount(amount) || ""}{amount != null && confidenceFor(line, ["amount", "line_amount", "line_total"]) && <small className="verify-warning"> âš  Please verify</small>}</td></tr>;
    })}</tbody></table></div></section>}
    {!invoicePresent && !amountFields.some(field => pick(source, field.keys) !== undefined) && !lines.length && <p className="muted">No invoice details are available yet.</p>}
  </div>;
}
function Pagination({ page, total, pageSize, loading, onChange }: { page: number; total: number; pageSize: number; loading: boolean; onChange: (page: number) => void }) { const pages = Math.max(1, Math.ceil(total / pageSize)); return <div className="pagination"><span>Showing page <b>{page}</b> of <b>{pages}</b> Â· {total} records</span><div><button className="secondary" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>â† Previous</button><button className="secondary" disabled={loading || page >= pages} onClick={() => onChange(page + 1)}>Next â†’</button></div></div>; }

const invoiceStatuses: InvoiceItem["status"][] = ["processing", "needs_review", "ready_to_pay", "on_hold", "rejected"];
const invoiceStatusLabels: Record<InvoiceItem["status"], string> = { processing: "In progress", needs_review: "Needs review", ready_to_pay: "Ready to pay", on_hold: "On hold", rejected: "Rejected" };
function invoiceStatusClass(status: InvoiceItem["status"]) { return ({ processing: "invoice-status-processing", needs_review: "invoice-status-review", ready_to_pay: "invoice-status-ready", on_hold: "invoice-status-hold", rejected: "invoice-status-rejected" })[status]; }
function invoiceStatusTone(status: InvoiceItem["status"]): "blue" | "amber" | "green" | "gray" | "red" { return ({ processing: "blue", needs_review: "amber", ready_to_pay: "green", on_hold: "gray", rejected: "red" } as const)[status]; }
function InvoicesWorkspace({ invoices, counts, status, onStatus, loading, error, search, source, onSource, onRefresh, onOpen }: { invoices: InvoiceItem[]; counts: Record<InvoiceItem["status"], number>; status: InvoiceItem["status"] | "all"; onStatus: (status: InvoiceItem["status"] | "all") => void; loading: boolean; error: string; search: string; source: "all" | "upload" | "email"; onSource: (source: "all" | "upload" | "email") => void; onRefresh: () => void; onOpen: (invoice: InvoiceItem) => void }) {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const statusFiltered = (status === "all" ? invoices : invoices.filter(invoice => invoice.status === status)).filter(invoice => source === "all" || (source === "email" ? invoice.source === "email" : invoice.source !== "email"));
  const query = search.trim().toLowerCase();
  const visible = statusFiltered.filter(invoice => !query || `${invoice.vendor_name || ""} ${invoice.invoice_no || ""} ${invoice.status} ${invoice.email_sender || ""} ${invoice.email_subject || ""}`.toLowerCase().includes(query));
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageInvoices = visible.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [status, search]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  return <><header className="welcome"><div><span className="eyebrow purple">FINANCE OPERATIONS</span><h1>Invoices</h1><p className="muted">Review invoice details and resolve purchase order discrepancies.</p></div><Button variant="secondary" onClick={onRefresh} disabled={loading}>â†» Refresh</Button></header>
    <Card className="panel invoice-workspace"><div className="invoice-toolbar"><div className="invoice-status-tabs" role="tablist" aria-label="Invoice status"><button className={status === "all" ? "active" : ""} onClick={() => onStatus("all")}>All <b>{Object.values(counts).reduce((sum, count) => sum + count, 0)}</b></button>{invoiceStatuses.map(item => <button key={item} className={status === item ? "active" : ""} onClick={() => onStatus(item)}><span className={`status-dot ${invoiceStatusClass(item)}`}/>{invoiceStatusLabels[item]} <b>{counts[item]}</b></button>)}</div><select value={source} onChange={event => onSource(event.target.value as "all" | "upload" | "email")} aria-label="Filter invoices by source"><option value="all">All sources</option><option value="upload">Upload</option><option value="email">Email</option></select></div>
      {error && <div className="notice error">{error}<button onClick={onRefresh}>Try again</button></div>}
      {loading ? <InvoiceTableSkeleton/> : visible.length ? <><div className="table-wrap"><table className="invoice-table"><thead><tr><th>Vendor</th><th>Source</th><th>Invoice No</th><th>Invoice Date</th><th>Due Date</th><th className="amount-cell">Total</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{pageInvoices.map((invoice, index) => <tr key={invoice.invoice_id} onClick={() => onOpen(invoice)} tabIndex={0} style={{ "--row-index": index } as React.CSSProperties} onKeyDown={event => { if (event.key === "Enter") onOpen(invoice); }}><td><span className="vendor-cell"><Avatar name={invoice.vendor_name || "Vendor"}/><b>{invoice.vendor_name || ""}</b></span></td><td><Badge tone={invoice.source === "email" ? "blue" : "gray"}>{invoice.source === "email" ? "Email" : "Upload"}</Badge>{invoice.source === "email" && <small className="invoice-source-meta">{invoice.email_sender || ""}{invoice.email_subject ? ` · ${invoice.email_subject}` : ""}</small>}</td><td>{invoice.invoice_no || ""}</td><td>{invoice.invoice_date ? dateLabel(invoice.invoice_date) : ""}</td><td>{invoice.due_date ? dateLabel(invoice.due_date) : ""}</td><td className="amount-cell">{invoice.total_amount == null ? "" : formatInvoiceMoney(invoice.total_amount, invoice.currency)}</td><td><Badge className={`invoice-status-badge ${invoiceStatusClass(invoice.status)}`} tone={invoiceStatusTone(invoice.status)} dot>{invoiceStatusLabels[invoice.status]}</Badge></td><td className="row-open"><span aria-hidden="true">â€º</span></td></tr>)}</tbody></table></div><Pagination page={page} total={visible.length} pageSize={pageSize} loading={loading} onChange={setPage}/></> : <EmptyState title="No invoices in this status" description="Uploaded invoices will appear here after extraction."/>}
    </Card>
  </>;
}

function InvoiceTableSkeleton() { return <div className="invoice-table-skeleton" role="status" aria-label="Loading invoice rows">{Array.from({ length: 6 }, (_, index) => <div className="invoice-skeleton-row" key={index}><Skeleton/><Skeleton/><Skeleton/><Skeleton/><Skeleton/><Skeleton/></div>)}</div>; }
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
function InvoiceReviewDrawer({ invoice, candidates, onClose, onMatch, onDecision, reducedMotion }: { invoice: InvoiceDetail; candidates: MatchCandidate[]; onClose: () => void; onMatch: (candidate: MatchCandidate, accept: boolean) => void; onDecision: (action: "hold" | "reject" | "approve-exception") => void; reducedMotion: boolean | null }) {
  const rows = [...(invoice.discrepancies || [])].sort((a, b) => Number(Boolean(a.resolved)) - Number(Boolean(b.resolved)) || (a.severity === "error" ? -1 : 1));
  const issues = rows.filter(item => !item.resolved);
  const labels: [string, (keyof InvoiceDetail)[]][] = [["Vendor", ["vendor_name"]], ["Vendor Tax ID", ["vendor_tax_id"]], ["Invoice Number", ["invoice_no"]], ["Invoice Date", ["invoice_date"]], ["Due Date", ["due_date"]], ["PO/Order Number", ["po_number_raw"]], ["Payment Terms", ["payment_terms"]], ["Currency", ["currency"]]];
  const hasNoReceipt = issues.some(item => item.field.includes("accepted_quantity") || item.field.includes("goods_receipt"));
  return <motion.section className="modal invoice-detail-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title" initial={reducedMotion ? false : { opacity: .8, x: 26 }} animate={{ opacity: 1, x: 0 }} exit={reducedMotion ? undefined : { opacity: .75, x: 20 }} transition={reducedMotion ? { duration: 0 } : { type: "spring", damping: 32, stiffness: 260, mass: .8 }}><header className="modal-head drawer-title"><div><span className="eyebrow purple">INVOICE REVIEW</span><h2 id="invoice-detail-title">{invoice.invoice_no || "Invoice details"}</h2><p className="muted">{invoice.vendor_name || "Vendor"}</p></div><button className="modal-close" onClick={onClose} aria-label="Close invoice">Ã—</button></header><div className="modal-body"><div className="detail-summary"><Badge className={`invoice-status-badge ${invoiceStatusClass(invoice.status)}`} tone={invoiceStatusTone(invoice.status)} dot>{invoiceStatusLabels[invoice.status]}</Badge><span className="pill neutral">{invoice.vendor_name || "Vendor"}</span><Badge tone={invoice.source === "email" ? "blue" : "gray"}>{invoice.source === "email" ? "Email" : "Upload"}</Badge></div>{invoice.source === "email" && <div className="email-invoice-origin"><span><b>From</b>{invoice.email_sender || "Unknown sender"}</span><span><b>Subject</b>{invoice.email_subject || "(No subject)"}</span></div>}
    {issues.length > 0 && <div className="discrepancy-banner"><span className="discrepancy-banner-icon" aria-hidden="true">!</span><div><b>{issues.length} item{issues.length === 1 ? "" : "s"} need attention</b><small>{issues.filter(item => item.severity === "error").length} high priority Â· {issues.filter(item => item.severity !== "error").length} to verify</small></div><div className="discrepancy-banner-chips"><span className="severity-chip severity-error">{issues.filter(item => item.severity === "error").length} mismatch</span><span className="severity-chip severity-warning">{issues.filter(item => item.severity !== "error").length} review</span></div></div>}
    <section className="extracted-section"><h3 className="section-title">Invoice</h3><div className="field-grid">{labels.map(([label, keys]) => { const value = keys.map(key => invoice[key]).find(item => item != null && item !== ""); if (value == null || (typeof value !== "string" && typeof value !== "number")) return null; const shown = ["invoice_date", "due_date"].includes(String(keys[0])) ? dateLabel(String(value)) : String(value); return <DetailField key={label} label={label} value={shown}/>; })}</div></section>
    <section className="extracted-section"><h3 className="section-title">Amounts</h3><div className="field-grid"><DetailField label="Subtotal" value={invoice.subtotal == null ? undefined : formatInvoiceMoney(invoice.subtotal, invoice.currency)}/><DetailField label="Tax" value={invoice.tax_amount == null ? undefined : formatInvoiceMoney(invoice.tax_amount, invoice.currency)}/><DetailField label="Total" value={invoice.total_amount == null ? undefined : formatInvoiceMoney(invoice.total_amount, invoice.currency)}/></div></section>
    {(invoice.line_items || []).length > 0 && <section className="extracted-section"><h3 className="section-title">Line Items</h3><div className="table-wrap"><table className="line-items-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>{invoice.line_items!.map((line, index) => { const qty = Number(line.qty); return <tr key={index}><td>{line.description || line.item_code || ""}</td><td>{line.qty == null || !Number.isFinite(qty) ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(qty)}</td><td>{line.unit_price == null ? "" : formatInvoiceMoney(line.unit_price, invoice.currency)}</td><td>{line.amount == null ? "" : formatInvoiceMoney(line.amount, invoice.currency)}</td></tr>; })}</tbody></table></div></section>}
    {rows.length > 0 && <section className="extracted-section"><h3 className="section-title">Match review</h3><div className="discrepancy-badges">{issues.map(item => <span key={`${item.field}-${item.reason}`} className={`discrepancy-badge ${item.severity === "error" ? "mismatch" : "within-tolerance"}`}>{item.field.includes("po_found") ? "No PO" : item.field.includes("unit_price") || item.field.includes("line_price") ? "Price mismatch" : item.field.includes("goods_receipt") || item.field.includes("accepted_quantity") ? "No goods receipt" : item.field.includes("quantity") ? "Qty exceeds PO" : humanize(item.field)}</span>)}</div><div className="table-wrap"><table className="comparison-table"><thead><tr><th>Field</th><th>Invoice</th><th>PO</th><th>Goods Receipt</th><th>Status</th></tr></thead><tbody>{issues.map(item => <InvoiceComparisonRow key={`${item.field}-${item.reason}`} item={item} currency={invoice.currency}/> )}</tbody></table></div>{rows.some(item => item.resolved) && <details className="matched-fields"><summary>Show matched fields ({rows.filter(item => item.resolved).length})</summary><div className="table-wrap"><table className="comparison-table"><thead><tr><th>Field</th><th>Invoice</th><th>PO</th><th>Goods Receipt</th><th>Status</th></tr></thead><tbody>{rows.filter(item => item.resolved).map(item => <InvoiceComparisonRow key={`${item.field}-${item.reason}`} item={item} currency={invoice.currency}/>)}</tbody></table></div></details>}</section>}
    {invoice.status === "needs_review" && !invoice.po_number_raw && candidates.length > 0 && <div className="suggestion-card"><small>SUGGESTED PURCHASE ORDER</small><div className="suggestion-content"><div><h3>This invoice matches {candidates[0].po_number} ({candidates[0].vendor_name || "vendor"}, amount, items). Match this PO?</h3><p>Matched signals: vendor, total amount, and item descriptions.</p></div><div className="match-score-ring" style={{ background: `conic-gradient(#14b8a6 0 ${Math.max(0, Math.min(100, candidates[0].score))}%, rgb(20 184 166 / 14%) 0)` }} aria-label={`${Math.round(candidates[0].score)} percent match`}><span>{Math.round(candidates[0].score)}<small>%</small></span></div></div><div><button className="primary" onClick={() => onMatch(candidates[0], true)}>Yes, match this PO</button><button className="secondary" onClick={() => onMatch(candidates[0], false)}>No</button></div></div>}
    {invoice.status === "needs_review" && !invoice.po_number_raw && !candidates.length && <p className="muted">No match found for this invoice.</p>}
    {hasNoReceipt && invoice.status === "needs_review" && <div className="notice info">No goods receipt was found. You can hold this invoice while waiting for the receipt, approve with an exception, or reject it.</div>}
    <div className="modal-actions"><button className="secondary" onClick={() => onDecision("hold")} disabled={invoice.status === "rejected"}>Hold</button><button className="danger-button" onClick={() => onDecision("reject")} disabled={invoice.status === "rejected"}>Reject</button>{invoice.status === "needs_review" && <button className="primary" onClick={() => onDecision("approve-exception")}>Approve with exception</button>}</div>
  </div></motion.section>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<LazyMotion features={domAnimation}><App /></LazyMotion>);
