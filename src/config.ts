/**
 * Configuration settings for the deepsrt-proxy
 */
export const config = {
  /**
   * Cache control max-age in seconds
   * Default: 7 days (604800 seconds)
   */
  cacheMaxAgeSeconds: 604800, // 7 days in seconds

  /**
   * Flag to determine if running in development mode
   * This affects caching behavior
   */
  isDev: false,
  
  // API key for cache purge operations
  apiKey: '<YOUR_API_KEY>'
};
