import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LanguageSelector from './LanguageSelector';

describe('LanguageSelector', () => {
  it('uses a labelled native select that reports the selected language', () => {
    const onChange = vi.fn();
    render(<LanguageSelector value="en" onChange={onChange} />);

    const select = screen.getByRole('combobox', { name: 'Output language' });
    fireEvent.change(select, { target: { value: 'el' } });

    expect(onChange).toHaveBeenCalledWith('el');
    expect(screen.getByRole('option', { name: /Ελληνικά/i })).toBeInTheDocument();
  });
});
