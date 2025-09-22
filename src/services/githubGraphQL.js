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

// Organizations that require smaller batch sizes due to complexity/size
const KNOWN_LARGE_ORGS = ['cardano-foundation', 'marlowe-lang', 'opshin', 'blockfrost']

// Repositories to exclude due to excessive size/memory usage
const EXCLUDED_REPOS = [
  'cardano-foundation/cardano-token-registry'  // Massive repo causing memory issues
]

// Initialize GraphQL client with timeout
const graphqlClient = new GraphQLClient(GITHUB_GRAPHQL_ENDPOINT, {
  headers: {
    authorization: `Bearer ${GITHUB_TOKEN}`,
    'User-Agent': 'ADAdev-GraphQL-Client/1.0'
  },
  timeout: 30000 // 30 second timeout
})

// Helper function to check if error is retryable server error
const isRetryableServerError = (error) => {
  if (!error?.response?.status) return false
  const status = error.response.status
  return status === 502 || status === 503 || status === 504
}

// Helper function to check if error is a timeout
const isTimeoutError = (error) => {
  return error?.code === 'ETIMEDOUT' ||
         error?.message?.includes('timeout') ||
         error?.name === 'TimeoutError'
}

// Helper function to extract status code from GraphQL error
const getErrorStatusCode = (error) => {
  if (error?.response?.status) return error.response.status
  if (error?.response?.error?.includes('502 Bad Gateway')) return 502
  if (error?.response?.error?.includes('503 Service Unavailable')) return 503
  if (error?.response?.error?.includes('504 Gateway Timeout')) return 504
  return null
}

