// A small red number (99+ when large) for a menu entry; nothing when there is nothing to tell.
export default function CountBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span data-testid="notification-badge" className={`inline-flex min-w-[1.125rem] h-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
