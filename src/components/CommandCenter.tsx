import type { CSSProperties } from "react";
import { Badge, Button, Card, EmptyState, Skeleton } from "./ui";
import { InvoiceFilters, SortControl, type FilterOwner, type FilterVendor, type InvoiceQueryPatch, type InvoiceQueryState } from "./InvoiceFilters";
import type { UnknownVendorInfo } from "./UnknownVendorPrompt";
import { VendorResolutionBanner } from "./VendorResolutionBanner";

export type CommandBucket = "ready_to_pay" | "needs_review" | "overdue" | "rejected";
export type CommandSummary = { count: number; total_amount: number | string };
export type CommandBill = {
  invoice_id: string;
  source_document_id?: string | null;
  invoice_no?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  workflow_status: string;
  status?: string;
  final_status?: string | null;
  due_date?: string | null;
  total_amount?: number | string | null;
  currency?: string | null;
  owner_user_id?: string | null;
  days_overdue?: number;
  reason?: string | null;
  alert?: boolean;
  rejection_reason?: string | null;
  actions?: string[];
  processing_status?: string | null;
};
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
export type ConfidenceResponse = {
  fields?: Record<string, { confidence?: number; derived?: boolean }>;
  line_items?: { confidence?: Record<string, { confidence?: number; derived?: boolean }> }[];
};

const buckets: { id: CommandBucket; label: string }[] = [
  { id: "ready_to_pay", label: "Ready to Pay" }, { id: "needs_review", label: "Needs Review" }, { id: "overdue", label: "Overdue" }, { id: "rejected", label: "Rejected" },
];
const actionLabels: Record<string, string> = { view: "View", approve: "Approve", reject: "Reject", escalate: "Escalate", reassign: "Reassign", pay: "Pay", hold: "Hold", resubmit: "Resubmit" };
const bucketActions: Record<CommandBucket, string[]> = {
  ready_to_pay: ["view", "pay", "hold", "reject", "reassign"],
  needs_review: ["view", "hold", "reject", "reassign"],
  overdue: ["view", "escalate", "reassign", "pay", "hold"],
  rejected: ["view", "resubmit"],
};

export function confidenceLevel(response?: ConfidenceResponse): ConfidenceLevel {
  if (!response) return "unknown";
  const values = [
    ...Object.values(response.fields || {}).map(field => field.confidence),
    ...(response.line_items || []).flatMap(line => Object.values(line.confidence || {}).map(field => field.confidence)),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return "unknown";
  const lowest = Math.min(...values);
  if (lowest >= 90) return "high";
  if (lowest >= 75) return "medium";
  return "low";
}

function money(value: number | string | null | undefined, currency?: string | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  try {
    return new Intl.NumberFormat("en-IN", currency ? { style: "currency", currency, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }).format(Number(value));
  } catch { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value)); }
}

