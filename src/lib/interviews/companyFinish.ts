/**
 * Whether a company's feedback is what finishes an interview (0015,
 * 2026-10-14): on the interviewer's page "Interview done" opens the feedback
 * form, and saving it marks the interview done. On unless a manager turned
 * it off (Settings → Feedback, `company_finishes: false`); then the page
 * only takes feedback and the organizers mark interviews done, as before.
 */
export function companyFinishes(settings: { company_finishes?: unknown } | null | undefined): boolean {
  return settings?.company_finishes !== false;
}
