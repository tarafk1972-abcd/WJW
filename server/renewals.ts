/**
 * Pengingat jatuh tempo & tagihan perpanjangan otomatis.
 *
 * Berjalan berkala di server. Untuk setiap lingkungan yang masa aktifnya
 * (atau masa percobaannya) segera habis:
 *
 *   - H-7  : buat tagihan perpanjangan → Mayar mengirim email tautan bayar
 *   - H-3  : ingatkan lagi lewat notifikasi
 *   - H-1  : ingatkan terakhir
 *   - H+0  : beri tahu bahwa langganan berakhir
 *
 * Semua keputusan memakai waktu yang bisa disuntik (`now`) supaya bisa diuji
 * tanpa menunggu hari berganti.
 */
import { DAY, audit, db, now as realNow } from './db.js'
import { createInvoice, mayarEnabled } from './mayar.js'
import { pushToMembers } from './push.js'

/** Ambang hari sebelum jatuh tempo yang memicu tindakan. */
export const REMIND_DAYS = [7, 3, 1] as const

/** Tagihan perpanjangan dibuat pada ambang ini. */
export const AUTO_BILL_DAY = 7

export interface CommunityDue {
  id: string
  name: string
  plan: string
  plan_name: string
  trial_ends_at: number
  paid_until: number | null
}

/** Kapan langganan lingkungan ini berakhir. */
export function expiryOf(c: CommunityDue): number {
  return c.paid_until && c.paid_until > 0 ? c.paid_until : c.trial_ends_at
}

/**
 * Sisa hari menuju jatuh tempo, dibulatkan ke atas dari batas hari kalender
 * agar "H-7" konsisten berapa pun jam pemeriksaan berjalan.
 */
export function daysUntil(expiry: number, now: number): number {
  return Math.ceil((expiry - now) / DAY)
}

/** Kunci unik agar satu pengingat tidak dikirim dua kali. */
function reminderKey(communityId: string, expiry: number, kind: string): string {
  return `renew:${communityId}:${expiry}:${kind}`
}

/**
 * Catat bahwa satu pengingat sudah dikerjakan.
 * Memakai tabel webhook_events karena kolom external_id-nya sudah UNIQUE —
 * ini yang membuat pengingat aman dijalankan berulang kali.
 */
function claim(key: string, detail: unknown): boolean {
  try {
    db.prepare(
      'INSERT INTO webhook_events (id, provider, event, external_id, payload, at) VALUES (?,?,?,?,?,?)',
    ).run(
      `rem_${Math.random().toString(36).slice(2, 11)}`,
      'scheduler',
      'renewal.reminder',
      key,
      JSON.stringify(detail),
      realNow(),
    )
    return true
  } catch {
    return false // sudah pernah dikerjakan
  }
}

/** Admin aktif sebuah lingkungan — penerima tagihan & pengingat. */
function adminsOf(communityId: string) {
  return db
    .prepare(
      `SELECT id, name, email, phone FROM members
       WHERE community_id=? AND role='admin' AND status='active'
       ORDER BY created_at`,
    )
    .all(communityId) as { id: string; name: string; email: string; phone: string }[]
}

export interface RenewalResult {
  checked: number
  billed: string[]
  reminded: string[]
  expired: string[]
}

/**
 * Periksa semua lingkungan sekali jalan.
 * Aman dipanggil berulang: tindakan yang sama tidak terulang.
 */
