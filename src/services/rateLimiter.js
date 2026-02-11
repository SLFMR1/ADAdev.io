// Server-side rate limiting and spam protection
const BLOCK_DURATION = 60 * 60 * 1000 // 1 hour
const SUSPICIOUS_WINDOW = 30 * 60 * 1000 // 30 minutes

class RateLimiter {
  constructor() {
    this.ipRequests = new Map()
    this.blockedIPs = new Map() // ip → blockedAt timestamp
    this.suspiciousIPs = new Map() // ip → { count, firstSeen }
  }

  // Track requests by IP
  trackRequest(ip, endpoint) {
    const now = Date.now()
    const key = `${ip}:${endpoint}`

    if (!this.ipRequests.has(key)) {
      this.ipRequests.set(key, [])
    }

    const requests = this.ipRequests.get(key)
    requests.push(now)

    // Keep only requests from last 5 minutes
    const fiveMinutesAgo = now - 5 * 60 * 1000
    const recentRequests = requests.filter(time => time > fiveMinutesAgo)
    this.ipRequests.set(key, recentRequests)

    return recentRequests.length
  }

  // Check if IP is blocked (with expiration)
  isBlocked(ip) {
    const blockedAt = this.blockedIPs.get(ip)
    if (!blockedAt) return false
    if (Date.now() - blockedAt > BLOCK_DURATION) {
      this.blockedIPs.delete(ip)
      return false
    }
    return true
  }

  // Check rate limits
  checkRateLimit(ip, endpoint) {
    if (this.isBlocked(ip)) {
      throw new Error('Access denied')
    }

    const requestCount = this.trackRequest(ip, endpoint)

    // Block if too many requests
    if (requestCount > 20) { // 20 requests per 5 minutes
      this.blockedIPs.set(ip, Date.now())
      throw new Error('Rate limit exceeded. Please try again later.')
    }

    // Mark as suspicious if high activity
    if (requestCount > 10) {
      const existing = this.suspiciousIPs.get(ip)
      if (existing) {
        existing.count++
      } else {
        this.suspiciousIPs.set(ip, { count: 1, firstSeen: Date.now() })
      }
    }

    // Block if consistently suspicious
    const suspicious = this.suspiciousIPs.get(ip)
    if (suspicious && suspicious.count > 3) {
      this.blockedIPs.set(ip, Date.now())
      throw new Error('Suspicious activity detected. Access denied.')
    }
  }

  // Clean up old data
  cleanup() {
    const now = Date.now()
    const fiveMinutesAgo = now - 5 * 60 * 1000

    for (const [key, requests] of this.ipRequests.entries()) {
      const recentRequests = requests.filter(time => time > fiveMinutesAgo)
      if (recentRequests.length === 0) {
        this.ipRequests.delete(key)
      } else {
        this.ipRequests.set(key, recentRequests)
      }
    }

    // Expire blocked IPs older than 1 hour
    for (const [ip, blockedAt] of this.blockedIPs.entries()) {
      if (now - blockedAt > BLOCK_DURATION) {
        this.blockedIPs.delete(ip)
      }
    }

    // Expire suspicious IPs older than 30 minutes
    for (const [ip, data] of this.suspiciousIPs.entries()) {
      if (now - data.firstSeen > SUSPICIOUS_WINDOW) {
        this.suspiciousIPs.delete(ip)
      }
    }
  }
}

// Content validation
export const validateContent = (content) => {
  const issues = []

  // Check for spam patterns
  const spamPatterns = [
    /\b(buy|sell|cheap|discount|offer|limited|act now|click here)\b/gi,
    /(.)\1{5,}/g, // Repeated characters
    /\b(spam|viagra|casino|poker)\b/gi,
  ]

  for (const pattern of spamPatterns) {
    if (pattern.test(content)) {
      issues.push('Content contains suspicious patterns')
      break
    }
  }

  // Check for excessive repetition
  const words = content.toLowerCase().split(/\s+/)
  const wordCount = {}
  words.forEach(word => {
    wordCount[word] = (wordCount[word] || 0) + 1
  })

  const maxRepetition = Math.max(...Object.values(wordCount))
  // Only flag if a word appears more than 60% of the time AND there are enough words
  if (maxRepetition > words.length * 0.6 && words.length > 5) {
    issues.push('Content contains excessive repetition')
  }

  // Check for suspicious length patterns
  if (content.length < 10 || content.length > 2000) {
    issues.push('Content length is outside acceptable range')
  }

  return {
    isValid: issues.length === 0,
    issues
  }
}

// Get client IP (for server-side use)
export const getClientIP = (req) => {
  return req.headers['x-forwarded-for'] ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         req.ip
}

export const rateLimiter = new RateLimiter()

// Cleanup old data every 5 minutes
setInterval(() => {
  rateLimiter.cleanup()
}, 5 * 60 * 1000)