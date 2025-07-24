// Server-side CommonJS version of resources for dynamic import compatibility
// This file exports the same data as resources_enhanced.js but in CommonJS format

const { readFileSync } = require('fs');
const path = require('path');

// Read the ES6 module file and parse it
const resourcesPath = path.join(__dirname, 'resources.js');
const resourcesContent = readFileSync(resourcesPath, 'utf8');

// Extract the cardanoResources object using a more robust approach
// Look for the export const cardanoResources = { pattern
const exportMatch = resourcesContent.match(/export const cardanoResources = ({[\s\S]*});?\s*$/);

if (!exportMatch) {
  console.error('❌ Could not parse cardanoResources from resources.js');
  console.error('📄 File content preview:', resourcesContent.substring(0, 500));
  throw new Error('Could not parse cardanoResources from resources.js');
}

try {
  // Evaluate the extracted object
  const cardanoResources = eval(`(${exportMatch[1]})`);
  
  // Validate the structure
  if (!cardanoResources || typeof cardanoResources !== 'object') {
    throw new Error('Invalid cardanoResources structure');
  }
  
  // Log success
  const totalResources = Object.values(cardanoResources).reduce((sum, category) => {
    return sum + (Array.isArray(category) ? category.length : 0);
  }, 0);
  
  console.log(`✅ Successfully loaded ${totalResources} resources from resources.js`);
  
  module.exports = { cardanoResources };
} catch (error) {
  console.error('❌ Error evaluating cardanoResources:', error);
  throw new Error(`Failed to load cardanoResources: ${error.message}`);
} 