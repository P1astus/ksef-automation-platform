export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const [{ capabilities }, { checkMailTransportOperationally }] = await Promise.all([
        import('@/lib/deployment'),
        import('@/lib/mail-transport'),
    ]);
    if (capabilities().emailTransport !== 'smtp') return;

    try {
        await checkMailTransportOperationally();
    } catch (error) {
        // The probe records its failure in system_health. Keep the portal up
        // so an administrator can correct SMTP or use recover-admin.mjs.
        console.error('SMTP operational check failed:', error);
    }
}
