import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GestureGuide from './GestureGuide';

describe('GestureGuide', () => {
  it('moves focus into the modal and restores it after close', () => {
    const onClose = vi.fn();
    const { rerender } = render(<button type="button">Open guide</button>);
    const opener = screen.getByRole('button', { name: 'Open guide' });
    opener.focus();

    rerender(
      <>
        <button type="button">Open guide</button>
        <GestureGuide language="en" onClose={onClose} />
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Gesture Reference Guide' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close gesture guide' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<button type="button">Open guide</button>);
    expect(opener).toHaveFocus();
  });
});
