const { GraphQLClient, gql } = require('graphql-request')
// Use console for server-side logging since logger-frontend is for client-side
const logger = {
  debug: console.log, // Changed to console.log for visibility in production
  info: console.log,
  warn: console.warn,
  error: console.error
}

// GraphQL stats tracking - will be injected by server.js
let GRAPHQL_STATS = null
let trackGraphQLError = null

// Allow server.js to inject tracking dependencies
const injectGraphQLTracking = (stats, errorTracker) => {
  GRAPHQL_STATS = stats
  trackGraphQLError = errorTracker
}

// GitHub GraphQL endpoint
const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

// Initialize GraphQL client
const graphqlClient = new GraphQLClient(GITHUB_GRAPHQL_ENDPOINT, {
  headers: {
    authorization: `Bearer ${GITHUB_TOKEN}`,
    'User-Agent': 'ADAdev-GraphQL-Client/1.0'
  }
})

// Tracked GraphQL request wrapper
const makeTrackedGraphQLRequest = async (query, variables = {}, operation = 'graphql_request') => {
  try {
    const response = await graphqlClient.request(query, variables)
    
    // Track successful request
    if (GRAPHQL_STATS) {
      GRAPHQL_STATS.successfulRequests++
      
      // Update rate limit info if available
      if (response.rateLimit?.remaining !== undefined) {
        GRAPHQL_STATS.lastRateLimitRemaining = response.rateLimit.remaining
      }
    }
    
    return response
  } catch (error) {
    // Track failed request
    if (GRAPHQL_STATS) {
      GRAPHQL_STATS.failedRequests++
    }
    
    // Track detailed error if tracker available
    if (trackGraphQLError) {
      const resource = variables.orgLogin || (variables.owner && variables.name) ? `${variables.owner}/${variables.name}` : 'unknown'
      trackGraphQLError(error, resource, operation)
    }
    
    throw error
  }
}

// Core GraphQL query for organization repositories and commits
const ORG_ACTIVITY_QUERY = gql`
  query OrgActivity($orgLogin: String!, $since: GitTimestamp, $first: Int, $after: String) {
    organization(login: $orgLogin) {
      login
      name
      url
      repositories(first: $first, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          nameWithOwner
          url
          createdAt
          pushedAt
          updatedAt
          stargazerCount
          forkCount
          isPrivate
          isFork
          isArchived
          primaryLanguage {
            name
          }
          defaultBranchRef {
            name
            target {
              ... on Commit {
                oid
                committedDate
                history(first: 100, since: $since) {
                  totalCount
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                  nodes {
                    oid
                    message
                    committedDate
                    author {
                      name
                      email
                      date
                    }
                    committer {
                      name
                      email
                      date
                    }
                    url
                  }
                }
              }
            }
          }
        }
      }
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`

// Single repository query for individual repos
const REPO_ACTIVITY_QUERY = gql`
  query RepoActivity($owner: String!, $name: String!, $since: GitTimestamp) {
    repository(owner: $owner, name: $name) {
      id
      name
      nameWithOwner
      url
      createdAt
      pushedAt
      updatedAt
      stargazerCount
      forkCount
      isPrivate
      isFork
      isArchived
      primaryLanguage {
        name
      }
      defaultBranchRef {
        name
        target {
          ... on Commit {
            oid
            committedDate
            history(first: 100, since: $since) {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                oid
                message
                committedDate
                author {
                  name
                  email
                  date
                }
                committer {
                  name
                  email
                  date
                }
                url
              }
            }
          }
        }
      }
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`

/**
 * Fetch organization repositories and commits using GraphQL
 * @param {string} orgLogin - GitHub organization login/name
 * @param {string} since - ISO date string for filtering commits
 * @param {number} maxRepos - Maximum number of repositories to fetch (default: 500)
 * @returns {Promise<Object>} Structured data with repositories and commits
 */
