import { Badge, Button, Card, EmptyState, Skeleton, Tabs, type TabOption } from "./ui";
import { InvoiceFilters, SortControl, type FilterOwner, type FilterVendor, type InvoiceQueryPatch, type InvoiceQueryState } from "./InvoiceFilters";

type Status = "processing" | "needs_review" | "ready_to_pay" | "on_hold" | "rejected";
export type WorkspaceInvoice = {
  invoice_id: string; source_document_id?: string | null; source?: "upload" | "email" | null;
  email_sender?: string | null; email_subject?: string | null; invoice_no?: string | null;
  vendor_name?: string | null; invoice_date?: string | null; due_date?: string | null;
  total_amount?: number | string | null; currency?: string | null; status: Status;
};
const statuses: Status[] = ["processing", "needs_review", "ready_to_pay", "on_hold", "rejected"];
const labels: Record<Status, string> = { processing: "In progress", needs_review: "Needs review", ready_to_pay: "Ready to pay", on_hold: "On hold", rejected: "Rejected" };
const tones: Record<Status, "info" | "warning" | "success" | "neutral" | "error"> = { processing: "info", needs_review: "warning", ready_to_pay: "success", on_hold: "neutral", rejected: "error" };
function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function money(value: number | string | null | undefined, currency?: string | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  try { return new Intl.NumberFormat("en-IN", currency ? { style: "currency", currency, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value)); }
}

export function InvoicesWorkspacePage({ invoices, counts, total, page, filters, vendors, owners, source, loading, error, onFilter, onVendorSearch, onSource, onPage, onRefresh, onOpen, onOpenDocument }: {
  invoices: WorkspaceInvoice[]; counts: Record<Status, number>; total: number; page: number; filters: InvoiceQueryState;
  vendors: FilterVendor[]; owners: FilterOwner[]; source: "all" | "upload" | "email"; loading: boolean; error: string;
  onFilter: (patch: InvoiceQueryPatch) => void; onVendorSearch: (query: string) => void; onSource: (source: "all" | "upload" | "email") => void;
  onPage: (page: number) => void; onRefresh: () => void; onOpen: (invoice: WorkspaceInvoice) => void; onOpenDocument: (id: string) => void;
}) {
  const options: TabOption<Status | "all">[] = [
    { id: "all", label: "All", count: Object.values(counts).reduce((sum, count) => sum + count, 0) },
    ...statuses.map(status => ({ id: status, label: <><span className={`status-dot invoice-status-${status === "processing" ? "processing" : status === "needs_review" ? "review" : status === "ready_to_pay" ? "ready" : status === "on_hold" ? "hold" : "rejected"}`}/>{labels[status]}</>, count: counts[status] })),
  ];
  return <div className="invoice-page page-enter">
    <header className="welcome"><div><span className="eyebrow">FINANCE OPERATIONS</span><h1>Invoices</h1><p className="muted">Review invoice details and resolve purchase order discrepancies.</p></div><Button variant="secondary" onClick={onRefresh} disabled={loading}>Refresh</Button></header>
    <Card className="panel invoice-workspace">
      <Tabs label="Invoice status" tabs={options} value={(filters.status || "all") as Status | "all"} onChange={status => onFilter({ status: status === "all" ? "" : status })}/>
      <div className="invoice-workspace-tools"><label className="form-label">Source<select value={source} onChange={event => onSource(event.target.value as "all" | "upload" | "email")}><option value="all">All sources</option><option value="upload">Upload</option><option value="email">Email</option></select></label><SortControl value={filters.sort_by} sortDir={filters.sort_dir} onChange={value => onFilter({ sort_by: value })} onSortDirChange={sort_dir => onFilter({ sort_dir })}/></div>
      <InvoiceFilters mode="invoices" filters={filters} vendors={vendors} owners={owners} resultCount={total} onChange={onFilter} onVendorSearch={onVendorSearch}/>
      {error && <div className="notice error" role="alert">{error}<button onClick={onRefresh}>Try again</button></div>}
      {loading ? <div className="invoice-workspace-skeleton" role="status" aria-label="Loading invoices">{Array.from({ length: 6 }, (_, index) => <div key={index}><Skeleton/><Skeleton/><Skeleton/><Skeleton/><Skeleton/></div>)}</div>
        : invoices.length ? <div className="table-wrap"><table className="invoice-table"><thead><tr><th>Vendor</th><th>Invoice No</th><th>Source</th><th>Sender / subject</th><th>Invoice Date</th><th>Due Date</th><th className="amount-cell">Total</th><th>Status</th><th>Source file</th></tr></thead><tbody>{invoices.map(invoice => <tr key={invoice.invoice_id} onClick={() => onOpen(invoice)} tabIndex={0} onKeyDown={event => { if (event.key === "Enter") onOpen(invoice); }}><td>{invoice.vendor_name || "Unknown vendor"}</td><td>{invoice.invoice_no || "—"}</td><td><Badge tone={invoice.source === "email" ? "warning" : "neutral"}>{invoice.source === "email" ? "Email" : "Upload"}</Badge></td><td className="invoice-source-cell">{invoice.source === "email" ? <><span>{invoice.email_sender || "Unknown sender"}</span><small>{invoice.email_subject || "No subject"}</small></> : "—"}</td><td>{dateLabel(invoice.invoice_date)}</td><td>{dateLabel(invoice.due_date)}</td><td className="amount-cell">{money(invoice.total_amount, invoice.currency)}</td><td><Badge tone={tones[invoice.status]} dot>{labels[invoice.status]}</Badge></td><td>{invoice.source_document_id && <button className="text-link" onClick={event => { event.stopPropagation(); onOpenDocument(invoice.source_document_id!); }}>View document</button>}</td></tr>)}</tbody></table></div>
          : <EmptyState title="No invoices found" description="Try changing your filters or source selection." action={<Button variant="secondary" onClick={() => { onFilter({ status: "", vendor_id: "", due_date_from: "", due_date_to: "", amount_min: "", amount_max: "", gl_code: "", owner_user_id: "" }); onSource("all"); }}>Clear filters</Button>}/>}
      {!loading && total > 0 && <div className="pagination"><span>Page {page} of {Math.max(1, Math.ceil(total / 25))} · {total.toLocaleString("en-IN")} records</span><div><Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="secondary" disabled={page * 25 >= total} onClick={() => onPage(page + 1)}>Next</Button></div></div>}
    </Card>
  </div>;
}
