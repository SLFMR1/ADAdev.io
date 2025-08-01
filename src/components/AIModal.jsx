import React, { useState } from 'react'
import { Copy, Check, X, FileText, Bot, Sparkles, Eye } from 'lucide-react'
import { generateMarkdownPlan } from '../services/ai'
import logger from '../utils/logger-frontend'

const AIWidget = ({ aiResults, onClose }) => {
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState('plan')

  const handleCopyPlan = async () => {
    try {
      const markdownPlan = generateMarkdownPlan(aiResults)
      await navigator.clipboard.writeText(markdownPlan)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      logger.error('Failed to copy plan:', error)
    }
  }

  // Function to handle "View Details" click - scrolls to ResourceCard in main resources section
  const handleViewDetails = (resource) => {
    // Close the AI modal
    onClose()
    
    // Wait a moment for the modal to close, then use the custom event system to expand the ResourceCard
    setTimeout(() => {
      const tabRequestEvent = new CustomEvent('resourceCardTabRequest', {
        detail: {
          resourceId: resource.id,
          resourceName: resource.name,
          tabName: 'about'
        }
      })
      document.dispatchEvent(tabRequestEvent)
      
      // Add highlight effect after expansion
      setTimeout(() => {
        const resourceElement = document.querySelector(`[data-resource-id="${resource.id}"], [data-resource-name="${resource.name}"]`)
        if (resourceElement) {
          resourceElement.style.boxShadow = '0 0 30px rgba(255, 255, 255, 0.3)'
          setTimeout(() => {
            resourceElement.style.boxShadow = ''
          }, 3000)
        }
      }, 800)
    }, 300)
  }

  const { analysis, recommendedResources, developmentPlan } = aiResults

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card-bg/50 border border-gray-800 rounded-xl shadow-lg max-w-4xl w-full max-h-[90vh] overflow-hidden transition-all duration-500 ease-in-out opacity-100 scale-100">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-700">
          <div className="flex items-center space-x-3">
            <Bot className="h-6 w-6 text-teal-400" />
            <h2 className="text-lg sm:text-xl font-bold text-white">AI Development Plan</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-2 touch-target"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col lg:flex-row h-[calc(90vh-120px)]">
          {/* Tabs */}
          <div className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-gray-700 bg-gray-900/50">
            <div className="p-4 flex lg:flex-col space-x-4 lg:space-x-0 lg:space-y-2">
              <button
                onClick={() => setActiveTab('plan')}
                className={`flex-1 lg:w-full text-left px-4 py-3 rounded-lg transition-colors touch-target ${
                  activeTab === 'plan'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-600/20'
                }`}
              >
                <FileText size={16} className="inline mr-2" />
                Development Plan
              </button>
              <button
                onClick={() => setActiveTab('tools')}
                className={`flex-1 lg:w-full text-left px-4 py-3 rounded-lg transition-colors touch-target ${
                  activeTab === 'tools'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-600/20'
                }`}
              >
                <Sparkles size={16} className="inline mr-2" />
                Recommended Tools
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'plan' && (
              <div className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 space-y-2 sm:space-y-0">
                  <h3 className="text-lg font-semibold text-white">Development Plan</h3>
                  <button
                    onClick={handleCopyPlan}
                    className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors touch-target"
                  >
                    {copied ? (
                      <>
                        <Check size={16} className="text-green-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={16} />
                        <span>Copy Plan</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Analysis */}
                <div className="mb-6">
                  <h4 className="text-md font-semibold text-white mb-3">Project Analysis</h4>
                  <p className="text-gray-300 leading-relaxed text-sm sm:text-base">{analysis}</p>
                </div>

                {/* Development Approaches */}
                <div className="space-y-6">
                  <h4 className="text-md font-semibold text-white">Development Approaches</h4>
                  <p className="text-gray-300 mb-4 text-sm sm:text-base">{developmentPlan.overview}</p>
                  
                  {developmentPlan.approaches.map((approach, index) => (
                    <div key={index} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 space-y-2 sm:space-y-0">
                        <h5 className="text-white font-medium text-sm sm:text-base">{approach.name}</h5>
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            approach.complexity === 'beginner' ? 'bg-green-500/20 text-green-400' :
                            approach.complexity === 'intermediate' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {approach.complexity}
                          </span>
                          <span className="text-gray-400 text-xs sm:text-sm">{approach.estimatedTime}</span>
                        </div>
                      </div>
                      <p className="text-gray-300 text-xs sm:text-sm mb-3">{approach.description}</p>
                      <div>
                        <span className="text-gray-400 text-xs sm:text-sm">Required Tools:</span>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {approach.tools.map((tool, toolIndex) => (
                            <span key={toolIndex} className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs">
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'tools' && (
              <div className="p-4 sm:p-6">
                <h3 className="text-lg font-semibold text-white mb-6">Recommended Tools</h3>
                <div className="space-y-4">
                  {recommendedResources.map((resource, index) => (
                    <div key={resource.id} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3 mb-2">
                            <h4 className="text-white font-medium text-sm sm:text-base">{resource.name}</h4>
                            <span className={`px-2 py-1 rounded-full text-xs ${
                              resource.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                              resource.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-green-500/20 text-green-400'
                            }`}>
                              {resource.priority} priority
                            </span>
                          </div>
                          <p className="text-gray-300 text-xs sm:text-sm mb-2">{resource.description}</p>
                          <p className="text-gray-400 text-xs sm:text-sm mb-3">
                            <strong>Why recommended:</strong> {resource.reason}
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs sm:text-sm">
                            <a
                              href={resource.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-cyan-600/20 hover:text-cyan-300 hover:border-cyan-500/30 border border-transparent transition-all duration-200 touch-target"
                            >
                              Visit Website
                            </a>
                            {resource.docs && (
                              <a
                                href={resource.docs}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-cyan-600/20 hover:text-cyan-300 hover:border-cyan-500/30 border border-transparent transition-all duration-200 touch-target"
                              >
                                Documentation
                              </a>
                            )}
                            <button
                              onClick={() => handleViewDetails(resource)}
                              className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-cyan-600/20 hover:text-cyan-300 hover:border-cyan-500/30 border border-transparent transition-all duration-200 flex items-center space-x-1 touch-target"
                            >
                              <Eye size={12} />
                              <span>View Card</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AIWidget 