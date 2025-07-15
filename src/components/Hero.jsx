import React, { useState } from 'react'
import { ArrowRight, Sparkles, TrendingUp, Activity } from 'lucide-react'
import BlockAnimation from './BlockAnimation'
import ADAdevLogo from '../../ADAdev_logo.png'

const Hero = () => {
  const scrollToResources = () => {
    const element = document.getElementById('resources')
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16 lg:pt-0" role="banner">
      {/* Logo in top left - hidden on mobile since we have mobile header */}
      <a href="/" tabIndex={-1} aria-label="ADAdev Home" className="hidden lg:block">
        <img 
          src={ADAdevLogo} 
          alt="ADAdev Cardano Developer Resources Logo" 
          className="absolute top-6 left-6 w-32 h-20 z-20 rounded-xl shadow-lg bg-black/10 p-2 border border-white/10"
          width="128" height="80"
          loading="eager"
        />
      </a>
      <BlockAnimation />
      <div className="relative z-10 max-w-6xl mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          
          <div className="bg-black/20 backdrop-blur-md rounded-2xl p-6 lg:p-8 border border-white/10">
            {/* Main headline */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 lg:mb-8 leading-tight">
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-400 bg-clip-text text-transparent">The Hub</span>
              {' '}for Cardano Devs{' '}
            </h1>
            
            {/* Subheadline */}
            <div className="mb-8 lg:mb-12">
              <p className="text-lg sm:text-xl md:text-2xl text-gray-200 mb-6 max-w-4xl mx-auto leading-relaxed">
                Your essential destination to stay ahead in Cardano development. 
                <span className="accent-gradient font-semibold"> Track ecosystem growth</span>, discover curated resources, and find everything you need to build.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-8 text-gray-400">
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
                  <span className="text-xs sm:text-sm">Real-time Ecosystem Pulse</span>
                </div>
                <div className="flex items-center space-x-2">
                  <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
                  <span className="text-xs sm:text-sm">Curated Dev Resources</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
                  <span className="text-xs sm:text-sm">Personalized Development Plans</span>
                </div>
              </div>
            </div>

            {/* CTA buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button 
                onClick={scrollToResources}
                className="btn-primary flex items-center justify-center space-x-2 text-base sm:text-lg px-6 sm:px-8 py-3 sm:py-4"
              >
                <span>Browse Resources</span>
                <ArrowRight size={18} className="sm:w-5 sm:h-5" />
              </button>
              
              <button 
                onClick={() => {
                  // Trigger AI widget expansion
                  const aiWidget = document.querySelector('[data-widget="ai"]')
                  if (aiWidget) {
                    aiWidget.click()
                  }
                }}
                className="btn-secondary flex items-center justify-center space-x-2 text-base sm:text-lg px-6 sm:px-8 py-3 sm:py-4"
              >
                <Sparkles size={18} className="sm:w-5 sm:h-5" />
                <span>Get Development Plan</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      
    </section>
  )
}

export default Hero 