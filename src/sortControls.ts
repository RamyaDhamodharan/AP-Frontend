export type SortDirection = "asc" | "desc";

export function toggleSortDirection(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

export function defaultSortLabel(sortBy: string, direction: SortDirection): string {
  const label = sortBy.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  return `${label} ${direction === "asc" ? "ascending" : "descending"}`;
}
