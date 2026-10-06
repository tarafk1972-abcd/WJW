/**
 * Verifikasi token ID "Masuk dengan Google" (web/PWA).
 *
 * Aplikasi web menerima `credential` (JWT ID token) dari Google Identity
 * Services, lalu menyerahkannya ke server. Di sinilah token itu diverifikasi
 * nyata — kredensial Google tidak pernah dipercaya apa adanya dari browser,
 * karena siapa pun bisa mengirim string apa pun ke endpoint login.
 *
 * Verifikasi memakai google-auth-library (OAuth2Client.verifyIdToken):
 *   - memeriksa tanda tangan dengan kunci publik Google,
 *   - memastikan `aud` sama dengan client_id aplikasi yang terdaftar,
 *   - memastikan email sudah diverifikasi Google.
 *
 * Menghidupkannya cukup dengan memasang secret `WJW_GOOGLE_CLIENT_ID`.
 * Tanpa itu, seluruh jalur Google mati dan aplikasi kembali ke login
 * email/sandi — tanpa error.
 */
import { OAuth2Client } from 'google-auth-library'

/** Client ID OAuth web yang terdaftar di Google Cloud Console. */
export function googleClientId(): string {
  return (process.env.WJW_GOOGLE_CLIENT_ID ?? '').trim()
}

/** Apakah login Google diaktifkan? (dengan client id yang sudah dipasang) */
export function googleEnabled(): boolean {
  return googleClientId().length > 0
}

let client: OAuth2Client | null = null

export interface GoogleIdentity {
  /** ID stabil pengguna di Google (sub). */
  sub: string
  email: string
  name: string
}

/**
 * Verifikasi sebuah ID token Google.
 *
 * @throws bila token rusak, audiens salah, atau email belum diverifikasi.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const cid = googleClientId()
  if (!cid) throw new Error('google_disabled')

  if (!client) client = new OAuth2Client(cid)
  const ticket = await client.verifyIdToken({ idToken, audience: cid })
  const payload = ticket.getPayload()
  if (!payload) throw new Error('google_invalid_token')

  // Akun Google tanpa email terverifikasi tidak boleh masuk: WJW memakai
  // email sebagai identitas yang menghubungkan ke anggota tertentu.
  if (payload.email_verified !== true || !payload.email) {
    throw new Error('google_email_unverified')
  }

  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: payload.name ?? '',
  }
}
