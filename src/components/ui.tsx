import { FileText } from "lucide-react";
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
};

export function Button({ variant = "secondary", loading = false, className = "", children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`ui-button ui-button-${variant} ${loading ? "ui-button-loading" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ui-card ${className}`.trim()} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-input ${className}`.trim()} {...props} />;
}

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className = "",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "success" | "neutral" | "error" | "blue" | "amber" | "green" | "gray" | "red";
  dot?: boolean;
  className?: string;
}) {
  const semanticTone = ({ blue: "info", amber: "warning", green: "success", gray: "neutral", red: "error" } as const)[tone as "blue" | "amber" | "green" | "gray" | "red"] || tone;
  return <span className={`ui-badge ui-badge-${semanticTone} ${className}`.trim()}>{dot && <i aria-hidden="true" />}{children}</span>;
}

export function StatusPill(props: Parameters<typeof Badge>[0]) { return <Badge {...props} />; }

export type TabOption<T extends string = string> = { id: T; label: ReactNode; count?: number };
export function Tabs<T extends string>({ label, tabs, value, onChange }: {
  label: string;
  tabs: TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === value));
  return (
    <div
      className="ui-tabs"
      role="tablist"
      aria-label={label}
      style={{
        "--active-tab": activeIndex,
        "--tab-count": Math.max(1, tabs.length),
      } as CSSProperties}
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={value === tab.id ? "active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}{tab.count !== undefined && <b>{tab.count}</b>}
        </button>
      ))}
      <span className="ui-tabs-indicator" aria-hidden="true" />
    </div>
  );
}

export function Avatar({ label, className = "" }: { label: string; className?: string }) {
  return <span className={`avatar ${className}`.trim()} aria-label={label}>{label.slice(0, 1).toUpperCase()}</span>;
}

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-skeleton ${className}`.trim()} aria-hidden="true" {...props} />;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        <FileText size={18} strokeWidth={1.75} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
