import { useEffect } from 'react';
import { actionForKey } from './keymap';
import type { KeyAction } from './types';

/**
 * A region marked `data-native-enter` (the history panel) keeps Enter's native job. Its toggle
 * and entries are real buttons that a keyboard user presses with Enter, so Equals must not
 * swallow the key there.
 */
function keepsNativeEnter(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-native-enter]') !== null;
}

/**
 * Sends physical key presses to `onAction`. Chords with ctrl, meta or alt belong to the
 * browser (Ctrl+R, Ctrl+C), so they pass through untouched. A handled key calls preventDefault,
 * so a focused keypad button doesn't also fire when Enter is pressed (release item 3.8).
 */
export function useKeyboard(onAction: (action: KeyAction) => void): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const action = actionForKey(event.key);
      if (!action) return;
      if (event.key === 'Enter' && keepsNativeEnter(event.target)) return;

      event.preventDefault();
      onAction(action);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onAction]);
}
