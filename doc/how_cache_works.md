# DeepSRT Provider Caching System

This document explains how the caching system works in the DeepSRT Provider application, which is built on Cloudflare Workers with R2 storage.

## Overview

The DeepSRT Provider uses Cloudflare's Cache API to efficiently serve SRT files without repeatedly accessing the R2 bucket for the same content. This reduces latency, improves performance, and minimizes R2 operations costs.

## Cache Configuration

The caching behavior is configured in `src/config.ts`:

```typescript
export const config = {
  // Cache duration in seconds (default: 7 days)
  cacheMaxAgeSeconds: 604800,
  
  // Flag to determine if running in development mode
  isDev: false,
  
  // API key for cache purge operations
  apiKey: '<YOUR_API_KEY>'
};
```

## How Caching Works

### 1. Cache Selection

The application uses different caches based on the environment:

```typescript
async function getCache() {
  if (config.isDev) {
    return await caches.open('dev_cache');
  }
  return caches.default;
}
```

- In development mode (`isDev = true`): Uses a named cache called 'dev_cache'
- In production mode (`isDev = false`): Uses Cloudflare's default cache

This separation allows for testing without affecting production cache.

### 2. Cache Key Generation

Cache keys are created based on the request URL with query parameters removed:

```typescript
const cacheUrl = new URL(url.toString());
cacheUrl.search = '';  // Remove query parameters
const cacheKey = new Request(cacheUrl.toString());
```

By removing query parameters, we ensure that requests like `/srt/file.srt?param=value` and `/srt/file.srt` use the same cache entry.

### 3. Cache Lookup Process

When a request comes in:

1. The application generates a cache key
2. It checks if a response for this key exists in the cache
3. If found, it returns the cached response with `X-Cache-Status: HIT`
4. If not found, it fetches the file from R2, caches it, and returns it with `X-Cache-Status: MISS`

```typescript
// Try to get from cache
let cache;
let cachedResponse = null;

try {
  cache = await getCache();
  cachedResponse = await cache.match(cacheKey);
} catch (error) {
  console.error('Cache lookup failed:', error);
  // Continue execution without cache
}

if (cachedResponse) {
  // Return cached response with HIT status
  // ...
}
```

### 4. Caching New Responses

When a cache miss occurs and content is fetched from R2:

```typescript
// Store the response in the cache
try {
  if (cache) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
} catch (error) {
  console.error('Cache put error:', error);
  // Continue without caching
}
```

The `response.clone()` is necessary because response bodies can only be read once.

### 5. Cache Headers

The application sets several cache-related headers:

- `Cache-Control: public, max-age=604800` - Standard HTTP cache control
- `X-Cache-Status: HIT|MISS` - Indicates if response came from cache
- `X-Cache-Key: [url]` - Shows which cache key was used
- `X-Cache-Duration: 604800 seconds` - Shows configured cache duration

## Cache Purging

The application supports purging specific cache entries via a `?purge` URL parameter:

```
https://<worker-name>.<your-subdomain>.workers.dev.workers.dev/srt/file.srt?purge
```

Purge requests require authentication with an API key:

```typescript
const apiKey = request.headers.get('X-Api-Key');
if (apiKey !== config.apiKey) {
  return new Response(JSON.stringify({ error: 'Invalid API key' }), {
    status: 401,
    // ...
  });
}
```

To purge a cache entry:

1. Send a request to the file URL with `?purge` parameter
2. Include the `X-Api-Key` header with the correct API key
3. The application will delete the cache entry and return a result

## Testing Cache Behavior

To test if caching is working:

1. Make an initial request to a file
   - Check for `X-Cache-Status: MISS` in the response headers
2. Make the same request again
   - Check for `X-Cache-Status: HIT` in the response headers

Example using curl:

```bash
# First request - should be a MISS
curl -v https://<worker-name>.<your-subdomain>.workers.dev/srt/file.srt

# Second request - should be a HIT
curl -v https://<worker-name>.<your-subdomain>.workers.dev/srt/file.srt
```

## Troubleshooting

If caching doesn't work as expected:

1. Verify that `config.isDev` is set correctly for your environment
2. Check if the URL contains query parameters that might be affecting the cache key
3. Look for errors in the Cloudflare Workers logs
4. Try purging the cache and testing again

## Best Practices

1. Keep cache keys consistent by standardizing URL patterns
2. Use appropriate cache durations based on content update frequency
3. Implement cache purging for content that needs immediate updates
4. Add debugging headers in development mode for easier troubleshooting
