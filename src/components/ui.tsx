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
