import { config } from './config';

export interface Env {
	DEEPSRT_BUCKET: R2Bucket;
}

/**
 * Get the appropriate cache based on environment
 * Uses a named cache in development and default cache in production
 */
async function getCache() {
	if (config.isDev) {
		return await caches.open('dev_cache');
	}
	return caches.default;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Only handle paths starting with /srt/
		if (!path.startsWith('/srt/')) {
			return new Response('Not Found', { status: 404 });
		}

		// Remove leading /srt/ to get the R2 object key
		const key = path.substring(5); // length of "/srt/"

		try {
			// Create a specific cache key from the path
			const cacheUrl = new URL(url.toString());
			
			// Check for purge request
			const isPurge = cacheUrl.searchParams.has('purge');
			if (isPurge) {
				// Validate API key for purge operations
				const apiKey = request.headers.get('X-Api-Key');
				if (apiKey !== config.apiKey) {
					return new Response(JSON.stringify({ error: 'Invalid API key' }), {
						status: 401,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					});
				}
				
				// Remove query parameters for cache key
				cacheUrl.search = '';
				const cacheKey = new Request(cacheUrl.toString());
				
				// Purge from cache
				const cache = await getCache();
				const result = await cache.delete(cacheKey);
				
				return new Response(JSON.stringify({
					message: 'Cache purge completed',
					path: path,
					purgeResult: result ? 'succeeded' : 'failed',
					purgedCacheKey: cacheKey.url,
				}, null, 2), {
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					},
				});
			}
			
			// Remove any query parameters that might affect caching
			cacheUrl.search = '';
			const cacheKey = new Request(cacheUrl.toString());
			
			// Get the cache instance
			let cache;
			let cachedResponse = null;
			
			try {
				cache = await getCache();
				cachedResponse = await cache.match(cacheKey);
				console.log('Cache lookup completed successfully');
			} catch (error) {
				console.error('Cache lookup failed:', error);
				// Continue execution without cache
			}
			
			if (cachedResponse) {
				// Add custom header to indicate cache hit
				const headers = new Headers(cachedResponse.headers);
				headers.set('X-Cache-Status', 'HIT');
				headers.set('X-Cache-Key', cacheKey.url);
				
				// Return the cached response with updated headers
				return new Response(cachedResponse.body, {
					status: cachedResponse.status,
					statusText: cachedResponse.statusText,
					headers: headers
				});
			}
			
			// Cache miss, get the object from R2
			const object = await env.DEEPSRT_BUCKET.get(`srt/${key}`);

			if (!object) {
				return new Response('Not Found', { status: 404 });
			}

			// Set appropriate headers for the response
			const headers = new Headers();
			headers.set('Content-Type', 'text/plain; charset=utf-8');
			headers.set('Cache-Control', `public, max-age=${config.cacheMaxAgeSeconds}`); // Cache based on config
			headers.set('Access-Control-Allow-Origin', '*'); // Allow CORS
			headers.set('X-Cache-Status', 'MISS'); // Add custom header to indicate cache miss
			headers.set('X-Cache-Key', cacheKey.url); // Show which cache key was used
			headers.set('X-Cache-Duration', `${config.cacheMaxAgeSeconds} seconds`); // Show cache duration
			
			// Create the response
			const response = new Response(object.body, {
				headers
			});
			
			// Store the response in the cache
			try {
				// We need to clone the response because the body can only be read once
				if (cache) {
					ctx.waitUntil(cache.put(cacheKey, response.clone()));
				}
			} catch (error) {
				console.error('Cache put error:', error);
				// Continue without caching
			}
			
			return response;
		} catch (error) {
			console.error('Error serving file:', error);
			return new Response('Internal Server Error', { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
