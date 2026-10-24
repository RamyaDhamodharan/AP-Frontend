import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "./ui";
import { defaultSortLabel, toggleSortDirection, type SortDirection } from "../sortControls";

export type InvoiceQueryState = {
  status: string;
  vendor_id: string;
  due_date_from: string;
  due_date_to: string;
  amount_min: string;
  amount_max: string;
  gl_code: string;
  owner_user_id: string;
  sort_by: string;
  sort_dir: "asc" | "desc";
  page: number;
  source: string;
  bucket: string;
  search: string;
};

export type InvoiceQueryKey = Exclude<keyof InvoiceQueryState, "page">;
export type InvoiceQueryPatch = Partial<InvoiceQueryState>;

const defaults: InvoiceQueryState = {
  status: "", vendor_id: "", due_date_from: "", due_date_to: "", amount_min: "", amount_max: "",
  gl_code: "", owner_user_id: "", sort_by: "due_date", sort_dir: "asc", page: 1, source: "all", bucket: "ready_to_pay", search: "",
};
const stateKeys = Object.keys(defaults) as (keyof InvoiceQueryState)[];

function readQuery(): InvoiceQueryState {
  const params = new URLSearchParams(window.location.search);
  return {
    ...defaults,
    status: params.get("status") || "",
    vendor_id: params.get("vendor_id") || "",
    due_date_from: params.get("due_date_from") || "",
    due_date_to: params.get("due_date_to") || "",
    amount_min: params.get("amount_min") || "",
    amount_max: params.get("amount_max") || "",
    gl_code: params.get("gl_code") || "",
    owner_user_id: params.get("owner_user_id") || "",
    sort_by: params.get("sort_by") || (params.get("bucket") === "overdue" ? "days_overdue" : defaults.sort_by),
    sort_dir: params.get("sort_dir") === "asc" || params.get("sort_dir") === "desc"
      ? params.get("sort_dir") as SortDirection
      : params.get("bucket") === "overdue" ? "desc" : defaults.sort_dir,
    page: Math.max(1, Number(params.get("page") || 1) || 1),
    source: params.get("source") || "all",
    bucket: params.get("bucket") || "ready_to_pay",
    search: params.get("search") || "",
  };
}

