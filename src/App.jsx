import React, { useState, useMemo, useEffect } from 'react'

import Header from './components/Header'
import BetaBanner from './components/BetaBanner'
import Hero from './components/Hero'
import GitHubUpdatesWidget from './components/GitHubUpdatesWidget'
import AddResourceWidget from './components/AddResourceWidget'
import DevelopmentActivityWidget from './components/DevelopmentActivityWidget'
import AISearchWidget from './components/AISearchWidget'
import SearchBar from './components/SearchBar'
import ResourceCard from './components/ResourceCard'
import AIResults from './components/AIResults'
import AIModal from './components/AIModal'
import Footer from './components/Footer'
import { cardanoResources } from './data/resources'
import { preloadCache, initializeRateLimit } from './services/github'
import { Zap, Menu, X } from 'lucide-react'

const SidebarWidgetsContainer = ({ expanded, setExpanded }) => {
  const handleExpand = (key) => {
    setExpanded(prev => prev === key ? prev : key)
  }
  return (
    <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50 flex flex-col items-start gap-0 hidden lg:flex" style={{ height: 'auto' }}>
      {expanded !== 'dev' && (
      <DevelopmentActivityWidget
          isExpanded={false}
        onExpand={() => handleExpand('dev')}
        onCollapse={() => setExpanded(null)}
        isAnyExpanded={!!expanded}
      />
      )}
      {expanded !== 'github' && (
      <GitHubUpdatesWidget
          isExpanded={false}
        onExpand={() => handleExpand('github')}
        onCollapse={() => setExpanded(null)}
        isAnyExpanded={!!expanded}
      />
      )}
      {expanded !== 'ai' && (
      <AISearchWidget
          isExpanded={false}
        onExpand={() => handleExpand('ai')}
        onCollapse={() => setExpanded(null)}
        isAnyExpanded={!!expanded}
      />
      )}
      {expanded !== 'add' && (
      <AddResourceWidget
          isExpanded={false}
        onExpand={() => handleExpand('add')}
        onCollapse={() => setExpanded(null)}
        isAnyExpanded={!!expanded}
      />
      )}
    </div>
  )
}

