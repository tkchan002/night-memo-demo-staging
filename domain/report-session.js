export const SUBMISSION_WINDOW_MINUTES = 120;

export function submissionCutoff(now = new Date(), minutes = SUBMISSION_WINDOW_MINUTES) {
  const ms = Math.max(1, Number(minutes) || SUBMISSION_WINDOW_MINUTES) * 60 * 1000;
  return new Date(new Date(now).getTime() - ms);
}

export function reportSubmittedAt(report) {
  return report?.submitted_at || report?.updated_at || report?.created_at || report?.payload?.savedAt || null;
}

export function isRecentSubmission(report, now = new Date(), minutes = SUBMISSION_WINDOW_MINUTES) {
  const value = reportSubmittedAt(report);
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= submissionCutoff(now, minutes).getTime();
}
