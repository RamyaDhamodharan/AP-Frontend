
import { useState } from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import "./styles/globals.css";

const AUTH_URL = import.meta.env.VITE_AUTH_API_URL;

function App() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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
        setMessage(
          response.data.must_change_password
            ? "Login successful. Password change is required."
            : "Login successful! Authentication is working.",
        );
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

  return (
    <main className="shell">
      <section className="auth-card">
        <p className="eyebrow">GENWORX · FINANCE OPERATIONS</p>
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
                onChange={(e) => setFullName(e.target.value)}
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
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        <p className="footnote">Secure access · GenWorx AP</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
