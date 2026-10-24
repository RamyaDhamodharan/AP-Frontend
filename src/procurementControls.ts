export function confidenceLabel(value: unknown): "High" | "Medium" | "Low" | "Unverified" {
  const numberValue = typeof value === "number"
    ? value
    : typeof value === "object" && value && "confidence" in value
      ? Number((value as { confidence?: unknown }).confidence)
      : Number(value);
  if (!Number.isFinite(numberValue)) return "Unverified";
  if (numberValue >= 90) return "High";
  if (numberValue >= 75) return "Medium";
  return "Low";
}
