const CACHE_NAME = 'github-updates-v2'
const CACHE_DURATION = 4 * 60 * 60 * 1000 // 4 hours (increased for data analysis platform)
const MAX_CACHE_SIZE = 100 // Increased from 50
const API_CACHE_NAME = 'api-cache-v1'
const API_CACHE_DURATION = 2 * 60 * 60 * 1000 // 2 hours for API responses

// Production logger - only log in development
const log = (...args) => {
  if (typeof self !== 'undefined' && self.location && self.location.hostname === 'localhost') {
    console.log(...args)
  }
}

// Helper function to check if a request can be cached
function canCacheRequest(request) {
  // Don't cache chrome-extension requests
  if (request.url.startsWith('chrome-extension://')) {
    return false
  }
  
  // Don't cache POST requests
  if (request.method !== 'GET') {
    return false
  }
  
  // Don't cache non-HTTP(S) requests
  if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) {
    return false
  }
  
  return true
}

// Install event - set up cache
self.addEventListener('install', (event) => {
  log('Service Worker installing...')
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  log('Service Worker activating...')
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            log('Deleting old cache:', cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
})

// Enhanced fetch event with better caching strategy
self.addEventListener('fetch', (event) => {
  const url = event.request.url
  
  // Skip caching for unsupported request types
  if (!canCacheRequest(event.request)) {
    return // Let the browser handle it normally
  }
  
  // Handle GitHub API requests
  if (url.includes('api.github.com')) {
    event.respondWith(handleGitHubAPIRequest(event.request))
    return
  }
  
  // Handle server API requests (GET only)
  if (url.includes('/api/') && !url.includes('api.github.com') && event.request.method === 'GET') {
    event.respondWith(handleServerAPIRequest(event.request))
    return
  }
  
  // Handle static assets
  if (url.includes('.js') || url.includes('.css') || url.includes('.png') || url.includes('.svg') || url.includes('.jpg') || url.includes('.jpeg') || url.includes('.gif') || url.includes('.ico')) {
    event.respondWith(handleStaticAssetRequest(event.request))
    return
  }
})

// Handle GitHub API requests with improved caching
async function handleGitHubAPIRequest(request) {
  const cache = await caches.open(CACHE_NAME)
  
  // Check cache first
  const cachedResponse = await cache.match(request)
  if (cachedResponse) {
    const cacheTime = new Date(cachedResponse.headers.get('sw-cache-time'))
    const now = new Date()
    
    if (now - cacheTime < CACHE_DURATION) {
      log('Serving GitHub API from cache:', request.url)
      return cachedResponse
    } else {
      log('GitHub API cache expired, fetching fresh data:', request.url)
      cache.delete(request)
    }
  }

  // Fetch fresh data
  try {
    const response = await fetch(request)
    
    if (response.ok && canCacheRequest(request)) {
      // Clone response to add cache timestamp
      const responseToCache = response.clone()
      const headers = new Headers(responseToCache.headers)
      headers.append('sw-cache-time', new Date().toISOString())
      
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      })

      // Store in cache
      cache.put(request, cachedResponse)
      
      // Clean up old entries if cache is too large
      cleanupCache(cache, MAX_CACHE_SIZE)
    }
    
    return response
  } catch (error) {
    log('GitHub API fetch failed, trying cache:', error)
    // Return cached response if available, even if expired
    const fallbackResponse = await cache.match(request)
    if (fallbackResponse) {
      log('Serving stale GitHub API data from cache')
      return fallbackResponse
    }
    throw error
  }
}

// Handle server API requests with caching
async function handleServerAPIRequest(request) {
  const cache = await caches.open(API_CACHE_NAME)
  
  // Check cache first
  const cachedResponse = await cache.match(request)
  if (cachedResponse) {
    const cacheTime = new Date(cachedResponse.headers.get('sw-cache-time'))
    const now = new Date()
    
    if (now - cacheTime < API_CACHE_DURATION) {
      log('Serving server API from cache:', request.url)
      return cachedResponse
    } else {
      log('Server API cache expired, fetching fresh data:', request.url)
      cache.delete(request)
    }
  }

  // Fetch fresh data
  try {
    const response = await fetch(request)
    
    if (response.ok && canCacheRequest(request)) {
      // Clone response to add cache timestamp
      const responseToCache = response.clone()
      const headers = new Headers(responseToCache.headers)
      headers.append('sw-cache-time', new Date().toISOString())
      
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      })

      // Store in cache
      cache.put(request, cachedResponse)
      
      // Clean up old entries if cache is too large
      cleanupCache(cache, MAX_CACHE_SIZE)
    }
    
    return response
  } catch (error) {
    log('Server API fetch failed, trying cache:', error)
    // Return cached response if available, even if expired
    const fallbackResponse = await cache.match(request)
    if (fallbackResponse) {
      log('Serving stale server API data from cache')
      return fallbackResponse
    }
    throw error
  }
}

// Handle static assets with long-term caching
async function handleStaticAssetRequest(request) {
  const cache = await caches.open(CACHE_NAME)
  
  // Check cache first
  const cachedResponse = await cache.match(request)
  if (cachedResponse) {
    log('Serving static asset from cache:', request.url)
    return cachedResponse
  }

  // Fetch fresh data
  try {
    const response = await fetch(request)
    
    if (response.ok && canCacheRequest(request)) {
      // Clone response to add cache timestamp
      const responseToCache = response.clone()
      const headers = new Headers(responseToCache.headers)
      headers.append('sw-cache-time', new Date().toISOString())
      
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      })

      // Store in cache
      cache.put(request, cachedResponse)
    }
    
    return response
  } catch (error) {
    log('Static asset fetch failed:', error)
    throw error
  }
}

// Improved cache cleanup function
async function cleanupCache(cache, maxSize) {
  const requests = await cache.keys()
  if (requests.length > maxSize) {
    // Remove oldest entries based on cache time
    const requestsWithTimes = await Promise.all(
      requests.map(async (request) => {
        const response = await cache.match(request)
        const cacheTime = new Date(response.headers.get('sw-cache-time') || 0)
        return { request, cacheTime }
      })
    )
    
    const sortedRequests = requestsWithTimes.sort((a, b) => a.cacheTime - b.cacheTime)
    const toDelete = sortedRequests.slice(0, requests.length - maxSize)
    
    for (const { request } of toDelete) {
      await cache.delete(request)
    }
    
    log(`Cleaned up ${toDelete.length} old cache entries`)
  }
}

// Message handling for cache management
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    Promise.all([
      caches.delete(CACHE_NAME),
      caches.delete(API_CACHE_NAME)
    ]).then(() => {
      event.ports[0].postMessage({ success: true })
    })
  } else if (event.data && event.data.type === 'GET_CACHE_STATUS') {
    Promise.all([
      caches.open(CACHE_NAME).then(cache => cache.keys()),
      caches.open(API_CACHE_NAME).then(cache => cache.keys())
    ]).then(([githubKeys, apiKeys]) => {
      event.ports[0].postMessage({ 
        success: true, 
        githubCacheSize: githubKeys.length,
        apiCacheSize: apiKeys.length
      })
    })
  }
}) 