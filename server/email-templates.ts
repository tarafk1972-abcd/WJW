/**
 * Template email tagihan untuk admin klaster.
 *
 * Ditulis sebagai HTML tabel dengan gaya sebaris (inline) karena klien email
 * seperti Gmail dan Outlook membuang <style> di <head> dan tidak mendukung
 * flexbox/grid. Setiap email juga menyertakan versi teks biasa.
 */

export interface BillEmailData {
  /** Nama admin yang ditagih. */
  adminName: string
  /** Nama klaster / lingkungan. */
  communityName: string
  plan: 'monthly' | 'yearly'
  amount: number
  /** Tanggal jatuh tempo (epoch ms). */
  dueAt: number
  /** Sisa hari sebelum layanan berhenti. */
  daysLeft?: number
  /** Nomor tagihan untuk rujukan. */
  invoiceNo: string
  /** Rekening tujuan transfer. */
  bankInfo?: string
}

const BRAND = '#2ec27e'
const DARK = '#0d1117'
const TEXT = '#1f2937'
const MUTED = '#6b7280'
const BORDER = '#e5e7eb'

function rupiah(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID')
}

function tanggal(ts: number): string {
  return new Date(ts).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  })
}

function planLabel(p: 'monthly' | 'yearly'): string {
  return p === 'monthly' ? 'Bulanan (30 hari)' : 'Tahunan (365 hari)'
}

/** Escape agar nama klaster/admin tidak bisa menyuntik HTML. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Kerangka HTML yang dipakai semua email. */
function layout(opts: {
  preheader: string
  heading: string
  headingColor?: string
  body: string
}): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<!-- teks pratinjau di kotak masuk -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
<tr><td align="center">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${BORDER};">

  <!-- kop -->
  <tr>
    <td style="background:${DARK};padding:22px 26px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:${BRAND};width:38px;height:38px;border-radius:11px;text-align:center;vertical-align:middle;color:#042417;font-weight:bold;font-size:13px;">WJW</td>
          <td style="padding-left:12px;">
            <div style="color:#ffffff;font-size:16px;font-weight:bold;">Warga Jaga Warga</div>
            <div style="color:#9aa7bd;font-size:12px;">Keamanan lingkungan dalam genggaman</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- isi -->
  <tr>
    <td style="padding:28px 26px;">
      <h1 style="margin:0 0 14px;font-size:20px;color:${opts.headingColor ?? TEXT};">${esc(opts.heading)}</h1>
      ${opts.body}
    </td>
  </tr>

  <!-- kaki -->
  <tr>
    <td style="background:#f9fafb;padding:18px 26px;border-top:1px solid ${BORDER};">
      <p style="margin:0 0 6px;font-size:12px;color:${MUTED};line-height:1.6;">
        Email ini dikirim otomatis untuk admin klaster yang terdaftar.
        Ada pertanyaan? Balas email ini dan kami akan membantu.
      </p>
      <p style="margin:0;font-size:11px;color:#9ca3af;">
        Warga Jaga Warga · Aplikasi keamanan lingkungan warga
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

