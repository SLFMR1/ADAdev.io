import React from 'react'
import { Search } from 'lucide-react'
import CustomDropdown from './CustomDropdown'
import PeriodDropdown from './PeriodDropdown'

const SearchBar = ({ 
  searchTerm, 
  setSearchTerm, 
  selectedCategory, 
  setSelectedCategory, 
  categories,
  sortBy,
  setSortBy,
  filterBy,
  setFilterBy
}) => {
  return (
    <div className="mb-8">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        {/* Search Input */}
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
            <Search className="h-4 w-4 text-gray-500" />
          </div>
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-9 pr-3 py-2 border border-gray-600/50 rounded-full bg-gray-800/30 backdrop-blur-sm text-gray-300 focus:outline-none focus:border-gray-500 hover:border-gray-500 transition-all duration-200 text-sm touch-target"
            style={{
              '::placeholder': {
                color: 'rgba(107, 114, 128, 0.3)'
              }
            }}
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

        {/* Sort By */}
        <div className="w-full sm:w-48">
          <PeriodDropdown
            value={sortBy}
            onChange={setSortBy}
            options={[
              { key: 'category', label: 'Category A-Z' },
              { key: 'activity', label: 'Activity High-Low' },
              { key: 'name', label: 'Name A-Z' }
            ]}
            placeholder="Sort by..."
            className="w-full"
          />
        </div>

        {/* Filter By Type */}
        <div className="w-full sm:w-48">
          <PeriodDropdown
            value={filterBy}
            onChange={setFilterBy}
            options={[
              { key: 'all', label: 'All Types' },
              { key: 'organization', label: 'Organization' },
              { key: 'repository', label: 'Repository' },
              { key: 'misc', label: 'Misc' },
              { key: 'founding_entity', label: 'Founding Entity' }
            ]}
            placeholder="Filter by..."
            className="w-full"
          />
        </div>
      </div>
    </div>
  )
}

export default SearchBar 