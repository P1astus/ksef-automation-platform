export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const [{ capabilities }, { checkMailTransportOperationally }] = await Promise.all([
        import('@/lib/deployment'),
        import('@/lib/mail-transport'),
    ]);
    if (capabilities().accessProvider === 'licence') {
        const { assertLicenceStartup, refreshLicenceStates } = await import('@/lib/licence');
        await assertLicenceStartup();
        await refreshLicenceStates();
        const timer = setInterval(() => { refreshLicenceStates().catch(error => console.error('Licence refresh failed:', error)); }, 60_000);
        timer.unref();
    }
    if (capabilities().emailTransport !== 'smtp') return;

    try {
        await checkMailTransportOperationally();
    } catch (error) {
        // The probe records its failure in system_health. Keep the portal up
        // so an administrator can correct SMTP or use recover-admin.mjs.
        console.error('SMTP operational check failed:', error);
    }
}
