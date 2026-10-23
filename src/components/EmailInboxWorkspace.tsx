import { Badge, Button, Card, EmptyState } from "./ui";

export type EmailPollStatus = {
  enabled: boolean;
  last_run_at?: string | null;
  next_poll_at?: string | null;
  last_error?: string | null;
  counts?: { processed: number; failed: number; needs_attention: number; skipped_by_reason: Record<string, number> };
};

export type EmailPollMessage = {
  id: string;
  sender?: string | null;
  subject?: string | null;
  status: string;
  failure_reason?: string | null;
  filter_reason?: string | null;
  created_at?: string | null;
  received_at?: string | null;
  retryable?: boolean;
};

type Props = {
  status: EmailPollStatus | null;
  messages: EmailPollMessage[];
  busy: boolean;
  onPoll: () => void;
  onRetry: (message: EmailPollMessage) => void;
  dateLabel: (value?: string | null) => string;
};

export function EmailInboxWorkspace({ status, messages, busy, onPoll, onRetry, dateLabel }: Props) {
  const attention = messages.filter(message => ["failed", "failed_final", "needs_attention", "ignored"].includes(message.status));
  const counts = status?.counts;
  const statusLabel = (value: string) => value === "needs_attention" || value === "ignored" ? "Needs attention" : value === "failed" || value === "failed_final" ? "Failed" : value === "processed" ? "Ready" : "Processing";
  const statusTone = (value: string): "blue" | "amber" | "green" | "gray" | "red" => value === "needs_attention" || value === "ignored" ? "amber" : value === "failed" || value === "failed_final" ? "red" : value === "processed" ? "green" : "blue";

  return <div className="email-inbox-page">
    <header className="welcome"><div><span className="eyebrow purple">ADMINISTRATION</span><h1>Email inbox</h1><p className="muted">Monitor mailbox intake and recover messages that need attention.</p></div><Button onClick={onPoll} disabled={busy}>{busy ? "Polling…" : "Poll now"}</Button></header>
    <section className="email-inbox-kpis">
      <Card><span>Poll status</span><strong>{status?.enabled ? "Enabled" : "Disabled"}</strong></Card>
      <Card><span>Last poll</span><strong>{dateLabel(status?.last_run_at) || "Not yet run"}</strong></Card>
      <Card><span>Next poll</span><strong>{dateLabel(status?.next_poll_at) || "Not scheduled"}</strong></Card>
      <Card><span>Processed</span><strong>{(counts?.processed || 0).toLocaleString("en-IN")}</strong></Card>
      <Card><span>Needs attention</span><strong>{(counts?.needs_attention || 0).toLocaleString("en-IN")}</strong></Card>
      <Card><span>Failed</span><strong>{(counts?.failed || 0).toLocaleString("en-IN")}</strong></Card>
    </section>
    {status?.last_error && <div className="notice error email-last-error"><b>Last error:</b> {status.last_error}</div>}
    {counts && Object.keys(counts.skipped_by_reason || {}).length > 0 && <Card className="email-skipped-summary"><h2>Skipped by reason</h2><div>{Object.entries(counts.skipped_by_reason).map(([reason, count]) => <Badge key={reason} tone="gray">{reason} · {count}</Badge>)}</div></Card>}
    <Card className="email-message-card"><div className="panel-head"><div><h2>Skipped &amp; failed emails</h2><p className="muted">Messages with a failure or filter reason are listed here.</p></div><Button variant="secondary" onClick={onPoll} disabled={busy}>{busy ? "Polling…" : "Poll now"}</Button></div>
      {attention.length ? <div className="table-wrap"><table className="email-message-table"><thead><tr><th>Sender</th><th>Subject</th><th>Received</th><th>Status</th><th>Reason</th><th>Action</th></tr></thead><tbody>{attention.map(message => <tr key={message.id}><td>{message.sender || "Unknown sender"}</td><td>{message.subject || "(No subject)"}</td><td>{dateLabel(message.received_at || message.created_at)}</td><td><Badge tone={statusTone(message.status)} dot>{statusLabel(message.status)}</Badge></td><td>{message.failure_reason || message.filter_reason || "Unknown (before reason tracking)"}</td><td>{message.retryable && <button className="secondary" onClick={() => onRetry(message)}>Retry</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="No email needs attention" description="New mail failures and filtered messages will appear here."/>}
    </Card>
  </div>;
}
