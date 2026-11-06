import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RecoveryPage } from './AuthPage';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: useAuthMock }));

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe('account recovery', () => {
  it('handles provider failures without exposing raw details and allows retry', async () => {
    const sendRecovery = vi.fn()
      .mockRejectedValueOnce(new Error('provider-internal-detail'))
      .mockResolvedValueOnce({ error: null });
    useAuthMock.mockReturnValue({
      configured: true,
      passwordRecovery: false,
      sendRecovery,
      updatePassword: vi.fn(),
    });
    const user = userEvent.setup();
    render(<MemoryRouter><RecoveryPage /></MemoryRouter>);

    const button = screen.getByRole('button', { name: /send recovery link/i });
    await user.type(screen.getByLabelText('Email address'), 'casey@example.invalid');
    await user.click(button);
    expect(await screen.findByRole('status')).toHaveTextContent('Account recovery is temporarily unavailable.');
    expect(screen.getByRole('status')).not.toHaveTextContent('provider-internal-detail');
    expect(button).toBeEnabled();

    await user.click(button);
    expect(await screen.findByText('If the address is registered, a secure recovery link will arrive shortly.')).toBeInTheDocument();
    expect(sendRecovery).toHaveBeenCalledTimes(2);
  });

  it('disables recovery submission while the request is pending', async () => {
    let finishRecovery!: (result: { error: null }) => void;
    const sendRecovery = vi.fn(() => new Promise<{ error: null }>((resolve) => { finishRecovery = resolve; }));
    useAuthMock.mockReturnValue({
      configured: true,
      passwordRecovery: false,
      sendRecovery,
      updatePassword: vi.fn(),
    });
    const user = userEvent.setup();
    render(<MemoryRouter><RecoveryPage /></MemoryRouter>);

    const button = screen.getByRole('button', { name: /send recovery link/i });
    await user.type(screen.getByLabelText('Email address'), 'casey@example.invalid');
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(sendRecovery).toHaveBeenCalledTimes(1);

    await act(async () => { finishRecovery({ error: null }); });
    expect(await screen.findByText('If the address is registered, a secure recovery link will arrive shortly.')).toBeInTheDocument();
  });
});