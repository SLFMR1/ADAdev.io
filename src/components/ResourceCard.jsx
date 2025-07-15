import React, { useState, useRef, useEffect } from 'react'
import { 
  ExternalLink, Github, MessageCircle,
  TerminalSquare, Database, Wallet, Image as ImageIcon, Users,
  ShieldCheck, Zap, BarChart2, Bot, Moon, HardDrive, Building2,
  BookOpen, UserCheck, Eye, Cpu, Heart, Server, GitBranch, Share2, Loader2
} from 'lucide-react'
import GitHubUpdates from './GitHubUpdates'
import WeeklyCommitCount from './WeeklyCommitCount'
import WeeklyActivityChart from './WeeklyActivityChart'
import html2canvas from 'html2canvas'

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"/>
  </svg>
)

const DiscordIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.317 4.369A19.791 19.791 0 0016.885 3.2a.077.077 0 00-.082.038c-.357.63-.755 1.453-1.037 2.104a18.524 18.524 0 00-5.532 0 12.683 12.683 0 00-1.05-2.104.077.077 0 00-.082-.038A19.736 19.736 0 003.684 4.369a.07.07 0 00-.032.027C.533 9.09-.32 13.578.099 18.021a.082.082 0 00.031.056c2.128 1.563 4.195 2.507 6.222 3.13a.077.077 0 00.084-.027c.48-.66.908-1.356 1.273-2.084a.076.076 0 00-.041-.104c-.676-.256-1.32-.568-1.94-.936a.077.077 0 01-.008-.127c.13-.098.26-.2.384-.304a.074.074 0 01.077-.01c4.07 1.86 8.47 1.86 12.51 0a.075.075 0 01.078.009c.124.104.254.206.384.304a.077.077 0 01-.006.127 12.298 12.298 0 01-1.941.936.076.076 0 00-.04.105c.366.728.794 1.423 1.273 2.083a.076.076 0 00.084.028c2.028-.623 4.095-1.567 6.223-3.13a.077.077 0 00.03-.055c.5-5.177-.838-9.637-3.548-13.625a.062.062 0 00-.03-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.175 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419zm7.96 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.175 1.094 2.157 2.418 0 1.334-.947 2.419-2.157 2.419z" fill="currentColor"/>
  </svg>
)

const categoryIconComponents = {
  "Development Tools": TerminalSquare,
  "Infrastructure & APIs": Database,
  "Wallets & User Tools": Wallet,
  "Security & Auditing": ShieldCheck,
  "Minting and NFTs": ImageIcon,
  "Analytics & Data": BarChart2,
  "Education & Documentation": BookOpen,
  "Identity & Authentication": UserCheck,
  "Oracles & External Data": Zap,
  "Privacy & Zero-Knowledge": Moon,
  "AI & Machine Learning": Bot,
  "Development Platforms": HardDrive,
  "Community & Engagement": Heart,
  "Core Infrastructure": Server,
  default: TerminalSquare
};

const getSocialIcon = (platform) => {
  switch (platform) {
    case 'twitter':
    case 'x': return <XIcon />
    case 'github': return <Github size={14} />
    case 'discord': return <DiscordIcon />
    default: return <ExternalLink size={14} />
  }
}

