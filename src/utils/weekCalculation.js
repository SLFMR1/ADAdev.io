// ES Module version for frontend
// Re-implementation of week calculation utilities as ES modules

/**
 * Get ISO week number for a given date
 */
export function getISOWeekNumber(date) {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);
  
  // Thursday in current week decides the year
  dateObj.setDate(dateObj.getDate() + 3 - (dateObj.getDay() + 6) % 7);
  
  // January 4 is always in week 1
  const week1 = new Date(dateObj.getFullYear(), 0, 4);
  
  // Adjust to Thursday in week 1 and count weeks from there
  return 1 + Math.round(((dateObj.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

/**
 * Get the start of the week (Sunday) for a given date
 */
export function getWeekStart(date) {
  const dateObj = new Date(date);
  const day = dateObj.getDay();
  const diff = dateObj.getDate() - day;
  const weekStart = new Date(dateObj.setDate(diff));
  
  // Set to beginning of day
  weekStart.setHours(0, 0, 0, 0);
  
  return weekStart;
}

/**
 * Get the start of the current week (Sunday)
 */
export function getCurrentWeekStart() {
  return getWeekStart(new Date());
}

/**
 * Check if a given date is in the current week
 */
export function isCurrentWeek(date) {
  const dateObj = new Date(date);
  const currentWeekStart = getCurrentWeekStart();
  const weekStart = getWeekStart(dateObj);
  return weekStart.getTime() === currentWeekStart.getTime();
}