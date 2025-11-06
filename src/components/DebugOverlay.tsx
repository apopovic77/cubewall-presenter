interface DebugOverlayProps {
  lines: string[];
}

export function DebugOverlay({ lines }: DebugOverlayProps) {
  if (!lines.length) return null;

  return (
    <aside className="cw-debug">
      <header>
        <span>Debug</span>
      </header>
      <ul>
        {lines.map((line, index) => (
          <li key={`${index}-${line}`}>{line}</li>
        ))}
      </ul>
    </aside>
  );
}
