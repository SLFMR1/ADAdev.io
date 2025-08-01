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
 * Get the start of the GitHub week (Sunday) for a given date
 * This maintains consistency with GitHub's Sunday-based week system and our database storage
 * 
 * @param {Date} date - The date to get week start for
 * @returns {Date} Sunday of the week containing the given date
 */
function getWeekStart(date) {
  const target = new Date(date.valueOf());
  const dayOfWeek = target.getUTCDay(); // Use UTC day to avoid timezone issues
  // Sunday = 0, so subtract dayOfWeek to get to Sunday
  // But we need to go BACK to the previous Sunday, not forward
  target.setUTCDate(target.getUTCDate() - dayOfWeek);
  target.setUTCHours(0, 0, 0, 0); // Start of day in UTC
  return target;
}

/**
 * Get the start of the current week (Sunday) excluding incomplete current week
 * This is used for filtering out incomplete current week data
 * 
 * @returns {Date} Sunday of the current week
 */
function getCurrentWeekStart() {
  const now = new Date();
  return getWeekStart(now);
}

/**
 * Check if a given date is in the current incomplete week
 * 
 * @param {Date|string} date - The date to check
 * @returns {boolean} True if the date is in the current week
 */
function isCurrentWeek(date) {
  const dateObj = new Date(date);
  const currentWeekStart = getCurrentWeekStart();
  const weekStart = getWeekStart(dateObj);
  return weekStart.getTime() === currentWeekStart.getTime();
}

// CommonJS exports for Node.js server
module.exports = {
  getISOWeekNumber,
  getWeekStart,
  getCurrentWeekStart,
  isCurrentWeek
};