/**
 * Inline SVG icon set.
 *
 * Deliberately dependency-free: a 44-icon set is a few kilobytes of path data, and an icon package
 * would add a build dependency plus a styling system to fight. All icons are 24×24, stroke-based,
 * and inherit `currentColor`.
 *
 * Icons are decorative by default (`aria-hidden`). When an icon is the only content of a control,
 * the control itself must carry an `aria-label` — see design.md §8.
 */

import type { SVGProps } from 'react'

export type IconName =
  | 'grid'
  | 'box'
  | 'package'
  | 'plusCircle'
  | 'store'
  | 'chart'
  | 'settings'
  | 'qr'
  | 'copy'
  | 'search'
  | 'trash'
  | 'pencil'
  | 'upload'
  | 'download'
  | 'image'
  | 'external'
  | 'whatsapp'
  | 'logout'
  | 'menu'
  | 'x'
  | 'check'
  | 'alert'
  | 'info'
  | 'link'
  | 'chevronDown'
  | 'chevronRight'
  | 'arrowUp'
  | 'arrowDown'
  | 'sparkle'
  | 'eye'
  | 'clock'
  | 'tag'
  | 'gridView'
  | 'listView'
  | 'user'
  | 'shield'
  | 'refresh'
  | 'mail'
  | 'phone'
  | 'globe'
  | 'moreVertical'
  | 'camera'
  | 'lock'
  | 'filter'
  | 'trendUp'

