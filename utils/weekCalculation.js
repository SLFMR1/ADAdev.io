/**
 * Calculate ISO week number (1-52/53) for a given date
 * This ensures consistent week numbering across the entire application
 * 
 * @param {Date} date - The date to calculate week number for
 * @returns {number} Week number (1-52, occasionally 53)
 */
function getISOWeekNumber(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7; // Monday = 0, Sunday = 6
  target.setDate(target.getDate() - dayNr + 3); // Thursday of this week
  const firstThursday = target.valueOf();
  target.setMonth(0, 1); // January 1st
  if (target.getDay() !== 4) { // If Jan 1st is not Thursday
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7); // First Thursday of year
  }
  return 1 + Math.ceil((firstThursday - target) / 604800000); // 604800000 = 7 * 24 * 60 * 60 * 1000
}

/**
 * Get the start of the ISO week (Monday) for a given date
 * This maintains consistency with our Sunday-based database storage
 * 
 * @param {Date} date - The date to get week start for
 * @returns {Date} Monday of the week containing the given date
 */
function getWeekStart(date) {
  const target = new Date(date.valueOf());
  const dayOfWeek = target.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday = 6 days back to Monday
  target.setDate(target.getDate() - daysToMonday);
  target.setHours(0, 0, 0, 0); // Start of day
  return target;
}

module.exports = {
  getISOWeekNumber,
  getWeekStart
};