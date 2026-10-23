import { useEffect, useState, type CSSProperties } from "react";
import { Badge, Button, Card, EmptyState, Skeleton } from "./ui";
import type { EmailPollStatus } from "./EmailInboxWorkspace";

export type DashboardInvoice = {
  invoice_id: string;
  invoice_no?: string | null;
  vendor_name?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  total_amount?: number | string | null;
  currency?: string | null;
  status: "processing" | "needs_review" | "ready_to_pay" | "on_hold" | "rejected";
};

type Props = {
  invoices: DashboardInvoice[];
  counts: Record<DashboardInvoice["status"], number>;
  loading: boolean;
  error: string;
  search: string;
  name: string;
  onOpen: (invoice: DashboardInvoice) => void;
  onInvoices: () => void;
  onReview: () => void;
  onDocuments: () => void;
  onRefresh: () => void;
  formatMoney: (value: unknown, currency?: string | null) => string;
  dateLabel: (value?: string | null) => string;
  isAdmin?: boolean;
  emailStatus?: EmailPollStatus | null;
  emailAttentionCount?: number;
  onEmailInbox?: () => void;
  onPollEmail?: () => void;
  emailPollBusy?: boolean;
};

const statuses: DashboardInvoice["status"][] = ["processing", "needs_review", "ready_to_pay", "on_hold", "rejected"];
const labels: Record<DashboardInvoice["status"], string> = { processing: "In progress", needs_review: "Needs review", ready_to_pay: "Ready to pay", on_hold: "On hold", rejected: "Rejected" };
const tones: Record<DashboardInvoice["status"], "blue" | "amber" | "green" | "gray" | "red"> = { processing: "blue", needs_review: "amber", ready_to_pay: "green", on_hold: "gray", rejected: "red" };
const classes: Record<DashboardInvoice["status"], string> = { processing: "invoice-status-processing", needs_review: "invoice-status-review", ready_to_pay: "invoice-status-ready", on_hold: "invoice-status-hold", rejected: "invoice-status-rejected" };
const ringColors: Record<DashboardInvoice["status"], string> = { processing: "#0284c7", needs_review: "#f59e0b", ready_to_pay: "#059669", on_hold: "#64748b", rejected: "#e11d48" };

