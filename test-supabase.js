require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase environment variables not configured')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testSupabaseConnection() {
  console.log('🔍 Testing Supabase connection...')
  
  try {
    // Test basic connection - get all records to count them
    const { data, error } = await supabase
      .from('github_activity')
      .select('*')
    
    if (error) {
      console.error('❌ Database connection failed:', error)
      return false
    }
    
    console.log('✅ Supabase connection successful')
    console.log(`📊 Current records in github_activity table: ${data?.length || 0}`)
    
    // Test table structure
    if (data && data.length > 0) {
      console.log('✅ Table structure looks good')
      console.log('📋 Sample record fields:', Object.keys(data[0]))
    } else {
      console.log('ℹ️ Table is empty, but structure is valid')
      // Try to get table schema by attempting a simple insert
      const testRecord = {
        resource_id: 'schema-test',
        repo_path: 'test/test',
        week_start: '2024-01-01',
        year: 2024,
        week_number: 1,
        commit_count: 0,
        fetched_at: new Date().toISOString()
      }
      
      const { error: schemaError } = await supabase
        .from('github_activity')
        .insert([testRecord])
      
      if (schemaError) {
        console.error('❌ Table schema issue:', schemaError)
        return false
      } else {
        console.log('✅ Table schema is correct')
        // Clean up test record
        await supabase
          .from('github_activity')
          .delete()
          .eq('resource_id', 'schema-test')
      }
    }
    
    return true
  } catch (error) {
    console.error('❌ Connection test failed:', error)
    return false
  }
}

async function testDataInsertion() {
  console.log('\n🧪 Testing data insertion...')
  
  try {
    const testRecord = {
      resource_id: 'test-resource',
      repo_path: 'test-owner/test-repo',
      week_start: '2024-01-01',
      year: 2024,
      week_number: 1,
      commit_count: 5,
      fetched_at: new Date().toISOString()
    }
    
    const { data, error } = await supabase
      .from('github_activity')
      .upsert([testRecord], {
        onConflict: 'resource_id,repo_path,week_start'
      })
    
    if (error) {
      console.error('❌ Data insertion test failed:', error)
      return false
    }
    
    console.log('✅ Data insertion test successful')
    
    // Clean up test data
    const { error: deleteError } = await supabase
      .from('github_activity')
      .delete()
      .eq('resource_id', 'test-resource')
    
    if (deleteError) {
      console.warn('⚠️ Could not clean up test data:', deleteError)
    } else {
      console.log('🧹 Test data cleaned up')
    }
    
    return true
  } catch (error) {
    console.error('❌ Data insertion test failed:', error)
    return false
  }
}

async function testSpecificResource() {
  console.log('\n🔍 Testing specific resource data...')
  
  try {
    // Test with a resource that exists in the database (ID: 20)
    const testResource = {
      id: 20,
      name: 'masumi-network',
      social: {
        github: 'https://github.com/masumi-network'
      }
    }
    
    // Extract repo path
    const repoMatch = testResource.social.github.match(/github\.com\/([^\/]+)$/)
    const repoPath = repoMatch ? repoMatch[1] : null
    
    console.log(`🔍 Testing resource: ${testResource.name} (ID: ${testResource.id})`)
    console.log(`🔍 Repo path: ${repoPath}`)
    
    if (!repoPath) {
      console.log('❌ Could not extract repo path')
      return false
    }
    
    // Check for recent data
    const threshold = new Date()
    threshold.setHours(threshold.getHours() - 24)
    
    const { data, error } = await supabase
      .from('github_activity')
      .select('*')
      .eq('resource_id', testResource.id)
      .eq('repo_path', repoPath)
      .gte('fetched_at', threshold.toISOString())
      .order('week_start', { ascending: true })
    
    if (error) {
      console.error('❌ Query failed:', error)
      return false
    }
    
    console.log(`📊 Found ${data?.length || 0} recent records for ${testResource.name}`)
    
    if (data && data.length > 0) {
      console.log('📋 Sample records:')
      data.slice(0, 3).forEach((record, i) => {
        console.log(`  ${i + 1}. Week: ${record.week_start}, Commits: ${record.commit_count}`)
      })
    } else {
      console.log('ℹ️ No recent data found for this resource')
    }
    
    return true
  } catch (error) {
    console.error('❌ Specific resource test failed:', error)
    return false
  }
}

