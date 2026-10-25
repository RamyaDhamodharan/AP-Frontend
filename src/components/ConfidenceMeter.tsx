import type { CSSProperties } from "react";
import { isReducedMotionPreferred } from "../motion/useCountUp.ts";
import { confidenceDisplay } from "../confidenceDisplay.ts";

interface ConfidenceMeterProps {
  value: unknown;
  variant?: "ring" | "bar";
  size?: number;
  showLabel?: boolean;
  className?: string;
}

export function ConfidenceMeter({
  value,
  variant = "ring",
  size = 40,
  showLabel = true,
  className = "",
}: ConfidenceMeterProps) {
  const { percent, label, tone } = confidenceDisplay(value);
  const strokeColor =
    tone === "green" ? "var(--success)" : tone === "amber" ? "var(--warning)" : "var(--error)";
  const textColor =
    tone === "green" ? "var(--success-text)" : tone === "amber" ? "var(--warning-text)" : "var(--error-text)";

  if (variant === "bar") {
    return (
      <div
        className={`confidence-bar-widget confidence-tone-${tone} ${className}`.trim()}
        title={`Extraction confidence: ${percent}% (${label})`}
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Confidence: ${percent}% ${label}`}
      >
        <div className="confidence-track">
          <div
            className={`confidence-fill confidence-fill-${tone}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {showLabel && (
          <span className="confidence-label-text" style={{ color: textColor }}>
            <b>{percent}%</b> <small>{label}</small>
          </span>
        )}
      </div>
    );
  }

  // Ring variant (circular SVG meter)
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;
  const reduced = isReducedMotionPreferred();

  return (
    <div
      className={`confidence-ring-widget confidence-tone-${tone} ${className}`.trim()}
      title={`Extraction confidence: ${percent}% (${label})`}
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Confidence: ${percent}% ${label}`}
      style={{ width: size, height: size } as CSSProperties}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="confidence-svg">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={reduced ? strokeDashoffset : undefined}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="confidence-circle-fill"
          style={{
            strokeDashoffset,
            transition: reduced ? "none" : "stroke-dashoffset var(--motion-slow) var(--motion-ease)",
          }}
        />
      </svg>
      {showLabel && (
        <div className="confidence-ring-text">
          <span className="confidence-ring-pct" style={{ color: textColor }}>{percent}%</span>
          <span className="confidence-ring-tag">{label}</span>
        </div>
      )}
    </div>
  );
}