const PATHS: Record<IconName, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  box: (
    <>
      <path d="M20.5 8.2v7.6a2 2 0 0 1-1 1.74l-6.5 3.7a2 2 0 0 1-2 0l-6.5-3.7a2 2 0 0 1-1-1.74V8.2a2 2 0 0 1 1-1.74l6.5-3.7a2 2 0 0 1 2 0l6.5 3.7a2 2 0 0 1 1 1.74Z" />
      <path d="M3.8 7.2 12 11.9l8.2-4.7" />
      <path d="M12 21.4v-9.5" />
    </>
  ),
  package: (
    <>
      <path d="M20 8v9.3a1.8 1.8 0 0 1-.95 1.6l-6.2 3.3a1.8 1.8 0 0 1-1.7 0l-6.2-3.3A1.8 1.8 0 0 1 4 17.3V8" />
      <path d="M4 8l8 4.3L20 8" />
      <path d="M12 12.3V21" />
      <path d="M4.6 6.3l7-3.7a1.8 1.8 0 0 1 1.7 0l7.1 3.7" />
    </>
  ),
  plusCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.2v7.6M8.2 12h7.6" />
    </>
  ),
  store: (
    <>
      <path d="M3.4 9.2 4.8 4.4A1 1 0 0 1 5.8 3.7h12.4a1 1 0 0 1 1 .7l1.4 4.8" />
      <path d="M4.3 9.2V20a1 1 0 0 0 1 1h13.4a1 1 0 0 0 1-1V9.2" />
      <path d="M3 9.2h18" />
      <path d="M9.6 21v-5.6h4.8V21" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V11" />
      <path d="M10 20V4.5" />
      <path d="M16 20v-6" />
      <path d="M21.5 20H2.5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8.5M17.5 7H20" />
      <path d="M4 17h2.5M11.5 17H20" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.4" />
      <rect x="14" y="3" width="7" height="7" rx="1.4" />
      <rect x="3" y="14" width="7" height="7" rx="1.4" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M20 20v.01M17 17h.01M17 20h.01M20 17h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20.5 20.5 16 16" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.8h5V7" />
      <path d="M6.5 7l.9 13.2a1 1 0 0 0 1 .8h7.2a1 1 0 0 0 1-.8L17.5 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4.2L20 8.2 15.8 4 4 15.8Z" />
      <path d="M14.2 5.6 18.4 9.8" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16.5V4" />
      <path d="M7.2 8.8 12 4l4.8 4.8" />
      <path d="M4 20h16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12.5" />
      <path d="M7.2 11.7 12 16.5l4.8-4.8" />
      <path d="M4 20h16" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.2" />
      <circle cx="8.6" cy="9.6" r="1.6" />
      <path d="M4 17.5 9.2 13l3.6 3.2 2.8-2.6L20 17.6" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14v5.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 19.2V8.8A1.8 1.8 0 0 1 5.8 7H11" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M20.5 11.7a8.4 8.4 0 0 1-12.5 7.3L3.5 20.5l1.5-4.4a8.4 8.4 0 1 1 15.5-4.4Z" />
      <path d="M8.8 8.6c0 3.4 2.6 6 6 6l1.1-1.7 1.8.9-.6 1.8c-4.4.6-8.6-3.6-8-8l1.8-.6.9 1.8Z" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 5H5.8A1.8 1.8 0 0 0 4 6.8v10.4A1.8 1.8 0 0 0 5.8 19h3.7" />
      <path d="M15 8.2 18.8 12 15 15.8" />
      <path d="M18.8 12H9" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  x: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
  check: (
    <>
      <path d="M5 12.8 9.2 17 19 7" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.6 21 19.4H3Z" />
      <path d="M12 9.6v4.2" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <path d="M12 7.6h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a4 4 0 0 1 0-5.7l2.2-2.2a4 4 0 0 1 5.7 5.7l-1.1 1.1" />
      <path d="M13.8 10.2a4 4 0 0 1 0 5.7l-2.2 2.2a4 4 0 0 1-5.7-5.7l1.1-1.1" />
    </>
  ),
  chevronDown: (
    <>
      <path d="M6 9.5 12 15.5 18 9.5" />
    </>
  ),
  chevronRight: (
    <>
      <path d="M9.5 6 15.5 12 9.5 18" />
    </>
  ),
  arrowUp: (
    <>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.2l1.9 5.4 5.4 1.9-5.4 1.9L12 17.8l-1.9-5.4L4.7 10.5l5.4-1.9Z" />
      <path d="M18.5 16.6l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.9 12 5.9 21.5 12 21.5 12 18 18.1 12 18.1 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.6 2.1" />
    </>
  ),
  tag: (
    <>
      <path d="M20.3 12.6 12.9 20a1.8 1.8 0 0 1-2.5 0L3.6 13.2V3.7h9.5l7.2 7.2a1.2 1.2 0 0 1 0 1.7Z" />
      <path d="M7.6 7.6h.01" />
    </>
  ),
  gridView: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
    </>
  ),
  listView: (
    <>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.4" r="3.7" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2l7 2.8v5.6c0 4.4-2.9 7.4-7 9-4.1-1.6-7-4.6-7-9V6Z" />
      <path d="M9.2 12.2 11.4 14.4 15 10.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.4 12a8.4 8.4 0 1 1-2.5-6" />
      <path d="M20.6 4.4v5.2h-5.2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <path d="M3.8 7.2 12 12.8l8.2-5.6" />
    </>
  ),
  phone: (
    <>
      <path d="M6.2 3.5h3l1.5 4-2 1.4a11.5 11.5 0 0 0 5.4 5.4l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A15.4 15.4 0 0 1 4.2 5.7a2 2 0 0 1 2-2.2Z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 12h17.6" />
      <path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18Z" />
    </>
  ),
  moreVertical: (
    <>
      <path d="M12 5.6h.01M12 12h.01M12 18.4h.01" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.4h2.9l1.5-2h7.2l1.5 2H20v11H4Z" />
      <circle cx="12" cy="13.4" r="3.4" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.2" width="15" height="10.3" rx="2.2" />
      <path d="M8.2 10.2V7.4a3.8 3.8 0 0 1 7.6 0v2.8" />
    </>
  ),
  filter: (
    <>
      <path d="M4 5.5h16l-6.2 7.2v5.6l-3.6 1.8v-7.4Z" />
    </>
  ),
  trendUp: (
    <>
      <path d="M3.5 17.2 9.4 11.3l4 4 7.1-7.1" />
      <path d="M15.4 8.2h5.1v5.1" />
    </>
  ),
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  /** Set when the icon conveys meaning on its own; otherwise the icon stays decorative. */
  title?: string
}

export function Icon({ name, size = 18, title, ...rest }: IconProps) {
  const labelled = Boolean(title)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      focusable="false"
      style={{ flexShrink: 0 }}
      {...rest}
    >
      {labelled ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  )
}
