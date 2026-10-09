/** Shown only while memory holds a value other than zero. */
export function MemoryIndicator() {
  return (
    <span
      className="memory-indicator"
      data-testid="memory-indicator"
      role="img"
      aria-label="Memory in use"
    >
      M
    </span>
  );
}
