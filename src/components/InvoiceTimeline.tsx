import { useEffect, useState } from "react";
import axios from "axios";
import { userFacingErrorMessage } from "../errorMessages";
import { documentActionAvailability, isValidDocumentId } from "../documentIds";
import { Badge, Button, EmptyState, Skeleton } from "./ui";

export type InvoiceTimelineEntry = {
  id: string;
  action?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  created_at?: string | null;
  actor_name?: string | null;
  step_name?: string | null;
  entry_type?: "pipeline_step" | "state_change" | "user_action" | "email" | string;
  input_label?: string | null;
  output_label?: string | null;
  duration_ms?: number | null;
  result?: "success" | "warning" | "error" | string | null;
  reason?: string | null;
  run_no?: number | null;
  new_value?: { workflow_status?: string | null } | null;
};

type Props = {
  invoiceId: string;
  coreUrl: string;
  authHeaders: () => { Authorization: string };
  sourceDocumentId?: string | null;
};

function label(value?: string | null) {
  return (value || "Activity").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}

function timestamp(value?: string | null) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function InvoiceTimeline({ invoiceId, coreUrl, authHeaders, sourceDocumentId }: Props) {
  const [entries, setEntries] = useState<InvoiceTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  async function loadTimeline() {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get<InvoiceTimelineEntry[]>(`${coreUrl}/api/invoices/${invoiceId}/timeline`, { headers: authHeaders() });
      setEntries(Array.isArray(response.data) ? response.data : []);
    } catch (loadError) {
      setError(userFacingErrorMessage(loadError));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await axios.get<InvoiceTimelineEntry[]>(`${coreUrl}/api/invoices/${invoiceId}/timeline`, { headers: authHeaders() });
        if (active) setEntries(Array.isArray(response.data) ? response.data : []);
      } catch (loadError) {
        if (active) { setError(userFacingErrorMessage(loadError)); setEntries([]); }
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [authHeaders, coreUrl, invoiceId]);

  const orderedEntries = [...entries].sort((left, right) => {
    const difference = new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime();
    return order === "oldest" ? difference : -difference;
  });

  async function rerun(entry: InvoiceTimelineEntry) {
    const documentId = entry.entity_type === "document" ? entry.entity_id : sourceDocumentId;
    if (!isValidDocumentId(documentId)) return;
    setRerunning(entry.id);
    setActionError("");
    setNotice("");
    try {
      await axios.post(`${coreUrl}/api/documents/${documentId}/retry`, {}, { headers: authHeaders() });
      setNotice("Re-run requested. The document will update after processing.");
      await loadTimeline();
    } catch (rerunError) { setActionError(userFacingErrorMessage(rerunError)); }
    finally { setRerunning(null); }
  }

  if (loading) return <div className="invoice-timeline-loading" role="status" aria-label="Loading invoice timeline">{Array.from({ length: 4 }, (_, index) => <div className="invoice-timeline-skeleton" key={index}><Skeleton/><Skeleton/><Skeleton/></div>)}</div>;
  if (error) return <div className="notice error invoice-timeline-error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => void loadTimeline()}>Retry</Button></div>;
  if (!orderedEntries.length) return <EmptyState title="No timeline entries" description="Invoice processing and review activity will appear here."/>;

  return <section className="invoice-timeline" aria-label="Invoice timeline">
    <header className="invoice-timeline-toolbar"><p>{orderedEntries.length.toLocaleString("en-IN")} events</p><Button variant="secondary" aria-label={`Show ${order === "newest" ? "oldest" : "newest"} events first`} onClick={() => setOrder(order === "newest" ? "oldest" : "newest")}>{order === "newest" ? "Newest first" : "Oldest first"}</Button></header>
    {notice && <p className="notice success" role="status">{notice}</p>}{actionError && <p className="notice error" role="alert">{actionError}</p>}
    <ol className="invoice-timeline-list">{orderedEntries.map(entry => {
      const result = entry.result === "success" || entry.result === "warning" || entry.result === "error" ? entry.result : "warning";
      const title = entry.step_name || (entry.entry_type === "state_change" ? entry.new_value?.workflow_status : null) || (entry.action === "invoice_match_run" && entry.run_no != null ? `Match run ${entry.run_no}` : entry.action);
      const documentId = entry.entity_type === "document" ? entry.entity_id : sourceDocumentId;
      const actionState = documentActionAvailability(documentId);
      const canRerun = entry.entry_type === "pipeline_step" && result === "error";
      return <li className={`invoice-timeline-item ${result}`} key={`${entry.entry_type || "event"}-${entry.id}`}>
        <span className="invoice-timeline-marker" aria-hidden="true"/>
        <article className="invoice-timeline-content">
          <div className="invoice-timeline-heading"><div><h3>{label(title)}</h3><time dateTime={entry.created_at || undefined}>{timestamp(entry.created_at)}</time></div><Badge tone={result} dot>{label(result)}</Badge></div>
          <p className="invoice-timeline-actor">{entry.actor_name || "System"}</p>
          {entry.input_label && <p><strong>Input</strong><span>{entry.input_label}</span></p>}
          {entry.output_label && <p><strong>Output</strong><span>{entry.output_label}</span></p>}
          {entry.duration_ms != null && <p><strong>Duration</strong><span>{entry.duration_ms < 1000 ? `${entry.duration_ms} ms` : `${(entry.duration_ms / 1000).toFixed(2)} sec`}</span></p>}
          {entry.reason && <p className="invoice-timeline-reason"><strong>Reason</strong><span>{entry.reason}</span></p>}
          {canRerun && <Button variant="secondary" disabled={rerunning === entry.id || actionState.disabled} title={actionState.title} onClick={() => void rerun(entry)}>{rerunning === entry.id ? "Requesting…" : "Re-run"}</Button>}
        </article>
      </li>;
    })}</ol>
  </section>;
}