const fetchOrgDataGraphQL = async (orgLogin, since = null, maxRepos = 500) => {
  try {
    logger.debug(`🔍 Fetching GraphQL data for organization: ${orgLogin}`)
    
    // Calculate since date if not provided (default: 7 days ago)
    const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    
    let allRepositories = []
    let hasNextPage = true
    let cursor = null
    let totalFetched = 0
    let orgMetadata = null
    
    // Handle pagination to get all repositories
    while (hasNextPage && totalFetched < maxRepos) {
      const remainingRepos = maxRepos - totalFetched
      const pageSize = Math.min(100, remainingRepos) // GitHub GraphQL max is 100
      
      logger.debug(`📄 Fetching page of ${pageSize} repos for ${orgLogin} (cursor: ${cursor ? 'present' : 'null'})`)
      
      const variables = {
        orgLogin,
        since: sinceDate,
        first: pageSize,
        after: cursor
      }
      
      const response = await makeTrackedGraphQLRequest(ORG_ACTIVITY_QUERY, variables, 'fetch_org_data')
      
      if (!response.organization) {
        throw new Error(`Organization '${orgLogin}' not found or not accessible`)
      }
      
      const { organization, rateLimit } = response
      const { repositories } = organization
      
      // Capture organization metadata from first response
      if (!orgMetadata) {
        orgMetadata = {
          name: organization.name,
          login: organization.login,
          url: organization.url
        }
      }
      
      // Log rate limit status and optimize usage
      const rateLimitUsed = rateLimit.limit - rateLimit.remaining
      logger.info(`⚡ GraphQL Rate limit: ${rateLimit.remaining}/${rateLimit.limit} used (${Math.round(rateLimitUsed/rateLimit.limit*100)}% - resets: ${rateLimit.resetAt})`)
      
      // Filter out private and archived repos if needed
      const publicRepos = repositories.nodes.filter(repo => 
        !repo.isPrivate && !repo.isArchived && !repo.isFork
      )
      
      allRepositories.push(...publicRepos)
      totalFetched += publicRepos.length
      
      hasNextPage = repositories.pageInfo.hasNextPage && totalFetched < maxRepos
      cursor = repositories.pageInfo.endCursor
      
      logger.debug(`📦 Fetched ${publicRepos.length} repos, total: ${totalFetched}/${repositories.totalCount}`)
    }
    
    logger.debug(`✅ GraphQL fetch complete for ${orgLogin}: ${allRepositories.length} repositories`)
    
    return {
      organization: orgMetadata || {
        login: orgLogin,
        name: orgLogin,
        url: `https://github.com/${orgLogin}`
      },
      repositories: allRepositories,
      totalCount: allRepositories.length,
      sinceDate,
      fetchedAt: new Date().toISOString()
    }
    
  } catch (error) {
    logger.error(`❌ GraphQL fetch failed for ${orgLogin}:`, error)
    throw new Error(`Failed to fetch GraphQL data for ${orgLogin}: ${error.message}`)
  }
}

/**
 * Fetch single repository data using GraphQL
 * @param {string} owner - Repository owner
 * @param {string} name - Repository name  
 * @param {string} since - ISO date string for filtering commits
 * @returns {Promise<Object>} Repository data with commits
 */
const fetchRepoDataGraphQL = async (owner, name, since = null) => {
  try {
    logger.debug(`🔍 Fetching GraphQL data for repository: ${owner}/${name}`)
    
    const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    
    const variables = {
      owner,
      name,
      since: sinceDate
    }
    
    const response = await makeTrackedGraphQLRequest(REPO_ACTIVITY_QUERY, variables, 'fetch_repo_data')
    
    if (!response.repository) {
      throw new Error(`Repository '${owner}/${name}' not found or not accessible`)
    }
    
    const { repository, rateLimit } = response
    
    const rateLimitUsed = rateLimit.limit - rateLimit.remaining
    logger.info(`⚡ GraphQL Rate limit: ${rateLimit.remaining}/${rateLimit.limit} used (${Math.round(rateLimitUsed/rateLimit.limit*100)}% - resets: ${rateLimit.resetAt})`)
    logger.debug(`✅ GraphQL fetch complete for ${owner}/${name}`)
    
    return {
      repository,
      sinceDate,
      fetchedAt: new Date().toISOString()
    }
    
  } catch (error) {
    logger.error(`❌ GraphQL fetch failed for ${owner}/${name}:`, error)
    throw new Error(`Failed to fetch GraphQL data for ${owner}/${name}: ${error.message}`)
  }
}

/**
 * Transform GraphQL organization data to match REST API format
 * @param {Object} graphqlData - Data from fetchOrgDataGraphQL
 * @returns {Object} REST API compatible format
 */
