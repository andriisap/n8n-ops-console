'use server';

import { revalidatePath } from 'next/cache';
import { isStatus, requestReplay, setIncidentStatus } from '@/lib/incidents';

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

// Form action for Replay on one event. Queues a one-shot manual retry.
export async function replayEvent(formData: FormData): Promise<void> {
  const eventId = Number(formData.get('eventId'));
  const incidentId = Number(formData.get('incidentId'));
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw new Error('Invalid event id');
  if (!Number.isSafeInteger(incidentId) || incidentId <= 0) throw new Error('Invalid incident id');

  await requestReplay(eventId);
  revalidatePath(`/incidents/${incidentId}`);
}
