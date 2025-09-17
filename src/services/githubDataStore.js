// Centralized GitHub data store to eliminate redundant API calls
class GitHubDataStore {
  constructor() {
    this.data = new Map();
    this.lastFetchTime = null;
    this.isLoading = false;
    this.cacheTimeout = process.env.NODE_ENV === 'production' ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000; // 2 hours in prod, 30 min in dev
    this.listeners = new Set();
  }

  // Subscribe to data changes
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  // Notify all listeners
  notify() {
    this.listeners.forEach(callback => callback(this.data));
  }

  // Get data for a specific resource
  getResourceData(resourceId) {
    return this.data.get(resourceId);
  }

  // Get all data
  getAllData() {
    return Array.from(this.data.values());
  }

  // Check if data is fresh
  isDataFresh() {
    return this.lastFetchTime && (Date.now() - this.lastFetchTime < this.cacheTimeout);
  }

  // Fetch all data once
  async fetchAllData() {
    if (this.isLoading) {
      return new Promise(resolve => {
        const unsubscribe = this.subscribe(() => {
          unsubscribe();
          resolve();
        });
      });
    }

    if (this.isDataFresh() && this.data.size > 0) {
      console.log('✅ Using cached GitHub data');
      return;
    }

    this.isLoading = true;
    console.log('🔄 Fetching all GitHub data...');

    try {
      const response = await fetch('/api/development-activity');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const devActivityData = await response.json();
      
      // Use the new githubUpdates field that contains detailed data
      const allData = devActivityData.githubUpdates || [];
      
      // Validate that allData is an array
      if (!Array.isArray(allData)) {
        console.error('❌ Expected array from API, got:', typeof allData, allData);
        throw new Error('Invalid data format from API');
      }
      
      // Clear existing data
      this.data.clear();
      
      // Store new data with validation
      allData.forEach((item, index) => {
        // More flexible validation - accept items with basic structure
        if (!item) {
          console.warn(`⚠️ Skipping null/undefined item at index ${index}`);
          return;
        }
        
        // Handle different data structures
        let resource = null;
        if (item.resource) {
          resource = item.resource;
        } else if (item.id || item.name) {
          // Item might be a resource directly
          resource = item;
        } else {
          console.warn(`⚠️ Skipping item without resource info at index ${index}:`, item);
          return;
        }
        
        // Use a more robust key generation
        const key = resource.id || resource.name || `resource-${index}`;
        
        // Normalize the data structure
        const normalizedItem = {
          resource: resource,
          releases: item.releases || [],
          commits: item.commits || [],
          commitsPerWeek: item.commitsPerWeek || 0,
          repoInfo: item.repoInfo || null,
          commitsPerMonth: item.commitsPerMonth || [],
          commitsPerWeekDetailed: item.commitsPerWeekDetailed || []
        };
        
        this.data.set(key, normalizedItem);
      });

      this.lastFetchTime = Date.now();
      console.log(`✅ Loaded data for ${this.data.size} resources`);
      
      // Notify listeners
      this.notify();
    } catch (error) {
      console.error('❌ Failed to fetch GitHub data:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  // Force refresh
  async refresh() {
    this.lastFetchTime = null;
    return this.fetchAllData();
  }
}

// Create singleton instance
const githubDataStore = new GitHubDataStore();

export default githubDataStore; 