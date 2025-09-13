import React, { useState, useMemo, useEffect } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import GitHubUpdatesWidget from './components/GitHubUpdatesWidget';
import AddResourceWidget from './components/AddResourceWidget';
import DevelopmentActivityWidget from './components/DevelopmentActivityWidget';
import AISearchWidget from './components/AISearchWidget';
import FindDeveloperWidget from './components/FindDeveloperWidget';
import DataQualityDashboard from './components/DataQualityDashboard';
import SearchBar from './components/SearchBar';
import ResourceCard from './components/ResourceCard';
import AIResults from './components/AIResults';
import AIModal from './components/AIModal';
import Footer from './components/Footer';
import { cardanoResources } from './data/resources';
import { preloadCache, initializeRateLimit } from './services/github';
import cacheManager from './services/cacheManager';
import { Activity, Menu, X, Brain, Bot, TrendingUp, Plus, Users, Database } from 'lucide-react';
import { useCommitData } from './contexts/CommitDataContext';
import { Routes, Route, useLocation } from 'react-router-dom';

// Unified Background Overlay Component
const WidgetOverlay = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-40 transition-all duration-500 ease-in-out opacity-100 scale-100"
      onClick={onClose}
      style={{
        background: 'linear-gradient(135deg, #1E1E1E 0%, #0F0F0F 50%, #1A1A1A 100%)',
        backgroundImage: `
          radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.1) 0%, transparent 50%),
          radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.1) 0%, transparent 50%),
          radial-gradient(circle at 40% 40%, rgba(120, 219, 255, 0.05) 0%, transparent 50%)
        `,
      }}
    >
      {children}
    </div>
  );
};