/** Rincian tagihan sebagai tabel. */
function detailTable(d: BillEmailData): string {
  const rows: [string, string][] = [
    ['Klaster', esc(d.communityName)],
    ['Paket', planLabel(d.plan)],
    ['Jatuh tempo', tanggal(d.dueAt)],
    ['No. tagihan', esc(d.invoiceNo)],
  ]
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:10px;margin:0 0 20px;">
  ${rows
    .map(
      ([k, v], i) => `<tr>
    <td style="padding:11px 14px;font-size:13px;color:${MUTED};${i ? `border-top:1px solid ${BORDER};` : ''}">${k}</td>
    <td style="padding:11px 14px;font-size:13px;color:${TEXT};font-weight:600;text-align:right;${i ? `border-top:1px solid ${BORDER};` : ''}">${v}</td>
  </tr>`,
    )
    .join('')}
  <tr>
    <td style="padding:13px 14px;font-size:14px;color:${TEXT};font-weight:bold;border-top:2px solid ${BORDER};background:#f9fafb;">Total</td>
    <td style="padding:13px 14px;font-size:17px;color:${BRAND};font-weight:bold;text-align:right;border-top:2px solid ${BORDER};background:#f9fafb;">${rupiah(d.amount)}</td>
  </tr>
</table>`
}

/** Petunjuk transfer bank. */
function manualBox(bankInfo: string, invoiceNo: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;margin:0 0 20px;">
  <tr><td style="padding:14px 16px;">
    <div style="font-size:13px;font-weight:bold;color:#92400e;margin-bottom:8px;">Cara pembayaran</div>
    <div style="font-size:14px;color:#78350f;line-height:1.8;white-space:pre-line;font-weight:600;">${esc(bankInfo)}</div>
    <div style="font-size:13px;color:#78350f;margin-top:10px;padding-top:10px;border-top:1px dashed #fcd34d;">
      Cantumkan <strong>${esc(invoiceNo)}</strong> pada berita transfer.
    </div>
    <div style="font-size:12px;color:#92400e;margin-top:10px;line-height:1.6;">
      Setelah transfer, tandai <strong>&ldquo;Saya sudah bayar&rdquo;</strong> di aplikasi
      pada halaman Langganan, atau balas email ini dengan bukti transfer.
    </div>
  </td></tr>
</table>`
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/* ------------------------------------------------------------------ */
/* 1. Tagihan baru                                                     */
/* ------------------------------------------------------------------ */

export function billEmail(d: BillEmailData): RenderedEmail {
  const subject = `Tagihan langganan ${d.communityName} — ${rupiah(d.amount)}`

  const action = manualBox(
    d.bankInfo || 'Hubungi pengelola untuk informasi rekening.',
    d.invoiceNo,
  )

  const html = layout({
    preheader: `Tagihan ${rupiah(d.amount)} untuk ${d.communityName}, jatuh tempo ${tanggal(d.dueAt)}.`,
    heading: 'Tagihan langganan',
    body: `
<p style="margin:0 0 8px;font-size:15px;color:${TEXT};line-height:1.7;">
  Halo <strong>${esc(d.adminName)}</strong>,
</p>
<p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.7;">
  Berikut tagihan langganan Warga Jaga Warga untuk klaster
  <strong style="color:${TEXT};">${esc(d.communityName)}</strong>.
  Mohon diselesaikan sebelum <strong style="color:${TEXT};">${tanggal(d.dueAt)}</strong>
  agar layanan keamanan tetap berjalan.
</p>
${detailTable(d)}
${action}
<p style="margin:0;font-size:13px;color:${MUTED};line-height:1.7;">
  Pembayaran diperiksa oleh pengelola, biasanya dalam 1&times;24 jam kerja.
  Anda akan menerima email kuitansi setelah langganan diaktifkan.
</p>`,
  })

  const text = `Warga Jaga Warga — Tagihan langganan

Halo ${d.adminName},

Berikut tagihan langganan untuk klaster ${d.communityName}.
Mohon diselesaikan sebelum ${tanggal(d.dueAt)} agar layanan tetap berjalan.

  Klaster      : ${d.communityName}
  Paket        : ${planLabel(d.plan)}
  Jatuh tempo  : ${tanggal(d.dueAt)}
  No. tagihan  : ${d.invoiceNo}
  Total        : ${rupiah(d.amount)}

Cara pembayaran:
${d.bankInfo || 'Hubungi pengelola untuk informasi rekening.'}

Cantumkan ${d.invoiceNo} pada berita transfer.

Setelah transfer, tandai "Saya sudah bayar" di aplikasi pada halaman
Langganan, atau balas email ini dengan bukti transfer.

--
Warga Jaga Warga`

  return { subject, html, text }
}

/* ------------------------------------------------------------------ */
/* 2. Pengingat jatuh tempo                                            */
/* ------------------------------------------------------------------ */

export function reminderEmail(d: BillEmailData): RenderedEmail {
  const n = d.daysLeft ?? 0
  const mendesak = n <= 1
  const subject = mendesak
    ? `Terakhir: langganan ${d.communityName} berakhir besok`
    : `Pengingat: langganan ${d.communityName} berakhir ${n} hari lagi`

  const action = manualBox(
    d.bankInfo || 'Hubungi pengelola untuk informasi rekening.',
    d.invoiceNo,
  )

  const html = layout({
    preheader: `Sisa ${n} hari sebelum layanan ${d.communityName} terhenti.`,
    heading: mendesak ? 'Langganan berakhir besok' : `Berakhir ${n} hari lagi`,
    headingColor: mendesak ? '#b91c1c' : '#b45309',
    body: `
<p style="margin:0 0 8px;font-size:15px;color:${TEXT};line-height:1.7;">
  Halo <strong>${esc(d.adminName)}</strong>,
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${mendesak ? '#fef2f2' : '#fffbeb'};border:1px solid ${mendesak ? '#fecaca' : '#fde68a'};border-radius:10px;margin:0 0 20px;">
  <tr><td style="padding:14px 16px;font-size:14px;color:${mendesak ? '#991b1b' : '#92400e'};line-height:1.7;">
    Langganan klaster <strong>${esc(d.communityName)}</strong> berakhir pada
    <strong>${tanggal(d.dueAt)}</strong>. Setelah itu tombol darurat dan
    fitur lain akan dibatasi.
  </td></tr>
</table>
${detailTable(d)}
${action}`,
  })

  const text = `Warga Jaga Warga — ${subject}

Halo ${d.adminName},

Langganan klaster ${d.communityName} berakhir pada ${tanggal(d.dueAt)}.
Setelah itu tombol darurat dan fitur lain akan dibatasi.

  Paket        : ${planLabel(d.plan)}
  No. tagihan  : ${d.invoiceNo}
  Total        : ${rupiah(d.amount)}

Cara pembayaran:
${d.bankInfo || 'Hubungi pengelola untuk informasi rekening.'}
Cantumkan ${d.invoiceNo} pada berita transfer.

--
Warga Jaga Warga`

  return { subject, html, text }
}

/* ------------------------------------------------------------------ */
/* 3. Langganan berakhir                                               */
/* ------------------------------------------------------------------ */

export function expiredEmail(d: BillEmailData): RenderedEmail {
  const subject = `Langganan ${d.communityName} telah berakhir`

  const html = layout({
    preheader: `Perpanjang untuk mengaktifkan kembali layanan ${d.communityName}.`,
    heading: 'Langganan telah berakhir',
    headingColor: '#b91c1c',
    body: `
<p style="margin:0 0 8px;font-size:15px;color:${TEXT};line-height:1.7;">
  Halo <strong>${esc(d.adminName)}</strong>,
</p>
<p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.7;">
  Masa langganan klaster <strong style="color:${TEXT};">${esc(d.communityName)}</strong>
  berakhir pada ${tanggal(d.dueAt)}. Beberapa fitur kini dibatasi.
  Data warga Anda tetap tersimpan dan akan pulih setelah perpanjangan.
</p>
${detailTable(d)}
${manualBox(d.bankInfo || 'Hubungi pengelola untuk informasi rekening.', d.invoiceNo)}`,
  })

  const text = `Warga Jaga Warga — Langganan berakhir

Halo ${d.adminName},

Masa langganan klaster ${d.communityName} berakhir pada ${tanggal(d.dueAt)}.
Beberapa fitur kini dibatasi. Data warga tetap tersimpan dan akan pulih
setelah perpanjangan.

  Paket : ${planLabel(d.plan)}
  Total : ${rupiah(d.amount)}

Cara perpanjangan:
${d.bankInfo || 'Hubungi pengelola untuk informasi rekening.'}

--
Warga Jaga Warga`

  return { subject, html, text }
}

/* ------------------------------------------------------------------ */
/* 4. Pembayaran diterima                                              */
/* ------------------------------------------------------------------ */

export function paidEmail(
  d: BillEmailData & { activeUntil: number },
): RenderedEmail {
  const subject = `Pembayaran diterima — ${d.communityName}`

  const html = layout({
    preheader: `Langganan ${d.communityName} aktif sampai ${tanggal(d.activeUntil)}.`,
    heading: 'Pembayaran diterima',
    headingColor: '#15803d',
    body: `
<p style="margin:0 0 8px;font-size:15px;color:${TEXT};line-height:1.7;">
  Halo <strong>${esc(d.adminName)}</strong>,
</p>
<p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.7;">
  Terima kasih. Pembayaran untuk klaster
  <strong style="color:${TEXT};">${esc(d.communityName)}</strong> sudah kami terima
  dan langganan telah aktif kembali.
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin:0 0 20px;">
  <tr><td style="padding:16px;text-align:center;">
    <div style="font-size:12px;color:#166534;margin-bottom:4px;">Aktif sampai</div>
    <div style="font-size:19px;font-weight:bold;color:#15803d;">${tanggal(d.activeUntil)}</div>
  </td></tr>
</table>
${detailTable(d)}
<p style="margin:0;font-size:13px;color:${MUTED};line-height:1.7;">
  Simpan email ini sebagai bukti pembayaran.
</p>`,
  })

  const text = `Warga Jaga Warga — Pembayaran diterima

Halo ${d.adminName},

Terima kasih. Pembayaran untuk klaster ${d.communityName} sudah diterima
dan langganan aktif kembali.

  Aktif sampai : ${tanggal(d.activeUntil)}
  Paket        : ${planLabel(d.plan)}
  No. tagihan  : ${d.invoiceNo}
  Total        : ${rupiah(d.amount)}

Simpan email ini sebagai bukti pembayaran.

--
Warga Jaga Warga`

  return { subject, html, text }
}
