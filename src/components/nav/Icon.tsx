export default function Icon({ d, className = 'w-5 h-5', strokeWidth = 1.5 }: { d: string; className?: string; strokeWidth?: number }) {
  return (
    <svg className={`${className} flex-shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
    </svg>
  );
}
