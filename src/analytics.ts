const analytics = {
  hostname: 'franciscoghansen.github.io',
  basePath: '/cozy-games-farm-planner/',
  scriptUrl: 'https://static.cloudflareinsights.com/beacon.min.js',
  token: 'bb1bfb253a5c4f8f8e416758094e3296',
}

export function initializeAnalytics() {
  if (!import.meta.env.PROD) return

  const { protocol, hostname, port, pathname } = window.location
  if (protocol !== 'https:' || hostname !== analytics.hostname || port) return
  if (pathname !== analytics.basePath.slice(0, -1) && !pathname.startsWith(analytics.basePath)) return
  if (document.querySelector(`script[src="${analytics.scriptUrl}"]`)) return

  const script = document.createElement('script')
  script.type = 'module'
  script.async = true
  script.src = analytics.scriptUrl
  script.dataset.cfBeacon = JSON.stringify({ token: analytics.token })
  document.head.append(script)
}
