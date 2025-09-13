import React, { useState, useRef, useEffect } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { analyzeUserRequirements } from '../services/ai'

const AISearchInput = ({ onAnalysisComplete, onLoadingChange, isGlowing = false, triggerTyping = false, onTypingComplete }) => {
  const [inputValue, setInputValue] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [lastSubmissionTime, setLastSubmissionTime] = useState(0)
  const [submissionCount, setSubmissionCount] = useState(0)
  const [showChallenge, setShowChallenge] = useState(false)
  const [challengeAnswer, setChallengeAnswer] = useState('')
  const [suspiciousActivity, setSuspiciousActivity] = useState(0)
  const [isTyping, setIsTyping] = useState(false)
  const [typedText, setTypedText] = useState('')
  const progressInterval = useRef(null)
  const typingTimeoutRef = useRef(null)
  const prevTriggerTyping = useRef(false)
  const currentIndexRef = useRef(0)

  // Rate limiting: max 5 submissions per minute
  const RATE_LIMIT_SUBMISSIONS = 5
  const RATE_LIMIT_WINDOW = 60000 // 1 minute in ms
  const MIN_SUBMISSION_INTERVAL = 2000 // 2 seconds between submissions

  // Matrix typing animation
  useEffect(() => {
    if (triggerTyping && !prevTriggerTyping.current && !isTyping) {
      setIsTyping(true)
      setTypedText('')
      currentIndexRef.current = 0
      const message = "Wake up, Neo..."
      const typeNext = () => {
        if (currentIndexRef.current < message.length) {
          setTypedText(message.slice(0, currentIndexRef.current + 1))
          currentIndexRef.current++
          let delay = 100
          if (currentIndexRef.current === 4) delay = 200 // Pause after 'Wake'
          else if (currentIndexRef.current === 8) delay = 250 // Pause after 'Wake up,'
          typingTimeoutRef.current = setTimeout(typeNext, delay)
        } else {
          typingTimeoutRef.current = setTimeout(() => {
            setTypedText('')
            setIsTyping(false)
            onTypingComplete?.()
          }, 2000)
        }
      }
      typeNext()
    }
    prevTriggerTyping.current = triggerTyping
  }, [triggerTyping, onTypingComplete])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [])

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

    // API key check removed - now handled server-side

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
    onLoadingChange?.(true)
    setProgress(0)

    try {
      const results = await analyzeUserRequirements(validatedInput)
      setProgress(100)
      
      // Wait for progress bar animation to complete (500ms) plus a small delay for visual feedback
      setTimeout(() => {
        setIsAnalyzing(false)
        onAnalysisComplete?.(results, validatedInput)
        
        // Add a small delay before scrolling to let the user see the completion
        setTimeout(() => {
          const element = document.getElementById('ai-results')
          if (element) {
            element.scrollIntoView({ behavior: 'smooth' })
          }
        }, 200) // Small delay to let user see the completed state
      }, 700) // Wait 700ms total: 500ms for animation + 200ms buffer
      
    } catch (err) {
      setError(err.message || 'Failed to analyze requirements')
      setIsAnalyzing(false)
    } finally {
      onLoadingChange?.(false)
      setLastSubmissionTime(Date.now())
      setSubmissionCount(prev => prev + 1)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto mb-6 sm:mb-8">
      <form onSubmit={handleSubmit} className="relative">
        <div className={`relative w-full rounded-full border border-gray-700 bg-card-bg/50 backdrop-blur-md pl-8 sm:pl-10 pr-6 sm:pr-8 py-3 sm:py-4 transition-all duration-300`}>
          {/* Matrix Overlay */}
          {isTyping && (
            <div className="absolute inset-0 flex items-center z-50 pointer-events-none">
              <span className="text-emerald-400 font-mono text-xs sm:text-sm tracking-wide pl-8 sm:pl-10">
                {typedText}
                <span className="animate-blink">|</span>
              </span>
            </div>
          )}
          {/* Progress Bar */}
          {isAnalyzing && (
            <div className="absolute inset-0 z-0 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-transparent to-teal-400/85 transition-all duration-500 shadow-[0_0_30px_rgba(45,212,191,0.85),0_0_60px_rgba(45,212,191,0.4)]"
                style={{ width: `${progress}%`, minWidth: progress > 0 ? '8px' : 0 }}
              />
            </div>
          )}
          {/* Search Icon */}
          <div className="absolute inset-y-0 left-0 pl-3 sm:pl-4 flex items-center pointer-events-none z-10">
            <Search className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
          </div>
          {/* Input Field */}
          <input
            type="text"
            value={isTyping ? '' : inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={isTyping ? '' : "What are you building?"}
            className="w-full bg-transparent border-none text-white placeholder-gray-400 focus:outline-none focus:ring-0 focus:border-none focus:shadow-none transition-all duration-200 text-sm sm:text-lg relative z-10 pr-8 sm:pr-10"
            disabled={isAnalyzing || isTyping}
            style={{ 
              position: 'relative',
              outline: 'none',
              boxShadow: 'none'
            }}
          />
          {/* Submit Button */}
          {!isAnalyzing && (
            <button
              type="submit"
              disabled={!inputValue.trim() || isTyping}
              className="absolute right-1 sm:right-2 top-1/2 transform -translate-y-1/2 bg-transparent border border-white/50 text-white px-3 py-3 sm:px-5 sm:py-5 rounded-full font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-custom-bg disabled:opacity-50 disabled:cursor-not-allowed hover:border-white hover:bg-white/10 hover:scale-105 active:scale-95 z-40 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] touch-target"
            >
            </button>
          )}
        </div>
      </form>
      {/* Error Message */}
      {error && (
        <div className="mt-2 sm:mt-3 text-red-400 text-xs sm:text-sm text-center">
          {error}
        </div>
      )}
      {/* Challenge Modal */}
      {showChallenge && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card-bg border border-gray-700 rounded-lg p-4 sm:p-6 max-w-md w-full">
            <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Verification Required</h3>
            <p className="text-gray-300 text-sm sm:text-base mb-3 sm:mb-4">Please answer this question to continue:</p>
            <div className="mb-3 sm:mb-4">
              <p className="text-cyan-400 font-medium text-sm sm:text-base">{generateChallenge().question}</p>
            </div>
            <input
              type="text"
              value={challengeAnswer}
              onChange={(e) => setChallengeAnswer(e.target.value)}
              placeholder="Your answer..."
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400 text-sm sm:text-base"
            />
            <div className="flex gap-2 sm:gap-3 mt-3 sm:mt-4">
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
                className="flex-1 bg-gradient-to-r from-emerald-400 to-cyan-400 text-black px-3 py-2 sm:px-4 rounded font-semibold hover:from-emerald-500 hover:to-cyan-500 transition-all text-sm sm:text-base touch-target"
              >
                Submit
              </button>
              <button
                onClick={() => {
                  setShowChallenge(false)
                  setChallengeAnswer('')
                  setError('')
                }}
                className="flex-1 bg-gray-600 text-white px-3 py-2 sm:px-4 rounded font-semibold hover:bg-gray-500 transition-all text-sm sm:text-base touch-target"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Help Text */}
      <div className="mt-4 text-center">
      </div>
    </div>
  )
}

export default AISearchInput 

// Animations
// Add to your global CSS (e.g., index.css):
// .animate-blink { animation: blink 1s steps(2, start) infinite; }
// @keyframes blink { to { visibility: hidden; } }
// .animate-fade-in { animation: fadeIn 0.3s ease; }
// @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } } 