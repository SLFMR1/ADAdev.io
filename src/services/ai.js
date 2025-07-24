import { cardanoResources } from '../data/resources'
import { validateContent } from './rateLimiter'
import logger from '../utils/logger-frontend'

/**
 * Filter resources based on user input keywords
 * @param {Array} allResources - All available resources
 * @param {string} userInput - User's input
 * @returns {Array} - Filtered resources
 */
const filterRelevantResources = (allResources, userInput) => {
  const inputLower = userInput.toLowerCase()
  const keywords = inputLower.split(' ').filter(word => word.length > 2)
  
  // Define category priorities based on keywords
  const categoryPriorities = {
    'smart contract': ['Development Tools', 'Libraries & Languages'],
    'defi': ['Development Tools', 'Infrastructure & APIs', 'Wallets & User Tools'],
    'nft': ['Minting and NFTs', 'Development Tools'],
    'wallet': ['Wallets & User Tools', 'Development Tools'],
    'api': ['Infrastructure & APIs', 'Development Tools'],
    'security': ['Security & Auditing', 'Development Tools'],
    'ai': ['AI & Machine Learning', 'Development Tools'],
    'oracle': ['Oracles & External Data', 'Infrastructure & APIs'],
    'privacy': ['Privacy & Zero-Knowledge', 'Security & Auditing'],
    'identity': ['Identity & Authentication', 'Security & Auditing'],
    'analytics': ['Analytics & Data', 'Infrastructure & APIs'],
    'education': ['Education & Documentation'],
    'community': ['Community & Engagement'],
    'infrastructure': ['Core Infrastructure', 'Infrastructure & APIs'],
    'scaling': ['Layer 2 Scaling Solutions', 'Infrastructure & APIs'],
    'governance': ['Governance & DAOs', 'Community & Engagement']
  }
  
  // Score resources based on relevance
  const scoredResources = allResources.map(resource => {
    let score = 0
    
    // Check category priority
    for (const [keyword, priorityCategories] of Object.entries(categoryPriorities)) {
      if (inputLower.includes(keyword) && priorityCategories.includes(resource.category)) {
        score += 10
      }
    }
    
    // Check name and description matches
    if (resource.name.toLowerCase().includes(inputLower)) score += 5
    if (resource.description.toLowerCase().includes(inputLower)) score += 3
    
    // Check key solutions
    resource.keySolutions.forEach(solution => {
      if (solution.toLowerCase().includes(inputLower)) score += 2
    })
    
    return { ...resource, relevanceScore: score }
  })
  
  // Sort by relevance and return top 30
  return scoredResources
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 30)
    .map(({ relevanceScore, ...resource }) => resource)
}

/**
 * Analyze user requirements and find relevant Cardano tools
 * @param {string} userInput - User's description of what they want to build
 * @returns {Promise<Object>} - Analysis results with recommended tools and plan
 */
export const analyzeUserRequirements = async (userInput) => {
  try {
    // Validate content for spam
    const contentValidation = validateContent(userInput)
    if (!contentValidation.isValid) {
      throw new Error(`Content validation failed: ${contentValidation.issues.join(', ')}`)
    }

    // Make server-side AI analysis request
    const response = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userInput })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || 'AI analysis failed')
    }

    const result = await response.json()
    return result

  } catch (error) {
    logger.error('AI analysis error:', error)
    
    // Provide a fallback response if AI fails
    if (error.message.includes('context length') || error.message.includes('tokens')) {
      throw new Error('Request too complex. Please try a more specific description of what you want to build.')
    }
    
    throw new Error('Failed to analyze requirements. Please try again.')
  }
}

/**
 * Generate a markdown development plan
 * @param {Object} aiResults - Results from analyzeUserRequirements
 * @returns {string} - Markdown formatted development plan
 */
export const generateMarkdownPlan = (aiResults) => {
  if (!aiResults) {
    throw new Error('No AI results provided')
  }
  
  const { analysis, recommendedResources, developmentPlan } = aiResults

  let markdown = `# Cardano Development Plan\n\n`

  // Analysis section
  markdown += `## Project Analysis\n\n`
  markdown += `${analysis}\n\n`

  // Recommended tools section
  markdown += `## Recommended Tools\n\n`
  ;(recommendedResources || []).forEach((resource, index) => {
    if (!resource) return
    markdown += `### ${index + 1}. ${resource.name || 'Unknown Tool'}\n`
    markdown += `**Category:** ${resource.category || 'Uncategorized'}\n\n`
    markdown += `**Description:** ${resource.description || 'No description available'}\n\n`
    markdown += `**Why Recommended:** ${resource.reason || 'Recommended for your use case'}\n\n`
    markdown += `**Priority:** ${resource.priority || 'medium'}\n\n`
    markdown += `**Website:** ${resource.website || 'No website available'}\n\n`
    if (resource.docs) {
      markdown += `**Documentation:** ${resource.docs}\n\n`
    }
    markdown += `---\n\n`
  })

  // Development approaches section
  markdown += `## Development Approaches\n\n`
  markdown += `${developmentPlan?.overview || 'No development plan overview available'}\n\n`

  ;(developmentPlan?.approaches || []).forEach((approach, index) => {
    if (!approach) return
    markdown += `### Approach ${index + 1}: ${approach.name || 'Unnamed Approach'}\n\n`
    markdown += `**Description:** ${approach.description || 'No description available'}\n\n`
    markdown += `**Complexity:** ${approach.complexity || 'unknown'}\n\n`
    markdown += `**Required Tools:**\n`
    ;(approach.tools || []).forEach(tool => {
      if (tool) markdown += `- ${tool}\n`
    })
    markdown += `\n---\n\n`
  })

  markdown += `---\n\n`
  markdown += `*Generated by ADAdev AI Assistant*\n`

  return markdown
}

/**
 * Search resources based on AI recommendations
 * @param {Array} recommendedResources - AI recommended resources
 * @returns {Object} - Grouped resources by category
 */
export const getAIRecommendedResources = (recommendedResources) => {
  const grouped = {}
  
  recommendedResources.forEach(resource => {
    if (!grouped[resource.category]) {
      grouped[resource.category] = []
    }
    grouped[resource.category].push(resource)
  })

  return grouped
} 