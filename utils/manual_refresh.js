#!/usr/bin/env node

/**
 * Manual Database Refresh Trigger
 *
 * Directly calls the populateUpdatesCache function to complete the database
 * without waiting for the 30-minute scheduled refresh cycles.
 */

require('dotenv').config()

async function manualRefresh() {
  console.log('🚀 MANUAL DATABASE REFRESH')
  console.log('=' + '='.repeat(50))

  try {
    // Import the server functions we need
    const path = require('path')
    const serverPath = path.join(__dirname, '..', 'server.js')

    // We need to call the populateUpdatesCache function
    // Let's use a direct HTTP request to trigger the background refresh
    const response = await fetch('http://localhost:3000/api/development-activity?viewMode=repository&period=52weeks')

    if (response.ok) {
      console.log('✅ Successfully triggered repository data refresh')
    } else {
      console.log(`⚠️ Repository refresh response: ${response.status}`)
    }

    // Also trigger organization data refresh
    const orgResponse = await fetch('http://localhost:3000/api/development-activity?viewMode=organization&period=52weeks')

    if (orgResponse.ok) {
      console.log('✅ Successfully triggered organization data refresh')
    } else {
      console.log(`⚠️ Organization refresh response: ${orgResponse.status}`)
    }

    // Force refresh specific resources that we know need updating
    const specificResources = [
      'masumi-network',
      'cardano-foundation',
      'intersectmbo',
      'emurgo'
    ]

    console.log('🎯 Triggering refresh for specific organizations...')

    for (const resourceName of specificResources) {
      try {
        const specificResponse = await fetch(`http://localhost:3000/api/development-activity?resourceName=${encodeURIComponent(resourceName)}&period=52weeks`)

        if (specificResponse.ok) {
          const data = await specificResponse.json()
          console.log(`✅ ${resourceName}: ${data.weeklyData?.length || 0} weeks, ${data.weeklyData?.reduce((s,w) => s + w.count, 0) || 0} total commits`)
        } else {
          console.log(`⚠️ ${resourceName}: HTTP ${specificResponse.status}`)
        }
      } catch (error) {
        console.log(`❌ ${resourceName}: ${error.message}`)
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log('\n✅ Manual refresh triggers completed!')
    console.log('💡 The server will now process these requests in the background.')
    console.log('📊 Check the server logs to monitor progress.')

  } catch (error) {
    console.error('💥 Manual refresh failed:', error.message)
    console.error('💡 Make sure the server is running on http://localhost:3000')
  }
}

// Run refresh if called directly
if (require.main === module) {
  manualRefresh().catch(console.error)
}

module.exports = { manualRefresh }