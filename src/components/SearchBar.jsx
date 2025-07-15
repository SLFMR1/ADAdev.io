import React from 'react'
import { Search } from 'lucide-react'
import CustomDropdown from './CustomDropdown'

const SearchBar = ({ 
  searchTerm, 
  setSearchTerm, 
  selectedCategory, 
  setSelectedCategory, 
  categories 
}) => {
  return (
    <div id="resources" className="mb-8">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        {/* Search Input */}
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-500" />
          </div>
          <input
            type="text"
            placeholder="Search resources..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-9 pr-3 py-3 sm:py-2 border border-gray-700 rounded-full bg-card-bg/50 backdrop-blur-md text-gray-100 placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors duration-200 text-sm sm:text-sm"
          />
        </div>

        {/* Category Filter */}
        <div className="w-full sm:w-48">
          <CustomDropdown
            value={selectedCategory}
            onChange={setSelectedCategory}
            options={categories}
            placeholder="Select category"
          />
        </div>
      </div>

      {/* Active filters display */}
      {(searchTerm || selectedCategory !== 'All') && (
        <div className="flex flex-wrap gap-2 text-sm">
          {searchTerm && (
            <span className="inline-flex items-center px-3 py-2 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
              "{searchTerm}"
              <button
                onClick={() => setSearchTerm('')}
                className="ml-2 hover:text-white p-1 rounded-full hover:bg-gray-700 transition-colors"
              >
                ×
              </button>
            </span>
          )}
          {selectedCategory !== 'All' && (
            <span className="inline-flex items-center px-3 py-2 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
              {selectedCategory}
              <button
                onClick={() => setSelectedCategory('All')}
                className="ml-2 hover:text-white p-1 rounded-full hover:bg-gray-700 transition-colors"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchBar 