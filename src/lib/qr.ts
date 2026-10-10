/**
 * QR generation — the only module that knows about the QR library.
 *
 * A QR code always encodes an **absolute public URL**, so a printed code keeps working as long as
 * the store slug and product id stay stable. Swap the library here and every screen follows.
 */

import QRCode from 'qrcode'

const QR_COLOURS = {
  dark: '#1E1A15', // --ink, for scan contrast
  light: '#FFFFFF',
}

export interface QrOptions {
  /** Rendered size in pixels for the PNG export. Screen display scales the SVG with CSS. */
  size?: number
}

/**
 * Inline SVG markup for on-screen display.
 *
 * The output is generated locally by the QR library from a URL we construct ourselves and contains
 * only vector geometry — no user-authored markup — so it is safe to inject.
 */
export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: QR_COLOURS,
  })
}

/** PNG data URL, suitable for a download link or an `<img>` in a print sheet. */
export async function qrPngDataUrl(url: string, options: QrOptions = {}): Promise<string> {
  return QRCode.toDataURL(url, {
    type: 'image/png',
    width: options.size ?? 1024,
    margin: 3,
    errorCorrectionLevel: 'M',
    color: QR_COLOURS,
  })
}

/** Triggers a browser download for a data URL. Kept here so QR export has one entry point. */
export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement('a')

  link.href = dataUrl
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/** Filesystem-safe name for a QR export, e.g. `shringaar-qr-meena-jewels.png`. */
export function qrFileName(slug: string, prefix = 'shringaar-qr'): string {
  const safe = slug.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return `${prefix}-${safe || 'code'}.png`
}
