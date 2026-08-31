import type { LetterPdfData } from './community-hub.js'

/**
 * Pembuat PDF kecil tanpa layanan pihak ketiga.
 *
 * Surat diproduksi di server hanya setelah status APPROVED telah diverifikasi.
 * Font PDF bawaan Helvetica memakai WinAnsi, jadi karakter di luar Latin dasar
 * ditransliterasi secara konservatif agar nama/dokumen tidak membuat file rusak.
 */
function pdfText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function wrap(value: string, width = 78): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return ['-']
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function indoDate(epoch: number): string {
  const d = new Date(epoch)
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function object(n: number, body: string): string {
  return `${n} 0 obj\n${body}\nendobj\n`
}

/**
 * Buat PDF A4 satu halaman dengan kop surat, nomor, data pemohon, keperluan
 * dan blok tanda tangan pengurus. Tanda tangan ini adalah persetujuan digital
 * internal WJW, bukan sertifikat tanda tangan elektronik tersertifikasi.
 */
export function createLetterPdf(data: LetterPdfData): Buffer {
  let y = 790
  const lines: string[] = []
  const text = (value: string, size = 11, bold = false, x = 54, gap = 17) => {
    lines.push(`BT /F${bold ? 2 : 1} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`)
    y -= gap
  }
  const paragraph = (value: string, size = 11, indent = 54) => {
    for (const line of wrap(value)) text(line, size, false, indent, 16)
  }

  text(data.community.name.toUpperCase(), 17, true, 54, 22)
  text([data.community.address, data.community.city].filter(Boolean).join(' · ') || 'Indonesia', 10, false, 54, 18)
  lines.push(`0.2 w 54 ${y + 7} m 541 ${y + 7} l S`)
  y -= 20
  text(data.type.toUpperCase(), 15, true, 54, 24)
  text(`Nomor: ${data.number}`, 11, false, 54, 20)
  text(`Tanggal persetujuan: ${indoDate(data.approvedAt)}`, 10, false, 54, 24)

  paragraph('Yang bertanda tangan di bawah ini, pengurus lingkungan menerangkan bahwa:')
  y -= 5
  text(`Nama                 : ${data.resident.name}`, 11, false, 68, 18)
  text(`Alamat / No. Rumah  : ${data.resident.house || '-'}`, 11, false, 68, 22)
  paragraph(`Mengajukan ${data.type.toLowerCase()} untuk keperluan: ${data.purpose || '-'}.`)
  if (data.requestBody) paragraph(`Keterangan pemohon: ${data.requestBody}`)
  if (data.decisionNote) paragraph(`Catatan pengurus: ${data.decisionNote}`)
  y -= 12
  paragraph('Surat ini diterbitkan berdasarkan data yang diajukan warga dan persetujuan pengurus lingkungan melalui WJW.')
  y -= 30
  text(data.community.city || 'Indonesia', 11, false, 340, 18)
  text('Menyetujui,', 11, false, 340, 18)
  text(data.signer.title, 11, false, 340, 52)
  text(data.signer.name, 11, true, 340, 18)
  text('Persetujuan digital WJW', 8, false, 340, 15)
  lines.push(`BT /F1 7 Tf 54 35 Td (${pdfText(`WJW · ${data.number} · diterbitkan ${indoDate(data.approvedAt)}`)}) Tj ET`)

  const stream = lines.join('\n')
  const bodies = [
    object(1, '<< /Type /Catalog /Pages 2 0 R >>'),
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    object(
      3,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    ),
    object(4, `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`),
    object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    object(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'),
    object(7, `<< /Title (${pdfText(data.type)}) /Author (${pdfText(data.community.name)}) >>`),
  ]
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  let offset = Buffer.byteLength(header, 'binary')
  const offsets = [0]
  for (const body of bodies) {
    offsets.push(offset)
    offset += Buffer.byteLength(body, 'utf8')
  }
  const xref = offset
  const table = [
    'xref',
    `0 ${bodies.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${bodies.length + 1} /Root 1 0 R /Info 7 0 R >>`,
    'startxref',
    String(xref),
    '%%EOF',
    '',
  ].join('\n')
  return Buffer.concat([Buffer.from(header, 'binary'), Buffer.from(bodies.join(''), 'utf8'), Buffer.from(table, 'utf8')])
}
