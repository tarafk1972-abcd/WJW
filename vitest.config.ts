import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    css: false,
    /*
     * Batas waktu bawaan vitest (5 detik) mengukur KECEPATAN MESIN, bukan
     * benar-salahnya kode. Di mesin yang lebih lambat, tes yang sama gagal
     * tanpa ada yang berubah — dan akibatnya nyata: langkah "Jalankan tes"
     * berhenti, lalu APK tidak pernah terbangun.
     *
     * PENTING: angkanya ditulis DI DALAM tiap project, bukan di tingkat
     * atas. Saat `projects` dipakai, vitest mengabaikan testTimeout di
     * luar — diam-diam, tanpa peringatan.
     */
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          testTimeout: 90_000,
          hookTimeout: 90_000,
          setupFiles: ['./src/__tests__/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'api',
          environment: 'node',
          globals: true,
          testTimeout: 90_000,
          hookTimeout: 90_000,
          include: ['server/**/*.test.ts'],
        },
      },
    ],
  },
})
