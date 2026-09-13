import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout';

vi.mock('../contexts/AppContext', () => ({
  useApp: () => ({
    accessibility: { highContrast: false, textSize: 'normal', audioEnabled: true },
    setAccessibility: vi.fn(),
    modelReady: true,
    modelLoading: false,
  }),
}));

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

describe('Layout mobile navigation', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
  });

  it('keeps the closed drawer inert and restores menu focus after closing it', () => {
    render(<Layout><h1>Page content</h1></Layout>);

    const menu = screen.getByRole('button', { name: 'Open navigation' });
    const drawer = document.querySelector('aside');
    expect(drawer).toHaveAttribute('inert');

    fireEvent.click(menu);
    const close = screen.getByRole('button', { name: 'Close navigation' });
    expect(close).toHaveFocus();
    expect(drawer).not.toHaveAttribute('inert');

    fireEvent.click(close);
    expect(menu).toHaveFocus();
    expect(drawer).toHaveAttribute('inert');
  });
});
