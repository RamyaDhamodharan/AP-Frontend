import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  return <button className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ui-card ${className}`.trim()} {...props} />;
}

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className = "",
}: {
  children: ReactNode;
  tone?: "blue" | "amber" | "green" | "gray" | "red" | "neutral";
  dot?: boolean;
  className?: string;
}) {
  return <span className={`ui-badge ui-badge-${tone} ${className}`.trim()}>{dot && <i aria-hidden="true" />}{children}</span>;
}

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-skeleton ${className}`.trim()} aria-hidden="true" {...props} />;
}

export function Avatar({ name, className = "" }: { name: string; className?: string }) {
  const initials = name.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "?";
  return <span className={`ui-avatar ${className}`.trim()} aria-label={name} title={name}>{initials}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><path d="M13 5.5h15l8 8V40a2.5 2.5 0 0 1-2.5 2.5h-20A2.5 2.5 0 0 1 11 40V8a2.5 2.5 0 0 1 2-2.5Z"/><path d="M28 6v9h8M17 23h14M17 29h14M17 35h9"/></svg></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
