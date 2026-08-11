/**
 * Data QRIS untuk mode lokal (tanpa server).
 *
 * Saat memakai server, data ini datang dari `GET /api/billing` yang
 * membacanya dari .env (WJW_QRIS_*). Di mode lokal tidak ada server,
 * jadi nilainya diambil dari variabel build Vite dengan cadangan tetap.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>

export const QRIS_LOCAL = {
  name: env.VITE_QRIS_NAME ?? 'FADLUL KHAIRA',
  phone: env.VITE_QRIS_PHONE ?? '(+62)81****781',
  imageUrl: env.VITE_QRIS_IMAGE_URL ?? '/qris.png',
  info: env.VITE_PAYMENT_INFO ?? '',
}
