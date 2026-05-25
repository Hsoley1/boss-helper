// 最简 Service Worker 以满足 PWA 安装要求
const CACHE_NAME = 'ai-deliver-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 仅作网络透传，不作过度缓存，保证飞书 API 实时性
self.addEventListener('fetch', (event) => {
  // 仅在必要时可以添加离线页面缓存
});
