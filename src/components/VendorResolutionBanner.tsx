import { useState } from "react";
import { Building2, Link2, Plus } from "lucide-react";
import type { UnknownVendorInfo } from "./UnknownVendorPrompt";

type VendorOption = { id: string; name: string };

export function VendorResolutionBanner({
  info,
  vendors,
  canAddVendor,
  busy,
  error,
  onAdd,
  onSelect,
}: {
  info: UnknownVendorInfo;
  vendors: VendorOption[];
  canAddVendor: boolean;
  busy?: boolean;
  error?: string;
  onAdd: () => void;
  onSelect: (vendorId: string) => void;
}) {
  const [selectedVendor, setSelectedVendor] = useState("");
  return <div className="notice warning vendor-resolution-banner" role="status">
    <div className="vendor-resolution-copy"><Building2 size={18} strokeWidth={1.75} aria-hidden="true"/><span>{info.suggestedVendors?.length === 1 ? <><strong>Did you mean {info.suggestedVendors[0].name}?</strong> Confirm the match or add a new vendor.</> : <><strong>New vendor.</strong> Add or select the vendor to continue matching.</>}{info.vendorName ? ` Extracted: ${info.vendorName}.` : ""}</span></div>
    <div className="vendor-resolution-actions">
      {info.suggestedVendors?.length === 1 && <button type="button" className="primary" onClick={() => onSelect(info.suggestedVendors![0].id)} disabled={busy}><Link2 size={18} strokeWidth={1.75} aria-hidden="true"/> Confirm</button>}
      <button type="button" className="secondary" onClick={onAdd} disabled={busy || !canAddVendor}><Plus size={18} strokeWidth={1.75} aria-hidden="true"/> {info.suggestedVendors?.length === 1 ? "Add new vendor" : "Add vendor"}</button>
      <label className="vendor-select-label"> <span className="sr-only">Select existing vendor</span><input list="vendor-resolution-options" aria-label="Select existing vendor" placeholder="Search existing vendors" value={selectedVendor} disabled={busy} onChange={event => setSelectedVendor(event.target.value)}/></label>
      <datalist id="vendor-resolution-options">{vendors.map(vendor => <option key={vendor.id} value={vendor.name}/>)}</datalist>
      <button type="button" className="secondary" disabled={busy || !selectedVendor} onClick={() => { const selected = vendors.find(vendor => vendor.name === selectedVendor); if (selected) onSelect(selected.id); }}><Link2 size={18} strokeWidth={1.75} aria-hidden="true"/> Select existing vendor</button>
      <span className="sr-only">Selecting a vendor links the extracted name as an alias.</span>
    </div>
    {error && <p className="vendor-resolution-error" role="alert">{error} Select an existing vendor if the name or tax ID is already registered.</p>}
  </div>;
}
