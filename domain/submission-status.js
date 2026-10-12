import { REPORT_TIME_ZONE } from '../core/dates.js';
import { reportSubmittedAt } from './report-session.js';

/** Independent status for each memo, not a ward-wide colour or row state. */
export function managerSubmissionStatus(report) {
  if (!report) return { state: 'missing', label: 'Not submitted', time: '' };
  const stamp = reportSubmittedAt(report);
  if (!stamp) return { state: 'submitted', label: 'Submitted', time: '' };
  const time = new Date(stamp).toLocaleTimeString('en-GB', {
    timeZone: REPORT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return { state: 'submitted', label: `Submitted ${time}`, time };
}

export function wardSubmissionStates({ pmReport = null, nightReport = null } = {}) {
  const pm = managerSubmissionStatus(pmReport);
  const night = managerSubmissionStatus(nightReport);
  const submitted = [pm, night].filter(state => state.state === 'submitted').length;
  return {
    pm,
    night,
    submitted,
    completeness: submitted === 2 ? 'complete' : submitted === 1 ? 'partial' : 'missing',
    missingTypes: ['pm', 'night'].filter(type => (type === 'pm' ? pm : night).state === 'missing'),
  };
}