// Mobile Navigation Component
const MobileNavigation = ({ isOpen, onClose, expanded, setExpanded }) => {
  const handleWidgetClick = (widgetKey) => {
    setExpanded(expanded === widgetKey ? null : widgetKey)
    onClose()
  }

  return (
    <>
      {/* Mobile Navigation Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 lg:hidden transition-all duration-500 ease-in-out opacity-100 scale-100"
          onClick={onClose}
          style={{
            background: 'linear-gradient(135deg, #1E1E1E 0%, #0F0F0F 50%, #1A1A1A 100%)',
            backgroundImage: `
              radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.1) 0%, transparent 50%),
              radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.1) 0%, transparent 50%),
              radial-gradient(circle at 40% 40%, rgba(120, 219, 255, 0.05) 0%, transparent 50%)
            `
          }}
        />
      )}
      
      {/* Mobile Navigation Menu */}
      <div className={`fixed top-0 left-0 h-full w-80 bg-card-bg/95 backdrop-blur-md border-r border-gray-800 z-50 transform transition-transform duration-300 ease-in-out lg:hidden ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-800">
            <h2 className="text-white font-bold text-lg">ADAdev Menu</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <X size={20} className="text-gray-400" />
            </button>
          </div>
          
          {/* Navigation Items */}
          <div className="flex-1 p-6 space-y-4">
            <div className="space-y-2">
              <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-3">
                Widgets
              </h3>
              
              <button
                onClick={() => handleWidgetClick('dev')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                    <Zap size={16} className="text-yellow-400" />
                  </div>
                  <div>
                    <div className="text-white font-medium">Development Activity</div>
                    <div className="text-gray-400 text-sm">Track ecosystem growth</div>
                  </div>
                </div>
              </button>
              
              <button
                onClick={() => handleWidgetClick('github')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-white font-medium">GitHub Updates</div>
                    <div className="text-gray-400 text-sm">Latest repository activity</div>
                  </div>
                </div>
              </button>
              
              <button
                onClick={() => handleWidgetClick('ai')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                    <Zap size={16} className="text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-white font-medium">AI Development Plan</div>
                    <div className="text-gray-400 text-sm">Get personalized guidance</div>
                  </div>
                </div>
              </button>
              
              <button
                onClick={() => handleWidgetClick('add')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-white font-medium">Add Resource</div>
                    <div className="text-gray-400 text-sm">Submit new tools</div>
                  </div>
                </div>
              </button>
            </div>
            
            <div className="pt-4 border-t border-gray-800">
              <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-3">
                Quick Actions
              </h3>
              
              <button
                onClick={() => {
                  document.getElementById('resources')?.scrollIntoView({ behavior: 'smooth' })
                  onClose()
                }}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-cyan-500/20 rounded-lg flex items-center justify-center">
                    <Zap size={16} className="text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-white font-medium">Browse Resources</div>
                    <div className="text-gray-400 text-sm">Find development tools</div>
                  </div>
                </div>
              </button>
            </div>
            
            <div className="pt-4 border-t border-gray-800">
              <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-3">
                Community
              </h3>
              
              <a
                href="https://x.com/SLFMR1"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-white font-medium">Follow on X</div>
                    <div className="text-gray-400 text-sm">Stay updated</div>
                  </div>
                </div>
              </a>
            </div>
          </div>
          
          {/* Footer */}
          <div className="p-6 border-t border-gray-800">
            <p className="text-gray-400 text-xs text-center">
              Built for the Cardano Developer Community
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

function App() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [aiResults, setAiResults] = useState(null)
  const [showAIWidget, setShowAIWidget] = useState(false)
  const [isAILoading, setIsAILoading] = useState(false)
  const [expanded, setExpanded] = React.useState(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Get all categories
  const categories = ['All', ...Object.keys(cardanoResources).sort()]

  // Flatten all resources with category info
  const allResources = useMemo(() => {
    return Object.entries(cardanoResources).flatMap(([category, resources]) =>
      resources.map(resource => ({ ...resource, category }))
    )
  }, [])

  // Initialize GitHub API and preload cache on app startup
  useEffect(() => {
    const initializeGitHub = async () => {
      // Initialize rate limit status first
      await initializeRateLimit()
      
      // Then preload cache
      const resourcesWithGitHub = allResources.filter(resource => resource.social?.github)
      if (resourcesWithGitHub.length > 0) {
        // Preload cache in the background
        preloadCache(resourcesWithGitHub)
      }
    }
    
    initializeGitHub()
  }, [allResources])

  // Listen for activity data updates for mobile stats
  useEffect(() => {
    const handleActivityDataUpdate = (event) => {
      const { totalActiveRepos, avgCommitsPerRepo, totalCommits } = event.detail
      
      // Update mobile stats
      const activeReposElement = document.getElementById('mobile-active-repos')
      const avgCommitsElement = document.getElementById('mobile-avg-commits')
      const totalCommitsElement = document.getElementById('mobile-total-commits')
      
      if (activeReposElement) activeReposElement.textContent = totalActiveRepos
      if (avgCommitsElement) avgCommitsElement.textContent = avgCommitsPerRepo
      if (totalCommitsElement) totalCommitsElement.textContent = totalCommits
    }

    document.addEventListener('activityDataUpdated', handleActivityDataUpdate)
    return () => document.removeEventListener('activityDataUpdated', handleActivityDataUpdate)
  }, [])

  // Handle AI analysis completion
  const handleAIAnalysisComplete = (results) => {
    setAiResults(results)
    // Clear any existing search/filter when AI results are shown
    setSearchTerm('')
    setSelectedCategory('All')
  }

  // Handle AI loading state
  const handleAILoadingChange = (loading) => {
    setIsAILoading(loading)
  }

  // Filter resources based on search and category
  const filteredResources = useMemo(() => {
    let filtered = allResources

    if (selectedCategory !== 'All') {
      filtered = filtered.filter(resource => resource.category === selectedCategory)
    }

    if (searchTerm) {
      filtered = filtered.filter(resource =>
        resource.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        resource.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        resource.keySolutions?.some(solution => 
          solution.toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    }

    return filtered
  }, [allResources, searchTerm, selectedCategory])

  // Group filtered resources by category for display
  const groupedResources = useMemo(() => {
    const grouped = {}
    filteredResources.forEach(resource => {
      if (!grouped[resource.category]) {
        grouped[resource.category] = []
      }
      grouped[resource.category].push(resource)
    })
    return grouped
  }, [filteredResources])

  return (
    <div className="min-h-screen bg-custom-bg z-0">
      {/* Global background layer - brings the gradient to front when widget is expanded */}
      {expanded && (
        <div 
          className="fixed inset-0 z-40 transition-all duration-500 ease-in-out opacity-100 scale-100"
          onClick={() => setExpanded(null)}
          style={{
            background: 'linear-gradient(135deg, #1E1E1E 0%, #0F0F0F 50%, #1A1A1A 100%)',
            backgroundImage: `
              radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.1) 0%, transparent 50%),
              radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.1) 0%, transparent 50%),
              radial-gradient(circle at 40% 40%, rgba(120, 219, 255, 0.05) 0%, transparent 50%)
            `
          }}
        />
      )}
      
      {/* Mobile Widget Overlays */}
      {expanded && (
        <div className="lg:hidden fixed inset-0 z-50 transition-all duration-500 ease-in-out opacity-100 scale-100"
          style={{
            background: 'linear-gradient(135deg, #1E1E1E 0%, #0F0F0F 50%, #1A1A1A 100%)',
            backgroundImage: `
              radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.1) 0%, transparent 50%),
              radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.1) 0%, transparent 50%),
              radial-gradient(circle at 40% 40%, rgba(120, 219, 255, 0.05) 0%, transparent 50%)
            `
          }}>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-card-bg/50 border border-gray-800 rounded-xl shadow-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
              {/* Widget Header */}
              <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-700">
                <div className="flex items-center space-x-3">
                  {expanded === 'dev' && <Zap className="h-6 w-6 text-yellow-400" />}
                  {expanded === 'github' && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-green-400">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                  )}
                  {expanded === 'ai' && <Zap className="h-6 w-6 text-emerald-400" />}
                  {expanded === 'add' && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                  )}
                  <h2 className="text-lg sm:text-xl font-bold text-white">
                    {expanded === 'dev' && 'Development Activity'}
                    {expanded === 'github' && 'GitHub Updates'}
                    {expanded === 'ai' && 'AI Development Plan'}
                    {expanded === 'add' && 'Add Resource'}
                  </h2>
                </div>
                <button
                  onClick={() => setExpanded(null)}
                  className="text-gray-400 hover:text-white transition-colors p-2"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Widget Content */}
              <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
                {expanded === 'dev' && (
                  <DevelopmentActivityWidget
                    isExpanded={true}
                    onExpand={() => {}}
                    onCollapse={() => setExpanded(null)}
                    isAnyExpanded={true}
                  />
                )}
                {expanded === 'github' && (
                  <GitHubUpdatesWidget
                    isExpanded={true}
                    onExpand={() => {}}
                    onCollapse={() => setExpanded(null)}
                    isAnyExpanded={true}
                  />
                )}
                {expanded === 'ai' && (
                  <AISearchWidget
                    isExpanded={true}
                    onExpand={() => {}}
                    onCollapse={() => setExpanded(null)}
                    isAnyExpanded={true}
                  />
                )}
                {expanded === 'add' && (
                  <AddResourceWidget
                    isExpanded={true}
                    onExpand={() => {}}
                    onCollapse={() => setExpanded(null)}
                    isAnyExpanded={true}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Mobile Navigation */}
      <MobileNavigation 
        isOpen={mobileMenuOpen} 
        onClose={() => setMobileMenuOpen(false)} 
        expanded={expanded}
        setExpanded={setExpanded}
      />
      
      {/* Sidebar Widgets (desktop only) - stays above backdrop */}
      <div className="relative z-50">
      <SidebarWidgetsContainer
        expanded={expanded}
        setExpanded={setExpanded}
      />
      </div>
      
      {/* Expanded Widgets (desktop only) - rendered separately to avoid duplication */}
      {expanded === 'dev' && (
        <DevelopmentActivityWidget
          isExpanded={true}
          onExpand={() => {}}
          onCollapse={() => setExpanded(null)}
          isAnyExpanded={true}
        />
      )}
      {expanded === 'github' && (
        <GitHubUpdatesWidget
          isExpanded={true}
          onExpand={() => {}}
          onCollapse={() => setExpanded(null)}
          isAnyExpanded={true}
        />
      )}
      {expanded === 'ai' && (
        <AISearchWidget
          isExpanded={true}
          onExpand={() => {}}
          onCollapse={() => setExpanded(null)}
          isAnyExpanded={true}
        />
      )}
      {expanded === 'add' && (
        <AddResourceWidget
          isExpanded={true}
          onExpand={() => {}}
          onCollapse={() => setExpanded(null)}
          isAnyExpanded={true}
        />
      )}
      
      {/* Main Content (Hero, ResourceGrid, etc.) - behind global background when widget expanded */}
      <div className={`relative z-10 transition-all duration-500 ease-in-out ${expanded ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Mobile Header */}
          <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card-bg/50 border-b border-gray-800">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                >
                  <Menu size={20} className="text-gray-400" />
                </button>
                <img 
                  src="/ADAdev_logo.png" 
                  alt="ADAdev" 
                  className="h-8 w-auto object-contain"
                />
              </div>
              <div className="text-white font-semibold text-sm">Cardano Hub</div>
            </div>
          </div>
          
          <Header />
          {/* <BetaBanner /> */}
          <Hero />
          
          {/* Mobile Development Activity Section */}
          <section className="lg:hidden bg-card-bg/50 border border-gray-800 rounded-xl mx-4 my-8 p-6 mt-20">
            <div className="flex items-center space-x-3 mb-4">
              <Zap size={24} className="text-yellow-400" />
              <h3 className="text-white font-bold text-xl">Development Activity</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                <div className="text-white font-bold text-2xl" id="mobile-active-repos">-</div>
                <div className="text-gray-400 text-sm">Active Repos</div>
              </div>
              <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                <div className="text-white font-bold text-2xl" id="mobile-avg-commits">-</div>
                <div className="text-gray-400 text-sm">Avg/Week</div>
              </div>
              <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                <div className="text-white font-bold text-2xl" id="mobile-total-commits">-</div>
                <div className="text-gray-400 text-sm">Total/Week</div>
              </div>
            </div>
            <div className="text-center">
              <p className="text-gray-400 text-sm">View detailed activity on desktop</p>
            </div>
          </section>
          
          {/* AI Results Section - Show when AI results are available */}
          {aiResults && (
            <section id="ai-results">
              <AIResults 
                aiResults={aiResults}
                onOpenWidget={() => setShowAIWidget(true)}
              />
            </section>
          )}
          
          <main>
              {/* Resources Section - "Second Page" */}
              <section id="resources" className="min-h-screen py-20 lg:py-20 pt-8 lg:pt-20">
                <div className="max-w-6xl mx-auto px-4">
                  {/* Resources Header */}
                  <div className="max-w-4xl mx-auto text-center mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
                      Developer Resources
                    </h2>
                    <p className="text-lg md:text-xl text-gray-400 max-w-3xl mx-auto leading-relaxed mb-12">
                      Comprehensive collection of tools, APIs, and libraries for building on Cardano
                    </p>
                    
                    {/* Search Bar in Resources Section */}
                    <div className="max-w-3xl mx-auto mb-16">
                      <SearchBar 
                        searchTerm={searchTerm}
                        setSearchTerm={setSearchTerm}
                        selectedCategory={selectedCategory}
                        setSelectedCategory={setSelectedCategory}
                        categories={categories}
                      />
                    </div>
                  </div>

                  {/* Resources Grid */}
                  {Object.keys(groupedResources).length === 0 ? (
                    <div className="text-center py-20">
                      <div className="text-gray-400 text-6xl mb-6">🔍</div>
                      <h3 className="text-2xl font-bold text-white mb-4">No resources found</h3>
                      <p className="text-lg text-gray-400">Try adjusting your search terms or category filter.</p>
                    </div>
                  ) : (
                    <div className="space-y-20">
                      {Object.entries(groupedResources)
                        .sort(([categoryA], [categoryB]) => categoryA.localeCompare(categoryB))
                        .map(([category, resources]) => (
                        <div key={category}>
                          <div className="text-center mb-12">
                            <h3 className="text-xl md:text-2xl lg:text-3xl font-bold text-white mb-4">
                              {category}
                            </h3>
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-5xl mx-auto">
                            {resources.map((resource) => (
                              <ResourceCard key={resource.id} resource={resource} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </main>
            
            {/* AI Modal */}
            {showAIWidget && aiResults && (
              <AIModal 
                aiResults={aiResults}
                onClose={() => setShowAIWidget(false)}
              />
            )}
            
            <Footer />
          </div>
        </div>
      </div>
    )
  }

  export default App 