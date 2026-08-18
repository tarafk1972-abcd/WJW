/*
 * Service worker Warga Jaga Warga.
 *
 * Dua tugas:
 *   1. Menampilkan notifikasi darurat walau aplikasi tertutup.
 *   2. Menyimpan cangkang aplikasi, agar bisa dibuka saat sinyal hilang —
 *      sekaligus memenuhi syarat Chrome untuk "Instal aplikasi".
 */

/** Naikkan bila daftar berkas di bawah berubah. */
const CACHE = 'wjw-shell-v2'

/** Berkas yang membuat aplikasi bisa terbuka tanpa jaringan. */
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Jangan gagalkan pemasangan hanya karena satu berkas tak terunduh.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  )
})

/*
 * Chrome hanya menawarkan "Instal aplikasi" bila service worker menangani
 * fetch. Selain itu, inilah yang membuat aplikasi tetap terbuka saat
 * sinyal hilang — hal yang penting untuk aplikasi darurat.
 */
self.addEventListener('fetch', (event) => {
  const req = event.request

  // Hanya GET biasa yang boleh disimpan.
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  /*
   * JANGAN pernah menyimpan jawaban API.
   *
   * Data peringatan, status ronda, dan daftar anggota harus selalu yang
   * terbaru. Menyajikan salinan lama saat darurat jauh lebih berbahaya
   * daripada gagal memuat.
   */
  if (url.pathname.startsWith('/api/')) return

  // Navigasi: coba jaringan dulu, jatuh ke cangkang tersimpan bila gagal.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then((r) => r || caches.match('./')),
      ),
    )
    return
  }

  const simpan = (res) => {
    if (res && res.ok && res.type === 'basic') {
      const salinan = res.clone()
      void caches.open(CACHE).then((c) => c.put(req, salinan))
    }
    return res
  }

  /*
   * Kode aplikasi: JARINGAN DULU.
   *
   * Skrip dan gaya membawa logika aplikasi, jadi salinan lama berarti
   * aplikasi lama. Dulu semua berkas statis disajikan cache-first, dan
   * akibatnya nyata di lapangan: setelah perbaikan dirilis, warga masih
   * melihat pesan galat versi lama dan kode undangan yang sah tetap
   * tampak ditolak. Perbaikan tertahan sampai kunjungan berikutnya —
   * lebih lama lagi bila tabnya tidak pernah ditutup.
   *
   * Bila jaringan gagal, salinan tersimpan tetap dipakai, sehingga
   * aplikasi ini tetap bisa dibuka saat sinyal hilang.
   */
  if (req.destination === 'script' || req.destination === 'style') {
    event.respondWith(
      fetch(req)
        .then(simpan)
        .catch(() => caches.match(req)),
    )
    return
  }

  // Sisanya (ikon, gambar, font) jarang berubah dan boros kuota bila
  // diambil ulang terus: pakai yang tersimpan, segarkan di belakang.
  event.respondWith(
    caches.match(req).then((cached) => {
      const jaringan = fetch(req)
        .then(simpan)
        .catch(() => cached)
      return cached || jaringan
    }),
  )
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
