export function ActivityLed({ level = 0, connected = true }: { level?: number; connected?: boolean }) {
  const color = !connected ? "var(--color-bad)" : level > 0.02 ? "var(--color-good)" : "var(--color-line)";
  return (
    <span
      className="inline-block h-2 w-2 rounded-full transition-all"
      style={{
        background: color,
        boxShadow: connected && level > 0.02 ? `0 0 ${2 + level * 8}px var(--color-good)` : "none",
        opacity: connected ? 0.5 + Math.min(0.5, level) : 1,
      }}
    />
  );
}
