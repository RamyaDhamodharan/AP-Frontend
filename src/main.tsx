import { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import "./styles/globals.css";

const AUTH_URL = import.meta.env.VITE_AUTH_API_URL;
const CORE_URL = import.meta.env.VITE_CORE_API_URL;

type Doc = {
  id: string;
  original_filename: string;
  status: string;
  extracted_json?: Record<string, unknown> | null;
  raw_text?: string | null;
  doc_type?: string | null;
  failure_message?: string | null;
};

const labels: Record<string, string> = {
  received: "Received", parsing: "Parsing", parsed: "Parsed",
  classified: "Classified", extracted: "Extracted", failed: "Failed",
  duplicate_blocked: "Duplicate",
};
const labelFor = (s: string) => labels[s] ?? s.replaceAll("_", " ");
const valueFor = (v: unknown) => v == null || v === "" ? "Not available" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);

function App() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  function updateDoc(doc: Doc) {
    setDocs(old => old.some(d => d.id === doc.id) ? old.map(d => d.id === doc.id ? { ...d, ...doc } : d) : [doc, ...old]);
    setSelected(old => old?.id === doc.id ? { ...old, ...doc } : doc);
  }

  async function authSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      if (mode === "register") {
        await axios.post(`${AUTH_URL}/api/auth/register`, { email, password, full_name: fullName });
        setMode("login"); setPassword(""); setMessage("Registration successful. Please sign in.");
      } else {
        const r = await axios.post(`${AUTH_URL}/api/auth/login`, { email, password });
        const t = r.data.access_token ?? r.data.accessToken;
        if (t) setToken(t); else setMessage("Login response did not include an access token.");
      }
    } catch (e) {
      setMessage(axios.isAxiosError(e) ? String(e.response?.data?.detail ?? e.message) : "Something went wrong.");
    } finally { setBusy(false); }
  }

  async function processDoc(doc: Doc) {
    updateDoc({ ...doc, status: "parsing", failure_message: null });
    setMessage("Processing document: parse → classify → extract…");
    try {
      const r = await axios.post(`${CORE_URL}/api/documents/${doc.id}/parse`, {}, { headers: { Authorization: `Bearer ${token}` } });
      const data = r.data ?? {};
      const updated: Doc = {
        ...doc, ...data, id: doc.id,
        original_filename: data.original_filename ?? doc.original_filename,
        status: data.status ?? "extracted",
        extracted_json: data.extracted_json ?? data.extracted_data ?? doc.extracted_json,
        raw_text: data.raw_text ?? data.text ?? doc.raw_text,
      };
      updateDoc(updated);
      setMessage(updated.status === "failed" ? updated.failure_message ?? "Processing failed." : `Processing finished: ${labelFor(updated.status)}.`);
    } catch (e) {
      const detail = axios.isAxiosError(e) ? String(e.response?.data?.detail ?? e.message) : "Document processing failed.";
      updateDoc({ ...doc, status: "failed", failure_message: detail }); setMessage(detail);
    }
  }

  async function uploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setMessage("File exceeds the 20 MB limit."); e.target.value = ""; return; }
    setBusy(true); setMessage("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await axios.post(`${CORE_URL}/api/documents/upload`, fd, { headers: { Authorization: `Bearer ${token}` } });
      const doc: Doc = { ...r.data, id: r.data.id, original_filename: r.data.original_filename ?? file.name, status: r.data.status ?? "received" };
      if (doc.status === "duplicate_blocked") setMessage("This document has already been uploaded.");
      else { updateDoc(doc); await processDoc(doc); }
    } catch (e) {
      setMessage(axios.isAxiosError(e) ? String(e.response?.data?.detail ?? e.message) : "Upload failed.");
    } finally { setBusy(false); e.target.value = ""; }
  }

  const filtered = useMemo(() => docs.filter(d =>
    (!search || d.original_filename.toLowerCase().includes(search.toLowerCase())) &&
    (filter === "all" || d.status === filter)
  ), [docs, search, filter]);
  const count = (statuses: string[]) => docs.filter(d => statuses.includes(d.status)).length;

  if (!token) return <main className="auth-shell">
    <section className="auth-hero">
      <div className="brand brand-light"><span className="brand-mark">G</span><span>GENWORX<small>FINANCE AUTOMATION</small></span></div>
      <div className="hero-copy"><span className="eyebrow">ACCOUNTS PAYABLE · AI WORKSPACE</span><h1>Less paperwork.<br /><em>More clarity.</em></h1><p>Invoices, payment advice, and purchase documents in one intelligent workspace.</p></div>
      <small className="hero-foot">● Document intelligence platform</small>
    </section>
    <section className="auth-side"><div className="auth-card">
      <div className="brand mobile-brand"><span className="brand-mark">G</span> GENWORX</div>
      <span className="eyebrow purple">WELCOME TO GENWORX</span><h2>{mode === "login" ? "Sign in to your workspace" : "Create your account"}</h2><p className="muted">{mode === "login" ? "Pick up where your finance team left off." : "Set up your finance workspace access."}</p>
      <div className="tabs"><button className={mode === "login" ? "active" : ""} type="button" onClick={() => { setMode("login"); setMessage(""); }}>Sign in</button><button className={mode === "register" ? "active" : ""} type="button" onClick={() => { setMode("register"); setMessage(""); }}>Register</button></div>
      <form className="form-stack" onSubmit={authSubmit}>
        {mode === "register" && <label>Full name<input value={fullName} onChange={e => setFullName(e.target.value)} minLength={2} maxLength={150} placeholder="Your name" required /></label>}
        <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={mode === "register" ? 12 : 1} maxLength={128} placeholder="Enter your password" autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        <button className="primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in →" : "Create account →"}</button>
      </form>
      {message && <p className="notice">{message}</p>}<p className="auth-foot">Secure access · GenWorx AP Assistant</p>
    </div></section>
  </main>;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">G</span><span>GENWORX<small>AP ASSISTANT</small></span></div>
      <p className="side-label">WORKSPACE</p><div className="nav-active">▦ <span>Documents</span><b>{docs.length}</b></div>
      <div className="side-bottom"><div className="ai-note"><span>✦</span><div><b>AI-powered processing</b><small>Parse · Classify · Extract</small></div></div><button className="signout" onClick={() => { setToken(""); setDocs([]); setSelected(null); setMessage(""); }}>↪ <span>Sign out</span></button><div className="profile"><span className="avatar">{(email[0] ?? "U").toUpperCase()}</span><div><b>{email}</b><small>Finance workspace</small></div></div></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div>Workspace <span>/</span> <b>Documents</b></div><div className="top-right"><i /> System workspace <span className="avatar">{(email[0] ?? "U").toUpperCase()}</span></div></header>
      <div className="content">
        <header className="welcome"><div><span className="eyebrow purple">FINANCE OPERATIONS</span><h1>Document workspace</h1><p className="muted">Upload, process, and review your accounts payable documents.</p></div><label className={`primary upload ${busy ? "disabled" : ""}`}>＋ Upload document<input type="file" accept=".pdf,.png,.jpg,.jpeg,.eml" onChange={uploadDoc} disabled={busy} hidden /></label></header>
        {message && <div className={`notice ${message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") ? "error" : ""}`}>{message}</div>}
        <section className="stats">
          <article><div>Total documents <span className="stat-icon violet">▤</span></div><strong>{docs.length}</strong><small>In this session</small></article>
          <article><div>Processing <span className="stat-icon amber">◷</span></div><strong>{count(["received","parsing","parsed","classified"])}</strong><small>In the pipeline</small></article>
          <article><div>Extracted <span className="stat-icon green">✓</span></div><strong>{count(["extracted"])}</strong><small>Ready for review</small></article>
          <article><div>Needs attention <span className="stat-icon red">!</span></div><strong>{count(["failed"])}</strong><small>Failed processing</small></article>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>Documents</h2><p className="muted">Your uploaded files and processing status.</p></div><span className="count">{filtered.length} files</span></div>
          <div className="toolbar"><label className="search">⌕ <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents…" /></label><select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter documents"><option value="all">All statuses</option><option value="received">Received</option><option value="parsing">Parsing</option><option value="parsed">Parsed</option><option value="classified">Classified</option><option value="extracted">Extracted</option><option value="failed">Failed</option></select></div>
          {filtered.length ? <div className="table-wrap"><table><thead><tr><th>DOCUMENT</th><th>STATUS</th><th>TYPE</th><th></th></tr></thead><tbody>{filtered.map(d => <tr key={d.id} className={selected?.id === d.id ? "selected-row" : ""} onClick={() => setSelected(d)}><td><div className="file"><span className="file-badge">PDF</span><div><b>{d.original_filename}</b><small>{d.id.slice(0,8)}…</small></div></div></td><td><span className={`pill ${d.status}`}><i />{labelFor(d.status)}</span></td><td>{d.doc_type ?? (d.extracted_json?.document_type as string | undefined) ?? "—"}</td><td><button className="view" onClick={e => { e.stopPropagation(); setSelected(d); }}>View details ↗</button></td></tr>)}</tbody></table></div> : <div className="empty"><div className="empty-icon">↑</div><h3>{docs.length ? "No matching documents" : "Your workspace is ready"}</h3><p>{docs.length ? "Try another search or status filter." : "Upload your first invoice or payment advice to start extracting data."}</p>{!docs.length && <label className="secondary">Choose a document<input type="file" accept=".pdf,.png,.jpg,.jpeg,.eml" onChange={uploadDoc} disabled={busy} hidden /></label>}</div>}
        </section>
        {selected && <section className="panel details"><div className="panel-head"><div><span className="eyebrow purple">DOCUMENT REVIEW</span><h2>{selected.original_filename}</h2><p className="muted">ID: {selected.id}</p></div><span className={`pill ${selected.status}`}><i />{labelFor(selected.status)}</span></div>
          {selected.failure_message && <div className="notice error">{selected.failure_message}</div>}
          {selected.extracted_json && Object.keys(selected.extracted_json).length ? <div className="extraction"><div className="extract-title"><div><h3>Extracted fields</h3><p className="muted">Values identified by the extraction pipeline.</p></div><b>✓ Extraction saved</b></div><div className="field-grid">{Object.entries(selected.extracted_json).map(([key,value]) => <article className="field" key={key}><span>{key.replaceAll("_"," ")}</span><strong className={value == null ? "missing" : ""}>{valueFor(value)}</strong></article>)}</div></div> : <div className="detail-empty"><span>⌁</span><div><b>{selected.status === "failed" ? "Processing needs attention" : "No extracted fields returned in the API response"}</b><p className="muted">Status: {labelFor(selected.status)}. If the database has extracted_json but this panel is empty, the parse endpoint response needs to return those fields or the frontend must fetch the document details endpoint.</p></div>{selected.status === "failed" && <button className="secondary" onClick={() => void processDoc(selected)}>Retry processing</button>}</div>}
          {selected.raw_text && <details className="raw"><summary>View parsed text</summary><pre>{selected.raw_text}</pre></details>}
        </section>}
        <footer className="footer"><span>GENWORX AP ASSISTANT</span><span>Document intelligence · Finance operations</span></footer>
      </div>
    </section>
  </main>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
