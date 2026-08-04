/* Service worker Warga Jaga Warga — menangani notifikasi darurat. */

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Warga Jaga Warga', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Warga Jaga Warga'
  const urgent = !!data.urgent

  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'wjw',
    renotify: true,
    requireInteraction: urgent,
    // getaran panjang untuk darurat agar terasa di dalam saku
    vibrate: urgent ? [300, 100, 300, 100, 300] : [150],
    data: { url: data.url || '#/app' },
    actions: urgent
      ? [{ action: 'open', title: 'Buka' }]
      : [],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '#/app'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // fokuskan tab yang sudah terbuka bila ada
      for (const client of list) {
        if ('focus' in client) {
          client.navigate?.(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
