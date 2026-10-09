interface ErrorBannerProps {
  /** The error text, or null when nothing is wrong. */
  message: string | null;
}

/**
 * The slot is always there so the keypad doesn't jump when an error appears. The alert itself
 * exists only while there is a message.
 */
export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div className="error-slot">
      {message === null ? null : (
        <p className="error-banner" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
