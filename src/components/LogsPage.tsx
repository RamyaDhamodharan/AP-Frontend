import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { userFacingErrorMessage } from "../errorMessages";
import { Badge, Button, Card, EmptyState, Skeleton } from "./ui";
import { InvoiceTimeline } from "./InvoiceTimeline";
import type { FilterOwner, FilterVendor } from "./InvoiceFilters";

const PAGE_SIZE = 25;
const urlKeys = ["date_from", "date_to", "user", "action", "result", "entity_type", "invoice", "vendor_id", "gl_code", "owner", "sort_dir", "page"] as const;
type LogFilter = (typeof urlKeys)[number];
type LogQuery = Record<LogFilter, string>;
type AuditEntry = {
  id: string; action: string; entity_type: string; entity_id?: string | null;
  result?: "success" | "warning" | "error"; message?: string | null;
  created_by?: string | null; created_at?: string | null; step_name?: string | null;
  duration_ms?: number | null; new_value?: Record<string, unknown> | null;
  output_summary?: Record<string, unknown> | null;
};
type Props = {
  coreUrl: string;
  authHeaders: () => { Authorization: string };
  vendors: FilterVendor[];
  owners: FilterOwner[];
  userNames: Record<string, string>;
  onOpenInvoice: (id: string) => void;
};

const emptyQuery: LogQuery = {
  date_from: "", date_to: "", user: "", action: "", result: "", entity_type: "",
  invoice: "", vendor_id: "", gl_code: "", owner: "", sort_dir: "desc", page: "1",
};

function queryFromUrl(): LogQuery {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(urlKeys.map(key => [key, params.get(`log_${key}`) || emptyQuery[key]])) as LogQuery;
}

function queryToUrl(query: LogQuery) {
  const params = new URLSearchParams(window.location.search);
  urlKeys.forEach(key => {
    const value = query[key];
    if (!value || (key === "page" && value === "1") || (key === "sort_dir" && value === "desc")) params.delete(`log_${key}`);
    else params.set(`log_${key}`, value);
  });
  const search = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
}

function friendly(value?: string | null) {
  return (value || "Unknown").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}

