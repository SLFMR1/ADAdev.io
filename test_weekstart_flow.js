#!/usr/bin/env node

const { getWeekStart } = require('./utils/weekCalculation.js');

console.log('=== TESTING COMPLETE DATA FLOW ===');

// Simulate processCommitsToWeekly logic (from server.js)
const processCommitsToWeekly = (commits) => {
  const weeklyData = new Map()
  
  commits.forEach((commit, index) => {
    const commitDate = commit.commit?.author?.date || commit.date
    if (!commitDate) return
    
    const date = new Date(commitDate)
    if (isNaN(date.getTime())) return
    
    const weekStart = getWeekStart(date)
    const weekKey = weekStart.toISOString().slice(0, 10)
    weeklyData.set(weekKey, (weeklyData.get(weekKey) || 0) + 1)
  })
  
  return Array.from(weeklyData.entries()).map(([weekStart, count]) => ({
    weekStart: weekStart,
    count: count
  }))
}

// Test with commits on different days
const testCommits = [
  { commit: { author: { date: '2025-07-13T09:00:00Z' } } }, // Sunday
  { commit: { author: { date: '2025-07-19T15:00:00Z' } } }, // Saturday  
  { commit: { author: { date: '2025-07-19T16:00:00Z' } } }, // Saturday (same week)
  { commit: { author: { date: '2025-07-20T10:00:00Z' } } }  // Sunday (next week)
];

console.log('Input commits:');
testCommits.forEach((commit, i) => {
  const date = new Date(commit.commit.author.date);
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getUTCDay()];
  console.log(`  ${i+1}. ${commit.commit.author.date} (${dayName})`);
});

console.log('\nProcessing through processCommitsToWeekly...');
const result = processCommitsToWeekly(testCommits);

console.log('\nResult - weeks with commit counts:');
result.forEach(week => {
  const date = new Date(week.weekStart);
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getUTCDay()];
  console.log(`  Week ${week.weekStart} (${dayName}): ${week.count} commits`);
});

console.log('\n=== VALIDATION ===');
console.log('✅ All weekStart dates should be Sundays');
console.log('✅ Saturday commits should be grouped with their Sunday');
console.log('✅ 2025-07-13 week should have 3 commits (Sun + 2 Sat)');
console.log('✅ 2025-07-20 week should have 1 commit (Sun)');

const allSundays = result.every(week => {
  const date = new Date(week.weekStart);
  return date.getUTCDay() === 0; // Sunday = 0
});

console.log(`\nAll weekStart dates are Sundays: ${allSundays ? '✅ YES' : '❌ NO'}`);