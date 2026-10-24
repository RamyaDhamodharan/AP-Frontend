export function confidenceLabel(value: unknown): "High" | "Medium" | "Low" | "Unverified" {
  const numberValue = typeof value === "number"
    ? value
    : typeof value === "object" && value && "confidence" in value
      ? Number((value as { confidence?: unknown }).confidence)
      : Number(value);
  if (!Number.isFinite(numberValue)) return "Unverified";
  if (numberValue >= 85) return "High";
  if (numberValue >= 70) return "Medium";
  return "Low";
}

export function procurementStatusLabel(needsVerification?: boolean, vendorId?: string | null): "Needs verification" | "Vendor pending" | "Verified" {
  if (!vendorId) return "Vendor pending";
  return needsVerification ? "Needs verification" : "Verified";
}
