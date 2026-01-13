import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Rocket } from 'lucide-react';

const CatalystBanner = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if banner was previously dismissed
    const dismissed = localStorage.getItem('catalystBannerDismissed');
    if (!dismissed) {
      setIsVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    localStorage.setItem('catalystBannerDismissed', 'true');
  };

  if (!isVisible || isDismissed) return null;

  const proposalUrl = "https://projectcatalyst.io/funds/15/cardano-use-cases-prototype-and-launch/adadev-30-development-transparency-for-catalyst-proposals";

  return (
    <>
      {/* Desktop: Top banner */}
      <div className="hidden lg:block w-full z-10">
        <div className="bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-sky-500/20 border-b border-emerald-500/30 backdrop-blur-sm">
          <div className="flex items-center justify-center px-4 py-3">
            <div className="flex items-center gap-3">
              <Rocket className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <p className="text-white text-sm font-medium">
                Support ADADEV 3.0:{' '}
                <a
                  href={proposalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 underline decoration-emerald-400/50 hover:decoration-emerald-300 transition-colors"
                >
                  Vote for Catalyst Fund 15
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {' '}to bring transparency to Catalyst proposals
              </p>
              <button
                onClick={handleDismiss}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors group"
                aria-label="Dismiss banner"
              >
                <X className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: Bottom banner - rendered via Portal to escape parent transforms */}
      {createPortal(
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[9999]">
          <div className="bg-gradient-to-r from-emerald-500/30 via-cyan-500/30 to-sky-500/30 border-t border-emerald-500/40 backdrop-blur-md">
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Rocket className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <a
                  href={proposalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-white text-sm font-medium"
                >
                  Support ADADEV 3.0:{' '}
                  <span className="text-emerald-400 underline">Catalyst Fund 15</span>
                  {' '}for transparency on Catalyst proposals
                </a>
                <button
                  onClick={handleDismiss}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  aria-label="Dismiss banner"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default CatalystBanner;
