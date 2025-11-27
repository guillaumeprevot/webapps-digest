/**
 * The service worker will cache resources to allow offline usage :
 * - GOOGLE : https://developers.google.com/web/fundamentals/primers/service-workers/#update-a-service-worker
 * - MOZILLA : https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
 */
var cacheName = '20251127';
var baseCacheContent = [
	'./libs/bootstrap/css/bootstrap.min.css',
	'./libs/bootstrap/js/bootstrap.min.js',
	'./libs/forge/forge-custom-digest.min.js',
	'./libs/jquery/jquery.min.js',
	'./libs/material-icons/algorithm.svg',
	'./libs/material-icons/clear.svg',
	'./libs/material-icons/download.svg',
	'./libs/material-icons/files.svg',
	'./libs/popper/popper.min.js',
	'webapps-digest.css',
	'webapps-digest.js',
	'webapps-digest.html',
	'webapps-digest.ico',
	'webapps-digest.png',
	'webapps-digest-ww.js'
];

function info(text) {
	console.log('Service Worker : ' + text);
}

function trace(_text) {
	// console.log('Service Worker : ' + text);
}

self.addEventListener('install', function(event) {
	info('installed');
	self.skipWaiting();
	event.waitUntil(caches.open(cacheName).then(function(cache) {
		info('caching data');
		return cache.addAll(baseCacheContent).then(function() {
			info('data cached');
		});
	}))
});

self.addEventListener('activate', function(event) {
	info('activated');
	event.waitUntil(caches.keys().then(function(keys) {
		var cacheWhitelist = [cacheName];
		return Promise.all(keys.map(function(key) {
			if (cacheWhitelist.indexOf(key) === -1) {
				info('cleaning old cache ' + key);
				return caches.delete(key);
			}
		})).then(function() {
			return clients.claim();
		});
	}));
});

self.addEventListener('fetch', function(event) {
	event.respondWith(caches.match(event.request).then(function(response) {
		if (response) {
			trace('using cache for ' + event.request.url);
			return response;
		}
		trace('fetching data for ' + event.request.url);
		return fetch(event.request).then(function(response) {
			if (!response || response.status !== 200 || response.type !== 'basic')
				return response;
			// Clone the response : one to return, one for cache
			var responseToCache = response.clone();
			caches.open(cacheName).then(function(cache) {
				trace('caching response for ' + event.request.url);
				cache.put(event.request, responseToCache);
			});
			return response;
		});
	}));
});