// SidebarWidgetsContainer Component
const SidebarWidgetsContainer = ({ expanded, setExpanded, handleWidgetExpand, isResourcesSectionActive }) => {
  return (
    <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50 flex flex-col items-start gap-0 hidden lg:flex">
      {/* Development Activity Widget */}
      <div className="relative z-50 w-16 h-16 isolate hover:z-[70]" onClick={() => handleWidgetExpand('dev')}>
        <div className={`group flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 ${
          expanded === 'dev' 
            ? 'border-[#C8F560]/50 shadow-[0_0_20px_rgba(200,245,96,0.4),0_0_40px_rgba(200,245,96,0.2)] z-[70]' 
            : 'hover:border-[#C8F560]/30 hover:shadow-[0_0_15px_rgba(200,245,96,0.3),0_0_30px_rgba(200,245,96,0.15)]'
        }`}>
          <Activity size={24} className={`transition-all duration-300 ${
            expanded === 'dev' 
              ? 'text-[#C8F560] drop-shadow-[0_0_12px_rgba(200,245,96,0.8)]' 
              : 'text-gray-400 group-hover:text-[#C8F560]'
          }`} />
        </div>
      </div>
      
      {/* GitHub Updates Widget */}
      <div className="relative z-50 w-16 h-16 isolate hover:z-[70]" onClick={() => handleWidgetExpand('github')}>
        <div className={`group flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 ${
          expanded === 'github' 
            ? 'border-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.4),0_0_40px_rgba(168,85,247,0.2)] z-[70]' 
            : 'hover:border-purple-400/30 hover:shadow-[0_0_15px_rgba(168,85,247,0.3),0_0_30px_rgba(168,85,247,0.15)]'
        }`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className={`transition-all duration-300 ${
            expanded === 'github' 
              ? 'text-purple-400 drop-shadow-[0_0_12px_rgba(168,85,247,0.8)]' 
              : 'text-gray-400 group-hover:text-purple-400'
          }`}>
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </div>
      </div>
      
      {/* AI Widget */}
      <div className="relative z-50 w-16 h-16 isolate hover:z-[70]" onClick={() => handleWidgetExpand('ai')}>
        <div className={`group flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 ${
          expanded === 'ai' 
            ? 'border-teal-400/50 shadow-[0_0_20px_rgba(20,184,166,0.4),0_0_40px_rgba(20,184,166,0.2)] z-[70]' 
            : 'hover:border-teal-400/30 hover:shadow-[0_0_15px_rgba(20,184,166,0.3),0_0_30px_rgba(20,184,166,0.15)]'
        }`}>
          <Bot size={24} className={`transition-all duration-300 ${
            expanded === 'ai' 
              ? 'text-teal-400 drop-shadow-[0_0_12px_rgba(20,184,166,0.8)]' 
              : 'text-gray-400 group-hover:text-teal-400'
          }`} />
        </div>
      </div>
      
      {/* Resources Widget */}
      <div className="relative z-[60] w-16 h-16 isolate hover:z-[70]" onClick={() => {
        // Close any open widget first
        if (expanded) {
          setExpanded(null)
          setNavigationSource(null)
        }
        // Scroll to resources immediately after closing widget
        const element = document.getElementById('resources')
        if (element) {
          // Calculate the offset to account for any fixed headers or padding
          const rect = element.getBoundingClientRect()
          const scrollTop = window.pageYOffset + rect.top - 20 // 20px offset for better positioning
          
          window.scrollTo({
            top: scrollTop,
            behavior: 'smooth'
          })
        }
      }}>
        <div className={`group flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 ${
          isResourcesSectionActive 
            ? 'border-red-400/50 shadow-[0_0_20px_rgba(248,113,113,0.4),0_0_40px_rgba(248,113,113,0.2)] z-[70]' 
            : 'hover:border-red-400/30 hover:shadow-[0_0_15px_rgba(248,113,113,0.3),0_0_30px_rgba(248,113,113,0.15)]'
        }`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-all duration-300 ${
            isResourcesSectionActive 
              ? 'text-red-400 drop-shadow-[0_0_12px_rgba(248,113,113,0.8)]' 
              : 'text-gray-400 group-hover:text-red-400'
          }`}>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
      </div>
      
      {/* Add Resource Widget */}
      <div className="relative z-50 w-16 h-16 isolate hover:z-[70]" onClick={() => handleWidgetExpand('add')}>
        <div className={`group flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 ${
          expanded === 'add' 
            ? 'border-emerald-400/50 shadow-[0_0_20px_rgba(52,211,153,0.4),0_0_40px_rgba(52,211,153,0.2)] z-[70]' 
            : 'hover:border-emerald-400/30 hover:shadow-[0_0_15px_rgba(52,211,153,0.3),0_0_30px_rgba(52,211,153,0.15)]'
        }`}>
          <Plus size={24} className={`transition-all duration-300 ${
            expanded === 'add' 
              ? 'text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]' 
              : 'text-gray-400 group-hover:text-emerald-400'
          }`} />
        </div>
      </div>
      
      {/* Find Developer Widget */}
      <div className="relative z-50 w-16 h-16 isolate hover:z-[70]" onClick={() => handleWidgetExpand('find')}>
        <div className={`group flex flex-col items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 ${
          expanded === 'find' 
            ? 'border-blue-400/50 shadow-[0_0_20px_rgba(59,130,246,0.4),0_0_40px_rgba(59,130,246,0.2)] z-[70]' 
            : 'hover:border-blue-400/30 hover:shadow-[0_0_15px_rgba(59,130,246,0.3),0_0_30px_rgba(59,130,246,0.15)]'
        }`}>
          <Users size={24} className={`transition-all duration-300 ${
            expanded === 'find' 
              ? 'text-blue-400 drop-shadow-[0_0_12px_rgba(59,130,246,0.8)]' 
              : 'text-gray-400 group-hover:text-blue-400'
          }`} />
        </div>
      </div>
      

    </div>
  )
}

// Mobile Navigation Component
const MobileNavigation = ({ isOpen, onClose, expanded, setExpanded, handleWidgetExpand }) => {
  const handleWidgetClick = (widgetKey) => {
    handleWidgetExpand(widgetKey);
    onClose();
  };

  return (
    <div className={`fixed inset-0 z-50 lg:hidden transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose}></div>
      <div className={`absolute left-0 top-0 h-full w-80 bg-card-bg/95 border-r border-gray-800 transform transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3">
              <img src="/ADAdev_logo.svg" alt="ADAdev" className="h-8 w-auto object-contain" />
              <span className="text-white font-semibold">Menu</span>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={24} />
            </button>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-3">Widgets</h3>
              <button
                onClick={() => handleWidgetClick('dev')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-6">
                  <Activity size={24} className="text-[#C8F560] drop-shadow-[0_0_12px_rgba(200,245,96,0.8)]" />
                  <div>
                    <div className="text-white font-medium">Development Activity</div>
                    <div className="text-gray-400 text-sm">Track ecosystem growth</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleWidgetClick('github')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-6">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-purple-400 drop-shadow-[0_0_12px_rgba(168,85,247,0.8)]">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  <div>
                    <div className="text-white font-medium">GitHub Updates</div>
                    <div className="text-gray-400 text-sm">Latest releases & commits</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleWidgetClick('ai')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-6">
                  <Bot size={24} className="text-teal-400 drop-shadow-[0_0_12px_rgba(20,184,166,0.8)]" />
                  <div>
                    <div className="text-white font-medium">AI Development Plan</div>
                    <div className="text-gray-400 text-sm">Get personalized guidance</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => {
                  const element = document.getElementById('resources')
                  if (element) {
                    // Calculate the offset to account for any fixed headers or padding
                    const rect = element.getBoundingClientRect()
                    const scrollTop = window.pageYOffset + rect.top - 20 // 20px offset for better positioning
                    
                    window.scrollTo({
                      top: scrollTop,
                      behavior: 'smooth'
                    })
                  }
                  onClose();
                }}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-6">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400 drop-shadow-[0_0_12px_rgba(248,113,113,0.8)]">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                  </svg>
                  <div>
                    <div className="text-white font-medium">Browse Resources</div>
                    <div className="text-gray-400 text-sm">Find development tools</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleWidgetClick('add')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-6">
                  <Plus size={24} className="text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                  <div>
                    <div className="text-white font-medium">Add Resource</div>
                    <div className="text-gray-400 text-sm">Contribute to the ecosystem</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleWidgetClick('find')}
                className="w-full text-left p-3 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center space-x-6">
                  <Users size={24} className="text-blue-400 drop-shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
                  <div>
                    <div className="text-white font-medium">Find a Developer</div>
                    <div className="text-gray-400 text-sm">Get help with your project</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function App() {
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('category');
  const [filterBy, setFilterBy] = useState('all');
  const [aiResults, setAiResults] = useState(null);
  const [showAIWidget, setShowAIWidget] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  
  // Animation state management for smooth widget transitions
  // Removed animationState and nextWidget - no longer needed for smooth crossfade transitions
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [viewingResourceCard, setViewingResourceCard] = useState(false);
  const [navigationSource, setNavigationSource] = useState(null); // 'leaderboard', 'widget', or null
  const [isResourcesSectionActive, setIsResourcesSectionActive] = useState(false);
  
  // Access commit data from context for sorting
  const { getCommitCount } = useCommitData();

  const isDataQualityPage = location.pathname === '/data-quality';

  const categories = ['All', ...Object.keys(cardanoResources).sort()];

  const allResources = useMemo(() => {
    return Object.entries(cardanoResources).flatMap(([category, resources]) =>
      resources.map((resource) => ({ ...resource, category }))
    );
  }, []);

  // Global scrolling prevention when widgets are active
  useEffect(() => {
    const handleWheel = (e) => {
      // If any widget is expanded, prevent default scrolling
      if (expanded) {
        // Check if the event target is within any widget that has internal scrolling
        const isInDevWidget = e.target.closest('[data-widget="development-activity"]');
        const isInGitHubWidget = e.target.closest('[data-widget="github-updates"]');
        const isInAIWidget = e.target.closest('[data-widget="ai-search"]');
        const isInAddWidget = e.target.closest('[data-widget="add-resource"]');
        const isInQualityWidget = e.target.closest('.dashboard-container');
        
        // If it's in any widget with internal scrolling, let the widget handle its own scrolling
        if (isInDevWidget || isInGitHubWidget || isInAIWidget || isInAddWidget || isInQualityWidget) {
          return; // Don't prevent default, let the widget handle it
        }
        
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleKeyDown = (e) => {
      // Prevent arrow key scrolling when widgets are active
      if (expanded && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        // Check if the event target is within any widget that has internal scrolling
        const isInDevWidget = e.target.closest('[data-widget="development-activity"]');
        const isInGitHubWidget = e.target.closest('[data-widget="github-updates"]');
        const isInAIWidget = e.target.closest('[data-widget="ai-search"]');
        const isInAddWidget = e.target.closest('[data-widget="add-resource"]');
        const isInFindDeveloperWidget = e.target.closest('[data-widget="find-developer"]');
        const isInQualityWidget = e.target.closest('.dashboard-container');
        
        // If it's in any widget with internal scrolling, let the widget handle its own scrolling
        if (isInDevWidget || isInGitHubWidget || isInAIWidget || isInAddWidget || isInFindDeveloperWidget || isInQualityWidget) {
          return; // Don't prevent default, let the widget handle it
        }
        
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleTouchMove = (e) => {
      // Prevent touch scrolling when widgets are active
      if (expanded) {
        // Check if the event target is within any widget that has internal scrolling
        const isInDevWidget = e.target.closest('[data-widget="development-activity"]');
        const isInGitHubWidget = e.target.closest('[data-widget="github-updates"]');
        const isInAIWidget = e.target.closest('[data-widget="ai-search"]');
        const isInAddWidget = e.target.closest('[data-widget="add-resource"]');
        const isInFindDeveloperWidget = e.target.closest('[data-widget="find-developer"]');
        const isInQualityWidget = e.target.closest('.dashboard-container');
        
        // If it's in any widget with internal scrolling, let the widget handle its own scrolling
        if (isInDevWidget || isInGitHubWidget || isInAIWidget || isInAddWidget || isInFindDeveloperWidget || isInQualityWidget) {
          return; // Don't prevent default, let the widget handle it
        }
        
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Clean up function to restore normal scrolling
    const restoreScrolling = () => {
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('touchmove', handleTouchMove);
      document.body.style.overflow = '';
      console.log('🔓 Scroll restrictions cleared');
    };

    if (expanded) {
      console.log('🔒 Applying scroll restrictions for widget:', expanded);
      // Add event listeners to prevent scrolling
      document.addEventListener('wheel', handleWheel, { passive: false });
      document.addEventListener('keydown', handleKeyDown, { passive: false });
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      
      // Add overflow hidden to body
      document.body.style.overflow = 'hidden';
    } else {
      // Immediately clear scroll restrictions when no widget is expanded
      restoreScrolling();
    }

    return restoreScrolling;
  }, [expanded]);

  // Ensure scroll is restored when navigating to resource cards
  useEffect(() => {
    if (viewingResourceCard) {
      // Force clear any lingering scroll restrictions
      document.body.style.overflow = '';
      console.log('🔓 Ensuring free scroll for resource card navigation');
    }
  }, [viewingResourceCard]);

  // Scroll detection for resources section
  useEffect(() => {
    let ticking = false;
    
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const resourcesSection = document.getElementById('resources');
          if (resourcesSection) {
            const rect = resourcesSection.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            
            // Consider the section active if it's visible in the viewport
            // with some tolerance for better UX, but only if no widget is expanded
            const isVisible = rect.top < viewportHeight * 0.8 && rect.bottom > viewportHeight * 0.2;
            
            // Only set as active if visible AND no widget is expanded
            setIsResourcesSectionActive(isVisible && !expanded);
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    // Initial check
    handleScroll();
    
    // Add scroll listener
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [expanded]); // Add expanded as dependency

  // Update resources section active state when widget expansion changes
  useEffect(() => {
    // If a widget is expanded, immediately set resources section as inactive
    if (expanded) {
      setIsResourcesSectionActive(false);
    } else {
      // If no widget is expanded, check current scroll position
      const resourcesSection = document.getElementById('resources');
      if (resourcesSection) {
        const rect = resourcesSection.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const isVisible = rect.top < viewportHeight * 0.8 && rect.bottom > viewportHeight * 0.2;
        setIsResourcesSectionActive(isVisible);
      }
    }
  }, [expanded]);

  // Function to handle reverting to main dashboard
  const handleRevert = () => {
    if (navigationSource === 'leaderboard') {
      // If came from leaderboard, reopen the Development Activity widget
      handleWidgetTransition('dev');
      setViewingResourceCard(false);
      setNavigationSource(null);
    } else {
      // Close any open widgets and go to dashboard
      setExpanded(null);
      setViewingResourceCard(false);
      setNavigationSource(null);
      // Don't scroll to top - maintain current scroll position
    }
  };

  // Enhanced widget expansion handler
  const handleWidgetExpand = (widgetKey) => {
    if (expanded === widgetKey) {
      setExpanded(null);
      setNavigationSource(null);
    } else {
      handleWidgetTransition(widgetKey);
      setNavigationSource('widget');
    }
  };

  // Function to navigate to a specific resource card
  // Smooth widget transition handler - immediate crossfade
  const handleWidgetTransition = (newWidget) => {
    if (expanded === newWidget) return; // Already showing this widget
    
    // Direct widget replacement for buttery smooth transitions
    // CSS will handle the crossfade animation
    setExpanded(newWidget);
  };

  const navigateToResourceCard = (resourceId, resourceName) => {
    console.log(`🎯 Navigating to resource: ${resourceName} (ID: ${resourceId})`);
    
    // Close any open widgets first
    setExpanded(null);
    
    // Immediate surgical cleanup of scroll restrictions to prevent race condition
    document.body.style.overflow = '';
    
    // Set viewing state and track navigation source
    setViewingResourceCard(true);
    setNavigationSource('leaderboard');
    
    // Use the new custom event system for direct navigation to the card
    // Skip the resources section scroll and go directly to the target card
    setTimeout(() => {
      console.log('📡 Dispatching tab request event for direct navigation...');
      const tabRequestEvent = new CustomEvent('resourceCardTabRequest', {
        detail: {
          resourceId,
          resourceName,
          tabName: 'activity'
        }
      });
      document.dispatchEvent(tabRequestEvent);
    }, 100); // Small delay to ensure widget closes first
  };

  // ExpandedWidgetRenderer Component (moved inside App function)
  const ExpandedWidgetRenderer = ({ expanded, setExpanded, isMobile = false }) => {
    if (!expanded) return null;

    const widgetProps = {
      isExpanded: true,
      onExpand: () => {},
      onCollapse: () => setExpanded(null),
      isAnyExpanded: true
    };

    const renderWidget = () => {
      switch (expanded) {
        case 'dev':
          return <DevelopmentActivityWidget {...widgetProps} onNavigateToResource={navigateToResourceCard} />;
        case 'github':
          return <GitHubUpdatesWidget {...widgetProps} />;
        case 'ai':
          return <AISearchWidget {...widgetProps} />;
        case 'add':
          return <AddResourceWidget {...widgetProps} />;
        case 'find':
          return <FindDeveloperWidget {...widgetProps} />;
        default:
          return null;
      }
    };

    if (isMobile) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-4 z-50">
          <div className="bg-card-bg/50 border border-gray-800 rounded-xl shadow-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-700">
              <div className="flex items-center space-x-3">
                {expanded === 'dev' && <Activity className="h-6 w-6 text-[#C8F560]" />}
                {expanded === 'github' && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-purple-400">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                )}
                {expanded === 'ai' && <Bot className="h-6 w-6 text-teal-400" />}
                {expanded === 'add' && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                )}
                {expanded === 'find' && <Users className="h-6 w-6 text-blue-400" />}
                <h2 className="text-lg sm:text-xl font-bold text-white">
                  {expanded === 'dev' && 'Development Activity'}
                  {expanded === 'github' && 'GitHub Updates'}
                  {expanded === 'ai' && 'AI Development Plan'}
                  {expanded === 'add' && 'Add Resource'}
                  {expanded === 'find' && 'Find a Developer'}
                </h2>
              </div>
              <button
                onClick={() => setExpanded(null)}
                className="text-gray-400 hover:text-white transition-colors p-2"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(90vh-120px)]">{renderWidget()}</div>
          </div>
        </div>
      );
    }

    return renderWidget();
  };

  useEffect(() => {
    const initializeGitHub = async () => {
      await initializeRateLimit();
      const resourcesWithGitHub = allResources.filter((resource) => resource.social?.github);
      if (resourcesWithGitHub.length > 0) {
        preloadCache(resourcesWithGitHub);
        
        // Start cache warming for better performance
        setTimeout(() => {
          cacheManager.warmCache(resourcesWithGitHub);
        }, 2000) // Start warming after 2 seconds
      }
    };
    initializeGitHub();
  }, [allResources]);


  useEffect(() => {
    const handleActivityDataUpdate = (event) => {
      const { totalActiveRepos, avgCommitsPerRepo, totalCommits } = event.detail;
      const activeReposElement = document.getElementById('mobile-active-repos');
      const avgCommitsElement = document.getElementById('mobile-avg-commits');
      const totalCommitsElement = document.getElementById('mobile-total-commits');
      if (activeReposElement) activeReposElement.textContent = totalActiveRepos;
      if (avgCommitsElement) avgCommitsElement.textContent = avgCommitsPerRepo;
      if (totalCommitsElement) totalCommitsElement.textContent = totalCommits;
    };
    document.addEventListener('activityDataUpdated', handleActivityDataUpdate);
    return () => document.removeEventListener('activityDataUpdated', handleActivityDataUpdate);
  }, []);

  useEffect(() => {
    const handleExpandWidget = (event) => {
      const { widgetKey } = event.detail;
      handleWidgetExpand(widgetKey);
    };
    document.addEventListener('expandWidget', handleExpandWidget);
    return () => document.removeEventListener('expandWidget', handleExpandWidget);
  }, []);

  const handleAIAnalysisComplete = (results) => {
    setAiResults(results);
    setSearchTerm('');
    setSelectedCategory('All');
  };

  const handleAILoadingChange = (loading) => {
    setIsAILoading(loading);
  };

  const filteredResources = useMemo(() => {
    let filtered = allResources;
    
    // Category filter
    if (selectedCategory !== 'All') {
      filtered = filtered.filter((resource) => resource.category === selectedCategory);
    }
    
    // Type filter (organization/repository/misc)
    if (filterBy !== 'all') {
      filtered = filtered.filter((resource) => resource.type === filterBy);
    }
    
    // Search term filter
    if (searchTerm) {
      filtered = filtered.filter(
        (resource) =>
          resource.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          resource.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
          resource.keySolutions?.some((solution) => solution.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    
    return filtered;
  }, [allResources, searchTerm, selectedCategory, filterBy]);

  const sortedAndGroupedResources = useMemo(() => {
    let sorted = [...filteredResources];
    
    // Apply sorting
    if (sortBy === 'name') {
      // Sort by name A-Z, ignoring categories
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      // For name sorting, return as single group
      return { 'All Resources': sorted };
    } else if (sortBy === 'activity') {
      // Sort by activity (high to low) using real commit data from WeeklyCommitCount components
      sorted.sort((a, b) => {
        const aCommits = getCommitCount(a.name);
        const bCommits = getCommitCount(b.name);
        
        // If both have the same commit count, check GitHub presence as secondary sort
        if (aCommits === bCommits) {
          const aHasGitHub = a.social?.github ? 1 : 0;
          const bHasGitHub = b.social?.github ? 1 : 0;
          if (aHasGitHub !== bHasGitHub) {
            return bHasGitHub - aHasGitHub; // GitHub repos first if commits are equal
          }
          return a.name.localeCompare(b.name); // Then alphabetical
        }
        
        // Sort by commit count (descending - high to low)
        return bCommits - aCommits;
      });
      
      // For activity sorting, return as single group
      return { 'Activity Ranked': sorted };
    } else {
      // Default: sort by category A-Z
      const grouped = {};
      sorted.forEach((resource) => {
        if (!grouped[resource.category]) {
          grouped[resource.category] = [];
        }
        grouped[resource.category].push(resource);
      });
      
      // Sort resources within each category by name
      Object.keys(grouped).forEach(category => {
        grouped[category].sort((a, b) => a.name.localeCompare(b.name));
      });
      
      return grouped;
    }
  }, [filteredResources, sortBy]);

  return (
    <Routes>
      <Route path="/data-quality" element={<DataQualityDashboard />} />
      <Route path="/" element={
        <div className="min-h-screen bg-custom-bg z-0">
          {/* Widget Overlay for Expanded Widgets (Mobile) */}
          <WidgetOverlay isOpen={expanded && window.innerWidth < 1024} onClose={() => setExpanded(null)}>
            <ExpandedWidgetRenderer expanded={expanded} setExpanded={setExpanded} isMobile={true} />
          </WidgetOverlay>

          {/* Mobile Navigation */}
          <MobileNavigation
            isOpen={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            expanded={expanded}
            setExpanded={setExpanded}
            handleWidgetExpand={handleWidgetExpand}
          />

          {/* Sidebar Widgets (Desktop) */}
          <div className="relative z-50">
            <SidebarWidgetsContainer expanded={expanded} setExpanded={setExpanded} handleWidgetExpand={handleWidgetExpand} isResourcesSectionActive={isResourcesSectionActive} />
          </div>

          {/* Desktop Logos - always visible and static */}
          <div className="hidden lg:block fixed top-6 left-0 z-[9998]">
            <div className="flex flex-col items-center gap-2">
              {/* Main ADAdev logo - clipped on left side */}
              <a href="#top" tabIndex={-1} aria-label="ADAdev Home" className="group">
                <div className="flex items-center justify-center h-16 w-16 cursor-pointer bg-card-bg/95 border border-gray-700 rounded-r-xl shadow-2xl transition-all duration-300 hover:border-white/30 hover:shadow-[0_0_15px_rgba(255,255,255,0.3),0_0_30px_rgba(255,255,255,0.15)]">
                  <img 
                    src="/ADAdev_logo.svg" 
                    alt="ADAdev Cardano Developer Resources Logo" 
                    className="h-10 w-auto object-contain transition-all duration-300 group-hover:drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]"
                    width="40" height="40"
                    loading="eager"
                  />
                </div>
              </a>
            </div>
          </div>
          
          {/* Cardano logo in top right - always visible and static */}
          <div className="hidden lg:block fixed top-6 right-6 z-[9998]">
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

          {/* Expanded Widgets (Desktop) */}
          <div className="hidden lg:block z-45">
            <ExpandedWidgetRenderer expanded={expanded} setExpanded={setExpanded} />
          </div>

          {/* Main Content */}
          <div
            className={`relative z-10 transition-all duration-500 ease-in-out ${
              expanded ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
            }`}
          >
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div className="lg:hidden fixed top-0 left-0 right-0 z-[9998] bg-card-bg/95 backdrop-blur-md border-b border-gray-800">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center space-x-6">
                    <button
                      onClick={() => setMobileMenuOpen(true)}
                      className="p-2 rounded-lg hover:bg-gray-800/50 hover:shadow-[0_0_10px_rgba(255,255,255,0.2)] transition-all duration-300 group"
                    >
                      <Menu size={20} className="text-gray-400 group-hover:text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.6)] transition-all duration-300" />
                    </button>
                    <a href="#top" tabIndex={-1} aria-label="ADAdev Home" className="group">
                      <img 
                        src="/ADAdev_logo.svg" 
                        alt="ADAdev Cardano Developer Resources Logo" 
                        className="h-8 w-auto object-contain transition-all duration-300 group-hover:drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]"
                        width="32" height="32"
                        loading="eager"
                      />
                    </a>
                  </div>
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
                      className="h-6 w-auto object-contain opacity-70 filter brightness-0 invert transition-all duration-300 group-hover:opacity-100 group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]"
                      width="24" height="24"
                      loading="eager"
                    />
                  </a>
                </div>
              </div>

              <Header />
              {/* <BetaBanner /> */}
              <Hero 
                onRevert={handleRevert}
                showRevertButton={expanded !== null || viewingResourceCard}
                navigationSource={navigationSource}
              />

              <section className="hidden lg:hidden bg-card-bg/50 border border-gray-800 rounded-xl mx-4 my-8 p-6 mt-20">
                <div className="flex items-center space-x-3 mb-4">
                  <Activity size={24} className="text-amber-400" />
                  <h3 className="text-white font-bold text-xl">Development Activity</h3>
                </div>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                    <div className="text-white font-bold text-2xl" id="mobile-active-repos">-</div>
                    <div className="text-gray-400 text-sm">Active Repos</div>
                  </div>
                  <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                    <div className="text-white font-bold text-2xl" id="mobile-avg-commits">-</div>
                    <div className="text-gray-400 text-sm">Avg/Week</div>
                  </div>
                  <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                    <div className="text-white font-bold text-2xl" id="mobile-total-commits">-</div>
                    <div className="text-gray-400 text-sm">Total/Week</div>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-sm">View detailed activity on desktop</p>
                </div>
              </section>

              {aiResults && (
                <section id="ai-results">
                  <AIResults aiResults={aiResults} onOpenWidget={() => setShowAIWidget(true)} />
                </section>
              )}

              <main>
                <section id="resources" className="min-h-screen py-20 lg:py-20 pt-8 lg:pt-20">
                  <div className="max-w-6xl mx-auto px-4">
                    <div className="max-w-4xl mx-auto text-center mb-16">
                      <h2 className="text-3xl md:text-4xl lg:text-5xl font-normal text-white mb-6 leading-tight">
                        Developer Resources
                      </h2>
                      <p className="text-lg md:text-xl text-gray-400 max-w-3xl mx-auto leading-relaxed mb-12">
                        A comprehensive collection of tools, APIs, and libraries for building on Cardano
                      </p>
                      <div className="max-w-3xl mx-auto mb-16">
                        <SearchBar
                          searchTerm={searchTerm}
                          setSearchTerm={setSearchTerm}
                          selectedCategory={selectedCategory}
                          setSelectedCategory={setSelectedCategory}
                          categories={categories}
                          sortBy={sortBy}
                          setSortBy={setSortBy}
                          filterBy={filterBy}
                          setFilterBy={setFilterBy}
                        />
                      </div>
                    </div>

                    {Object.keys(sortedAndGroupedResources).length === 0 ? (
                      <div className="text-center py-20">
                        <div className="text-gray-400 text-6xl mb-6">🔍</div>
                        <h3 className="text-2xl font-bold text-white mb-4">No resources found</h3>
                        <p className="text-lg text-gray-400">Try adjusting your search terms or category filter.</p>
                      </div>
                    ) : (
                      <div className="space-y-20">
                        {Object.entries(sortedAndGroupedResources)
                          .sort(([categoryA], [categoryB]) => categoryA.localeCompare(categoryB))
                          .map(([category, resources]) => (
                            <div key={category}>
                              <div className="text-center mb-12">
                                <h3 className="text-xl md:text-2xl lg:text-3xl font-medium text-white mb-4">{category}</h3>
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-5xl mx-auto auto-rows-min">
                                {resources.map((resource) => (
                                  <ResourceCard 
                                    key={resource.id} 
                                    resource={resource} 
                                    onViewResource={() => navigateToResourceCard(resource.id, resource.name)}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </section>
              </main>

              {showAIWidget && aiResults && <AIModal aiResults={aiResults} onClose={() => setShowAIWidget(false)} />}

              <Footer />
            </div>
          </div>
        </div>
      } />
    </Routes>
  );
}

export default App;