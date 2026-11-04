// Shared digital readout. Geometry stays fixed as the transport advances.
const segments = [
  '3,1 13,1 15,3 13,5 3,5 1,3',
  '14,5 16,3 17,5 17,13 15,15 13,13',
  '15,17 17,19 17,27 16,29 14,27 13,19',
  '3,27 13,27 15,29 13,31 3,31 1,29',
  '1,17 3,19 3,27 1,29 0,27 0,19',
  '1,3 3,5 3,13 1,15 0,13 0,5',
  '3,14 13,14 15,16 13,18 3,18 1,16',
]
const digits: Record<string, string> = {
  '0': '012345', '1': '12', '2': '01346', '3': '01236', '4': '1256',
  '5': '02356', '6': '023456', '7': '012', '8': '0123456', '9': '012356',
}

export function SegmentDisplay({ value, className = '' }: { value: string; className?: string }) {
  let width = 0
  const glyphs = [...value].map((character, index) => {
    const x = width
    width += character === ':' ? 9 : character === '.' ? 6 : 22
    return (
      <g key={index} transform={`translate(${x} 0)`}>
        {character === ':' ? <><circle cx="3" cy="10" r="1.8" /><circle cx="3" cy="23" r="1.8" /></>
          : character === '.' ? <circle cx="2" cy="29" r="1.8" />
            : segments.map((points, segment) => (
              <polygon key={segment} points={points} opacity={digits[character]?.includes(String(segment)) ? 1 : 0.07} />
            ))}
      </g>
    )
  })
  return <span className={`segment-display ${className}`}>
    <span className="sr-only">{value}</span>
    <svg aria-hidden="true" width={width * .65} height="22" viewBox={`0 0 ${width} 33`} fill="currentColor">{glyphs}</svg>
  </span>
}
