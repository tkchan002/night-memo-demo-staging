import { todayISO } from '../core/dates.js';

export const defaultReportDate = () => todayISO();
export const dateInRange = (date, start, end) => (!start || date >= start) && (!end || date <= end);
