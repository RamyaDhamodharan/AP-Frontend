export function canSeeAdminNavigation(role?: string | null): boolean {
  return role === "admin";
}

export function canAccessLogs(role?: string | null): boolean {
  return canSeeAdminNavigation(role);
}

export function canCreateVendor(role?: string | null): boolean {
  return role === "admin";
}
