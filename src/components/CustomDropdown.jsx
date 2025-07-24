import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

const CustomDropdown = ({ 
  value, 
  onChange, 
  options, 
  placeholder = "Select option..." 
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (option) => {
    onChange(option)
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 sm:py-2 bg-card-bg/50 backdrop-blur-md border border-gray-700 rounded-full text-white focus:outline-none focus:border-gray-600 transition-colors duration-200 text-sm touch-target"
      >
        <span className={`truncate ${!value ? 'text-gray-400/30' : ''}`}>{value || placeholder}</span>
        <ChevronDown 
          size={16} 
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full mt-1 w-full bg-card-bg/50 backdrop-blur-md border border-gray-700 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto mobile-scroll">
          {options.map((option, index) => (
            <button
              key={index}
              type="button"
              onClick={() => handleSelect(option)}
              className={`w-full text-left px-4 py-3 sm:py-3 text-sm transition-colors duration-200 hover:bg-gray-800/70 first:rounded-t-xl last:rounded-b-xl touch-target ${
                value === option 
                  ? 'bg-gray-800/70 text-primary-500' 
                  : 'text-gray-300'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default CustomDropdown 