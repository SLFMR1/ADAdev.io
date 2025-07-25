import React, { useState } from 'react'
import { ArrowRight, Sparkles, TrendingUp, Activity, Bot, RotateCcw } from 'lucide-react'
import BlockAnimation from './BlockAnimation'
import ADAdevLogoSvg from '../../ADAdev_logo.svg'

const Hero = ({ onRevert, showRevertButton, navigationSource }) => {
  const scrollToResources = () => {
    const element = document.getElementById('resources')
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16 lg:pt-0" role="banner">
      {/* Logo in top left - clipped like widget bar */}
      <div className="hidden lg:block fixed top-6 left-0 z-20">
        <div className="flex flex-col items-center gap-2">
          {/* Main ADAdev logo - clipped on left side */}
          <a href="/" tabIndex={-1} aria-label="ADAdev Home" className="group">
            <div className="flex items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 hover:border-white/30 hover:shadow-[0_0_15px_rgba(255,255,255,0.3),0_0_30px_rgba(255,255,255,0.15)]">
              <img 
                src={ADAdevLogoSvg} 
                alt="ADAdev Cardano Developer Resources Logo" 
                className="h-10 w-auto object-contain transition-all duration-300 group-hover:drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]"
                width="40" height="40"
                loading="eager"
              />
            </div>
          </a>
        </div>
      </div>
      
      {/* Cardano logo in top right */}
      <div className="hidden lg:block fixed top-6 right-6 z-20">
        <a 
          href="https://cardano.org/" 
          target="_blank" 
          rel="noopener noreferrer" 
          aria-label="Visit Cardano Official Website"
          className="group"
        >
          <img 
            src="https://developers.cardano.org/img/cardano-black.svg" 
            alt="Cardano Logo" 
            className="h-9 w-auto object-contain opacity-70 filter brightness-0 invert transition-all duration-300 group-hover:opacity-100 group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]"
            width="36" height="36"
            loading="eager"
          />
        </a>
      </div>
      
      <BlockAnimation />
      <div className="relative z-10 max-w-6xl mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          
          <div className="bg-transparent backdrop-blur-md rounded-2xl p-6 lg:p-8 border border-gray-700/50 shadow-2xl">
            {/* Main headline */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-thin text-white mb-6 lg:mb-8 leading-tight">
            {' '}Cardano{' '}
              <span 
                className="text-transparent"
                style={{
                  WebkitTextStroke: '1px #22d3ee',
                }}
              >
                Developer Hub
              </span>
            </h1>
            
            {/* Subheadline */}
            <div className="mb-4 lg:mb-6">
              <p className="text-lg sm:text-xl md:text-2xl text-gray-200 mb-6 max-w-4xl mx-auto leading-relaxed">
                Your essential destination to stay ahead in Cardano development. 
                <span className="text-cyan-400 font-thin">
                  {' '}Track ecosystem growth
                </span>
                , discover curated resources, and 
                <span className="text-cyan-400 font-thin">
                  {' '}find everything
                </span>
                <span className="text-white font-thin">
                  {' '}you need to
                </span>
                <span className="text-cyan-400 font-thin">
                  {' '}build on Cardano
                </span>
                .
              </p>

            {/* CTA buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button 
                onClick={scrollToResources}
                className="bg-transparent border border-cyan-400/50 text-cyan-400 px-6 py-3 rounded-full font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-custom-bg hover:border-cyan-400 hover:bg-cyan-400/10 hover:scale-105 active:scale-95 flex items-center justify-center space-x-2 text-sm sm:text-base shadow-[0_0_8px_rgba(34,211,238,0.2)] hover:shadow-[0_0_12px_rgba(34,211,238,0.3)]"
              >
                <span>Browse Resources</span>
                <ArrowRight size={16} className="sm:w-4 sm:h-4" />
              </button>
              
              <button 
                onClick={() => {
                  // Trigger AI widget expansion via custom event
                  const event = new CustomEvent('expandWidget', { 
                    detail: { widgetKey: 'ai' } 
                  })
                  document.dispatchEvent(event)
                }}
                className="bg-transparent border border-gray-600 text-gray-300 px-6 py-3 rounded-full font-semibold hover:border-gray-500 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-custom-bg flex items-center justify-center space-x-2 text-sm sm:text-base hover:bg-gray-800/30"
              >
                <Sparkles size={16} className="sm:w-4 sm:h-4" />
                <span>Get Development Plan</span>
              </button>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-8 text-gray-400 mt-9">
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
                  <span className="text-xs sm:text-sm">Real-time Ecosystem Pulse</span>
                </div>
                <div className="flex items-center space-x-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 sm:w-5 sm:h-5 text-red-400">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                  </svg>
                  <span className="text-xs sm:text-sm">Curated Dev Resources</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-teal-400" />
                  <span className="text-xs sm:text-sm">Personalized Development Plans</span>
                </div>
              </div>
            </div>


            {/* Revert Button - appears when widgets are open or viewing resource card */}
            {showRevertButton && (
              <div className="mt-4">
                <button 
                  onClick={onRevert}
                  className={`flex items-center justify-center space-x-2 text-sm sm:text-base px-6 py-3 rounded-full font-semibold transition-all duration-200 mx-auto ${
                    navigationSource === 'leaderboard' 
                      ? 'bg-transparent border border-cyan-400/50 text-cyan-400 hover:border-cyan-400 hover:bg-cyan-400/10 hover:scale-105 active:scale-95 shadow-[0_0_8px_rgba(34,211,238,0.2)] hover:shadow-[0_0_12px_rgba(34,211,238,0.3)]' 
                      : 'bg-transparent border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white hover:bg-gray-800/30'
                  }`}
                >
                  <RotateCcw size={16} className="sm:w-4 sm:h-4" />
                  <span>
                    {navigationSource === 'leaderboard' ? 'Back to Leaderboard' : 'Back to Dashboard'}
                  </span>
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