// Tracked GraphQL request wrapper with exponential backoff for server errors
const makeTrackedGraphQLRequest = async (query, variables = {}, operation = 'graphql_request') => {
  const maxRetries = 3
  const baseDelay = 1000 // 1 second

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
      const statusCode = getErrorStatusCode(error)
      const isLastAttempt = attempt === maxRetries
      const isServerError = isRetryableServerError(error)

      // Track failed request
      if (GRAPHQL_STATS) {
        GRAPHQL_STATS.failedRequests++
      }

      // Track detailed error if tracker available
      if (trackGraphQLError) {
        const resource = variables.orgLogin || (variables.owner && variables.name) ? `${variables.owner}/${variables.name}` : 'unknown'
        trackGraphQLError(error, resource, operation, statusCode)
      }

      // Retry logic for server errors (502, 503, 504) and timeouts
      const isTimeout = isTimeoutError(error)
      if ((isServerError || isTimeout) && !isLastAttempt) {
        const delay = baseDelay * Math.pow(2, attempt) // Exponential backoff: 1s, 2s, 4s
        const errorType = isTimeout ? 'timeout' : `server error ${statusCode}`
        logger.warn(`🔄 GraphQL ${errorType}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)

        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      // For final attempt or non-server errors, throw immediately
      throw error
    }
  }
}

// Separate query for paginating commit history
const COMMIT_HISTORY_QUERY = gql`
  query CommitHistory($owner: String!, $name: String!, $ref: String!, $since: GitTimestamp, $after: String) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $ref) {
        target {
          ... on Commit {
            history(first: 100, since: $since, after: $after) {
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
`

// Core GraphQL query for organization repositories and commits
const ORG_ACTIVITY_QUERY = gql`
  query OrgActivity($orgLogin: String!, $since: GitTimestamp, $first: Int, $after: String, $commitCursor: String) {
    organization(login: $orgLogin) {
      login
      name
      url
      repositories(first: $first, after: $after, isFork: false, orderBy: {field: UPDATED_AT, direction: DESC}) {
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
                history(first: 100, since: $since, after: $commitCursor) {
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
          refs(refPrefix: "refs/heads/", first: 10) {
            nodes {
              name
              target {
                ... on Commit {
                  oid
                  committedDate
                  history(first: 100, since: $since, after: $commitCursor) {
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
  query RepoActivity($owner: String!, $name: String!, $since: GitTimestamp, $commitCursor: String) {
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
            history(first: 100, since: $since, after: $commitCursor) {
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
 * @param {number} maxRepos - Maximum number of repositories to fetch (default: 1000)
 * @returns {Promise<Object>} Structured data with repositories and commits
 */
const fetchOrgDataGraphQL = async (orgLogin, since = null, maxRepos = 1000) => {
  try {
    logger.debug(`🔍 Fetching GraphQL data for organization: ${orgLogin}`)
    
    // Use since date if provided, otherwise fetch complete history (null = no date filter)
    const sinceDate = since === null ? null : (since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    
    let allRepositories = []
    let hasNextPage = true
    let cursor = null
    let totalFetched = 0
    let orgMetadata = null
    
    // Handle pagination to get all repositories
    while (hasNextPage && totalFetched < maxRepos) {
      const remainingRepos = maxRepos - totalFetched

      // Adaptive page sizing - check known large orgs first, then detected size
      let maxPageSize = 100 // GitHub GraphQL max

      if (KNOWN_LARGE_ORGS.includes(orgLogin)) {
        maxPageSize = 5 // Ultra-small batches for known problematic orgs
      } else if (orgMetadata?.isVeryLargeOrg) {
        maxPageSize = 25 // Smaller batches for very large orgs
      } else if (orgMetadata?.isLargeOrg) {
        maxPageSize = 50 // Medium batches for large orgs
      }

      const pageSize = Math.min(maxPageSize, remainingRepos)

      // Log special handling for known large orgs
      if (KNOWN_LARGE_ORGS.includes(orgLogin) && totalFetched === 0) {
        logger.info(`🎯 Using small batches (${maxPageSize} repos) for known large org: ${orgLogin}`)
      }

      logger.debug(`📄 Fetching page of ${pageSize} repos for ${orgLogin} (cursor: ${cursor ? 'present' : 'null'})`)
      
      const variables = {
        orgLogin,
        since: sinceDate,
        first: pageSize,
        after: cursor,
        commitCursor: null
      }
      
      const response = await makeTrackedGraphQLRequest(ORG_ACTIVITY_QUERY, variables, 'fetch_org_data')
      
      if (!response.organization) {
        throw new Error(`Organization '${orgLogin}' not found or not accessible`)
      }
      
      const { organization, rateLimit } = response
      const { repositories } = organization
      
      // Capture organization metadata from first response and detect size
      if (!orgMetadata) {
        const totalRepoCount = repositories.totalCount
        const isLargeOrg = totalRepoCount > 200
        const isVeryLargeOrg = totalRepoCount > 500

        orgMetadata = {
          name: organization.name,
          login: organization.login,
          url: organization.url,
          totalRepoCount,
          isLargeOrg,
          isVeryLargeOrg
        }

        // Log organization size for monitoring
        logger.info(`📊 Organization size: ${totalRepoCount} repos (${isVeryLargeOrg ? 'very large' : isLargeOrg ? 'large' : 'normal'})`)
      }
      
      // Log rate limit status and optimize usage
      const rateLimitUsed = rateLimit.limit - rateLimit.remaining
      logger.info(`⚡ GraphQL Rate limit: ${rateLimit.remaining}/${rateLimit.limit} used (${Math.round(rateLimitUsed/rateLimit.limit*100)}% - resets: ${rateLimit.resetAt})`)
      
      // Filter out private and archived repos (forks are already excluded by GraphQL query)
      const publicRepos = repositories.nodes.filter(repo =>
        !repo.isPrivate && !repo.isArchived
      )
      
      allRepositories.push(...publicRepos)
      totalFetched += publicRepos.length
      
      hasNextPage = repositories.pageInfo.hasNextPage && totalFetched < maxRepos
      cursor = repositories.pageInfo.endCursor
      
      logger.debug(`📦 Fetched ${publicRepos.length} repos, total: ${totalFetched}/${repositories.totalCount}`)

      // Add progressive delays for large organizations to prevent overwhelming GitHub
      if (hasNextPage && orgMetadata) {
        let delay = 0
        if (orgMetadata.isVeryLargeOrg) {
          delay = 1000 // 1 second delay for very large orgs
        } else if (orgMetadata.isLargeOrg) {
          delay = 500  // 500ms delay for large orgs
        }

        if (delay > 0) {
          logger.debug(`⏱️ Adding ${delay}ms delay before next request (org size optimization)`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    
    logger.debug(`✅ GraphQL fetch complete for ${orgLogin}: ${allRepositories.length} repositories`)

    // Fetch additional commits for repositories that have more than 100 commits on any branch
    for (const repo of allRepositories) {
      // Handle default branch pagination
      if (repo.defaultBranchRef?.target?.history) {
        const history = repo.defaultBranchRef.target.history
        if (history.pageInfo.hasNextPage && history.totalCount > 100) {
          let commitCursor = history.pageInfo.endCursor
          let totalCommitsFetched = history.nodes.length

          logger.debug(`📈 ${repo.name} (default): Fetching additional commits (${history.totalCount} total, ${totalCommitsFetched} fetched)`)

          // Fetch all commits from default branch with retry logic
          let retryCount = 0
          const maxRetries = 3

          while (history.pageInfo.hasNextPage && retryCount <= maxRetries) {
            try {
              // Exponential backoff: 1s, 2s, 4s delays
              if (retryCount > 0) {
                const delay = Math.pow(2, retryCount - 1) * 1000
                logger.debug(`🔄 Retrying ${repo.name} (default) after ${delay}ms delay (attempt ${retryCount + 1}/${maxRetries + 1})`)
                await new Promise(resolve => setTimeout(resolve, delay))
              }

              const commitPageResponse = await makeTrackedGraphQLRequest(COMMIT_HISTORY_QUERY, {
                owner: repo.nameWithOwner.split('/')[0],
                name: repo.name,
                ref: repo.defaultBranchRef.name,
                since: sinceDate,
                after: commitCursor
              }, 'fetch_additional_commits')

              const commitHistory = commitPageResponse.repository?.ref?.target?.history

              if (commitHistory?.nodes) {
                const newCommits = commitHistory.nodes
                history.nodes.push(...newCommits)
                totalCommitsFetched += newCommits.length

                history.pageInfo.hasNextPage = commitHistory.pageInfo.hasNextPage
                commitCursor = commitHistory.pageInfo.endCursor

                logger.debug(`📈 ${repo.name} (default): +${newCommits.length} commits (total: ${totalCommitsFetched}/${history.totalCount})`)
                retryCount = 0 // Reset retry count on success
              } else {
                throw new Error('No commit data returned from GraphQL')
              }
            } catch (error) {
              retryCount++
              if (retryCount > maxRetries) {
                logger.error(`❌ Failed to fetch additional commits for ${repo.name} (default) after ${maxRetries} retries: ${error.message}`)
                break
              } else {
                logger.warn(`⚠️ Attempt ${retryCount} failed for ${repo.name} (default): ${error.message} - retrying...`)
              }
            }
          }
        }
      }

      // Handle all other branches pagination
      if (repo.refs?.nodes) {
        for (const ref of repo.refs.nodes) {
          if (ref.target?.history) {
            const history = ref.target.history
            if (history.pageInfo.hasNextPage && history.totalCount > 100) {
              let commitCursor = history.pageInfo.endCursor
              let totalCommitsFetched = history.nodes.length

              logger.debug(`📈 ${repo.name} (${ref.name}): Fetching additional commits (${history.totalCount} total, ${totalCommitsFetched} fetched)`)

              // Fetch all commits from this branch with retry logic
              let branchRetryCount = 0
              const maxBranchRetries = 3

              while (history.pageInfo.hasNextPage && branchRetryCount <= maxBranchRetries) {
                try {
                  // Exponential backoff: 1s, 2s, 4s delays
                  if (branchRetryCount > 0) {
                    const delay = Math.pow(2, branchRetryCount - 1) * 1000
                    logger.debug(`🔄 Retrying ${repo.name} (${ref.name}) after ${delay}ms delay (attempt ${branchRetryCount + 1}/${maxBranchRetries + 1})`)
                    await new Promise(resolve => setTimeout(resolve, delay))
                  }

                  const commitPageResponse = await makeTrackedGraphQLRequest(COMMIT_HISTORY_QUERY, {
                    owner: repo.nameWithOwner.split('/')[0],
                    name: repo.name,
                    ref: ref.name,
                    since: sinceDate,
                    after: commitCursor
                  }, 'fetch_additional_commits')

                  const commitHistory = commitPageResponse.repository?.ref?.target?.history

                  if (commitHistory?.nodes) {
                    const newCommits = commitHistory.nodes
                    history.nodes.push(...newCommits)
                    totalCommitsFetched += newCommits.length

                    history.pageInfo.hasNextPage = commitHistory.pageInfo.hasNextPage
                    commitCursor = commitHistory.pageInfo.endCursor

                    logger.debug(`📈 ${repo.name} (${ref.name}): +${newCommits.length} commits (total: ${totalCommitsFetched}/${history.totalCount})`)
                    branchRetryCount = 0 // Reset retry count on success
                  } else {
                    throw new Error('No commit data returned from GraphQL')
                  }
                } catch (error) {
                  branchRetryCount++
                  if (branchRetryCount > maxBranchRetries) {
                    logger.error(`❌ Failed to fetch additional commits for ${repo.name} (${ref.name}) after ${maxBranchRetries} retries: ${error.message}`)
                    break
                  } else {
                    logger.warn(`⚠️ Attempt ${branchRetryCount} failed for ${repo.name} (${ref.name}): ${error.message} - retrying...`)
                  }
                }
              }
            }
          }
        }
      }
    }

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
    
    // Use since date if provided, otherwise fetch complete history (null = no date filter)
    const sinceDate = since === null ? null : (since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    
    const variables = {
      owner,
      name,
      since: sinceDate,
      commitCursor: null
    }
    
    const response = await makeTrackedGraphQLRequest(REPO_ACTIVITY_QUERY, variables, 'fetch_repo_data')
    
    if (!response.repository) {
      throw new Error(`Repository '${owner}/${name}' not found or not accessible`)
    }
    
    const { repository, rateLimit } = response
    
    const rateLimitUsed = rateLimit.limit - rateLimit.remaining
    logger.info(`⚡ GraphQL Rate limit: ${rateLimit.remaining}/${rateLimit.limit} used (${Math.round(rateLimitUsed/rateLimit.limit*100)}% - resets: ${rateLimit.resetAt})`)

    // Fetch additional commits if this repository has more than 100 commits
    if (repository.defaultBranchRef?.target?.history) {
      const history = repository.defaultBranchRef.target.history
      if (history.pageInfo.hasNextPage && history.totalCount > 100) {
        let commitCursor = history.pageInfo.endCursor
        let totalCommitsFetched = history.nodes.length

        logger.debug(`📈 ${name}: Fetching additional commits (${history.totalCount} total, ${totalCommitsFetched} fetched)`)

        // Fetch all commits (no limit, but keep function structure for future configurability)
        while (history.pageInfo.hasNextPage) {
          try {
            const commitPageResponse = await makeTrackedGraphQLRequest(REPO_ACTIVITY_QUERY, {
              owner,
              name,
              since: sinceDate,
              commitCursor
            }, 'fetch_additional_commits')

            if (commitPageResponse.repository?.defaultBranchRef?.target?.history?.nodes) {
              const newCommits = commitPageResponse.repository.defaultBranchRef.target.history.nodes
              history.nodes.push(...newCommits)
              totalCommitsFetched += newCommits.length

              const moreHistory = commitPageResponse.repository.defaultBranchRef.target.history
              history.pageInfo.hasNextPage = moreHistory.pageInfo.hasNextPage
              commitCursor = moreHistory.pageInfo.endCursor

              logger.debug(`📈 ${name}: +${newCommits.length} commits (total: ${totalCommitsFetched}/${history.totalCount})`)
            } else {
              break
            }
          } catch (error) {
            logger.warn(`⚠️ Failed to fetch additional commits for ${name}: ${error.message}`)
            break
          }
        }
      }
    }

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
  
  // Collect all commits across all repositories and branches, with deduplication
  const allCommits = []
  const commitShaSet = new Set() // For deduplication by SHA
  const repoCommitCounts = []

  repositories.forEach(repo => {
    let repoTotalCommits = 0
    let repoMaxTotalCount = 0

    // Process commits from default branch
    if (repo.defaultBranchRef?.target?.history) {
      const commits = repo.defaultBranchRef.target.history.nodes
      repoMaxTotalCount = Math.max(repoMaxTotalCount, repo.defaultBranchRef.target.history.totalCount)

      commits.forEach(commit => {
        if (!commitShaSet.has(commit.oid)) {
          commitShaSet.add(commit.oid)
          repoTotalCommits++
          allCommits.push({
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
            },
            branch: repo.defaultBranchRef.name
          })
        }
      })
    }

    // Process commits from all other branches
    if (repo.refs?.nodes) {
      repo.refs.nodes.forEach(ref => {
        if (ref.target?.history) {
          const commits = ref.target.history.nodes
          repoMaxTotalCount = Math.max(repoMaxTotalCount, ref.target.history.totalCount)

          commits.forEach(commit => {
            if (!commitShaSet.has(commit.oid)) {
              commitShaSet.add(commit.oid)
              repoTotalCommits++
              allCommits.push({
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
                },
                branch: ref.name
              })
            }
          })
        }
      })
    }

    repoCommitCounts.push({
      repo: repo.name,
      count: repoTotalCommits,
      totalCount: repoMaxTotalCount
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
  
  logger.debug(`📊 Transformed GraphQL data: ${allCommits.length} unique commits from ${repositories.length} repos (across all branches)`)
  
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

/**
 * Process large organization data in chunks to prevent memory overflow
 * @param {string} orgLogin - GitHub organization login/name
 * @param {string} since - ISO date string for filtering commits
 * @param {Object} resource - Resource object for database storage
 * @param {Function} processCommitsToWeekly - Function to process commits to weekly format
 * @param {Object} supabaseService - Service for database operations
 * @returns {Promise<Array>} Summary commits data (not full data to save memory)
 */
const fetchLargeOrgDataChunked = async (orgLogin, since = null, resource = null, processCommitsToWeekly = null, supabaseService = null) => {
  try {
    logger.info(`🎯 Processing large org ${orgLogin} in memory-safe chunks`)

    let allCommits = []
    let allDailyCommitData = [] // Track all commits for org-level daily aggregation
    let totalRepos = 0
    let processedRepos = 0
    let cursor = null
    let hasNextPage = true

    while (hasNextPage) {
      // Check memory before each chunk
      const memUsage = process.memoryUsage()
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024)

      if (heapUsedMB > 400) {
        logger.warn(`⚠️ ${orgLogin}: Breaking at ${processedRepos} repos due to memory (${heapUsedMB}MB)`)
        break
      }

      logger.debug(`📦 ${orgLogin}: Fetching chunk starting at cursor: ${cursor ? 'present' : 'null'} (heap: ${heapUsedMB}MB)`)

      // Fetch small chunk (3 repos max for large orgs)
      const variables = {
        orgLogin,
        since,
        first: 3,
        after: cursor,
        commitCursor: null
      }

      const response = await makeTrackedGraphQLRequest(ORG_ACTIVITY_QUERY, variables, 'fetch_large_org_chunk')

      if (!response.organization) {
        throw new Error(`Organization '${orgLogin}' not found`)
      }

      const { organization, rateLimit } = response
      const repositories = organization.repositories.nodes || []
      totalRepos = organization.repositories.totalCount
      hasNextPage = organization.repositories.pageInfo.hasNextPage
      cursor = organization.repositories.pageInfo.endCursor

      logger.debug(`📊 ${orgLogin}: Processing ${repositories.length} repos from chunk`)

      // Process each repo immediately to avoid memory buildup
      for (const repository of repositories) {
        try {
          // MEMORY LEAK FIX: Skip excluded repositories that cause memory issues
          if (EXCLUDED_REPOS.includes(repository.nameWithOwner)) {
            logger.warn(`⚠️ Skipping excluded repo: ${repository.nameWithOwner} (known memory issue)`)
            processedRepos++
            continue
          }

          // Extract commits from this repository
          const repoCommits = []

          // Get commits from default branch
          if (repository.defaultBranchRef?.target?.history?.nodes) {
            repoCommits.push(...repository.defaultBranchRef.target.history.nodes.map(commit => ({
              ...commit,
              repository: repository.nameWithOwner
            })))
          }

          // Get commits from other branches
          if (repository.refs?.nodes) {
            for (const ref of repository.refs.nodes) {
              if (ref.target?.history?.nodes) {
                repoCommits.push(...ref.target.history.nodes.map(commit => ({
                  ...commit,
                  repository: repository.nameWithOwner,
                  branch: ref.name
                })))
              }
            }
          }

          logger.debug(`📈 ${repository.nameWithOwner}: Found ${repoCommits.length} commits`)

          // Process commits to weekly format immediately
          if (repoCommits.length > 0 && processCommitsToWeekly) {
            const weeklyData = processCommitsToWeekly(repoCommits)

            // Store immediately if resource provided
            if (resource && weeklyData.length > 0 && supabaseService) {
              await supabaseService.storeWeeklyActivity(resource, weeklyData)
              logger.debug(`✅ ${repository.nameWithOwner}: Stored ${weeklyData.length} weeks to database`)
            }
          }

          // Collect commit dates for org-level daily aggregation (for KNOWN_LARGE_ORGS)
          if (repoCommits.length > 0 && resource && supabaseService) {
            const repoDaily = repoCommits.map(commit => ({
              date: commit.committedDate ? commit.committedDate.split('T')[0] : new Date().toISOString().split('T')[0],
              count: 1
            }))
            allDailyCommitData.push(...repoDaily)
            logger.debug(`📅 ${repository.nameWithOwner}: Added ${repoDaily.length} commits to org-level daily data`)
          }

          if (repoCommits.length > 0 && processCommitsToWeekly) {
            // Keep only summary for return (not full commit data)
            allCommits.push(...repoCommits.map(commit => ({
              sha: commit.oid,
              commit: {
                message: commit.message,
                author: { date: commit.committedDate }
              },
              date: commit.committedDate,
              repository: commit.repository
            })))
          }

          processedRepos++

        } catch (error) {
          logger.error(`❌ Error processing repo ${repository.nameWithOwner}: ${error.message}`)
        }
      }

      logger.info(`📊 ${orgLogin}: Processed ${processedRepos}/${totalRepos} repos (chunk complete)`)

      // Small delay between chunks
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    // Store organization-level daily data after processing all repositories (last 7 days only)
    if (allDailyCommitData.length > 0 && resource && supabaseService) {
      // Filter to last 7 days
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      const cutoffDate = sevenDaysAgo.toISOString().split('T')[0]

      const recentCommitData = allDailyCommitData.filter(d => d.date >= cutoffDate)

      // Aggregate recent commits by date at organization level
      const orgDailyData = recentCommitData.reduce((acc, d) => {
        const date = d.date
        const existing = acc.find(item => item.date === date)
        if (existing) {
          existing.count += 1
        } else {
          acc.push({ date, count: 1 })
        }
        return acc
      }, [])

      if (orgDailyData.length > 0) {
        const resourceId = orgLogin // Use org name as resource ID
        const repoPath = orgLogin   // Use org name as repo path
        await supabaseService.storeDailyActivity(resourceId, repoPath, orgDailyData, resource)
        logger.info(`✅ ${orgLogin}: Stored ${orgDailyData.length} org-level daily records (last 7 days) from ${recentCommitData.length} recent commits`)
      }
    }

    logger.info(`✅ ${orgLogin}: Completed chunked processing - ${processedRepos} repos, ${allCommits.length} commits`)
    return allCommits

  } catch (error) {
    logger.error(`❌ Chunked processing failed for ${orgLogin}:`, error)
    throw error
  }
}

module.exports = {
  fetchOrgDataGraphQL,
  fetchRepoDataGraphQL,
  fetchLargeOrgDataChunked,
  transformOrgDataToRestFormat,
  transformRepoDataToRestFormat,
  injectGraphQLTracking,
  ORG_ACTIVITY_QUERY,
  REPO_ACTIVITY_QUERY,
  KNOWN_LARGE_ORGS,
  EXCLUDED_REPOS
}