export async function runRenewalCheck(
  now: number = realNow(),
): Promise<RenewalResult> {
  const out: RenewalResult = { checked: 0, billed: [], reminded: [], expired: [] }

  const rows = db
    .prepare(
      `SELECT id, name, plan, plan_name, trial_ends_at, paid_until
       FROM communities WHERE plan <> 'suspended'`,
    )
    .all() as CommunityDue[]

  for (const c of rows) {
    out.checked++
    const expiry = expiryOf(c)
    const left = daysUntil(expiry, now)

    // sudah lewat jatuh tempo
    if (left <= 0) {
      if (claim(reminderKey(c.id, expiry, 'expired'), { name: c.name })) {
        const admins = adminsOf(c.id)
        void pushToMembers(
          admins.map((a) => a.id),
          {
            title: 'Langganan berakhir',
            body: `Langganan ${c.name} sudah berakhir. Perpanjang untuk melanjutkan layanan.`,
            url: '#/app/billing',
            tag: `expired-${c.id}`,
          },
        )
        audit(c.id, 'scheduler', 'renewal.expired', c.name)
        out.expired.push(c.id)
      }
      continue
    }

    if (left > REMIND_DAYS[0]) continue // masih lama

    const admins = adminsOf(c.id)
    if (admins.length === 0) continue

    // H-7: buatkan tagihan perpanjangan sekalian.
    // `claim` hanya dipanggil bila ambangnya tercapai, supaya pengingat
    // H-3/H-1 di bawah tetap berjalan pada pemeriksaan berikutnya.
    const shouldBill =
      left <= AUTO_BILL_DAY && claim(reminderKey(c.id, expiry, 'bill'), { left })

    if (shouldBill) {
      // Jangan buat tagihan baru bila sudah ada yang menunggu pembayaran.
      const pending = db
        .prepare(
          `SELECT 1 FROM invoices WHERE community_id=? AND status='pending'
           AND expires_at > ? LIMIT 1`,
        )
        .get(c.id, now)

      if (!pending && mayarEnabled()) {
        const admin = admins[0]
        // Perpanjang paket yang sama; masa percobaan default ke bulanan.
        const plan = c.plan_name === 'yearly' ? 'yearly' : 'monthly'
        try {
          const inv = await createInvoice({
            communityId: c.id,
            communityName: c.name,
            memberId: admin.id,
            name: admin.name,
            email: admin.email,
            mobile: admin.phone,
            plan,
            redirectUrl:
              process.env.WJW_APP_URL ?? 'https://wargajagawarga.app/#/app/billing',
          })
          audit(c.id, 'scheduler', 'renewal.billed', `${plan} ${inv.amount}`)
          out.billed.push(c.id)

          void pushToMembers(
            admins.map((a) => a.id),
            {
              title: 'Tagihan perpanjangan',
              body: `Langganan ${c.name} berakhir dalam ${left} hari. Tautan pembayaran sudah dikirim ke email Anda.`,
              url: '#/app/billing',
              tag: `bill-${c.id}`,
            },
          )
        } catch (e) {
          // Kegagalan Mayar tidak boleh menghentikan pemeriksaan lingkungan lain.
          audit(
            c.id,
            'scheduler',
            'renewal.billFailed',
            String(e instanceof Error ? e.message : e),
          )
        }
      }
    }

    // H-3 dan H-1: pengingat saja
    for (const d of REMIND_DAYS) {
      if (d === AUTO_BILL_DAY) continue
      if (left === d && claim(reminderKey(c.id, expiry, `d${d}`), { left })) {
        void pushToMembers(
          admins.map((a) => a.id),
          {
            title: `Langganan berakhir ${d} hari lagi`,
            body: `Selesaikan pembayaran agar layanan ${c.name} tidak terputus.`,
            url: '#/app/billing',
            tag: `remind-${c.id}-${d}`,
          },
        )
        audit(c.id, 'scheduler', 'renewal.remind', `H-${d}`)
        out.reminded.push(c.id)
      }
    }
  }

  return out
}

/** Jalankan pemeriksaan berkala. Mengembalikan fungsi penghenti. */
export function startRenewalScheduler(intervalMs = 6 * 60 * 60 * 1000): () => void {
  // jalankan sekali saat mulai, lalu berkala
  void runRenewalCheck().catch(() => {})
  const id = setInterval(() => {
    void runRenewalCheck().catch(() => {})
  }, intervalMs)
  id.unref?.()
  return () => clearInterval(id)
}
