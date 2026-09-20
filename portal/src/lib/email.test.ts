import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn());
vi.mock('./mail-transport', () => ({ sendMail }));

describe('email templates', () => {
    beforeEach(() => sendMail.mockReset().mockResolvedValue(undefined));

    it('sends password resets through the configured transport', async () => {
        const { sendPasswordReset } = await import('./email');

        await sendPasswordReset('owner@example.test', 'https://portal.example/reset-password/token');

        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'owner@example.test',
            subject: expect.stringMatching(/reset hasła/i),
            html: expect.stringContaining('https://portal.example/reset-password/token'),
        }));
    });

    it('sends team invitations through the configured transport', async () => {
        const { sendTeamInvite } = await import('./email');

        await sendTeamInvite('member@example.test', 'Biuro Test', 'https://portal.example/invite/accept?token=x');

        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'member@example.test',
            subject: expect.stringContaining('Biuro Test'),
            html: expect.stringContaining('https://portal.example/invite/accept?token=x'),
        }));
    });
});
