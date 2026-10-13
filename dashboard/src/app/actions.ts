'use server';

import { revalidatePath } from 'next/cache';
import { isStatus, setIncidentStatus } from '@/lib/incidents';

// Form action for Resolve / Ignore / Reopen. Everything arriving here is untrusted input.
export async function changeStatus(formData: FormData): Promise<void> {
  const id = Number(formData.get('id'));
  const status = formData.get('status');

  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid incident id');
  if (!isStatus(status)) throw new Error('Invalid status');

  await setIncidentStatus(id, status);
  revalidatePath('/');
  revalidatePath(`/incidents/${id}`);
}
