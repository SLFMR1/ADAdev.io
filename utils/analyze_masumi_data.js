#!/usr/bin/env node

/**
 * Analyze masumi-network organization data vs individual repository data
 * to understand if sokosumi commits are included in the organization aggregation
 */

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3000';

const fetchData = async (viewMode, period = 'current') => {
  try {
    const response = await fetch(`${API_BASE}/api/development-activity?viewMode=${viewMode}&period=${period}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`❌ Error fetching ${viewMode} data:`, error.message);
    return null;
  }
};

const analyzeData = async () => {
  console.log('🔍 Analyzing masumi-network organization vs repository data\n');
  
  // Fetch both views
  const orgData = await fetchData('organization');
  const repoData = await fetchData('repository');
  
  if (!orgData || !repoData) {
    console.error('❌ Failed to fetch data');
    return;
  }
  
  console.log('📊 Overview:');
  console.log(`Organization view: ${orgData.metrics.daily.totalActiveRepos} organizations, ${orgData.metrics.daily.totalCommits} total commits`);
  console.log(`Repository view: ${repoData.metrics.daily.totalActiveRepos} repositories, ${repoData.metrics.daily.totalCommits} total commits`);
  console.log('');
  
  // Find masumi-network in organization view
  const masumiOrg = orgData.dailyLeaderboard.find(item => 
    item.resource.name === 'Masumi Network' || 
    item.resource.organization === 'masumi-network'
  );
  
  console.log('🏢 Masumi Network (Organization View):');
  if (masumiOrg) {
    console.log(`   Name: ${masumiOrg.resource.name}`);
    console.log(`   Total commits: ${masumiOrg.totalCommits}`);
    console.log(`   Type: ${masumiOrg.resource.type}`);
    console.log(`   Organization: ${masumiOrg.resource.organization}`);
    console.log(`   Repo path: ${masumiOrg.resource.repo_path}`);
  } else {
    console.log('   ❌ Masumi Network not found in organization view');
  }
  console.log('');
  
  // Find masumi-network repositories in repository view
  const masumiRepos = repoData.dailyLeaderboard.filter(item => 
    item.resource.organization === 'masumi-network'
  );
  
  console.log('📦 Masumi Network Repositories (Repository View):');
  if (masumiRepos.length > 0) {
    let totalRepoCommits = 0;
    masumiRepos.forEach(repo => {
      console.log(`   - ${repo.resource.name}: ${repo.totalCommits} commits`);
      console.log(`     Type: ${repo.resource.type}`);
      console.log(`     Repository: ${repo.resource.repository}`);
      console.log(`     Repo path: ${repo.resource.repo_path}`);
      totalRepoCommits += repo.totalCommits;
    });
    console.log(`   📈 Total commits from masumi repositories: ${totalRepoCommits}`);
  } else {
    console.log('   ❌ No masumi-network repositories found in repository view');
  }
  console.log('');
  
  // Analysis
  console.log('🧮 Analysis:');
  if (masumiOrg && masumiRepos.length > 0) {
    const orgCommits = masumiOrg.totalCommits;
    const sumRepoCommits = masumiRepos.reduce((sum, repo) => sum + repo.totalCommits, 0);
    
    console.log(`   Organization commits: ${orgCommits}`);
    console.log(`   Sum of repository commits: ${sumRepoCommits}`);
    console.log(`   Difference: ${Math.abs(orgCommits - sumRepoCommits)}`);
    
    if (orgCommits === sumRepoCommits) {
      console.log('   ✅ PERFECT MATCH: Organization commits equal sum of repository commits');
    } else if (orgCommits > sumRepoCommits) {
      console.log('   🔍 Organization has MORE commits than sum of listed repositories');
      console.log('      This could mean:');
      console.log('      - Organization has other repositories not listed separately');
      console.log('      - Organization includes main org activity + subrepos');
      console.log('      - Some repositories might not be showing in repository view');
    } else {
      console.log('   ⚠️ Organization has FEWER commits than sum of repositories');
      console.log('      This suggests possible issues with organization aggregation');
    }
  }
  
  // Check specific repositories
  console.log('\n🎯 Specific Repository Check:');
  const sokosumi = repoData.dailyLeaderboard.find(item => item.resource.name === 'Sokosumi');
  const kodosumi = repoData.dailyLeaderboard.find(item => item.resource.name === 'Kodosumi');
  
  console.log(`   Sokosumi: ${sokosumi ? `${sokosumi.totalCommits} commits` : 'NOT FOUND'}`);
  console.log(`   Kodosumi: ${kodosumi ? `${kodosumi.totalCommits} commits` : 'NOT FOUND'}`);
  
  if (masumiOrg && sokosumi) {
    console.log(`\n💡 Key Question: Are Sokosumi's ${sokosumi.totalCommits} commits included in Masumi's ${masumiOrg.totalCommits} commits?`);
    
    if (masumiOrg.totalCommits >= sokosumi.totalCommits) {
      console.log('   ✅ LIKELY YES: Organization commits >= Sokosumi commits');
      console.log('   This suggests the GitHub API organization aggregation is working correctly');
    } else {
      console.log('   ❌ LIKELY NO: Organization commits < Sokosumi commits');
      console.log('   This suggests Sokosumi data is NOT included in organization aggregation');
    }
  }
  
  console.log('\n📋 Recommendations:');
  console.log('1. Check server logs for masumi-network organization data fetching');
  console.log('2. Verify that fetchOrgRepos("masumi-network") returns sokosumi and kodosumi');
  console.log('3. Test organization API directly with GitHub to confirm repo list');
  console.log('4. Check if there are any filtering issues in the aggregation logic');
};

analyzeData().catch(error => {
  console.error('❌ Analysis failed:', error.message);
  process.exit(1);
});