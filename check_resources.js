const { cardanoResources } = require('./src/data/resources.js');

const allResources = Object.values(cardanoResources).flat();
const withGitHub = allResources.filter(r => 
  r.social && r.social.github && 
  r.social.github !== 'n/a' && 
  r.social.github.includes('github.com')
);

console.log('=== RESOURCE SUMMARY ===');
console.log('Total resources:', allResources.length);
console.log('With valid GitHub URLs:', withGitHub.length);
console.log('');

console.log('=== RESOURCES WITH GITHUB (by category) ===');
const byCategory = {};
withGitHub.forEach(r => {
  if (!byCategory[r.category]) byCategory[r.category] = [];
  byCategory[r.category].push(r);
});

Object.keys(byCategory).forEach(cat => {
  console.log(`${cat}: ${byCategory[cat].length} resources`);
  byCategory[cat].forEach(r => {
    console.log(`  - ${r.name} (${r.type || 'unknown'}): ${r.social.github}`);
  });
  console.log('');
});

console.log('=== CHECKING FOR MISSING REPOS ===');
const possibleMissing = allResources.filter(r => 
  (!r.social || !r.social.github || r.social.github === 'n/a')
);
console.log(`Resources without GitHub URLs: ${possibleMissing.length}`);
possibleMissing.forEach(r => {
  console.log(`  - ${r.name} (${r.category})`);
});