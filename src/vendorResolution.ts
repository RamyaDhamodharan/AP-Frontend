export async function addAndResolveVendor(input: {
  name: string;
  taxId?: string;
  create: (payload: { name: string; tax_id: string | null }) => Promise<{ id: string }>;
  resolve: (vendorId: string, payload: { name: string; tax_id: string | null }) => Promise<unknown>;
  onComplete?: () => void;
}): Promise<{ id: string }> {
  const payload = { name: input.name.trim(), tax_id: input.taxId?.trim() || null };
  const created = await input.create(payload);
  await input.resolve(created.id, payload);
  input.onComplete?.();
  return created;
}
