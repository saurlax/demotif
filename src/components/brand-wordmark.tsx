import { brandGeometry } from './brand-geometry'

export function BrandWordmark() {
  return (
    <svg
      role="img"
      aria-label="Demotif"
      focusable="false"
      viewBox={brandGeometry.viewBox}
      width={(brandGeometry.width / brandGeometry.height) * 18}
      height={18}
      className="h-[18px]! w-auto! shrink-0"
      fill="currentColor"
    >
      <path d={brandGeometry.path} />
    </svg>
  )
}
