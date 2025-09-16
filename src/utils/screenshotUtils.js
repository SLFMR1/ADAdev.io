import { createGlobalGradientBackground } from './logger-frontend';
import html2canvas from 'html2canvas';

// Create an isolated screenshot render that doesn't affect the live UI
export async function createIsolatedScreenshot(element, options = {}) {
  const {
    scale = 2,
    useCORS = true,
    allowTaint = true,
    logging = false,
    backgroundColor = null,
    width,
    height,
    scrollX = 0,
    scrollY = 0,
    windowWidth,
    windowHeight
  } = options;

  // Create a clone of the element for isolated rendering
  const clonedElement = element.cloneNode(true);
  
  // Set up isolated container
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  container.style.width = '50vw';
  container.style.height = '100vh';
  container.style.zIndex = '-9999';
  container.style.overflow = 'hidden';
  container.style.background = 'transparent';
  
  // Force desktop layout for consistent screenshots
  const originalBodyClass = document.body.className;
  document.body.className = originalBodyClass + ' screenshot-mode';
  
  // Add desktop-specific styles
  const style = document.createElement('style');
  style.textContent = `
    .screenshot-mode * {
      transform: none !important;
      transition: none !important;
      animation: none !important;
    }
    .screenshot-mode .mobile-only,
    .screenshot-mode [class*="lg:hidden"],
    .screenshot-mode [class*="sm:hidden"],
    .screenshot-mode [class*="md:hidden"] {
      display: none !important;
    }
    .screenshot-mode .desktop-only,
    .screenshot-mode [class*="hidden lg:"] {
      display: block !important;
    }
    .screenshot-mode .lg\\:hidden {
      display: none !important;
    }
    .screenshot-mode .lg\\:block {
      display: block !important;
    }
    .screenshot-mode .lg\\:flex {
      display: flex !important;
    }
    .screenshot-mode .lg\\:grid {
      display: grid !important;
    }
    .screenshot-mode .lg\\:text-lg {
      font-size: 1.125rem !important;
    }
    .screenshot-mode .lg\\:text-xl {
      font-size: 1.25rem !important;
    }
    .screenshot-mode .lg\\:text-2xl {
      font-size: 1.5rem !important;
    }
    .screenshot-mode .lg\\:p-6 {
      padding: 1.5rem !important;
    }
    .screenshot-mode .lg\\:p-8 {
      padding: 2rem !important;
    }
    .screenshot-mode .lg\\:px-6 {
      padding-left: 1.5rem !important;
      padding-right: 1.5rem !important;
    }
    .screenshot-mode .lg\\:py-6 {
      padding-top: 1.5rem !important;
      padding-bottom: 1.5rem !important;
    }
    .screenshot-mode .lg\\:gap-6 {
      gap: 1.5rem !important;
    }
    .screenshot-mode .lg\\:space-x-6 > * + * {
      margin-left: 1.5rem !important;
    }
    .screenshot-mode .lg\\:space-y-6 > * + * {
      margin-top: 1.5rem !important;
    }
    .screenshot-mode .lg\\:w-auto {
      width: auto !important;
    }
    .screenshot-mode .lg\\:h-auto {
      height: auto !important;
    }
    .screenshot-mode .lg\\:max-w-none {
      max-width: none !important;
    }
    .screenshot-mode .lg\\:min-h-screen {
      min-height: 100vh !important;
    }
    .screenshot-mode .lg\\:grid-cols-3 {
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    }
    .screenshot-mode .lg\\:grid-cols-4 {
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    }
    .screenshot-mode .lg\\:flex-row {
      flex-direction: row !important;
    }
    .screenshot-mode .lg\\:justify-between {
      justify-content: space-between !important;
    }
    .screenshot-mode .lg\\:items-center {
      align-items: center !important;
    }
    .screenshot-mode .lg\\:text-center {
      text-align: center !important;
    }
    .screenshot-mode .lg\\:text-left {
      text-align: left !important;
    }
    .screenshot-mode .lg\\:text-right {
      text-align: right !important;
    }
    /* Hide tab navigation in screenshot mode */
    .screenshot-mode [class*="flex space-x-1 mb-3 border-b border-gray-700/50 overflow-x-auto"] {
      display: none !important;
    }
    .screenshot-mode [class*="TabButton"] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
  
  // Add cloned element to container
  container.appendChild(clonedElement);
  document.body.appendChild(container);
  
  try {
    // Wait for any layout calculations
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Capture the isolated element
    const canvas = await html2canvas(clonedElement, { 
      scale,
      useCORS,
      allowTaint,
      logging,
      backgroundColor,
      width,
      height,
      scrollX,
      scrollY,
      windowWidth,
      windowHeight
    });
    
    // Create global gradient background
    const backgroundCanvas = createGlobalGradientBackground(canvas.width, canvas.height);
    const bgCtx = backgroundCanvas.getContext('2d');
    
    // Draw the screenshot on top of the gradient background
    bgCtx.drawImage(canvas, 0, 0);
    
    return new Promise(resolve => {
      backgroundCanvas.toBlob(resolve, 'image/png', 0.95);
    });
  } finally {
    // Clean up
    document.body.removeChild(container);
    document.head.removeChild(style);
    document.body.className = originalBodyClass;
  }
}

// Utility: Convert SVG element to PNG Blob using a canvas
export async function svgToPngBlob(svgElement, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    try {
      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(svgElement);
      const svg64 = btoa(unescape(encodeURIComponent(svgString)));
      const image64 = 'data:image/svg+xml;base64,' + svg64;
      const img = new window.Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        
        // Create global gradient background
        const backgroundCanvas = createGlobalGradientBackground(canvas.width, canvas.height);
        const bgCtx = backgroundCanvas.getContext('2d');
        
        // Draw the SVG on top of the gradient background
        bgCtx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        backgroundCanvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create PNG blob from SVG'));
        }, 'image/png', 0.95);
      };
      img.onerror = reject;
      img.src = image64;
    } catch (err) {
      reject(err);
    }
  });
}

// Enhanced screenshot capture with gradient background
export async function captureElementWithGradient(element, options = {}) {
  const {
    scale = 2,
    useCORS = true,
    allowTaint = true,
    logging = false,
    backgroundColor = null,
    width,
    height,
    scrollX = 0,
    scrollY = 0,
    windowWidth,
    windowHeight
  } = options;

  // Temporarily hide widget overlays and high z-index elements during screenshot
  const elementsToHide = [];
  
  // Hide widget overlays and modals that might interfere
  const highZIndexSelectors = [
    '[style*="z-index: 9999"]',
    '[style*="z-index: 999"]',
    '[style*="z-index: 99"]',
    '[style*="z-index: 50"]',
    '[style*="z-index: 45"]',
    '[style*="z-index: 40"]',
    '.fixed[style*="z-index"]',
    '[class*="z-[9999]"]',
    '[class*="z-[999]"]',
    '[class*="z-[99]"]',
    '[class*="z-[50]"]',
    '[class*="z-[45]"]',
    '[class*="z-[40]"]'
  ];
  
  highZIndexSelectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      if (el !== element && !element.contains(el)) {
        const originalDisplay = el.style.display;
        el.style.display = 'none';
        elementsToHide.push({ element: el, originalDisplay });
      }
    });
  });

  // Hide Portal components (React portals)
  const portalElements = document.querySelectorAll('[data-portal]');
  portalElements.forEach(el => {
    const originalDisplay = el.style.display;
    el.style.display = 'none';
    elementsToHide.push({ element: el, originalDisplay });
  });

  // Hide portal-root div and its children
  const portalRoot = document.getElementById('portal-root');
  if (portalRoot) {
    const portalChildren = portalRoot.querySelectorAll('*');
    portalChildren.forEach(el => {
      const originalDisplay = el.style.display;
      el.style.display = 'none';
      elementsToHide.push({ element: el, originalDisplay });
    });
  }

  // Hide elements with backdrop-blur that might interfere
  const backdropElements = document.querySelectorAll('[class*="backdrop-blur"]');
  backdropElements.forEach(el => {
    if (el !== element && !element.contains(el)) {
      const originalDisplay = el.style.display;
      el.style.display = 'none';
      elementsToHide.push({ element: el, originalDisplay });
    }
  });

  // Hide elements with bg-black/50 or similar dark overlays
  const darkOverlaySelectors = [
    '[class*="bg-black/50"]',
    '[class*="bg-black/80"]',
    '[class*="bg-black/90"]',
    '[style*="background-color: rgba(0, 0, 0, 0.5)"]',
    '[style*="background-color: rgba(0, 0, 0, 0.8)"]'
  ];
  
  darkOverlaySelectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      if (el !== element && !element.contains(el)) {
        const originalDisplay = el.style.display;
        el.style.display = 'none';
        elementsToHide.push({ element: el, originalDisplay });
      }
    });
  });

  // Hide tab navigation elements during screenshot
  const tabNavigationSelectors = [
    '[class*="flex space-x-1 mb-3 border-b border-gray-700/50 overflow-x-auto"]',
    'button[class*="px-3 py-1 text-sm rounded-md"]'
  ];
  
  tabNavigationSelectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      if (element.contains(el)) {
        const originalDisplay = el.style.display;
        el.style.display = 'none';
        elementsToHide.push({ element: el, originalDisplay });
      }
    });
  });

  try {
    // Wait for React to fully re-render and clean up any duplicate elements
    await new Promise(resolve => {
      // Wait for current render cycle
      requestAnimationFrame(() => {
        // Wait for next render cycle to ensure cleanup
        requestAnimationFrame(() => {
          // Wait for any pending state updates
          setTimeout(resolve, 100);
        });
      });
    });

    const canvas = await html2canvas(element, { 
      scale,
      useCORS,
      allowTaint,
      logging,
      backgroundColor,
      width,
      height,
      scrollX,
      scrollY,
      windowWidth,
      windowHeight
    });
    
    // Create global gradient background
    const backgroundCanvas = createGlobalGradientBackground(canvas.width, canvas.height);
    const bgCtx = backgroundCanvas.getContext('2d');
    
    // Draw the screenshot on top of the gradient background
    bgCtx.drawImage(canvas, 0, 0);
    
    // Ensure the gradient is visible by drawing it again if needed
    if (canvas.width > 0 && canvas.height > 0) {
      // Create a temporary canvas to check if the screenshot has content
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, 0, 0);
      
      const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
      const hasContent = imageData.data.some((value, index) => index % 4 === 3 && value > 0); // Check alpha channel
      
      if (!hasContent) {
        // If no content detected, ensure gradient is visible
        const gradientCanvas = createGlobalGradientBackground(canvas.width, canvas.height);
        bgCtx.drawImage(gradientCanvas, 0, 0);
      }
    }
    
    return new Promise(resolve => {
      backgroundCanvas.toBlob(resolve, 'image/png', 0.95);
    });
  } finally {
    // Restore all hidden elements
    elementsToHide.forEach(({ element, originalDisplay }) => {
      element.style.display = originalDisplay;
    });
  }
}

// Merge multiple images with gap
export async function mergeImagesWithGap(images, gap = 32) {
  if (!images || images.length === 0) {
    throw new Error('No images provided for merging');
  }

  // Calculate total width and max height
  let totalWidth = 0;
  let maxHeight = 0;
  
  for (const img of images) {
    totalWidth += img.width;
    maxHeight = Math.max(maxHeight, img.height);
  }
  
  // Add gaps between images
  totalWidth += gap * (images.length - 1);
  
  // Create merged canvas with global gradient background
  const mergedCanvas = createGlobalGradientBackground(totalWidth, maxHeight);
  const ctx = mergedCanvas.getContext('2d');
  
  // Draw images side by side with gaps
  let currentX = 0;
  for (const img of images) {
    const y = (maxHeight - img.height) / 2; // Center vertically
    ctx.drawImage(img, currentX, y);
    currentX += img.width + gap;
  }
  
  return new Promise(resolve => {
    mergedCanvas.toBlob(resolve, 'image/png', 0.95);
  });
}

// Share to X (Twitter) with robust mobile/desktop support (image + text when possible)
export async function shareToX(blob, tweetText, handles = []) {
  try {
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !/Mac/.test(navigator.platform));
    const file = new File([blob], `cardano-activity-${Date.now()}.png`, { type: 'image/png' });

    // Desktop: prefer clipboard (image + text combined), then separate, before any Web Share attempt
    if (!isMobile && navigator.clipboard && window.isSecureContext) {
      // Try combined item first (desktop Chrome/Edge)
      if (typeof ClipboardItem !== 'undefined') {
        try {
          const item = new ClipboardItem({
            'image/png': blob,
            'text/plain': new Blob([tweetText], { type: 'text/plain' })
          });
          await navigator.clipboard.write([item]);
          return { success: true, message: 'Image and text copied! Paste in your tweet.' };
        } catch (e) {
          // Fall back to separate writes below
        }
      }

      let copiedImage = false;
      let copiedText = false;
      try {
        if (typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copiedImage = true;
        }
      } catch {}
      try {
        await navigator.clipboard.writeText(tweetText);
        copiedText = true;
      } catch {}
      if (copiedImage || copiedText) {
        return {
          success: true,
          message: copiedImage && copiedText
            ? 'Image and text copied! Paste in your tweet.'
            : copiedImage
              ? 'Image copied! Paste in your tweet.'
              : 'Text copied! Paste in your tweet.'
        };
      }
    }

    // Mobile: prefer Web Share with files + text.
    if (isMobile && navigator.share) {
      // If file sharing is supported, include the image
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title: 'Cardano Development Activity', text: tweetText, files: [file] });
          return { success: true, message: 'Shared successfully!' };
        } catch (shareError) {
          // Fall through to text-only share
        }
      }
      // Try text-only share (covers iOS Chrome/older WebKit where file share is limited)
      try {
        await navigator.share({ title: 'Cardano Development Activity', text: tweetText });
        return { success: true, message: 'Shared successfully!' };
      } catch (shareError) {
        // User cancelled or gesture chain broken; fall through to fallbacks
      }
    }

    // Generic clipboard fallback (may help on some mobile/desktop combos)
    if (navigator.clipboard && window.isSecureContext) {
      try {
        if (typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          // Try to copy text too (ignore failures)
          try { await navigator.clipboard.writeText(tweetText); } catch {}
          return { success: true, message: 'Image copied! Paste in your tweet.' };
        }
      } catch {}
      try {
        await navigator.clipboard.writeText(tweetText);
        return { success: true, message: 'Text copied! Paste in your tweet.' };
      } catch {}
      // Legacy text-copy fallback for iOS WebKit
      try {
        const ta = document.createElement('textarea');
        ta.value = tweetText;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
          return { success: true, message: 'Text copied! Paste in your tweet.' };
        }
      } catch {}
    }

    // Final fallback: download image, then try to copy text
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cardano-activity-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(tweetText);
        return { success: true, message: 'Image downloaded! Text copied. Paste in your tweet.' };
      }
    } catch {}

    return { success: true, message: 'Image downloaded! Copy and paste the text into your tweet.' };
  } catch (error) {
    console.warn('Share error:', error);
    return { success: false, message: 'Failed to share. Please try again.' };
  }
}

// Generate tweet text for development activity
export function generateTweetText(handles = [], shareType = 'chart', activityData = []) {
  const handleText = handles.join(' ');
  
  // Calculate total commits from activity data
  const totalCommits = activityData.reduce((sum, item) => sum + (item.totalCommits || 0), 0);
  const projectCount = activityData.length;
  
  return `Cardano Development Activity\n\nTop projects: ${handleText}\n ${totalCommits} total commits from ${projectCount} projects\n\nSee more at: https://adadev.io`;
}

// Get top handles or names from activity data
export function getTop5HandlesOrNames(activityData) {
  return activityData.slice(0, 5).map(item => {
    const social = item.resource.social || {};
    if (social.x) {
      const match = social.x.match(/x.com\/(\w+)/i);
      if (match && match[1]) return '@' + match[1];
    }
    if (social.github) {
      const match = social.github.match(/github.com\/(?:orgs\/)?([\w-]+)/i);
      if (match && match[1]) return '@' + match[1];
    }
    return item.resource.name.replace(/\s+/g, '');
  });
} 