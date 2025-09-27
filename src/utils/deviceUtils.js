// Device and browser detection utilities for share feature compatibility

export const detectDevice = () => {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) ||
                  (maxTouchPoints > 1 && !/Mac/.test(platform));

  return { isMobile };
};

export const detectBrowser = () => {
  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor || '';

  // Detect Safari first (has both Chrome and Safari in user agent)
  const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);

  // True Chrome detection - must have Chrome but NOT be Safari, Edge, Opera
  const isChrome = /Chrome/.test(userAgent) &&
                   /Google Inc/.test(vendor) &&
                   !isSafari &&
                   !/Edg/.test(userAgent) &&
                   !/OPR/.test(userAgent);

  return { isChrome, isSafari };
};

export const shouldShowShareButton = () => {
  const { isMobile } = detectDevice();
  const { isChrome } = detectBrowser();

  // Only show on desktop Chrome for now (early beta)
  return !isMobile && isChrome;
};

export const getShareUnavailableReason = () => {
  const { isMobile } = detectDevice();
  const { isChrome } = detectBrowser();

  if (isMobile) {
    return "Share feature is currently in early beta - Desktop Chrome/Chromium browsers only";
  }

  if (!isChrome) {
    return "Share feature is currently in early beta - Desktop Chrome/Chromium browsers only";
  }

  return null;
};