async function inspectTableData() {
  console.log('\n🔍 Inspecting table data...')
  
  try {
    // Get a sample of recent records
    const { data, error } = await supabase
      .from('github_activity')
      .select('*')
      .order('fetched_at', { ascending: false })
      .limit(10)
    
    if (error) {
      console.error('❌ Query failed:', error)
      return false
    }
    
    console.log(`📊 Recent records in table:`)
    data.forEach((record, i) => {
      console.log(`  ${i + 1}. Resource: ${record.resource_id}, Repo: ${record.repo_path}, Week: ${record.week_start}, Commits: ${record.commit_count}, Fetched: ${record.fetched_at}`)
    })
    
    // Get unique resource IDs
    const { data: uniqueResources, error: resourceError } = await supabase
      .from('github_activity')
      .select('resource_id')
      .order('resource_id')
    
    if (resourceError) {
      console.error('❌ Resource query failed:', resourceError)
      return false
    }
    
    const resourceIds = [...new Set(uniqueResources.map(r => r.resource_id))]
    console.log(`\n📊 Unique resources in table (${resourceIds.length}):`)
    resourceIds.slice(0, 10).forEach(id => console.log(`  - ${id}`))
    if (resourceIds.length > 10) {
      console.log(`  ... and ${resourceIds.length - 10} more`)
    }
    
    return true
  } catch (error) {
    console.error('❌ Table inspection failed:', error)
    return false
  }
}

async function mapResourceIdsToNames() {
  console.log('\n🔍 Mapping resource IDs to names...')
  
  try {
    // Get all unique resource IDs and their data
    const { data, error } = await supabase
      .from('github_activity')
      .select('resource_id, repo_path, commit_count, week_start')
      .order('resource_id')
    
    if (error) {
      console.error('❌ Query failed:', error)
      return false
    }
    
    // Group by resource_id
    const resourceMap = {}
    data.forEach(record => {
      if (!resourceMap[record.resource_id]) {
        resourceMap[record.resource_id] = {
          repo_path: record.repo_path,
          total_records: 0,
          total_commits: 0,
          weeks_with_commits: 0,
          sample_weeks: []
        }
      }
      resourceMap[record.resource_id].total_records++
      resourceMap[record.resource_id].total_commits += record.commit_count
      if (record.commit_count > 0) {
        resourceMap[record.resource_id].weeks_with_commits++
      }
      if (resourceMap[record.resource_id].sample_weeks.length < 3) {
        resourceMap[record.resource_id].sample_weeks.push({
          week: record.week_start,
          commits: record.commit_count
        })
      }
    })
    
    console.log('📊 Resource mapping:')
    Object.entries(resourceMap).forEach(([id, info]) => {
      console.log(`  ID ${id}: ${info.repo_path}`)
      console.log(`    Records: ${info.total_records}, Total commits: ${info.total_commits}, Weeks with commits: ${info.weeks_with_commits}`)
      console.log(`    Sample weeks: ${info.sample_weeks.map(w => `${w.week}(${w.commits})`).join(', ')}`)
    })
    
    return true
  } catch (error) {
    console.error('❌ Resource mapping failed:', error)
    return false
  }
}

async function runAllTests() {
  console.log('🚀 Starting Supabase tests...\n')
  
  const connectionTest = await testSupabaseConnection()
  if (!connectionTest) {
    console.log('❌ Connection test failed, stopping')
    return
  }
  
  const insertionTest = await testDataInsertion()
  if (!insertionTest) {
    console.log('❌ Insertion test failed')
  }
  
  const resourceTest = await testSpecificResource()
  if (!resourceTest) {
    console.log('❌ Resource test failed')
  }
  
  const inspectionTest = await inspectTableData()
  if (!inspectionTest) {
    console.log('❌ Table inspection failed')
  }
  
  const mappingTest = await mapResourceIdsToNames()
  if (!mappingTest) {
    console.log('❌ Resource mapping failed')
  }
  
  console.log('\n✅ All tests completed')
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error)
}

module.exports = {
  testSupabaseConnection,
  testDataInsertion,
  testSpecificResource,
  runAllTests
} 