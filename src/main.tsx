
import { useState } from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import "./styles/globals.css";

const AUTH_URL = import.meta.env.VITE_AUTH_API_URL;
const CORE_URL = import.meta.env.VITE_CORE_API_URL;

type DocumentItem = {
  id: string;
  original_filename: string;
  status: string;
  raw_text?: string;
};

function App() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selected, setSelected] = useState<DocumentItem | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "register") {
        await axios.post(`${AUTH_URL}/api/auth/register`, {
          email,
          password,
          full_name: fullName,
        });
        setMode("login");
        setPassword("");
        setMessage("Registration successful. Please sign in.");
      } else {
        const response = await axios.post(`${AUTH_URL}/api/auth/login`, {
          email,
          password,
        });
        const accessToken =
          response.data.access_token ?? response.data.accessToken;

        if (accessToken) {
          setToken(accessToken);
          setMessage("");
        } else {
          setMessage(
            "Login response received, but no access token was returned. Check the Auth API response format.",
          );
        }
      }
    } catch (error) {
      setMessage(
        axios.isAxiosError(error)
          ? String(error.response?.data?.detail ?? error.message)
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadDocument(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      setMessage("File exceeds the 20 MB limit.");
      event.target.value = "";
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await axios.post(
        `${CORE_URL}/api/documents/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const item: DocumentItem = {
        id: response.data.id,
        original_filename: response.data.original_filename ?? file.name,
        status: response.data.status,
      };

      if (item.status === "duplicate_blocked") {
        setMessage("This document was already uploaded.");
      } else {
        setDocuments((previous) => [item, ...previous]);
        setSelected(item);
        setMessage("Document uploaded successfully.");
      }
    } catch (error) {
      setMessage(
        axios.isAxiosError(error)
          ? String(error.response?.data?.detail ?? error.message)
          : "Upload failed.",
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function parseDocument(item: DocumentItem) {
    setMessage("");

    try {
      const response = await axios.post(
        `${CORE_URL}/api/documents/${item.id}/parse`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );

      const updated = { ...item, ...response.data };
      setDocuments((previous) =>
        previous.map((doc) => (doc.id === item.id ? updated : doc)),
      );
      setSelected(updated);
      setMessage("Document parsing completed.");
    } catch (error) {
      setMessage(
        axios.isAxiosError(error)
          ? String(error.response?.data?.detail ?? error.message)
          : "Document parsing failed.",
      );
    }
  }

  if (!token) {
    return (
      <main className="shell">
        <section className="auth-card">
          <p className="eyebrow">GENWORX / FINANCE OPERATIONS</p>
          <h1>Accounts Payable Assistant</h1>
          <p className="muted">
            {mode === "login"
              ? "Sign in to your finance workspace."
              : "Create your associate account."}
          </p>

          <div className="auth-tabs">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setMessage("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setMessage("");
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="form-stack">
            {mode === "register" && (
              <label>
                Full name
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  minLength={2}
                  maxLength={150}
                  required
                />
              </label>
            )}
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={mode === "register" ? 12 : 1}
                maxLength={128}
                required
              />
            </label>
            <button className="primary-button" disabled={loading}>
              {loading
                ? "Please wait..."
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>

          {message && <p className="notice" role="status">{message}</p>}
          <p className="footnote">Secure access / GenWorx AP</p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <p className="eyebrow">GENWORX</p>
        <h2>AP Assistant</h2>
        <p className="muted">Finance workspace</p>
        <div className="sidebar-link active">Documents</div>
        <button
          className="secondary-button"
          onClick={() => {
            setToken("");
            setDocuments([]);
            setSelected(null);
            setMessage("");
          }}
        >
          Sign out
        </button>
      </aside>

      <section className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">FINANCE OPERATIONS</p>
            <h1>Document workspace</h1>
            <p className="muted">
              Upload documents and extract their text for review.
            </p>
          </div>
          <label className="primary-button upload-button">
            {uploading ? "Uploading..." : "＋ Upload document"}
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.eml"
              onChange={uploadDocument}
              disabled={uploading}
              hidden
            />
          </label>
        </header>

        {message && <p className="notice" role="status">{message}</p>}

        <div className="status-grid">
          <article>
            <span>Total documents</span>
            <strong>{documents.length}</strong>
            <small>Uploaded this session</small>
          </article>
          <article>
            <span>Parsed</span>
            <strong>
              {documents.filter((doc) => doc.status === "parsed").length}
            </strong>
            <small>Text extraction completed</small>
          </article>
          <article>
            <span>Awaiting parsing</span>
            <strong>
              {documents.filter((doc) => doc.status === "received").length}
            </strong>
            <small>Ready to process</small>
          </article>
        </div>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Uploaded documents</h2>
              <p className="muted">Select a document to review its status.</p>
            </div>
          </div>

          {documents.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">↑</span>
              <h3>No documents yet</h3>
              <p>Upload a PDF, image, or email file to get started.</p>
            </div>
          ) : (
            <div className="document-list">
              {documents.map((doc) => (
                <article
                  className={`document-row ${selected?.id === doc.id ? "selected" : ""}`}
                  key={doc.id}
                >
                  <button
                    className="document-name"
                    onClick={() => setSelected(doc)}
                  >
                    <span className="file-icon">FILE</span>
                    <span>
                      <strong>{doc.original_filename}</strong>
                      <small>{doc.id}</small>
                    </span>
                  </button>
                  <span className={`status-pill ${doc.status}`}>
                    {doc.status}
                  </span>
                  {doc.status === "received" && (
                    <button
                      className="secondary-button"
                      onClick={() => parseDocument(doc)}
                    >
                      Parse
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {selected && (
          <section className="panel">
            <h2>Document details</h2>
            <p><strong>Filename:</strong> {selected.original_filename}</p>
            <p><strong>Status:</strong> {selected.status}</p>
            <p><strong>Document ID:</strong> {selected.id}</p>
            <h3>Extracted text</h3>
            <pre className="text-preview">
              {selected.raw_text ??
                "No extracted text available yet. Select Parse to process this document."}
            </pre>
            <p className="muted">
              Classification will be connected when the backend endpoint is available.
            </p>
          </section>
        )}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
