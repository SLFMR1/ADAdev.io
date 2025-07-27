import React, { createContext, useContext, useState, useCallback } from 'react';

const CommitDataContext = createContext();

export const useCommitData = () => {
  const context = useContext(CommitDataContext);
  if (!context) {
    // Graceful fallback if context is not available
    return {
      updateCommitData: () => {},
      clearCommitData: () => {},
      getCommitCount: () => 0
    };
  }
  return context;
};

export const CommitDataProvider = ({ children }) => {
  const [commitData, setCommitData] = useState({});

  // Throttled function to prevent too many rapid updates
  const updateCommitData = useCallback((resourceName, commitsPerMonth) => {
    setCommitData(prev => {
      // Only update if the value actually changed
      if (prev[resourceName] === commitsPerMonth) return prev;
      
      return {
        ...prev,
        [resourceName]: commitsPerMonth
      };
    });
  }, []);

  // Function to clear data for a specific resource
  const clearCommitData = useCallback((resourceName) => {
    setCommitData(prev => {
      if (!prev[resourceName]) return prev; // Already cleared
      
      const newData = { ...prev };
      delete newData[resourceName];
      return newData;
    });
  }, []);

  // Get commit count for a specific resource with fallback
  const getCommitCount = useCallback((resourceName) => {
    return commitData[resourceName] ?? 0;
  }, [commitData]);

  const value = {
    commitData,
    updateCommitData,
    clearCommitData,
    getCommitCount
  };

  return (
    <CommitDataContext.Provider value={value}>
      {children}
    </CommitDataContext.Provider>
  );
};