function stamp(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function reasonFor(entry: AuditEntry) {
  const reason = entry.new_value?.reason;
  return typeof reason === "string" && reason.trim() ? reason : entry.message || "—";
}

function outputFor(summary?: Record<string, unknown> | null) {
  if (!summary) return "—";
  const allowed = ["result", "status", "step", "count", "workflow_status"];
  const values = allowed.flatMap(key => {
    const value = summary[key];
    if ((typeof value === "number" && key === "count") || (typeof value === "string" && /^[a-z0-9_ -]{1,40}$/i.test(value) && ["result", "status", "step", "workflow_status"].includes(key))) {
      return [`${friendly(key)}: ${friendly(String(value))}`];
    }
    return [];
  });
  return values.slice(0, 3).join(" · ") || "—";
}

function rowInvoiceId(entry: AuditEntry) {
  if (entry.entity_type === "invoice") return entry.entity_id || null;
  const value = entry.output_summary?.invoice_id || entry.new_value?.invoice_id;
  return typeof value === "string" ? value : null;
}

export function LogsPage({ coreUrl, authHeaders, vendors, owners, userNames, onOpenInvoice }: Props) {
  const [query, setQuery] = useState<LogQuery>(queryFromUrl);
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);

  const update = useCallback((patch: Partial<LogQuery>) => {
    const next = { ...queryFromUrl(), ...patch };
    if (patch.page === undefined) next.page = "1";
    queryToUrl(next);
    setQuery(next);
  }, []);

  useEffect(() => {
    const onPopState = () => setQuery(queryFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ page: query.page, page_size: String(PAGE_SIZE), sort_dir: query.sort_dir });
        if (query.date_from) params.set("date_from", `${query.date_from}T00:00:00`);
        if (query.date_to) params.set("date_to", `${query.date_to}T23:59:59.999999`);
        if (query.user) params.set("user", query.user);
        if (query.action) params.set("action", query.action);
        if (query.result) params.set("result", query.result);
        if (query.entity_type) params.set("entity_type", query.entity_type === "issue" ? "invoice_issue" : query.entity_type);
        if (query.vendor_id) params.set("vendor_id", query.vendor_id);
        if (query.gl_code) params.set("gl_code", query.gl_code);
        if (query.owner) params.set("owner", query.owner);
        if (query.invoice.trim()) {
          let invoiceId = query.invoice.trim();
          if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(invoiceId)) {
            const found = await axios.get<{ items?: { invoice_id?: string; invoice_no?: string }[] }>(`${coreUrl}/api/invoices`, {
              params: { search: invoiceId, page: 1, page_size: 100 }, headers: authHeaders(),
            });
            const exact = (found.data.items || []).find(item => item.invoice_no?.toLowerCase() === invoiceId.toLowerCase());
            if (!exact?.invoice_id) throw new Error("No invoice matches that number.");
            invoiceId = exact.invoice_id;
          }
          params.set("invoice_id", invoiceId);
        }
        const response = await axios.get<{ items?: AuditEntry[]; total?: number }>(`${coreUrl}/api/audit-log`, { params, headers: authHeaders() });
        if (!current) return;
        setItems(response.data.items || []); setTotal(response.data.total || 0);
      } catch (loadError) {
        if (!current) return;
        setError(userFacingErrorMessage(loadError, "Could not load logs. Refresh and try again."));
        setItems([]); setTotal(0);
      } finally { if (current) setLoading(false); }
    }
    void load();
    return () => { current = false; };
  }, [coreUrl, authHeaders, query]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedInvoiceId = selected ? rowInvoiceId(selected) : null;
  const userOptions = useMemo(() => {
    const merged = new Map<string, string>();
    owners.forEach(user => merged.set(user.id, user.name));
    Object.entries(userNames).forEach(([id, name]) => merged.set(id, name));
    return [...merged].sort((a, b) => a[1].localeCompare(b[1]));
  }, [owners, userNames]);

  async function openEntry(entry: AuditEntry) {
    setSelected(entry);
    setShowTimeline(false);
  }

  return <div className="logs-page page-enter">
    <header className="welcome"><div><span className="eyebrow">ADMINISTRATION</span><h1>Logs</h1><p className="muted">Review invoice, document, issue, and email activity.</p></div></header>
    <Card className="logs-panel">
      <form className="logs-filters" onSubmit={event => { event.preventDefault(); update({}); }} aria-label="Log filters">
        <label className="form-label">From<input type="date" value={query.date_from} onChange={event => update({ date_from: event.target.value })}/></label>
        <label className="form-label">To<input type="date" value={query.date_to} onChange={event => update({ date_to: event.target.value })}/></label>
        <label className="form-label">User ID<select value={query.user} onChange={event => update({ user: event.target.value })}><option value="">All users</option>{userOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="form-label">Action<input value={query.action} onChange={event => update({ action: event.target.value })} placeholder="Any action"/></label>
        <label className="form-label">Result<select value={query.result} onChange={event => update({ result: event.target.value })}><option value="">All results</option><option value="success">Success</option><option value="warning">Warning</option><option value="error">Error</option></select></label>
        <label className="form-label">Entity<select value={query.entity_type} onChange={event => update({ entity_type: event.target.value })}><option value="">All entities</option><option value="invoice">Invoice</option><option value="document">Document</option><option value="issue">Issue</option><option value="email">Email activity</option><option value="email_draft">Email draft</option></select></label>
        <label className="form-label">Invoice number or ID<input value={query.invoice} onChange={event => update({ invoice: event.target.value })} placeholder="Invoice number or UUID"/></label>
        <label className="form-label">Vendor<select value={query.vendor_id} onChange={event => update({ vendor_id: event.target.value })}><option value="">All vendors</option>{vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
        <label className="form-label">GL code<input value={query.gl_code} onChange={event => update({ gl_code: event.target.value })} placeholder="Any GL code"/></label>
        <label className="form-label">Owner<select value={query.owner} onChange={event => update({ owner: event.target.value })}><option value="">All owners</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
        <div className="logs-filter-actions"><Button type="button" variant="secondary" onClick={() => update({ ...emptyQuery })}>Clear filters</Button><span aria-live="polite">{total.toLocaleString("en-IN")} records</span></div>
      </form>
      {error && <div className="notice error" role="alert">{error}<Button variant="secondary" onClick={() => setQuery({ ...query })}>Try again</Button></div>}
      {loading ? <div className="logs-loading" role="status" aria-label="Loading logs">{Array.from({ length: 7 }, (_, index) => <div key={index}>{Array.from({ length: 7 }, (_, cell) => <Skeleton key={cell}/>)}</div>)}</div>
        : items.length === 0 ? <EmptyState title="No logs found" description="No activity matches these filters."/>
          : <div className="table-wrap logs-table-wrap"><table className="logs-table"><thead><tr><th><button type="button" className="logs-sort" onClick={() => update({ sort_dir: query.sort_dir === "asc" ? "desc" : "asc" })}>Date / time {query.sort_dir === "asc" ? <ArrowUp size={18} strokeWidth={1.75}/> : <ArrowDown size={18} strokeWidth={1.75}/>}</button></th><th>User</th><th>Entity</th><th>Action</th><th>Result</th><th>Reason / notes</th><th>Output summary</th></tr></thead><tbody>{items.map(entry => {
            const userName = entry.created_by ? userNames[entry.created_by] || `User ${entry.created_by.slice(0, 8)}` : "System";
            const entity = entry.entity_type === "email_draft" ? "email draft" : entry.entity_type === "invoice_issue" ? "issue" : entry.entity_type;
            return <tr key={entry.id} tabIndex={0} onClick={() => void openEntry(entry)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openEntry(entry); } }} aria-label={`View ${friendly(entity)} ${friendly(entry.action)} log`}>
              <td>{stamp(entry.created_at)}</td><td>{userName}</td><td>{friendly(entity)}<small>{entry.entity_id || ""}</small></td><td>{friendly(entry.action)}</td><td><Badge tone={entry.result === "success" ? "success" : entry.result === "warning" ? "warning" : entry.result === "error" ? "error" : "neutral"} dot>{friendly(entry.result)}</Badge></td><td>{reasonFor(entry)}</td><td>{outputFor(entry.output_summary)}</td>
            </tr>;
          })}</tbody></table></div>}
      {!loading && total > 0 && <div className="pagination"><span>Page {query.page} of {totalPages} · {total.toLocaleString("en-IN")} records</span><div><Button variant="secondary" disabled={Number(query.page) <= 1} onClick={() => update({ page: String(Number(query.page) - 1) })}>Previous</Button><Button variant="secondary" disabled={Number(query.page) >= totalPages} onClick={() => update({ page: String(Number(query.page) + 1) })}>Next</Button></div></div>}
    </Card>
    {selected && <div className="modal-backdrop logs-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal logs-detail-panel" role="dialog" aria-modal="true" aria-labelledby="log-detail-title"><header className="modal-head"><div><span className="eyebrow">ACTIVITY DETAIL</span><h2 id="log-detail-title">{friendly(selected.action)}</h2></div><button className="modal-close" aria-label="Close log details" onClick={() => setSelected(null)}><X size={18} strokeWidth={1.75}/></button></header><div className="modal-body"><dl className="logs-detail-grid"><dt>Date / time</dt><dd>{stamp(selected.created_at)}</dd><dt>User</dt><dd>{selected.created_by ? userNames[selected.created_by] || `User ${selected.created_by.slice(0, 8)}` : "System"}</dd><dt>Entity</dt><dd>{friendly(selected.entity_type === "email_draft" ? "email draft" : selected.entity_type === "invoice_issue" ? "issue" : selected.entity_type)} · {selected.entity_id || "—"}</dd><dt>Result</dt><dd>{friendly(selected.result)}</dd><dt>Reason / notes</dt><dd>{reasonFor(selected)}</dd><dt>Output summary</dt><dd>{outputFor(selected.output_summary)}</dd></dl>
        {selectedInvoiceId && <><div className="logs-timeline-heading"><h3>Invoice timeline</h3><div><Button variant="secondary" onClick={() => onOpenInvoice(selectedInvoiceId)}>Open invoice</Button> <Button variant="secondary" aria-expanded={showTimeline} onClick={() => setShowTimeline(value => !value)}>{showTimeline ? "Hide timeline" : "Show timeline"}</Button></div></div>{showTimeline && <InvoiceTimeline invoiceId={selectedInvoiceId} coreUrl={coreUrl} authHeaders={authHeaders}/>}</>}
      </div></section></div>}
  </div>;
}