const transformOrgDataToRestFormat = (graphqlData) => {
  const { organization, repositories, sinceDate } = graphqlData
  
  // Collect all commits across all repositories
  const allCommits = []
  const repoCommitCounts = []
  
  repositories.forEach(repo => {
    if (!repo.defaultBranchRef?.target?.history) {
      return
    }
    
    const commits = repo.defaultBranchRef.target.history.nodes
    const repoCommits = commits.map(commit => ({
      sha: commit.oid,
      commit: {
        author: {
          name: commit.author.name,
          email: commit.author.email,
          date: commit.committedDate
        },
        committer: {
          name: commit.committer.name,
          email: commit.committer.email,
          date: commit.committer.date
        },
        message: commit.message
      },
      html_url: commit.url,
      repository: {
        name: repo.name,
        full_name: repo.nameWithOwner,
        html_url: repo.url
      }
    }))
    
    allCommits.push(...repoCommits)
    repoCommitCounts.push({
      repo: repo.name,
      count: commits.length,
      totalCount: repo.defaultBranchRef.target.history.totalCount
    })
  })
  
  // Sort commits by date (newest first)
  allCommits.sort((a, b) => new Date(b.commit.author.date) - new Date(a.commit.author.date))
  
  const result = {
    commits: allCommits,
    commitsPerWeek: allCommits.length,
    weeklyData: [], // Will be populated by existing processing functions
    repoInfo: {
      name: organization.name,
      login: organization.login,
      html_url: organization.url,
      isOrganization: true,
      totalRepos: repositories.length,
      activeRepos: repoCommitCounts.filter(r => r.count > 0).length
    },
    repositories: repositories.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.nameWithOwner,
      html_url: repo.url,
      created_at: repo.createdAt,
      updated_at: repo.updatedAt,
      pushed_at: repo.pushedAt,
      stargazers_count: repo.stargazerCount,
      forks_count: repo.forkCount,
      language: repo.primaryLanguage?.name || null,
      fork: repo.isFork,
      archived: repo.isArchived,
      private: repo.isPrivate
    })),
    metadata: {
      source: 'graphql',
      sinceDate,
      fetchedAt: graphqlData.fetchedAt,
      repoCommitCounts
    }
  }
  
  logger.debug(`📊 Transformed GraphQL data: ${allCommits.length} commits from ${repositories.length} repos`)
  
  return result
}

/**
 * Transform GraphQL repository data to match REST API format  
 * @param {Object} graphqlData - Data from fetchRepoDataGraphQL
 * @returns {Object} REST API compatible format
 */
const transformRepoDataToRestFormat = (graphqlData) => {
  const { repository, sinceDate } = graphqlData
  
  let commits = []
  if (repository.defaultBranchRef?.target?.history) {
    commits = repository.defaultBranchRef.target.history.nodes.map(commit => ({
      sha: commit.oid,
      commit: {
        author: {
          name: commit.author.name,
          email: commit.author.email,
          date: commit.committedDate
        },
        committer: {
          name: commit.committer.name,
          email: commit.committer.email,
          date: commit.committer.date
        },
        message: commit.message
      },
      html_url: commit.url,
      repository: {
        name: repository.name,
        full_name: repository.nameWithOwner,
        html_url: repository.url
      }
    }))
  }
  
  const result = {
    commits,
    commitsPerWeek: commits.length,
    weeklyData: [], // Will be populated by existing processing functions
    repoInfo: {
      id: repository.id,
      name: repository.name,
      full_name: repository.nameWithOwner,
      html_url: repository.url,
      created_at: repository.createdAt,
      updated_at: repository.updatedAt,
      pushed_at: repository.pushedAt,
      stargazers_count: repository.stargazerCount,
      forks_count: repository.forkCount,
      language: repository.primaryLanguage?.name || null,
      fork: repository.isFork,
      archived: repository.isArchived,
      private: repository.isPrivate
    },
    metadata: {
      source: 'graphql',
      sinceDate,
      fetchedAt: graphqlData.fetchedAt,
      totalCommitCount: repository.defaultBranchRef?.target?.history?.totalCount || 0
    }
  }
  
  logger.debug(`📊 Transformed repo GraphQL data: ${commits.length} commits for ${repository.name}`)
  
  return result
}

module.exports = {
  fetchOrgDataGraphQL,
  fetchRepoDataGraphQL,
  transformOrgDataToRestFormat,
  transformRepoDataToRestFormat,
  injectGraphQLTracking,
  ORG_ACTIVITY_QUERY,
  REPO_ACTIVITY_QUERY
}