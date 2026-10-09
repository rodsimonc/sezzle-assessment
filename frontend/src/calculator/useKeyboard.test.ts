import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyAction } from './types';
import { useKeyboard } from './useKeyboard';

function press(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function setup() {
  const onAction = vi.fn<(action: KeyAction) => void>();
  const hook = renderHook(() => {
    useKeyboard(onAction);
  });
  return { onAction, ...hook };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('useKeyboard', () => {
  it('turns a mapped key into an action and prevents the default', () => {
    const { onAction } = setup();

    const event = press({ key: '7' });

    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'digit', digit: '7' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops Enter from also clicking a focused button', () => {
    const { onAction } = setup();
    const button = document.createElement('button');
    document.body.append(button);

    const event = press({ key: 'Enter' }, button);

    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'equals' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves keys that mean nothing here alone', () => {
    const { onAction } = setup();

    const event = press({ key: 'Tab' });

    expect(onAction).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
  ])('passes %s chords through to the browser', (_name, modifier) => {
    const { onAction } = setup();

    const event = press({ key: 'r', ...modifier });
    const digit = press({ key: '5', ...modifier });

    expect(onAction).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(digit.defaultPrevented).toBe(false);
  });

  it('ignores keys pressed during text composition', () => {
    const { onAction } = setup();

    press({ key: '5', isComposing: true });

    expect(onAction).not.toHaveBeenCalled();
  });

  it('ignores an event that something else already handled', () => {
    const { onAction } = setup();
    const early = (event: Event): void => {
      event.preventDefault();
    };
    document.body.addEventListener('keydown', early);
    const target = document.createElement('div');
    document.body.append(target);

    press({ key: '5' }, target);

    expect(onAction).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', early);
  });

  it('leaves Enter to the focused control inside a data-native-enter region', () => {
    const { onAction } = setup();
    const region = document.createElement('div');
    region.dataset.nativeEnter = '';
    const button = document.createElement('button');
    region.append(button);
    document.body.append(region);

    const event = press({ key: 'Enter' }, button);

    expect(onAction).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('still handles other keys inside a data-native-enter region', () => {
    const { onAction } = setup();
    const region = document.createElement('div');
    region.dataset.nativeEnter = '';
    const button = document.createElement('button');
    region.append(button);
    document.body.append(region);

    press({ key: '4' }, button);

    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'digit', digit: '4' });
  });

  it('stops listening after unmount', () => {
    const { onAction, unmount } = setup();

    unmount();
    press({ key: '5' });

    expect(onAction).not.toHaveBeenCalled();
  });
});