function titleStatus(value: string) {
  if (value === "approved") return "Ready to pay";
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

export function CommandCenter({
  bucket, summary, bills, total, page, pageSize, filters, vendors, owners, confidences, loading, error,
  onBucket, onFilter, onVendorSearch, onPage, onRefresh, onOpen, onAction, vendorNotice, vendorVendors, canAddVendor, vendorBusy, vendorError, onAddVendor, onSelectVendor,
}: {
  bucket: CommandBucket;
  summary: Partial<Record<CommandBucket, CommandSummary>>;
  bills: CommandBill[];
  total: number;
  page: number;
  pageSize: number;
  filters: InvoiceQueryState;
  vendors: FilterVendor[];
  owners: FilterOwner[];
  confidences: Record<string, ConfidenceLevel>;
  loading: boolean;
  error: string;
  onBucket: (bucket: CommandBucket) => void;
  onFilter: (patch: InvoiceQueryPatch) => void;
  onVendorSearch: (query: string) => void;
  onPage: (page: number) => void;
  onRefresh: () => void;
  onOpen: (invoiceId: string) => void;
  onAction: (bill: CommandBill, action: string) => void;
  vendorNotice?: UnknownVendorInfo | null;
  vendorVendors?: FilterVendor[];
  canAddVendor?: boolean;
  vendorBusy?: boolean;
  vendorError?: string;
  onAddVendor?: () => void;
  onSelectVendor?: (id: string) => void;
}) {
  const activeSummary = summary[bucket];
  const overdueSummary = summary.overdue;
  const indicatorStyle = { "--active-tab": buckets.findIndex(item => item.id === bucket) } as CSSProperties;
  return <div className="command-center-page page-enter">
    <header className="welcome"><div><span className="eyebrow">FINANCE OPERATIONS</span><h1>Command Center</h1><p className="muted">Track payment readiness, overdue invoices, and rejected items.</p></div><Button variant="secondary" onClick={onRefresh} disabled={loading}>Refresh</Button></header>
    {error && <div className="notice error" role="alert">{error}<button onClick={onRefresh}>Try again</button></div>}
    <section className="command-summary-grid" aria-label="Bucket summaries">
      {buckets.map(item => {
        const value = summary[item.id];
        return <Card className={`command-summary-card ${bucket === item.id ? "selected" : ""}`} key={item.id}>
          <button type="button" onClick={() => onBucket(item.id)} aria-label={`${item.label}, ${value?.count ?? 0} invoices`}>
            <span>{item.label}</span><strong>{loading && !value ? <Skeleton className="command-summary-skeleton"/> : (value?.count ?? 0).toLocaleString("en-IN")}</strong>
            <small>{value ? money(value.total_amount) : "—"}<em>Currency not provided by summary API</em></small>
          </button>
        </Card>;
      })}
    </section>
    <div className="command-tabs" role="tablist" aria-label="Command Center buckets" style={indicatorStyle}>
      <span className="command-tabs-indicator" aria-hidden="true"/>
      {buckets.map(item => <button key={item.id} type="button" role="tab" aria-selected={bucket === item.id} onClick={() => onBucket(item.id)}>{item.label}<b>{summary[item.id]?.count ?? 0}</b></button>)}
    </div>
    {bucket === "overdue" && <div className="command-overdue-alert" role="status"><span className="alert-strip"/><div><strong>{(overdueSummary?.count ?? 0).toLocaleString("en-IN")} invoices are overdue</strong><span>Total {money(overdueSummary?.total_amount)} <small>Currency not provided by summary API</small></span></div></div>}
    <Card className="command-table-card">{vendorNotice && <VendorResolutionBanner info={vendorNotice} vendors={vendorVendors || []} canAddVendor={Boolean(canAddVendor)} busy={vendorBusy} error={vendorError} onAdd={onAddVendor || (() => undefined)} onSelect={onSelectVendor || (() => undefined)}/>}
      <div className="command-table-toolbar"><div><h2>{buckets.find(item => item.id === bucket)?.label}</h2><p className="muted">{total.toLocaleString("en-IN")} invoices</p></div><SortControl value={filters.sort_by} sortDir={filters.sort_dir} onChange={value => onFilter({ sort_by: value })} onSortDirChange={sort_dir => onFilter({ sort_dir })}/></div>
      <InvoiceFilters mode="command-center" filters={filters} vendors={vendors} owners={owners} resultCount={total} onChange={onFilter} onVendorSearch={onVendorSearch}/>
      {loading ? <div className="command-skeleton-table" role="status" aria-label="Loading invoices">{Array.from({ length: 6 }, (_, index) => <div className="command-skeleton-row" key={index}>{Array.from({ length: bucket === "overdue" ? 9 : 7 }, (_, cell) => <Skeleton key={cell}/>)}</div>)}</div>
        : bills.length === 0 ? <EmptyState title={`No ${bucket === "ready_to_pay" ? "ready to pay" : bucket.replaceAll("_", " ")} invoices`} description="Try another bucket or clear the current filters." action={<Button variant="secondary" onClick={() => onFilter({ status: "", vendor_id: "", due_date_from: "", due_date_to: "", amount_min: "", amount_max: "", gl_code: "", owner_user_id: "" })}>Clear filters</Button>}/>
          : <div className="table-wrap command-table-wrap"><table className="command-table"><thead><tr><th>Vendor</th><th>Invoice No</th><th>Due date</th>{bucket === "overdue" && <><th>Days overdue</th><th>Reason</th></>}<th className="amount-cell">Amount</th><th>Status</th><th>Owner</th><th>Confidence</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
            {bills.map(bill => {
              const level = confidences[bill.invoice_id] || "unknown";
              const owner = owners.find(item => item.id === bill.owner_user_id)?.name || (bill.owner_user_id ? "Assigned" : "Unassigned");
              const allowed = bucketActions[bucket];
              return <tr key={bill.invoice_id} className={bucket === "overdue" ? "command-overdue-row" : ""}>
                <td><button className="command-vendor-link" onClick={() => onOpen(bill.invoice_id)}>{bill.vendor_name || "Unknown vendor"}</button></td>
                <td>{bill.invoice_no || "—"}</td><td>{bill.due_date ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${bill.due_date}T00:00:00`)) : "—"}</td>
                {bucket === "overdue" && <><td><strong>{bill.days_overdue || 0} days</strong></td><td>{bill.reason || "Past due date"}</td></>}
                <td className="amount-cell">{money(bill.total_amount, bill.currency)}</td><td><Badge tone={(bill.status || bill.workflow_status) === "rejected" ? "error" : (bill.status || bill.workflow_status) === "needs_review" || bill.workflow_status === "overdue" ? "warning" : "success"} dot>{titleStatus(bill.status || bill.workflow_status)}</Badge></td><td>{owner}</td>
                <td><span className={`confidence-level confidence-${level}`} title={level === "unknown" ? "Confidence unavailable" : `${level[0].toUpperCase()}${level.slice(1)} confidence`}><i aria-hidden="true"/>{level === "unknown" ? "Unavailable" : `${level[0].toUpperCase()}${level.slice(1)}`}</span></td>
                <td><details className="command-row-menu"><summary aria-label={`Actions for ${bill.invoice_no || "invoice"}`}>Actions</summary><div role="menu">{allowed.map(action => { const available = action === "view" || Boolean(bill.actions?.includes(action)); return <button type="button" role="menuitem" key={action} disabled={!available} title={available ? undefined : "Not available yet"} onClick={() => action === "view" ? onOpen(bill.invoice_id) : onAction(bill, action)}>{actionLabels[action]}{!available && <span className="sr-only">Not available yet</span>}</button>; })}</div></details></td>
              </tr>;
            })}
          </tbody></table></div>}
      {!loading && total > 0 && <div className="pagination"><span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))} · {total.toLocaleString("en-IN")} records</span><div><Button variant="secondary" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="secondary" disabled={page * pageSize >= total || loading} onClick={() => onPage(page + 1)}>Next</Button></div></div>}
    </Card>
  </div>;
}
