/**
 * The CV rules, shared by the forms and the server (cv.ts). The forms check
 * them before sending, so a student is told at once and keeps what they
 * typed; the server checks them again because only its check counts.
 *
 * 4 MB, not the bucket's 5: Vercel refuses a request body over about 4.45 MB
 * with a 413 before the app runs (measured on production, 2026-10-11), so a
 * bigger file could never reach the server's own check or its message.
 */
export const MAX_CV_BYTES = 4 * 1024 * 1024;

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** The `errors.*` key for a CV the server would refuse, or null. */
export function cvProblem(file: File): 'not_pdf' | 'cv_too_large' | null {
  if (!isPdf(file)) return 'not_pdf';
  if (file.size > MAX_CV_BYTES) return 'cv_too_large';
  return null;
}
