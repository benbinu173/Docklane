import { toast } from 'sonner'

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value)
          const safe = /^[=+@-]/.test(text) && typeof value === 'string' ? `'${text}` : text
          return `"${safe.replaceAll('"', '""')}"`
        })
        .join(','),
    )
    .join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast.success('Export ready', { description: 'Your filtered sample data has been downloaded.' })
}
