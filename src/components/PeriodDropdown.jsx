import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

const PeriodDropdown = ({ 
  value, 
  onChange, 
  options, 
  placeholder = "Select period...",
  className = "",
  disabled = false,
  screenshotMode = false
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
    onChange(option.key)
    setIsOpen(false)
  }

  const selectedOption = options.find(opt => opt.key === value)
  const displayValue = selectedOption ? selectedOption.label : placeholder

  // If in screenshot mode, render as simple text
  if (screenshotMode) {
    return (
      <div className={`text-sm text-gray-400 ${className}`}>
        {displayValue}
      </div>
    )
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Dropdown Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-3 py-1.5 bg-gray-800/30 backdrop-blur-sm border border-cyan-400/50 rounded-md text-gray-300 focus:outline-none focus:border-cyan-400 transition-all duration-200 text-sm touch-target shadow-[0_0_20px_rgba(34,211,238,0.03)] hover:shadow-[0_0_30px_rgba(34,211,238,0.05)] ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-cyan-400 hover:bg-cyan-400/10'
        }`}
      >
        <span className={`truncate ${!selectedOption ? 'text-gray-400/30' : ''}`}>{displayValue}</span>
        <ChevronDown 
          size={14} 
          className={`transition-transform duration-200 text-gray-400 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full mt-1 w-full bg-gray-800/40 backdrop-blur-sm border border-gray-600/50 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto mobile-scroll">
          {options.map((option, index) => (
            <button
              key={option.key}
              type="button"
              onClick={() => handleSelect(option)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors duration-200 hover:bg-gray-700/50 first:rounded-t-lg last:rounded-b-lg touch-target ${
                value === option.key 
                  ? 'bg-gray-700/50 text-gray-200' 
                  : 'text-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default PeriodDropdown 