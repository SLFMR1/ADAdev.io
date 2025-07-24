import React, { useState, useEffect, useRef } from 'react'
import { Bot, X, FileText, ExternalLink, Copy, Check, Sparkles } from 'lucide-react'
import { analyzeUserRequirements } from '../services/ai'
import { generateMarkdownPlan } from '../services/ai'
import logger from '../utils/logger-frontend'
import Portal from './Portal'

const AISearchWidget = ({ isExpanded, onExpand, onCollapse, isAnyExpanded }) => {
  const [inputValue, setInputValue] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [lastSubmissionTime, setLastSubmissionTime] = useState(0)
  const [submissionCount, setSubmissionCount] = useState(0)
  const [showChallenge, setShowChallenge] = useState(false)
  const [challengeAnswer, setChallengeAnswer] = useState('')
  const [suspiciousActivity, setSuspiciousActivity] = useState(0)
  const [aiResults, setAiResults] = useState(null)
  const [activeTab, setActiveTab] = useState('search')
  const [copied, setCopied] = useState(false)
  const progressInterval = useRef(null)

  // Handle click outside to collapse widget
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isExpanded && !event.target.closest('[data-widget="ai-search"]')) {
        onCollapse();
      }
    };
    
    // Only add the event listener when the widget is expanded
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded, onCollapse]);

  // Rate limiting: max 5 submissions per minute
  const RATE_LIMIT_SUBMISSIONS = 5
  const RATE_LIMIT_WINDOW = 60000 // 1 minute in ms
  const MIN_SUBMISSION_INTERVAL = 2000 // 2 seconds between submissions

  const checkRateLimit = () => {
    const now = Date.now()
    const timeSinceLastSubmission = now - lastSubmissionTime
    
    // Check minimum interval between submissions
    if (timeSinceLastSubmission < MIN_SUBMISSION_INTERVAL) {
      const remainingTime = Math.ceil((MIN_SUBMISSION_INTERVAL - timeSinceLastSubmission) / 1000)
      throw new Error(`Please wait ${remainingTime} seconds before submitting again`)
    }
    
    // Check submission count in time window
    if (submissionCount >= RATE_LIMIT_SUBMISSIONS) {
      const timeWindowStart = now - RATE_LIMIT_WINDOW
      if (lastSubmissionTime > timeWindowStart) {
        const remainingTime = Math.ceil((RATE_LIMIT_WINDOW - (now - timeWindowStart)) / 1000)
        throw new Error(`Rate limit exceeded. Please wait ${remainingTime} seconds`)
      } else {
        // Reset counter if window has passed
        setSubmissionCount(0)
      }
    }
  }

  useEffect(() => {
    if (isAnalyzing) {
      setProgress(0)
      const startTime = Date.now()
      
      progressInterval.current = setInterval(() => {
        const elapsed = Date.now() - startTime
        
        // Start fast, then slow down gradually
        let progressPercent
        if (elapsed < 10000) {
          // First 10 seconds: 0% to 70%
          progressPercent = (elapsed / 10000) * 70
        } else if (elapsed < 20000) {
          // 10-20 seconds: 70% to 90%
          const remaining = elapsed - 10000
          progressPercent = 70 + (remaining / 10000) * 20
        } else {
          // After 20 seconds: 90% to 98% (very slow)
          const extraTime = elapsed - 20000
          const slowProgress = Math.min(extraTime / 10000, 8) // Additional 8% over 10 seconds
          progressPercent = 90 + slowProgress
        }
        
        setProgress(progressPercent)
      }, 100)
    } else {
      setProgress(0)
      if (progressInterval.current) clearInterval(progressInterval.current)
    }
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current)
    }
  }, [isAnalyzing])

  const generateChallenge = () => {
    const challenges = [
      { question: 'What is 2 + 3?', answer: '5' },
      { question: 'What color is the sky?', answer: 'blue' },
      { question: 'How many days in a week?', answer: '7' },
      { question: 'What is the opposite of hot?', answer: 'cold' },
      { question: 'What do you call a baby dog?', answer: 'puppy' }
    ]
    return challenges[Math.floor(Math.random() * challenges.length)]
  }

  const validateInput = (input) => {
    const trimmed = input.trim()
    
    // Check minimum length
    if (trimmed.length < 10) {
      throw new Error('Please provide a more detailed description (at least 10 characters)')
    }
    
    // Check maximum length
    if (trimmed.length > 1000) {
      throw new Error('Description too long. Please keep it under 1000 characters')
    }
    
    // Check for repetitive patterns (spam detection)
    const words = trimmed.toLowerCase().split(/\s+/)
    const uniqueWords = new Set(words)
    const repetitionRatio = uniqueWords.size / words.length
    
    if (words.length > 20 && repetitionRatio < 0.3) {
      setSuspiciousActivity(prev => prev + 1)
      throw new Error('Please provide a more natural description')
    }
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /(.)\1{5,}/, // Repeated characters
      /(.)\1{3,}/g, // Multiple repeated characters
      /(.)\1{2,}/g, // Triple repeated characters
    ]
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(trimmed)) {
        setSuspiciousActivity(prev => prev + 1)
        throw new Error('Please provide a more natural description')
      }
    }
    
    return trimmed
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!inputValue.trim()) {
      setError('Please describe what you want to build')
      return
    }

    // Check for suspicious activity and trigger challenge
    if (suspiciousActivity >= 2) {
      setShowChallenge(true)
      setError('Please complete the verification challenge')
      return
    }

    // Validate input
    let validatedInput
    try {
      validatedInput = validateInput(inputValue)
    } catch (validationError) {
      setError(validationError.message)
      return
    }

    try {
      checkRateLimit()
    } catch (rateLimitError) {
      setError(rateLimitError.message)
      return
    }

    setIsAnalyzing(true)
    setError('')
    setProgress(0)

    try {
      const results = await analyzeUserRequirements(validatedInput)
      setProgress(100)
      
      // Wait for progress bar animation to complete
      setTimeout(() => {
        setIsAnalyzing(false)
        setAiResults(results)
        setActiveTab('results')
        
        // Add a small delay before scrolling to let the user see the completion
        setTimeout(() => {
          const element = document.getElementById('ai-results')
          if (element) {
            element.scrollIntoView({ behavior: 'smooth' })
          }
        }, 200)
      }, 700)
      
    } catch (err) {
      setError(err.message || 'Failed to analyze requirements')
      setIsAnalyzing(false)
    } finally {
      setLastSubmissionTime(Date.now())
      setSubmissionCount(prev => prev + 1)
    }
  }

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

  // Group resources by category
  const groupedResources = aiResults ? aiResults.recommendedResources.reduce((acc, resource) => {
    if (!acc[resource.category]) {
      acc[resource.category] = []
    }
    acc[resource.category].push(resource)
    return acc
  }, {}) : {}

  return (
    <>
      {/* Collapsed Floating Button for Sidebar Grouping */}
      {!isExpanded ? (
        <div
          className="relative z-50 w-16 h-16"
          onClick={onExpand}
          data-widget="ai"
        >
                      <div className="flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl">
              <Sparkles size={24} className="text-teal-400" />
            </div>
        </div>
      ) : (
        /* Expanded Centered Widget */
        <Portal>
          <div className="fixed z-[9999] flex items-center justify-center left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[1600px] max-h-[90vh] min-w-[900px] min-h-[600px] border-radius-[32px] bg-card-bg/40 border border-gray-800 rounded-xl shadow-lg overflow-hidden p-0 transition-all duration-500 ease-in-out opacity-100 scale-100"
            style={{ borderRadius: '32px' }}
            data-widget="ai-search">
            <button
              className="absolute top-6 right-6 z-50 text-gray-400 hover:text-white transition-all duration-200"
              onClick={onCollapse}
              aria-label="Close"
            >
              <span style={{fontSize: 24, fontWeight: 'bold', lineHeight: 1}}>×</span>
            </button>
            <div className="w-full h-full p-8 overflow-auto" style={{ maxHeight: '90vh', minHeight: '600px' }}>
              {/* Main Heading */}
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Bot className="h-8 w-8 text-teal-400" />
                  <h1 className="text-white text-2xl font-medium">AI Development Assistant</h1>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex space-x-3 mb-6">
                <button
                  onClick={() => setActiveTab('search')}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border ${
                    activeTab === 'search' 
                      ? 'border-cyan-400/50 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]' 
                      : 'border-gray-600/50 text-cyan-300 hover:border-cyan-400 hover:text-white shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]'
                  }`}
                >
                  Search
                </button>
                {aiResults && (
                  <>
                    <button
                      onClick={() => setActiveTab('results')}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border ${
                        activeTab === 'results' 
                          ? 'border-cyan-400/50 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]' 
                          : 'border-gray-600/50 text-cyan-300 hover:border-cyan-400 hover:text-white shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]'
                      }`}
                    >
                      Results
                    </button>
                    <button
                      onClick={() => setActiveTab('plan')}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border ${
                        activeTab === 'plan' 
                          ? 'border-cyan-400/50 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]' 
                          : 'border-gray-600/50 text-cyan-300 hover:border-cyan-400 hover:text-white shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]'
                      }`}
                    >
                      Development Plan
                    </button>
                  </>
                )}
              </div>

              {/* Content */}
              <div className="flex-1">
                {activeTab === 'search' && (
                  <div className="max-w-2xl mx-auto">
                    <div className="mb-6">
                      <h2 className="text-white text-lg font-semibold mb-4">What are you building?</h2>
                      <p className="text-gray-400 mb-6">Describe your project and get AI-powered recommendations for Cardano tools and development approaches.</p>
                    </div>
                    
                    <form onSubmit={handleSubmit} className="relative">
                      <div className={`relative w-full rounded-full border border-gray-700 bg-card-bg/50 backdrop-blur-md pl-10 pr-8 py-4 transition-all duration-300 shadow-[0_0_8px_rgba(20,184,166,0.8)]`}>
                        {/* Progress Bar */}
                        {isAnalyzing && (
                          <div className="absolute inset-0 z-0 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-400 transition-all duration-500 shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)]"
                              style={{ width: `${progress}%`, minWidth: progress > 0 ? '8px' : 0 }}
                            />
                          </div>
                        )}
                        {/* Search Icon */}
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none z-10">
                          <Bot className="h-5 w-5 text-gray-400" />
                        </div>
                        {/* Input Field */}
                        <input
                          type="text"
                          value={inputValue}
                          onChange={(e) => setInputValue(e.target.value)}
                          placeholder="What are you building?"
                          className="w-full bg-transparent border-none text-white focus:outline-none focus:ring-0 focus:border-none focus:shadow-none transition-all duration-200 text-lg relative z-10 pr-10"
                          disabled={isAnalyzing}
                          style={{ 
                            position: 'relative',
                            outline: 'none',
                            boxShadow: 'none',
                            '::placeholder': {
                              color: 'rgba(156, 163, 175, 0.3)'
                            }
                          }}
                        />
                        {/* Submit Button */}
                        {!isAnalyzing && (
                          <button
                            type="submit"
                            disabled={!inputValue.trim()}
                            className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-400 text-black px-5 py-5 rounded-full font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-custom-bg disabled:opacity-50 disabled:cursor-not-allowed hover:from-emerald-500 hover:via-cyan-500 hover:to-sky-500 hover:scale-105 active:scale-95 z-40 shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)]"
                          >
                          </button>
                        )}
                      </div>
                    </form>
                    
                    {/* Error Message */}
                    {error && (
                      <div className="mt-3 text-red-400 text-sm text-center">
                        {error}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'results' && aiResults && (
                  <div className="space-y-6">
                    {/* Analysis */}
                    <div className="bg-card-bg/50 backdrop-blur-md border border-gray-700 rounded-xl p-6">
                      <h3 className="text-lg font-semibold text-white mb-3">Project Analysis</h3>
                      <p className="text-gray-300 leading-relaxed">{aiResults.analysis}</p>
                    </div>

                    {/* AI-Recommended Resources */}
                    <div className="space-y-6">
                      {Object.entries(groupedResources).map(([category, resources]) => (
                        <div key={category}>
                          <div className="text-center mb-6">
                            <h3 className="text-xl font-bold text-white mb-2">{category}</h3>
                          </div>
                          
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {resources.map((resource) => (
                              <div key={resource.id} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                                <div className="flex items-start justify-between mb-3">
                                  <h4 className="text-white font-medium">{resource.name}</h4>
                                  <span className={`px-2 py-1 rounded-full text-xs ${
                                    resource.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                                    resource.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-green-500/20 text-green-400'
                                  }`}>
                                    {resource.priority} priority
                                  </span>
                                </div>
                                <p className="text-gray-300 text-sm mb-3">{resource.description}</p>
                                <p className="text-gray-400 text-sm mb-3">
                                  <strong>Why recommended:</strong> {resource.reason}
                                </p>
                                <div className="flex items-center space-x-4 text-sm">
                                  <a
                                    href={resource.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-cyan-400 hover:text-cyan-300 transition-colors"
                                  >
                                    Visit Website
                                  </a>
                                  {resource.docs && (
                                    <a
                                      href={resource.docs}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-cyan-400 hover:text-cyan-300 transition-colors"
                                    >
                                      Documentation
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(activeTab === 'plan' || activeTab === 'tools') && aiResults && (
                  <div className="flex h-[calc(90vh-200px)]">
                    {/* Tabs */}
                    <div className="w-64 border-r border-gray-700 bg-gray-900/50">
                      <div className="p-4">
                        <button
                          onClick={() => setActiveTab('plan')}
                          className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 border ${
                            activeTab === 'plan'
                              ? 'border-cyan-400/50 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]'
                              : 'border-gray-600/50 text-gray-400 hover:border-cyan-400 hover:text-white hover:bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]'
                          }`}
                        >
                          <FileText size={16} className="inline mr-2" />
                          Development Plan
                        </button>
                        <button
                          onClick={() => setActiveTab('tools')}
                          className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 border mt-2 ${
                            activeTab === 'tools'
                              ? 'border-cyan-400/50 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]'
                              : 'border-gray-600/50 text-gray-400 hover:border-cyan-400 hover:text-white hover:bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]'
                          }`}
                        >
                          <Bot size={16} className="inline mr-2" />
                          Recommended Tools
                        </button>
                      </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 overflow-y-auto">
                      {activeTab === 'plan' && (
                        <div className="p-6">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-semibold text-white">Development Plan</h3>
                            <button
                              onClick={handleCopyPlan}
                              className="flex items-center space-x-2 px-4 py-2 bg-gray-800/30 text-gray-300 rounded-lg border border-cyan-400/50 hover:border-cyan-400 hover:bg-cyan-400/10 transition-all duration-200 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]"
                            >
                              {copied ? (
                                <>
                                  <Check size={16} className="text-green-400" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={16} />
                                  <span>Copy as Markdown</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Analysis */}
                          <div className="mb-6">
                            <h4 className="text-md font-semibold text-white mb-3">Project Analysis</h4>
                            <p className="text-gray-300 leading-relaxed">{aiResults.analysis}</p>
                          </div>

                          {/* Development Approaches */}
                          <div className="space-y-6">
                            <h4 className="text-md font-semibold text-white">Development Approaches</h4>
                            <p className="text-gray-300 mb-4">{aiResults.developmentPlan.overview}</p>
                            
                            {aiResults.developmentPlan.approaches.map((approach, index) => (
                              <div key={index} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                                <div className="flex items-center justify-between mb-3">
                                  <h5 className="text-white font-medium">{approach.name}</h5>
                                  <div className="flex items-center space-x-2">
                                    <span className={`px-2 py-1 rounded-full text-xs ${
                                      approach.complexity === 'beginner' ? 'bg-green-500/20 text-green-400' :
                                      approach.complexity === 'intermediate' ? 'bg-yellow-500/20 text-yellow-400' :
                                      'bg-red-500/20 text-red-400'
                                    }`}>
                                      {approach.complexity}
                                    </span>
                                    <span className="text-gray-400 text-sm">{approach.estimatedTime}</span>
                                  </div>
                                </div>
                                <p className="text-gray-300 text-sm mb-3">{approach.description}</p>
                                <div>
                                  <span className="text-gray-400 text-sm">Required Tools:</span>
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
                        <div className="p-6">
                          <h3 className="text-lg font-semibold text-white mb-6">Recommended Tools</h3>
                          <div className="space-y-4">
                            {aiResults.recommendedResources.map((resource, index) => (
                              <div key={resource.id} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-3 mb-2">
                                      <h4 className="text-white font-medium">{resource.name}</h4>
                                      <span className={`px-2 py-1 rounded-full text-xs ${
                                        resource.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                                        resource.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-green-500/20 text-green-400'
                                      }`}>
                                        {resource.priority} priority
                                      </span>
                                    </div>
                                    <p className="text-gray-300 text-sm mb-2">{resource.description}</p>
                                    <p className="text-gray-400 text-sm mb-3">
                                      <strong>Why recommended:</strong> {resource.reason}
                                    </p>
                                    <div className="flex items-center space-x-4 text-sm">
                                      <a
                                        href={resource.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 transition-colors"
                                      >
                                        Visit Website
                                      </a>
                                      {resource.docs && (
                                        <a
                                          href={resource.docs}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-cyan-400 hover:text-cyan-300 transition-colors"
                                        >
                                          Documentation
                                        </a>
                                      )}
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
                )}
              </div>

              {/* Challenge Modal */}
              {showChallenge && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-card-bg border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
                    <h3 className="text-lg font-semibold text-white mb-4">Verification Required</h3>
                    <p className="text-gray-300 mb-4">Please answer this question to continue:</p>
                    <div className="mb-4">
                      <p className="text-cyan-400 font-medium">{generateChallenge().question}</p>
                    </div>
                    <input
                      type="text"
                      value={challengeAnswer}
                      onChange={(e) => setChallengeAnswer(e.target.value)}
                      placeholder="Your answer..."
                      className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-cyan-400"
                      style={{
                        '::placeholder': {
                          color: 'rgba(156, 163, 175, 0.3)'
                        }
                      }}
                    />
                    <div className="flex gap-3 mt-4">
                      <button
                        onClick={() => {
                          const challenge = generateChallenge()
                          if (challengeAnswer.toLowerCase().trim() === challenge.answer.toLowerCase()) {
                            setShowChallenge(false)
                            setChallengeAnswer('')
                            setSuspiciousActivity(0)
                            setError('')
                            // Retry the submission
                            handleSubmit({ preventDefault: () => {} })
                          } else {
                            setError('Incorrect answer. Please try again.')
                          }
                        }}
                        className="flex-1 bg-gradient-to-r from-emerald-400 to-cyan-400 text-black px-4 py-2 rounded font-semibold hover:from-emerald-500 hover:to-cyan-500 transition-all duration-200 border border-cyan-400/50 shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]"
                      >
                        Submit
                      </button>
                      <button
                        onClick={() => {
                          setShowChallenge(false)
                          setChallengeAnswer('')
                          setError('')
                        }}
                        className="flex-1 bg-gray-600/30 text-white px-4 py-2 rounded font-semibold hover:bg-gray-500/50 transition-all duration-200 border border-gray-600/50 hover:border-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}

export default AISearchWidget 