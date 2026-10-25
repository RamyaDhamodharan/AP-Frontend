import { useState, useRef, useId, type MouseEvent, type ReactNode } from "react";
import { ArrowRight, TrendingUp, TrendingDown, Clock, FileText } from "lucide-react";
import { Badge, Card } from "./ui";
import { useCountUp } from "../motion/useCountUp";
import { isReducedMotionPreferred } from "../motion/useCountUp";
import { useStagger } from "../motion/useStagger";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({
  data,
  width = 96,
  height = 32,
  color = "var(--orange)",
  className = "",
}: SparklineProps) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const points = data.map((val, idx) => {
    const x = padding + (idx / (data.length - 1)) * usableWidth;
    const y = height - padding - ((val - min) / range) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(" L ")}`;
  const reduced = isReducedMotionPreferred();

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`sparkline-svg ${className}`.trim()}
      aria-hidden="true"
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={reduced ? "" : "sparkline-path"}
      />
    </svg>
  );
}

export function KpiCardWithSparkline({
  label,
  value,
  formattedValue,
  tone,
  icon,
  trendPercent,
  trendDirection = "up",
  sparklineData,
  onClick,
}: {
  label: string;
  value: number;
  formattedValue?: string;
  tone: "accent" | "amber" | "green" | "gray" | "blue";
  icon: ReactNode;
  trendPercent?: number;
  trendDirection?: "up" | "down" | "neutral";
  sparklineData: number[];
  onClick: () => void;
}) {
  const animatedValue = useCountUp(value, 600);
  const display = formattedValue ?? animatedValue.toLocaleString("en-IN");
  const strokeColor =
    tone === "accent"
      ? "var(--orange)"
      : tone === "green"
      ? "var(--success)"
      : tone === "amber"
      ? "var(--warning)"
      : tone === "blue"
      ? "var(--info)"
      : "var(--navy)";

  return (
    <Card className={`kpi-card kpi-${tone} kpi-card-motion`}>
      <button className="kpi-card-button" onClick={onClick} type="button">
        <div className="kpi-card-top">
          <span className="kpi-icon">{icon}</span>
          {trendPercent !== undefined && (
            <span className={`kpi-trend kpi-trend-${trendDirection} fade-in`}>
              {trendDirection === "up" ? (
                <TrendingUp size={12} strokeWidth={2.5} />
              ) : trendDirection === "down" ? (
                <TrendingDown size={12} strokeWidth={2.5} />
              ) : null}
              {trendPercent > 0 ? `+${trendPercent}%` : `${trendPercent}%`}
            </span>
          )}
        </div>
        <span className="kpi-label">{label}</span>
        <div className="kpi-number-row">
          <strong className="kpi-value">{display}</strong>
          <Sparkline data={sparklineData} color={strokeColor} width={76} height={26} />
        </div>
        <span className="kpi-link">
          View details <span aria-hidden="true"><ArrowRight size={14} /></span>
        </span>
      </button>
    </Card>
  );
}

export interface DonutSegment {
  id: string;
  label: string;
  count: number;
  color: string;
  tone: "success" | "warning" | "info" | "neutral" | "error";
}

export function StatusDistributionDonut({
  segments,
  total,
  onSegmentClick,
}: {
  segments: DonutSegment[];
  total: number;
  onSegmentClick?: (segmentId: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title: string; subtitle: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartId = useId();

  const size = 190;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;
  const arcs = segments.map((seg) => {
    const fraction = total > 0 ? seg.count / total : 0;
    const strokeDash = fraction * circumference;
    const offset = cumulativeOffset;
    cumulativeOffset += strokeDash;
    const percent = total > 0 ? Math.round(fraction * 100) : 0;
    return {
      ...seg,
      fraction,
      strokeDash,
      offset,
      percent,
    };
  });

  const handleMouseMove = (e: MouseEvent<SVGCircleElement>, seg: (typeof arcs)[0]) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setHoveredId(seg.id);
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      title: `${seg.label}: ${seg.count}`,
      subtitle: `${seg.percent}% of total invoices`,
    });
  };

  const handleMouseLeave = () => {
    setHoveredId(null);
    setTooltip(null);
  };

  const reduced = isReducedMotionPreferred();

  return (
    <div className="donut-chart-container" ref={containerRef}>
      <div className="donut-graphic-wrapper">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className={`donut-svg ${reduced ? "" : "donut-sweep-in"}`}
          aria-labelledby={`${chartId}-desc`}
          role="img"
        >
          <desc id={`${chartId}-desc`}>Invoice status distribution chart</desc>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
          />
          {arcs.map((seg) => {
            if (seg.count <= 0) return null;
            const isHovered = hoveredId === seg.id;
            const currentStroke = isHovered ? strokeWidth + 4 : strokeWidth;
            return (
              <circle
                key={seg.id}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={currentStroke}
                strokeDasharray={`${seg.strokeDash} ${circumference - seg.strokeDash}`}
                strokeDashoffset={-seg.offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                className={`donut-segment ${isHovered ? "segment-hovered" : ""}`}
                style={{
                  transition: "stroke-width var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
                  cursor: onSegmentClick ? "pointer" : "default",
                }}
                onMouseMove={(e) => handleMouseMove(e, seg)}
                onMouseLeave={handleMouseLeave}
                onClick={() => onSegmentClick?.(seg.id)}
              />
            );
          })}
        </svg>

        <div className="donut-center-label" aria-hidden="true">
          <strong className="donut-center-total">{total}</strong>
          <span className="donut-center-sub">Invoices</span>
        </div>
      </div>

      <div className="donut-legend">
        {arcs.map((seg) => {
          const isHighlighted = hoveredId === seg.id;
          return (
            <div
              key={seg.id}
              className={`donut-legend-item ${isHighlighted ? "legend-highlighted" : ""}`}
              onMouseEnter={() => setHoveredId(seg.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSegmentClick?.(seg.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSegmentClick?.(seg.id);
                }
              }}
            >
              <div className="donut-legend-info">
                <Badge tone={seg.tone} dot>{seg.label}</Badge>
                <span className="donut-legend-count">{seg.count.toLocaleString("en-IN")}</span>
              </div>
              <small className="donut-legend-pct">{seg.percent}%</small>
            </div>
          );
        })}
      </div>

      {tooltip && (
        <div
          className="chart-floating-tooltip"
          style={{
            left: `${tooltip.x + 12}px`,
            top: `${tooltip.y + 12}px`,
          }}
          role="tooltip"
        >
          <b>{tooltip.title}</b>
          <small>{tooltip.subtitle}</small>
        </div>
      )}
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  subValue?: string;
  color?: string;
  tone?: string;
}

export function AnimatedBarChart({
  data,
  title,
  subtitle,
  unit = "",
}: {
  data: BarDatum[];
  title?: string;
  subtitle?: string;
  unit?: string;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title: string; subtitle: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>, item: BarDatum) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      title: item.label,
      subtitle: `${item.value} ${unit}${item.subValue ? ` (${item.subValue})` : ""}`,
    });
  };

  return (
    <div className="animated-bar-chart" ref={containerRef}>
      {title && (
        <div className="bar-chart-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
        </div>
      )}
      <div className="bar-chart-plot">
        {data.map((item, index) => {
          const heightPercent = Math.max(4, Math.round((item.value / maxValue) * 100));
          const staggerStyle = useStagger(index, 30, 240);
          return (
            <div
              key={item.label}
              className="bar-column"
              onMouseMove={(e) => handleMouseMove(e, item)}
              onMouseLeave={() => setTooltip(null)}
            >
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    height: `${heightPercent}%`,
                    backgroundColor: item.color || "var(--navy)",
                    ...staggerStyle,
                  }}
                />
              </div>
              <span className="bar-label">{item.label}</span>
              <b className="bar-value">{item.value}</b>
            </div>
          );
        })}
      </div>

      {tooltip && (
        <div
          className="chart-floating-tooltip"
          style={{
            left: `${tooltip.x + 8}px`,
            top: `${tooltip.y - 36}px`,
          }}
          role="tooltip"
        >
          <b>{tooltip.title}</b>
          <small>{tooltip.subtitle}</small>
        </div>
      )}
    </div>
  );
}

export function RecentActivityFeed({
  invoices,
  onOpenInvoice,
}: {
  invoices: Array<{
    invoice_id: string;
    vendor_name?: string | null;
    invoice_no?: string | null;
    status: string;
    total_amount?: number | string | null;
    currency?: string | null;
    received_at?: string | null;
    invoice_date?: string | null;
  }>;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const recentItems = invoices.slice(0, 8);

  if (!recentItems.length) {
    return null;
  }

  return (
    <Card className="dashboard-card recent-activity-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow purple">AUDIT TRAIL</span>
          <h2>Recent invoice activity</h2>
          <p className="muted">Latest invoices processed or updated.</p>
        </div>
      </div>
      <div className="recent-activity-list">
        {recentItems.map((inv, idx) => {
          const delayStyle = useStagger(idx, 30, 300);
          return (
            <button
              key={inv.invoice_id}
              className="recent-activity-row"
              onClick={() => onOpenInvoice(inv.invoice_id)}
              type="button"
              style={{ ...delayStyle, "--row-index": idx } as React.CSSProperties}
            >
              <span className="activity-icon">
                <Clock size={14} />
              </span>
              <div className="activity-info">
                <b>{inv.vendor_name || "Unknown vendor"}</b>
                <small>{inv.invoice_no || "Invoice"} · {inv.status.replace(/_/g, " ")}</small>
              </div>
              {inv.total_amount != null && (
                <span className="activity-amount">{String(inv.total_amount)} {inv.currency || ""}</span>
              )}
              <ArrowRight size={13} className="activity-arrow" />
            </button>
          );
        })}
      </div>
    </Card>
  );
}
