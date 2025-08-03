import React, { useState } from 'react'
import { ArrowRight, Sparkles, TrendingUp, Activity, Bot, RotateCcw } from 'lucide-react'
import BlockAnimation from './BlockAnimation'

const Hero = ({ onRevert, showRevertButton, navigationSource }) => {
  const scrollToResources = () => {
    const element = document.getElementById('resources')
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16 lg:pt-0" role="banner">
      <BlockAnimation />
      <div className="relative z-10 max-w-6xl mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          
          <div className="bg-transparent backdrop-blur-md rounded-2xl p-6 lg:p-8 border border-gray-700/50 shadow-2xl">
            {/* Main headline */}
            <div className="mb-8 lg:mb-12 leading-tight flex justify-center">
              <img 
                src="/AdAdev_text.svg" 
                alt="ADAdev" 
                className="w-auto h-14 sm:h-15 md:h-18 lg:h-21 object-contain"
                style={{
                  filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.3))'
                }}
              />
            </div>
            
            {/* Subheadline */}
            <div className="mb-8 lg:mb-12">
              <p className="text-base sm:text-lg md:text-xl text-gray-200 max-w-4xl mx-auto leading-relaxed">
                Your essential destination to stay ahead in Cardano development. 
                <span className="text-white font-thin">
                  {' '}Track ecosystem growth
                </span>
                , discover curated resources, and 
                <span className="text-white font-thin">
                  {' '}find everything
                </span>
                <span className="text-white font-thin">
                  {' '}you need to
                </span>
                <span className="text-white font-thin">
                  {' '}build on Cardano
                </span>
                .
              </p>
            </div>

            {/* Icon buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-24 text-gray-400">
                <button 
                  onClick={() => {
                    // Trigger Development Activity widget expansion
                    const event = new CustomEvent('expandWidget', { 
                      detail: { widgetKey: 'dev' } 
                    })
                    document.dispatchEvent(event)
                  }}
                  className="flex items-center group cursor-pointer transition-all duration-200 hover:scale-105 overflow-hidden w-5 sm:w-6 hover:w-auto"
                >
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-[#C8F560] transition-all duration-200 drop-shadow-[0_0_8px_rgba(200,245,96,0.3)] group-hover:drop-shadow-[0_0_12px_rgba(200,245,96,0.5)] flex-shrink-0" />
                  <span className="text-xs sm:text-sm text-white opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap ml-2">Real-time Ecosystem Pulse</span>
                </button>
                <button 
                  onClick={scrollToResources}
                  className="flex items-center group cursor-pointer transition-all duration-200 hover:scale-105 overflow-hidden w-5 sm:w-6 hover:w-auto"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 sm:w-5 sm:h-5 text-red-400 transition-all duration-200 drop-shadow-[0_0_8px_rgba(248,113,113,0.3)] group-hover:drop-shadow-[0_0_12px_rgba(248,113,113,0.5)] flex-shrink-0">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                  </svg>
                  <span className="text-xs sm:text-sm text-white opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap ml-2">Curated Dev Resources</span>
                </button>
                <button 
                  onClick={() => {
                    // Trigger AI widget expansion via custom event
                    const event = new CustomEvent('expandWidget', { 
                      detail: { widgetKey: 'ai' } 
                    })
                    document.dispatchEvent(event)
                  }}
                  className="flex items-center group cursor-pointer transition-all duration-200 hover:scale-105 overflow-hidden w-5 sm:w-6 hover:w-auto"
                >
                  <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-teal-400 transition-all duration-200 drop-shadow-[0_0_8px_rgba(20,184,166,0.3)] group-hover:drop-shadow-[0_0_12px_rgba(20,184,166,0.5)] flex-shrink-0" />
                  <span className="text-xs sm:text-sm text-white opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap ml-2">Personalized Development Plans</span>
                </button>
              </div>


            {/* Revert Button - appears when widgets are open or viewing resource card */}
            {showRevertButton && (
              <div className="mt-4">
                <button 
                  onClick={onRevert}
                  className={`flex items-center justify-center space-x-2 text-sm sm:text-base px-6 py-3 rounded-full font-semibold transition-all duration-200 mx-auto ${
                    navigationSource === 'leaderboard' 
                      ? 'bg-transparent border border-white/50 text-white hover:border-white hover:bg-white/10 hover:scale-105 active:scale-95 shadow-[0_0_8px_rgba(255,255,255,0.2)] hover:shadow-[0_0_12px_rgba(255,255,255,0.3)]' 
                      : 'bg-transparent border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white hover:bg-gray-800/30'
                  }`}
                >
                  <RotateCcw size={16} className="sm:w-4 sm:h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
    </section>
  )
}

export default Hero 