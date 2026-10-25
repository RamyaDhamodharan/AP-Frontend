export type VendorIdentity = { id?: string; name?: string | null; tax_id?: string | null };
export function normalizeVendorValue(value?: string | null) { return (value || "").trim().toLocaleLowerCase().replace(/[\s\W_]+/g, ""); }
export function vendorMatches(identity: VendorIdentity, vendors: VendorIdentity[]) {
  const name = normalizeVendorValue(identity.name); const tax = normalizeVendorValue(identity.tax_id);
  if (!name && !tax) return true;
  return vendors.some(vendor => tax
    ? normalizeVendorValue(vendor.tax_id) === tax
    : normalizeVendorValue(vendor.name) === name);
}
