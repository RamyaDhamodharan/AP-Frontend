import { useMemo } from "react";
import { Badge, Button, Card, EmptyState, Skeleton, Tabs, type TabOption } from "./ui";
import {
  InvoiceFilters,
  SortControl,
  type FilterOwner,
  type FilterVendor,
  type InvoiceQueryPatch,
  type InvoiceQueryState,
} from "./InvoiceFilters";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck,
  FileText,
  Mail,
  Receipt,
  Sparkles,
  Upload,
} from "lucide-react";

type Status = "processing" | "needs_review" | "ready_to_pay" | "on_hold" | "rejected";

export type WorkspaceInvoice = {
  invoice_id: string;
  source_document_id?: string | null;
  source?: "upload" | "email" | null;
  email_sender?: string | null;
  email_subject?: string | null;
  invoice_no?: string | null;
  vendor_name?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  total_amount?: number | string | null;
  currency?: string | null;
  status: Status;
  overall_confidence_percent?: number | null;
  discrepancy_count?: number | null;
  active_discrepancy_count?: number | null;
};

const statuses: Status[] = ["processing", "needs_review", "ready_to_pay", "on_hold", "rejected"];
const labels: Record<Status, string> = {
  processing: "In progress",
  needs_review: "Needs review",
  ready_to_pay: "Ready to pay",
  on_hold: "On hold",
  rejected: "Rejected",
};
const tones: Record<Status, "info" | "warning" | "success" | "neutral" | "error"> = {
  processing: "info",
  needs_review: "warning",
  ready_to_pay: "success",
  on_hold: "neutral",
  rejected: "error",
};

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function money(value: number | string | null | undefined, currency?: string | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  try {
    return new Intl.NumberFormat("en-IN", currency ? { style: "currency", currency, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }).format(Number(value));
  } catch {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));
  }
}

