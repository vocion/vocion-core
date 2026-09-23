/**
 * The longest period the scorecard accepts, in days. Shared by the server
 * (which refuses anything longer, so one request cannot scan years of events)
 * and the date picker (which says so before the request is sent).
 */
export const MAX_SCORECARD_RANGE_DAYS = 366;
