// bruv's wordmark and b, from site/assets/brand, drawn in currentColor so they follow light and dark.
const b = "M20 20H52V68H106L134 94V138L106 164H20Z M52 96V136H92L102 126V106L92 96Z";

export function Wordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="22 20 489 144" className={className} fill="currentColor" role="img" aria-label="bruv">
      <g transform="matrix(1 0 -.15 1 27 0)">
        <path fillRule="evenodd" d={b} />
        <path d="M154 68H186V81L199 68H236V100H210L186 124V164H154Z" />
        <path d="M254 68H286V124L294 132H314L322 124V68H354V138L328 164H280L254 138Z" />
        <path d="M374 68H410L434 124L458 68H494L450 164H418Z" />
      </g>
    </svg>
  );
}

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="22 20 125 144" className={className} fill="currentColor" aria-hidden="true">
      <g transform="matrix(1 0 -.15 1 27 0)">
        <path fillRule="evenodd" d={b} />
      </g>
    </svg>
  );
}