function vendorAvatarColor(name: string): string {
  const colors = [
    "linear-gradient(135deg, #243a5e 0%, #3b82f6 100%)",
    "linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)",
    "linear-gradient(135deg, #c2410c 0%, #f97316 100%)",
    "linear-gradient(135deg, #6d28d9 0%, #a855f7 100%)",
    "linear-gradient(135deg, #15803d 0%, #22c55e 100%)",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function InvoicesWorkspacePage({
  invoices,
  counts,
  total,
  page,
  filters,
  vendors,
  owners,
  source,
  loading,
  error,
  onFilter,
  onVendorSearch,
  onSource,
  onPage,
  onRefresh,
  onOpen,
  onOpenDocument,
}: {
  invoices: WorkspaceInvoice[];
  counts: Record<Status, number>;
  total: number;
  page: number;
  filters: InvoiceQueryState;
  vendors: FilterVendor[];
  owners: FilterOwner[];
  source: "all" | "upload" | "email";
  loading: boolean;
  error: string;
  onFilter: (patch: InvoiceQueryPatch) => void;
  onVendorSearch: (query: string) => void;
  onSource: (source: "all" | "upload" | "email") => void;
  onPage: (page: number) => void;
  onRefresh: () => void;
  onOpen: (invoice: WorkspaceInvoice) => void;
  onOpenDocument: (id: string) => void;
}) {
  const options: TabOption<Status | "all">[] = [
    { id: "all", label: "All Invoices", count: Object.values(counts).reduce((sum, count) => sum + count, 0) },
    ...statuses.map(status => ({
      id: status,
      label: (
        <>
          <span className={`status-dot invoice-status-${status === "processing" ? "processing" : status === "needs_review" ? "review" : status === "ready_to_pay" ? "ready" : status === "on_hold" ? "hold" : "rejected"}`} />
          {labels[status]}
        </>
      ),
      count: counts[status],
    })),
  ];

  const totalSpend = useMemo(() => {
    return invoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);
  }, [invoices]);

  const activeDiscrepanciesCount = useMemo(() => {
    return invoices.reduce((sum, inv) => sum + (inv.active_discrepancy_count || 0), 0);
  }, [invoices]);

  return (
    <div className="invoice-page page-enter">
      <header className="welcome scroll-reveal" style={{ marginBottom: "20px" }}>
        <div>
          <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <Receipt size={14} /> FINANCE OPERATIONS
          </span>
          <h1>Invoices Workspace</h1>
          <p className="muted">
            Intelligent 2-way and 3-way matching with automated discrepancy resolution.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Metrics Summary Banner */}
      <section className="workspace-metrics-banner reveal-stagger" aria-label="Invoice Metrics Summary">
        <div className="metric-box scroll-reveal">
          <div className="metric-icon-wrap navy">
            <Receipt size={22} strokeWidth={2} />
          </div>
          <div className="metric-content">
            <div className="metric-title">Total Invoices</div>
            <div className="metric-val">{total.toLocaleString("en-IN")}</div>
            <div className="metric-sub">{money(totalSpend, "INR")} visible value</div>
          </div>
        </div>

        <div className="metric-box scroll-reveal" style={{ cursor: "pointer" }} onClick={() => onFilter({ status: "needs_review" })}>
          <div className="metric-icon-wrap amber">
            <Clock size={22} strokeWidth={2} />
          </div>
          <div className="metric-content">
            <div className="metric-title">Needs Review</div>
            <div className="metric-val">{counts.needs_review || 0}</div>
            <div className="metric-sub">Action required to approve</div>
          </div>
        </div>

        <div className="metric-box scroll-reveal" style={{ cursor: "pointer" }} onClick={() => onFilter({ status: "ready_to_pay" })}>
          <div className="metric-icon-wrap green">
            <CheckCircle2 size={22} strokeWidth={2} />
          </div>
          <div className="metric-content">
            <div className="metric-title">Ready to Pay</div>
            <div className="metric-val">{counts.ready_to_pay || 0}</div>
            <div className="metric-sub">Clean 2-way / 3-way match</div>
          </div>
        </div>

        <div className="metric-box scroll-reveal">
          <div className="metric-icon-wrap orange">
            <AlertTriangle size={22} strokeWidth={2} />
          </div>
          <div className="metric-content">
            <div className="metric-title">Active Issues</div>
            <div className="metric-val" style={{ color: activeDiscrepanciesCount > 0 ? "var(--orange-hover)" : "var(--navy)" }}>
              {activeDiscrepanciesCount}
            </div>
            <div className="metric-sub">
              {activeDiscrepanciesCount === 0 ? "All variances cleared" : "Open discrepancies"}
            </div>
          </div>
        </div>
      </section>

      <Card className="panel invoice-workspace scroll-reveal">
        <Tabs
          label="Invoice status"
          tabs={options}
          value={(filters.status || "all") as Status | "all"}
          onChange={status => onFilter({ status: status === "all" ? "" : status })}
        />

        <div className="invoice-workspace-tools">
          <label className="form-label">
            Source
            <select value={source} onChange={event => onSource(event.target.value as "all" | "upload" | "email")}>
              <option value="all">All sources</option>
              <option value="upload">Upload</option>
              <option value="email">Email Intake</option>
            </select>
          </label>
          <SortControl
            value={filters.sort_by}
            sortDir={filters.sort_dir}
            onChange={value => onFilter({ sort_by: value })}
            onSortDirChange={sort_dir => onFilter({ sort_dir })}
          />
        </div>

        <InvoiceFilters
          mode="invoices"
          filters={filters}
          vendors={vendors}
          owners={owners}
          resultCount={total}
          onChange={onFilter}
          onVendorSearch={onVendorSearch}
        />

        {error && (
          <div className="notice error" role="alert">
            {error}
            <button onClick={onRefresh}>Try again</button>
          </div>
        )}

        {loading ? (
          <div className="invoice-workspace-skeleton" role="status" aria-label="Loading invoices">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index}>
                <Skeleton />
                <Skeleton />
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ))}
          </div>
        ) : invoices.length ? (
          <div className="table-wrap">
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Invoice No</th>
                  <th>Source</th>
                  <th>Sender / Subject</th>
                  <th>Invoice Date</th>
                  <th>Due Date</th>
                  <th className="amount-cell">Total Amount</th>
                  <th>Confidence</th>
                  <th>Discrepancies</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody className="reveal-stagger">
                {invoices.map(invoice => {
                  const conf = invoice.overall_confidence_percent ?? 0;
                  const confLevel = conf >= 85 ? "high" : conf >= 70 ? "medium" : "low";
                  const vendorName = invoice.vendor_name || "Unknown vendor";
                  const initial = (vendorName[0] || "V").toUpperCase();

                  return (
                    <tr
                      key={invoice.invoice_id}
                      className="scroll-reveal"
                      onClick={() => onOpen(invoice)}
                      tabIndex={0}
                      onKeyDown={event => {
                        if (event.key === "Enter") onOpen(invoice);
                      }}
                    >
                      <td>
                        <div className="vendor-cell-wrap">
                          <span
                            className="vendor-initial-avatar"
                            style={{ background: vendorAvatarColor(vendorName) }}
                            aria-hidden="true"
                          >
                            {initial}
                          </span>
                          <span className="vendor-name-txt" title={vendorName}>
                            {vendorName}
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong style={{ color: "var(--navy)", fontFamily: "var(--font-display)", fontSize: "13px" }}>
                          {invoice.invoice_no || "—"}
                        </strong>
                      </td>
                      <td>
                        <Badge tone={invoice.source === "email" ? "warning" : "neutral"}>
                          {invoice.source === "email" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              <Mail size={12} /> Email
                            </span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              <Upload size={12} /> Upload
                            </span>
                          )}
                        </Badge>
                      </td>
                      <td className="invoice-source-cell">
                        {invoice.source === "email" ? (
                          <>
                            <span style={{ fontWeight: 500 }}>{invoice.email_sender || "Unknown sender"}</span>
                            <small>{invoice.email_subject || "No subject"}</small>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{dateLabel(invoice.invoice_date)}</td>
                      <td>{dateLabel(invoice.due_date)}</td>
                      <td className="amount-cell">
                        <strong style={{ fontSize: "14px", color: "var(--navy)" }}>
                          {money(invoice.total_amount, invoice.currency)}
                        </strong>
                      </td>
                      <td>
                        <div className="confidence-meter-mini" title={`Extraction confidence: ${conf}%`}>
                          <div className="confidence-bar-bg">
                            <div className={`confidence-bar-val ${confLevel}`} style={{ width: `${Math.min(100, Math.max(8, conf))}%` }} />
                          </div>
                          <span className="confidence-pct-txt">{conf}%</span>
                        </div>
                      </td>
                      <td>
                        {invoice.active_discrepancy_count != null && invoice.active_discrepancy_count > 0 ? (
                          <span className="discrepancy-badge mismatch" title={`${invoice.active_discrepancy_count} open issue(s)`}>
                            <AlertTriangle size={12} />
                            {invoice.active_discrepancy_count} {invoice.active_discrepancy_count === 1 ? "issue" : "issues"}
                          </span>
                        ) : invoice.discrepancy_count != null && invoice.discrepancy_count > 0 ? (
                          <span className="discrepancy-badge match" title="All discrepancies resolved">
                            <CheckCircle2 size={12} /> Resolved
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <FileCheck size={14} color="#16a34a" /> Clean
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={tones[invoice.status]} dot>
                          {labels[invoice.status]}
                        </Badge>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          style={{
                            padding: "4px 10px",
                            fontSize: "12px",
                            height: "auto",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                          onClick={e => {
                            e.stopPropagation();
                            onOpen(invoice);
                          }}
                        >
                          Review <ArrowRight size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No invoices found"
            description="Try changing your filters or source selection."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  onFilter({
                    status: "",
                    vendor_id: "",
                    due_date_from: "",
                    due_date_to: "",
                    amount_min: "",
                    amount_max: "",
                    gl_code: "",
                    owner_user_id: "",
                  });
                  onSource("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        )}

        {!loading && total > 0 && (
          <div className="pagination">
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / 25))} · {total.toLocaleString("en-IN")} records
            </span>
            <div>
              <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page * 25 >= total} onClick={() => onPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
