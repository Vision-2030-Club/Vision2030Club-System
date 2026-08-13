import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A request's status is only meaningful together with its type — every type
 * defines its own statuses. PostgREST can't embed across the composite
 * (request_type_id, status) foreign key, so we fetch the status rows for the
 * types in play and look names up client-side.
 */
export type StatusRow = {
  request_type_id: string;
  key: string;
  name_en: string;
  name_ar: string;
  is_terminal: boolean;
  is_approved: boolean;
};

export type StatusLookup = Map<string, StatusRow>;

const statusKey = (typeId: string, status: string) => `${typeId}:${status}`;

export async function loadStatusLookup(
  supabase: SupabaseClient,
  typeIds: string[],
): Promise<StatusLookup> {
  const lookup: StatusLookup = new Map();
  const unique = [...new Set(typeIds)].filter(Boolean);
  if (unique.length === 0) return lookup;

  const { data } = await supabase
    .from('request_statuses')
    .select('request_type_id, key, name_en, name_ar, is_terminal, is_approved')
    .in('request_type_id', unique);

  for (const row of (data ?? []) as StatusRow[]) {
    lookup.set(statusKey(row.request_type_id, row.key), row);
  }
  return lookup;
}

export function findStatus(
  lookup: StatusLookup,
  typeId: string,
  status: string,
): StatusRow | undefined {
  return lookup.get(statusKey(typeId, status));
}

/** The custom form definition stored on a request type (spec §3). */
export type RequestField = {
  key: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select';
  required?: boolean;
  label_en: string;
  label_ar: string;
  options?: { value: string; label_en: string; label_ar: string }[];
};