export function useInvoiceQueryState() {
  const [filters, setFilters] = useState<InvoiceQueryState>(readQuery);

  useEffect(() => {
    const onPopState = () => setFilters(readQuery());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const update = useCallback((patch: InvoiceQueryPatch, resetPage = true) => {
    const next = { ...readQuery(), ...patch };
    if (resetPage && patch.page === undefined) next.page = 1;
    const params = new URLSearchParams(window.location.search);
    for (const key of stateKeys) {
      const value = next[key];
      if (value === "" || value === "all" || (key === "page" && value === 1) || (key === "sort_by" && value === defaults.sort_by) || (key === "sort_dir" && value === defaults.sort_dir)) params.delete(key);
      else params.set(key, String(value));
    }
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    setFilters(next);
  }, []);

  const clear = useCallback(() => update({
    status: "", vendor_id: "", due_date_from: "", due_date_to: "", amount_min: "", amount_max: "",
    gl_code: "", owner_user_id: "", sort_by: defaults.sort_by, sort_dir: defaults.sort_dir, page: 1, source: "all", bucket: "ready_to_pay", search: "",
  }, false), [update]);

  return { filters, update, clear };
}

export type FilterVendor = { id: string; name: string };
export type FilterOwner = { id: string; name: string; email?: string };
type FilterMode = "invoices" | "command-center";

const invoiceStatuses = [
  ["processing", "In progress"], ["needs_review", "Needs review"], ["ready_to_pay", "Ready to pay"], ["on_hold", "On hold"], ["rejected", "Rejected"],
];
const workflowStatuses = [
  ["received", "Received"], ["reading", "Reading"], ["verifying", "Verifying"], ["matching", "Matching"],
  ["match_approved", "Match approved"], ["match_issues", "Match issues"], ["no_match", "No match"],
  ["approved", "Approved"], ["overdue", "Overdue"], ["on_hold", "On hold"], ["rejected", "Rejected"],
  ["paid", "Paid"], ["resubmitted", "Resubmitted"], ["failed", "Failed"],
];

export function InvoiceFilters({
  mode, filters, vendors, owners, resultCount, onChange, onVendorSearch,
}: {
  mode: FilterMode;
  filters: InvoiceQueryState;
  vendors: FilterVendor[];
  owners: FilterOwner[];
  resultCount: number;
  onChange: (patch: InvoiceQueryPatch) => void;
  onVendorSearch: (query: string) => void;
}) {
  const [vendorText, setVendorText] = useState("");
  useEffect(() => {
    if (!filters.vendor_id) return;
    setVendorText(vendors.find(vendor => vendor.id === filters.vendor_id)?.name || "Selected vendor");
  }, [filters.vendor_id, vendors]);
  const id = useMemo(() => `vendor-list-${mode}`, [mode]);
  const vendorChange = (value: string) => {
    setVendorText(value);
    onVendorSearch(value);
    const selected = vendors.find(vendor => vendor.name.toLowerCase() === value.trim().toLowerCase());
    onChange({ vendor_id: selected?.id || "" });
  };
  const statuses = mode === "invoices" ? invoiceStatuses : workflowStatuses;
  const statusLabel = statuses.find(([value]) => value === filters.status)?.[1] || filters.status;
  const ownerLabel = owners.find(owner => owner.id === filters.owner_user_id)?.name || (filters.owner_user_id ? "Assigned owner" : "");
  const vendorLabel = vendors.find(vendor => vendor.id === filters.vendor_id)?.name || (filters.vendor_id ? "Selected vendor" : "");
  const active: { key: InvoiceQueryKey; label: string }[] = [];
  if (filters.vendor_id) active.push({ key: "vendor_id", label: `Vendor: ${vendorLabel}` });
  if (filters.status) active.push({ key: "status", label: `Status: ${statusLabel}` });
  if (filters.due_date_from) active.push({ key: "due_date_from", label: `Due from: ${filters.due_date_from}` });
  if (filters.due_date_to) active.push({ key: "due_date_to", label: `Due to: ${filters.due_date_to}` });
  if (filters.amount_min) active.push({ key: "amount_min", label: `Min amount: ${filters.amount_min}` });
  if (filters.amount_max) active.push({ key: "amount_max", label: `Max amount: ${filters.amount_max}` });
  if (filters.gl_code) active.push({ key: "gl_code", label: `GL code: ${filters.gl_code}` });
  if (filters.owner_user_id) active.push({ key: "owner_user_id", label: `Owner: ${ownerLabel}` });

  return <section className="invoice-filters" aria-label="Invoice filters">
    <div className="invoice-filter-grid">
      <label className="form-label">Vendor<input list={id} value={vendorText} onChange={event => vendorChange(event.target.value)} placeholder="Search vendors" aria-label="Search vendor"/><datalist id={id}>{vendors.map(vendor => <option key={vendor.id} value={vendor.name}/>)}</datalist></label>
      <label className="form-label">Status<select value={filters.status} onChange={event => onChange({ status: event.target.value })}><option value="">All statuses</option>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="form-label">Due date from<input type="date" value={filters.due_date_from} onChange={event => onChange({ due_date_from: event.target.value })}/></label>
      <label className="form-label">Due date to<input type="date" value={filters.due_date_to} onChange={event => onChange({ due_date_to: event.target.value })}/></label>
      <label className="form-label">Amount minimum<input type="number" min="0" step="0.01" value={filters.amount_min} onChange={event => onChange({ amount_min: event.target.value })} placeholder="0.00"/></label>
      <label className="form-label">Amount maximum<input type="number" min="0" step="0.01" value={filters.amount_max} onChange={event => onChange({ amount_max: event.target.value })} placeholder="0.00"/></label>
      <label className="form-label">GL code<input value={filters.gl_code} onChange={event => onChange({ gl_code: event.target.value })} placeholder="Any GL code"/></label>
      <label className="form-label">Owner<select value={filters.owner_user_id} onChange={event => onChange({ owner_user_id: event.target.value })}><option value="">All owners</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
    </div>
    <div className="invoice-filter-footer"><span className="filter-result-count" aria-live="polite">{resultCount.toLocaleString("en-IN")} results</span>{active.length > 0 && <div className="filter-chips" aria-label="Active filters">{active.map(filter => <button key={filter.key} type="button" className="filter-chip" onClick={() => onChange({ [filter.key]: "" })} aria-label={`Remove ${filter.label} filter`}>{filter.label}<X size={18} strokeWidth={1.75} aria-hidden="true"/></button>)}<Button variant="ghost" onClick={() => onChange({ status: "", vendor_id: "", due_date_from: "", due_date_to: "", amount_min: "", amount_max: "", gl_code: "", owner_user_id: "" })}>Clear all</Button></div>}</div>
  </section>;
}

const sorts = [
  ["due_date", "Due date"], ["amount", "Amount"], ["days_overdue", "Days overdue"], ["confidence", "Confidence"], ["date_received", "Date received"],
];

export function SortControl({ value, sortDir = "asc", onChange, onSortDirChange }: { value: string; sortDir?: "asc" | "desc"; onChange: (value: string) => void; onSortDirChange?: (value: "asc" | "desc") => void }) {
  const label = sorts.find(([key]) => key === value)?.[1] || "Due date";
  return <div className="sort-control"><label>Sort by<select aria-label="Sort invoices by" value={value} onChange={event => onChange(event.target.value)}>{sorts.map(([key, optionLabel]) => <option key={key} value={key}>{optionLabel}</option>)}</select></label><button type="button" className="sort-direction-toggle" aria-label={defaultSortLabel(label, sortDir)} aria-pressed={sortDir === "desc"} onClick={() => onSortDirChange?.(toggleSortDirection(sortDir))}>{sortDir === "asc" ? "Ascending ↑" : "Descending ↓"}</button></div>;
}
