export type ConfidenceDisplay = { percent: number; label: "High" | "Medium" | "Low"; tone: "green" | "amber" | "red" };

export function confidenceDisplay(value: unknown): ConfidenceDisplay {
  const numeric = Number(value);
  const percent = Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
  if (percent >= 85) return { percent, label: "High", tone: "green" };
  if (percent >= 75) return { percent, label: "Medium", tone: "amber" };
  return { percent, label: "Low", tone: "red" };
}

export function groupLowConfidenceFields(fields: string[]): { header: string[]; lines: string[] } {
  return fields.reduce((groups, field) => {
    if (field.startsWith("line_")) groups.lines.push(field.replace(/^line_/, ""));
    else groups.header.push(field);
    return groups;
  }, { header: [] as string[], lines: [] as string[] });
}