const ResourceCard = ({ resource }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('about')
  const [isScrolling, setIsScrolling] = useState(false)
  const expandTimeoutRef = useRef(null)
  const scrollTimeoutRef = useRef(null)
  const cardRef = useRef(null)
  const chartContainerRef = useRef(null)
  const [isSharing, setIsSharing] = useState(false)
  const [screenshotMode, setScreenshotMode] = useState(false)

  const IconComponent = categoryIconComponents[resource.category] || categoryIconComponents.default;

  // Placeholder logo component
  const PlaceholderLogo = ({ name, className = "" }) => (
    <div className={`flex items-center justify-center bg-gray-700 rounded-md ${className}`}>
      <Building2 size={16} className="text-gray-400" />
    </div>
  );

  const TabButton = ({ tabName, children }) => (
    <button
      onClick={(e) => {
        e.stopPropagation()
        setActiveTab(tabName)
      }}
      onMouseEnter={() => setActiveTab(tabName)}
      className={`px-3 py-1 text-sm rounded-md transition-all duration-200  ${
        activeTab === tabName 
          ? 'bg-gray-700/50 border-gray-600 text-white shadow-inner' 
          : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-800/50 '
      }`}
    >
      {children}
    </button>
  );

  // Handle scroll detection
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolling(true)
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      
      // Set scrolling to false after scroll stops
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false)
      }, 150) // 150ms delay after scroll stops
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Handle clicks outside the card
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isExpanded && cardRef.current && !cardRef.current.contains(event.target)) {
        setIsExpanded(false)
      }
    }

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isExpanded])

  const handleCardClick = () => {
    // Don't trigger expand if currently scrolling
    if (isScrolling) return
    // Only expand if not already expanded
    if (!isExpanded) {
      setIsExpanded(true)
    }
    // Do nothing if already expanded (let outside click handler handle collapse)
  }

  // Share logic for activity chart
  const handleShareActivityChart = async () => {
    if (!chartContainerRef.current) return;
    setScreenshotMode(true);
    setIsSharing(true);
    await new Promise(resolve => setTimeout(resolve, 100)); // allow re-render
    // Hide tooltips if any (no hover/focus)
    const tooltips = chartContainerRef.current.querySelectorAll('[class*=tooltip]');
    tooltips.forEach(el => el.style.display = 'none');
    // Screenshot chart container
    const canvas = await html2canvas(chartContainerRef.current, {
      backgroundColor: '#1a1a1a',
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false
    });
    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, 'image/png', 0.95);
    });
    // Compose tweet text
    const tweetText = `Cardano Project Activity\n\n${resource.name} - ${resource.category}\n#Cardano #Development #OpenSource\n\nSee more at: https://adadev.io`;
    try {
      if (navigator.clipboard && navigator.clipboard.write) {
        const clipboardItems = [
          new ClipboardItem({
            'image/png': blob,
            'text/plain': new Blob([tweetText], { type: 'text/plain' })
          })
        ];
        await navigator.clipboard.write(clipboardItems);
        setTimeout(() => {
          window.open('https://x.com/intent/tweet', '_blank');
        }, 2000);
      } else {
        await navigator.clipboard.writeText(tweetText);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `cardano-activity-${resource.name.replace(/\s+/g, '')}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setTimeout(() => {
          window.open('https://x.com/intent/tweet', '_blank');
        }, 2000);
      }
    } catch (clipboardError) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cardano-activity-${resource.name.replace(/\s+/g, '')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      try {
        await navigator.clipboard.writeText(tweetText);
      } catch {}
      setTimeout(() => {
        window.open('https://x.com/intent/tweet', '_blank');
      }, 2000);
    }
    setIsSharing(false);
    setScreenshotMode(false);
  }

  return (
    <div 
      ref={cardRef}
      onClick={handleCardClick}
      className="relative bg-card-bg/50 backdrop-blur-md border border-gray-800 rounded-xl p-4 transition-all duration-300 ease-in-out transform-gpu shadow-lg hover:shadow-2xl cursor-pointer"
      style={{
        height: isExpanded ? 'auto' : '6rem',
        minHeight: isExpanded && activeTab === 'activity' ? (window.innerWidth < 1024 ? '25rem' : '38rem') : isExpanded ? (window.innerWidth < 1024 ? '18rem' : '22rem') : undefined,
        width: isExpanded && activeTab === 'activity' ? (window.innerWidth < 1024 ? '100%' : '60rem') : undefined,
        maxWidth: isExpanded && activeTab === 'activity' ? (window.innerWidth < 1024 ? '100%' : '60rem') : undefined,
        transform: isExpanded ? (window.innerWidth < 1024 ? 'scale(1)' : 'scale(1.03)') : 'scale(1)',
        zIndex: isExpanded && activeTab === 'activity' ? 50 : isExpanded ? 10 : 1,
      }}
    >
      {/* Collapsed View */}
      <div className={`transition-opacity duration-200 ${isExpanded ? 'opacity-0' : 'opacity-100'}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-4">
            <IconComponent size={28} className="text-gray-400" />
            <div className="flex-1">
              <h3 className="text-white font-medium text-base mb-1">{resource.name}</h3>
              <p className="text-gray-400 text-sm line-clamp-2">{resource.description}</p>
            </div>
          </div>
          {resource.social?.github && (
            <WeeklyCommitCount resource={resource} />
          )}
        </div>
      </div>

      {/* Expanded View */}
      <div className={`absolute top-0 left-0 w-full p-4 transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} style={{ 
        minHeight: activeTab === 'activity' ? (window.innerWidth < 1024 ? '25rem' : '38rem') : (window.innerWidth < 1024 ? '18rem' : '22rem'), 
        zIndex: activeTab === 'activity' ? 50 : 10, 
        width: activeTab === 'activity' ? (window.innerWidth < 1024 ? '100%' : '60rem') : '100%' 
      }}>
        <div className="flex flex-col min-h-full">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <IconComponent size={28} className="text-cyan-400" />
              <h3 className="text-white font-medium text-base">{resource.name}</h3>
            </div>
            {/* Logo in expanded view */}
            {resource.website ? (
              <a 
                href={resource.website} 
                target="_blank" 
                rel="noopener noreferrer"
                className="hover:opacity-80 transition-opacity duration-200"
                aria-label={`Visit ${resource.name} website`}
                onClick={(e) => e.stopPropagation()}
              >
                {resource.logo ? (
                  <img src={resource.logo} alt={`${resource.name} logo`} className="h-6 w-auto max-w-[80px] object-contain" />
                ) : (
                  <PlaceholderLogo name={resource.name} className="h-6 w-16" />
                )}
              </a>
            ) : (
              resource.logo ? (
                <img src={resource.logo} alt={`${resource.name} logo`} className="h-6 w-auto max-w-[80px] object-contain" />
              ) : (
                <PlaceholderLogo name={resource.name} className="h-6 w-16" />
              )
            )}
          </div>

          {/* Tabs */}
          <div className="flex space-x-1 mb-3 border-b border-gray-700/50 overflow-x-auto">
            <TabButton tabName="about">About</TabButton>
            <TabButton tabName="solutions">Solutions</TabButton>
            <TabButton tabName="links">Links</TabButton>
            {resource.social?.github && (
              <TabButton tabName="updates">Updates</TabButton>
            )}
            {resource.social?.github && (
              <TabButton tabName="activity">Activity</TabButton>
            )}
          </div>

          {/* Tab Content */}
          <div className={`flex-grow overflow-hidden text-sm text-gray-300 pr-2 ${activeTab === 'updates' || activeTab === 'activity' ? 'overflow-y-auto' : ''}`}>
            {activeTab === 'about' && <p>{resource.fullDescription || resource.description}</p>}
            {activeTab === 'solutions' && (
              <div className="flex flex-wrap gap-1">
                {resource.keySolutions.map((solution) => (
                  <span key={solution} className="bg-gray-800 text-gray-300 px-2 py-1 rounded-full border border-gray-700 text-xs">
                    {solution}
                  </span>
                ))}
              </div>
            )}
            {activeTab === 'links' && (
              <div className="flex flex-col space-y-2" onClick={(e) => e.stopPropagation()}>
                {resource.website && (
                   <a href={resource.website} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-2 hover:text-cyan-300">
                     <ExternalLink size={14} /> <span>Website</span>
                   </a>
                )}
                {resource.social && Object.entries(resource.social).map(([platform, url]) => (
                  <a key={platform} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-2 hover:text-cyan-300 capitalize">
                    {getSocialIcon(platform)} <span>{platform}</span>
                  </a>
                ))}
              </div>
            )}
            {activeTab === 'updates' && resource.social?.github && (
              <GitHubUpdates resource={resource} />
            )}
            {activeTab === 'activity' && resource.social?.github && (
              <div className="mb-2 flex justify-end">
                <button
                  onClick={handleShareActivityChart}
                  className={`share-button text-cyan-400 hover:text-white bg-gray-800/70 rounded-full p-2 transition-colors ${isSharing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title="Share Activity Chart"
                  disabled={isSharing}
                >
                  {isSharing ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Share2 className="w-5 h-5" />
                  )}
                </button>
              </div>
            )}
            {activeTab === 'activity' && resource.social?.github && (
              <div ref={chartContainerRef}>
                <WeeklyActivityChart resource={resource} showThreeYearOption={false} hidePeriodSwitches={screenshotMode} hideActivityLevelInfo={true} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ResourceCard 