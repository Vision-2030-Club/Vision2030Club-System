import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import { buildForm, DEFAULT_FORM, type Catalog, type FormQuestion, type Locale, type QuestionRow } from './form';

/**
 * A project's application form, read from the Quroosh database (0004) and
 * merged over the form's own questions (form.ts). Before 0004 is applied
 * the `questions` table is missing: the form is then the code's, and
 * `editable` is false, so nothing breaks and the editor says why.
 */
export async function loadForm(
  db: SupabaseClient,
  projectId: string,
): Promise<{ form: FormQuestion[]; editable: boolean }> {
  const { data, error } = await db
    .from('questions')
    .select(
      'key, section, sort_order, kind, builtin, required, hidden, label_en, label_ar, hint_en, hint_ar, options, min_value, max_value',
    )
    .eq('project_id', projectId);
  if (error) return { form: DEFAULT_FORM, editable: false };
  return { form: buildForm((data ?? []) as QuestionRow[]), editable: true };
}

/** A key under `quroosh.apply` in the request's language, for the form's wording (next-intl). */
export async function requestCatalog(locale: string): Promise<Catalog> {
  const t = await getTranslations({ locale, namespace: 'quroosh.apply' });
  return (key) => (t.has(key) ? t(key) : null);
}

function lookup(root: unknown, key: string): string | null {
  let node = root;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : null;
}

/** The same lookup straight from a catalog file, for code outside a request (the Google Sheet). */
export function fileCatalog(locale: Locale): Catalog {
  const apply = (locale === 'ar' ? ar : en).quroosh.apply;
  return (key) => lookup(apply, key);
}
