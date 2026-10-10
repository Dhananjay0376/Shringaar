import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { copyText } from '@/lib/clipboard'
import { downloadDataUrl, qrFileName, qrPngDataUrl, qrSvg } from '@/lib/qr'

/**
 * QR code dialog.
 *
 * A QR always encodes the absolute public URL, so a code printed today keeps resolving after the
 * dashboard is redeployed. The SVG is generated for display and a PNG is generated on demand for
 * download — a scan target should be a raster file at a sensible resolution for print.
 */

export interface QrShareRow {
  label: string
  value: string
  /** Shown as a link when present. */
  href?: string
}

export interface QrDialogProps {
  open: boolean
  onClose: () => void
  title: string
  url: string
  fileName: string
  description?: string
  extraRows?: QrShareRow[]
}

export function QrDialog({
  open,
  onClose,
  title,
  url,
  fileName,
  description,
  extraRows = [],
}: QrDialogProps) {
  const toast = useToast()
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!open) return

    let active = true
    setSvg(null)
    setFailed(false)

    qrSvg(url)
      .then((markup) => {
        if (active) setSvg(markup)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
    }
  }, [open, url])

  async function handleCopy() {
    const copied = await copyText(url)
    if (copied) {
      toast.success('Link copied to clipboard.')
    } else {
      toast.error('The browser blocked clipboard access. Select the link and copy it manually.')
    }
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      const dataUrl = await qrPngDataUrl(url)
      downloadDataUrl(dataUrl, qrFileName(fileName))
      toast.success('QR code downloaded as a PNG.')
    } catch {
      toast.error('The QR code could not be generated. Try again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" icon="copy" onClick={handleCopy}>
            Copy link
          </Button>
          <Button variant="primary" icon="download" loading={downloading} onClick={handleDownload}>
            Download PNG
          </Button>
        </>
      }
    >
      <div className="qr-layout">
        {failed ? (
          <div className="callout callout--warning">
            <span className="callout__icon">
              <Icon name="alert" size={15} />
            </span>
            <span>
              The QR code could not be generated in this browser. The link below still works — copy
              it and generate a code from any QR tool.
            </span>
          </div>
        ) : svg ? (
          // Generated locally by the QR library from a URL we construct: vector geometry only, no
          // user-authored markup.
          <div className="qr-frame" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="qr-frame qr-frame--loading">Generating code…</div>
        )}

        <div className="qr-url">
          <Icon name="link" size={14} />
          <span className="qr-url__text mono" title={url}>
            {url}
          </span>
        </div>

        {extraRows.length > 0 ? (
          <div className="share-list">
            {extraRows.map((row) => (
              <div className="share-row" key={row.label}>
                <span className="share-row__label">{row.label}</span>
                {row.href ? (
                  <a
                    className="share-row__value"
                    href={row.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={row.value}
                  >
                    {row.value}
                  </a>
                ) : (
                  <span className="share-row__value mono" title={row.value}>
                    {row.value}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
