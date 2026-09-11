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

export type FieldOption = { value: string; label_en: string; label_ar: string };

/** The custom form definition stored on a request type (spec §3). */
export type RequestField = {
  key: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'file';
  required?: boolean;
  label_en: string;
  label_ar: string;
  options?: FieldOption[];
  /**
   * A `select` whose choices are looked up live instead of frozen into the
   * schema. Needed wherever the list is a moving target — the club buys and
   * retires equipment, so an asset list written into JSON is wrong within a
   * term. Unknown sources resolve to an empty list rather than an error, so
   * adding one later stays additive.
   */
  options_source?: keyof typeof OPTION_SOURCES;
  /**
   * Only ask this when another field holds one of these values — "if other,
   * what?" after a select, the room only for an in-person meeting. A hidden
   * field is not rendered, not submitted, and not required, on the client
   * and the server alike (`fieldApplies`).
   */
  show_when?: { key: string; value: string | string[] };
};

/** Whether a field is asked at all, given what the other fields hold. */
export function fieldApplies(
  field: Pick<RequestField, 'show_when'>,
  values: Record<string, unknown>,
): boolean {
  if (!field.show_when) return true;
  const current = values[field.show_when.key];
  if (current === undefined || current === null || current === '') return false;
  const wanted = Array.isArray(field.show_when.value)
    ? field.show_when.value
    : [field.show_when.value];
  return wanted.includes(String(current));
}

/**
 * Where a live-sourced select gets its rows.
 *
 * Each entry names a readable relation and how to turn a row into an option.
 * Note what `assets` reads: `requestable_assets`, the catalogue view — never
 * `assets` itself, which only Finance and the Presidency can see. A member
 * filing a request has to be able to pick the camera without being able to
 * read who currently has it.
 */
const OPTION_SOURCES = {
  /** Club equipment, for an Asset Request. Shows whether it is free today. */
  assets: {
    from: 'requestable_assets',
    select: 'id, tag, name_en, name_ar, is_available',
    order: 'name_en',
    label: (row: SourceRow) => {
      const tag = row.tag ? ` (${row.tag})` : '';
      const suffix = row.is_available === false ? ' — ⛔' : '';
      return {
        label_en: `${row.name_en}${tag}${suffix}`,
        label_ar: `${row.name_ar}${tag}${suffix}`,
      };
    },
  },
  /** Rooms in service, for an in-person Meeting Request. */
  rooms: {
    from: 'pickable_rooms',
    select: 'id, name_en, name_ar',
    order: 'name_en',
    label: plainName,
  },
  /** The groups the CALLER may book a room as — see migration 0030. */
  booking_identities: {
    from: 'my_booking_identities',
    select: 'id, name_en, name_ar',
    order: 'name_en',
    label: plainName,
  },
  /** People the caller may assign a task to — see migration 0040. */
  assignable_members: {
    from: 'assignable_members',
    select: 'id, name_en, name_ar',
    order: 'name_en',
    label: plainName,
  },
  /** Projects, for tying a Design or Media Request to one (optional). */
  projects: {
    from: 'projects',
    select: 'id, name_en, name_ar',
    order: 'name_en',
    label: plainName,
  },
} as const;

/** Where an uploaded answer to a `file` field goes. */
export const REQUEST_FILE_BUCKET = 'design-files';

/** Mirrors the bucket's own limit (migration 0035). */
export const MAX_REQUEST_FILE_BYTES = 10 * 1024 * 1024;

type SourceRow = {
  id: string;
  name_en: string;
  name_ar: string;
  tag?: string | null;
  is_available?: boolean | null;
};

function plainName(row: SourceRow) {
  return { label_en: row.name_en, label_ar: row.name_ar };
}

export type OptionSource = keyof typeof OPTION_SOURCES;

/** Resolved options, keyed by source name. */
export type FieldOptions = Partial<Record<OptionSource, FieldOption[]>>;

/**
 * Loads every live option list the given types actually reference.
 *
 * Both the new-request form and the request detail page call this — the form
 * to render the select, the detail page to turn the stored id back into a
 * name. Sharing it is what stops those two disagreeing about what an id means.
 */
export async function loadFieldOptions(
  supabase: SupabaseClient,
  types: Array<{ field_schema: RequestField[] | null }>,
): Promise<FieldOptions> {
  const needed = new Set<OptionSource>();
  for (const type of types) {
    for (const field of type.field_schema ?? []) {
      if (field.options_source && field.options_source in OPTION_SOURCES) {
        needed.add(field.options_source);
      }
    }
  }

  const resolved: FieldOptions = {};

  await Promise.all(
    [...needed].map(async (source) => {
      const spec = OPTION_SOURCES[source];
      const { data } = await supabase.from(spec.from).select(spec.select).order(spec.order);

      resolved[source] = ((data ?? []) as unknown as SourceRow[]).map((row) => ({
        value: String(row.id),
        ...spec.label(row),
      }));
    }),
  );

  return resolved;
}

/**
 * The label for a stored value, for read-only display.
 *
 * Falls back to the raw value: a request is a permanent record, and an asset
 * that has since been retired must still show as *something* on the request
 * that borrowed it.
 */
export function optionLabel(
  field: RequestField,
  value: string,
  options: FieldOptions,
  locale: string,
): string {
  const list = field.options_source
    ? (options[field.options_source] ?? [])
    : (field.options ?? []);
  const match = list.find((option) => option.value === value);
  if (!match) return value;
  return locale === 'ar' ? match.label_ar : match.label_en;
}
