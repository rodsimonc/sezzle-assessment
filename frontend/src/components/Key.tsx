import type { KeyVariant } from '../calculator/keypadLayout';

interface KeyProps {
  /** Accessible name. Screen readers say this instead of the glyph. */
  name: string;
  /** What the key shows. */
  label: string;
  variant: KeyVariant;
  onPress: () => void;
}

export function Key({ name, label, variant, onPress }: KeyProps) {
  return (
    <button
      type="button"
      className={`key key--${variant}`}
      // A digit's label is already its name, so only glyph keys need the override.
      aria-label={name === label ? undefined : name}
      onClick={onPress}
    >
      {label}
    </button>
  );
}
