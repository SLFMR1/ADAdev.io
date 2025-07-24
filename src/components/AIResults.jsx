import React from 'react'
import { Bot, ExternalLink, FileText } from 'lucide-react'
import ResourceCard from './ResourceCard'

const AIResults = ({ aiResults, onOpenWidget }) => {
  const { analysis, recommendedResources, developmentPlan } = aiResults

  // Group resources by category
  const groupedResources = recommendedResources.reduce((acc, resource) => {
    if (!acc[resource.category]) {
      acc[resource.category] = []
    }
    acc[resource.category].push(resource)
    return acc
  }, {})

  return (
    <section className="py-12 sm:py-20 bg-custom-bg">
      <div className="max-w-6xl mx-auto px-4">
        {/* AI Results Header */}
        <div className="max-w-4xl mx-auto text-center mb-12 sm:mb-16">
          <div className="flex items-center justify-center space-x-3 mb-6">
            <Bot className="h-6 w-6 sm:h-8 sm:w-8 text-teal-400" />
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight">
              AI-Recommended Tools
            </h2>
          </div>
          
          <p className="text-lg sm:text-xl text-gray-400 max-w-3xl mx-auto leading-relaxed mb-8">
            Based on your requirements, here are the best Cardano tools for your project
          </p>

          {/* Analysis Summary */}
          <div className="bg-card-bg/50 backdrop-blur-md border border-gray-700 rounded-xl p-4 sm:p-6 mb-8">
            <h3 className="text-lg font-semibold text-white mb-3">Project Analysis</h3>
            <p className="text-gray-300 leading-relaxed text-sm sm:text-base">{analysis}</p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={onOpenWidget}
              className="btn-primary flex items-center justify-center space-x-2 px-4 sm:px-6 py-3"
            >
              <FileText size={18} />
              <span>View Development Plan</span>
            </button>
            
            <button
              onClick={() => {
                const element = document.getElementById('resources')
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth' })
                }
              }}
              className="btn-secondary flex items-center justify-center space-x-2 px-4 sm:px-6 py-3"
            >
              <ExternalLink size={18} />
              <span>Browse All Resources</span>
            </button>
          </div>
        </div>

        {/* AI-Recommended Resources */}
        <div className="space-y-16 sm:space-y-20">
          {Object.entries(groupedResources).map(([category, resources]) => (
            <div key={category}>
              <div className="text-center mb-8 sm:mb-12">
                <h3 className="text-xl sm:text-2xl md:text-3xl font-medium text-white mb-4">
                  {category}
                </h3>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-5xl mx-auto">
                {resources.map((resource) => (
                  <div key={resource.id} className="relative">
                    {/* Priority Badge */}
                    <div className="absolute top-4 right-4 z-10">
                      <span className={`px-2 sm:px-3 py-1 rounded-full text-xs font-medium ${
                        resource.priority === 'high' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        resource.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                        'bg-green-500/20 text-green-400 border border-green-500/30'
                      }`}>
                        {resource.priority} priority
                      </span>
                    </div>
                    
                    <ResourceCard resource={resource} />
                    
                    {/* AI Recommendation Reason */}
                    <div className="mt-3 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                      <p className="text-cyan-300 text-xs sm:text-sm">
                        <strong>Why recommended:</strong> {resource.reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Development Plan Preview */}
        <div className="mt-12 sm:mt-16 text-center">
          <div className="bg-card-bg/50 backdrop-blur-md border border-gray-700 rounded-xl p-4 sm:p-6 max-w-4xl mx-auto">
            <h3 className="text-lg sm:text-xl font-semibold text-white mb-4">Development Plan Overview</h3>
            <p className="text-gray-300 mb-6 text-sm sm:text-base">{developmentPlan.overview}</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {developmentPlan.approaches.map((approach, index) => (
                <div key={index} className="bg-gray-800/50 rounded-lg p-3 sm:p-4 border border-gray-700">
                  <h4 className="text-white font-medium mb-2 text-sm sm:text-base">{approach.name}</h4>
                  <div className="flex items-center space-x-2 mb-2">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      approach.complexity === 'beginner' ? 'bg-green-500/20 text-green-400' :
                      approach.complexity === 'intermediate' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {approach.complexity}
                    </span>
                    <span className="text-gray-400 text-xs">{approach.estimatedTime}</span>
                  </div>
                  <p className="text-gray-300 text-xs sm:text-sm">{approach.description}</p>
                </div>
              ))}
            </div>
            
            <button
              onClick={onOpenWidget}
              className="mt-6 btn-primary flex items-center justify-center space-x-2 mx-auto"
            >
              <FileText size={16} />
              <span>View Full Development Plan</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default AIResults 