export function DashboardWorkspace({ invoices, counts, loading, error, search, name, onOpen, onInvoices, onReview, onDocuments, onRefresh, formatMoney, dateLabel, isAdmin, emailStatus, emailAttentionCount = 0, onEmailInbox, onPollEmail, emailPollBusy = false }: Props) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const query = search.trim().toLowerCase();
  const attention = invoices.filter(invoice => invoice.status === "needs_review" && (!query || `${invoice.vendor_name || ""} ${invoice.invoice_no || ""}`.toLowerCase().includes(query))).slice(0, 5);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const monthMap = new Map<string, number>();
  invoices.forEach(invoice => {
    if (!invoice.invoice_date) return;
    const date = new Date(invoice.invoice_date);
    if (!Number.isNaN(date.getTime())) {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      monthMap.set(key, (monthMap.get(key) || 0) + 1);
    }
  });
  const monthSeries = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  let ringAngle = 0;
  const ringGradient = statuses.map(status => {
    const start = ringAngle;
    ringAngle += total ? counts[status] / total * 360 : 0;
    return `${ringColors[status]} ${start}deg ${ringAngle}deg`;
  }).join(", ");

  return <div className="dashboard-page">
    <header className="welcome dashboard-welcome dashboard-hero"><div className="dashboard-hero-copy"><span className="eyebrow">ACCOUNTS PAYABLE OVERVIEW</span><h1>{greeting}, {name}</h1><p>{counts.needs_review === 0 ? "Your invoice queue is clear. Keep your documents moving smoothly." : `${counts.needs_review.toLocaleString("en-IN")} ${counts.needs_review === 1 ? "invoice needs" : "invoices need"} your review.`}</p><Button variant="primary" onClick={onReview}>Review invoices <span aria-hidden="true">→</span></Button></div><div className="dashboard-hero-art" aria-hidden="true"><span className="hero-orb orb-one"/><span className="hero-orb orb-two"/><span className="hero-glass-card"><i/><i/><b>{counts.needs_review.toLocaleString("en-IN")}</b><small>NEEDS REVIEW</small></span></div><button className="dashboard-refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh dashboard">↻</button></header>
    {error && <div className="notice error" role="alert">{error}<button onClick={onRefresh}>Try again</button></div>}
    {isAdmin && <Card className="dashboard-card email-dashboard-card"><div className="email-dashboard-heading"><span className="email-dashboard-icon" aria-hidden="true">✉</span><div><span className="eyebrow purple">MAILBOX AUTOMATION</span><h2>Email inbox</h2><p className="muted">{emailStatus?.enabled ? `Last poll ${dateLabel(emailStatus.last_run_at) || "has not run yet"}.` : "Email polling is currently disabled."}</p>{emailStatus?.next_poll_at && <small className="email-next-poll">Next poll {dateLabel(emailStatus.next_poll_at)}</small>}</div></div><div className="email-dashboard-summary"><span><b>{emailStatus?.counts?.processed || 0}</b><small>Ready</small></span><span><b>{emailAttentionCount}</b><small>Needs attention</small></span><span><b>{emailStatus?.counts?.failed || 0}</b><small>Failed</small></span></div><div className="email-dashboard-actions"><Button variant="secondary" onClick={onEmailInbox}>Open inbox <span aria-hidden="true">→</span></Button><Button onClick={onPollEmail} disabled={emailPollBusy}>{emailPollBusy ? "Polling…" : "Poll now"}</Button></div></Card>}
    <section className="kpi-grid" aria-label="Invoice summary">
      <KpiCard label="Total invoices" value={total} tone="accent" icon="▤" onClick={onInvoices}/>
      <KpiCard label="Needs review" value={counts.needs_review} tone="amber" icon="!" onClick={onReview}/>
      <KpiCard label="Ready to pay" value={counts.ready_to_pay} tone="green" icon="✓" onClick={onInvoices}/>
      <KpiCard label="On hold" value={counts.on_hold} tone="gray" icon="Ⅱ" onClick={onInvoices}/>
    </section>
    <section className="dashboard-grid">
      <Card className="dashboard-card status-distribution"><div className="section-heading"><div><span className="eyebrow purple">PORTFOLIO</span><h2>Status distribution</h2><p className="muted">Current invoice totals by workflow status.</p></div><button className="text-link" onClick={onInvoices}>View invoices <span aria-hidden="true">→</span></button></div>
        {loading ? <DashboardChartSkeleton/> : total === 0 ? <EmptyState title="No invoice data yet" description="Invoice status distribution will appear after invoices are uploaded." action={<Button onClick={onDocuments}>Go to documents</Button>}/> : <div className="distribution-layout"><div className="distribution-donut" style={{ background: `conic-gradient(${ringGradient})` }} aria-label={`${total} invoices across workflow statuses`}><span><b>{total.toLocaleString("en-IN")}</b><small>INVOICES</small></span></div><div className="distribution-list">{statuses.map(status => { const count = counts[status]; const percent = total ? Math.round(count / total * 100) : 0; return <div className="distribution-row" key={status}><div className="distribution-label"><Badge tone={tones[status]} dot>{labels[status]}</Badge><span>{count.toLocaleString("en-IN")}</span></div><div className="distribution-track"><span className={`distribution-fill ${classes[status]}`} style={{ width: `${percent}%` }}/></div><small>{percent}%</small></div>; })}</div></div>}
      </Card>
      <Card className="dashboard-card attention-card"><div className="section-heading"><div><span className="eyebrow purple">ACTION REQUIRED</span><h2>Needs attention</h2><p className="muted">Recent invoices waiting for review.</p></div><Badge tone="amber" dot>{counts.needs_review} open</Badge></div>
        {loading ? <AttentionSkeleton/> : attention.length ? <div className="attention-list">{attention.map((invoice, index) => <button className="attention-row" key={invoice.invoice_id} onClick={() => onOpen(invoice)} style={{ "--row-index": index } as CSSProperties}><span className="attention-vendor-icon">{(invoice.vendor_name || "V").slice(0, 1).toUpperCase()}</span><span className="attention-copy"><b>{invoice.vendor_name || "Unknown vendor"}</b><small>{invoice.invoice_no || "Invoice"}{invoice.invoice_date ? ` · ${dateLabel(invoice.invoice_date)}` : ""}</small></span><span className="attention-amount">{invoice.total_amount == null ? "" : formatMoney(invoice.total_amount, invoice.currency)}</span><span className="attention-arrow" aria-hidden="true">→</span></button>)}<Button variant="ghost" className="attention-more" onClick={onReview}>Review all invoices <span aria-hidden="true">→</span></Button></div> : <EmptyState title="You’re all caught up" description="There are no invoices waiting for review."/>}
      </Card>
    </section>
    <Card className="dashboard-card trend-card"><div className="section-heading"><div><span className="eyebrow purple">INVOICE ACTIVITY</span><h2>Invoices over time</h2><p className="muted">Based on invoice dates in the loaded records.</p></div></div>{monthSeries.length > 1 ? <InvoiceTrendChart points={monthSeries}/> : <EmptyState title="Not enough date history yet" description="Invoice activity will appear when records include dates across multiple months."/>}</Card>
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

function InvoiceTrendChart({ points }: { points: [string, number][] }) {
  const max = Math.max(...points.map(([, count]) => count), 1);
  const width = 640;
  const height = 150;
  const chartPoints = points.map(([, count], index) => `${points.length === 1 ? width / 2 : 16 + index * (width - 32) / (points.length - 1)},${height - 18 - count / max * (height - 42)}`).join(" ");
  return <div className="trend-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Invoice counts by invoice month"><defs><linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity=".24"/><stop offset="100%" stopColor="#6366f1" stopOpacity="0"/></linearGradient></defs><polygon points={`16,${height - 18} ${chartPoints} ${width - 16},${height - 18}`} fill="url(#trend-fill)"/><polyline points={chartPoints} fill="none" stroke="#5b52e8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="1" className="trend-line"/>{points.map(([key, count], index) => { const x = points.length === 1 ? width / 2 : 16 + index * (width - 32) / (points.length - 1); const y = height - 18 - count / max * (height - 42); return <circle key={key} cx={x} cy={y} r="4.5" fill="#fff" stroke="#5b52e8" strokeWidth="2.5"><title>{count} invoices</title></circle>; })}</svg><div className="trend-labels">{points.map(([key, count]) => <span key={key}><small>{new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(`${key}-01T00:00:00`))}</small><b>{count}</b></span>)}</div></div>;
}
