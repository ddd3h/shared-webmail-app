'use client';

interface Props {
  typingUsers: { userId: string; name: string }[];
}

export default function TypingIndicator({ typingUsers }: Props) {
  if (typingUsers.length === 0) return null;

  const label =
    typingUsers.length === 1
      ? `${typingUsers[0].name} が入力中`
      : `${typingUsers.map(u => u.name).join(', ')} が入力中`;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-500">
      <span>{label}</span>
      <span className="flex gap-0.5">
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
      </span>
    </div>
  );
}
