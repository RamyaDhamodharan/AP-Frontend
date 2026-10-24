export function canSeeAdminNavigation(role?: string | null): boolean {
  return role === "admin";
}

export function canAccessLogs(role?: string | null): boolean {
  return canSeeAdminNavigation(role);
}

/** Authenticated admins and associates may create vendors. Mutations to an
 * existing vendor remain admin-only in the page and are enforced by Core. */
export function canCreateVendor(role?: string | null): boolean {
  return role === "admin" || role === "associate";
}
