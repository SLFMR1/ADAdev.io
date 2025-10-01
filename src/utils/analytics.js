/**
 * Google Analytics Event Tracking Helper
 *
 * Safely sends events to Google Analytics using gtag.js
 * Falls back silently if gtag is not available
 */

/**
 * Track a custom event in Google Analytics
 * @param {string} eventName - The name of the event
 * @param {object} eventParams - Additional parameters for the event
 */
export const trackEvent = (eventName, eventParams = {}) => {
  try {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', eventName, eventParams);
      console.debug(`📊 GA Event: ${eventName}`, eventParams);
    }
  } catch (error) {
    // Fail silently - analytics should never break the app
    console.warn('Analytics tracking failed:', error);
  }
};

/**
 * Track widget opening
 * @param {string} widgetName - Name of the widget (dev, github, ai, add, find)
 */
export const trackWidgetOpen = (widgetName) => {
  trackEvent('widget_open', {
    widget_name: widgetName,
  });
};

/**
 * Track widget view mode change (for Development Activity Widget)
 * @param {string} viewMode - View mode (repository, organization, founding_entity)
 */
export const trackWidgetViewChange = (viewMode) => {
  trackEvent('widget_view_change', {
    widget_name: 'dev',
    view_mode: viewMode,
  });
};

/**
 * Track widget period change (for Development Activity Widget)
 * @param {string} period - Period (current, 4weeks, 3months, 52weeks, 3years)
 */
export const trackWidgetPeriodChange = (period) => {
  trackEvent('widget_period_change', {
    widget_name: 'dev',
    period: period,
  });
};

/**
 * Track resource card view
 * @param {string} resourceName - Name of the resource
 * @param {string} resourceCategory - Category of the resource
 */
export const trackResourceView = (resourceName, resourceCategory) => {
  trackEvent('resource_view', {
    resource_name: resourceName,
    resource_category: resourceCategory,
  });
};

/**
 * Track URL sharing (when page loads with URL parameters)
 * @param {string} shareType - Type of share (widget, resource)
 * @param {string} paramValue - The parameter value
 */
export const trackURLShare = (shareType, paramValue) => {
  trackEvent('url_share_used', {
    share_type: shareType,
    param_value: paramValue,
  });
};
