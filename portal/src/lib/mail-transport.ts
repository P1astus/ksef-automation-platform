import { readFile } from 'node:fs/promises';
import { query } from '@/lib/db';
import { capabilities, type EmailTransport } from '@/lib/deployment';

// @ts-expect-error -- nodemailer does not publish TypeScript declarations.
import nodemailer from 'nodemailer';

type NodemailerTransport = {
    sendMail(message: Record<string, unknown>): Promise<unknown>;
};

const typedNodemailer = nodemailer as {
    createTransport(options: Record<string, unknown>): NodemailerTransport;
};

const RESEND_API = 'https://api.resend.com/emails';

export type MailAttachment = {
    filename: string;
    content?: Buffer | string;
    path?: string;
    contentType?: string;
};

export type MailMessage = {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: MailAttachment[];
};

export class MailTransportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MailTransportError';
    }
}

function selectedTransport(): EmailTransport {
    return capabilities().emailTransport;
}

function requireLocalAppUrl() {
    if (capabilities().mode === 'local' && !process.env.NEXT_PUBLIC_APP_URL?.trim()) {
        throw new MailTransportError('NEXT_PUBLIC_APP_URL is required for local email delivery');
    }
}

export function assertMailTransportConfigured(): void {
    requireLocalAppUrl();
    const transport = selectedTransport();
    if (transport === 'none') {
        throw new MailTransportError('Email transport is disabled (EMAIL_TRANSPORT=none)');
    }
    if (transport === 'smtp') {
        smtpConfig();
        return;
    }
    if (!process.env.RESEND_API_KEY) {
        throw new MailTransportError('RESEND_API_KEY is not configured');
    }
}

function smtpPort(): number {
    const port = Number(process.env.SMTP_PORT || '587');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new MailTransportError('SMTP_PORT must be a valid TCP port');
    }
    return port;
}

function smtpConfig() {
    const host = process.env.SMTP_HOST?.trim();
    const from = process.env.SMTP_FROM_EMAIL?.trim();
    const checkTo = process.env.SMTP_CHECK_TO?.trim();
    if (!host) throw new MailTransportError('SMTP_HOST is not configured');
    if (!from) throw new MailTransportError('SMTP_FROM_EMAIL is not configured');
    if (!checkTo) throw new MailTransportError('SMTP_CHECK_TO is not configured');

    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASSWORD;
    if (Boolean(user) !== Boolean(pass)) {
        throw new MailTransportError('SMTP_USER and SMTP_PASSWORD must be configured together');
    }

    const port = smtpPort();
    return {
        host,
        port,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
        from,
        checkTo,
        auth: user && pass ? { user, pass } : undefined,
    };
}

let smtpClient: NodemailerTransport | undefined;
let smtpProbe: Promise<void> | undefined;

function getSmtpClient(): NodemailerTransport {
    if (smtpClient) return smtpClient;
    const config = smtpConfig();
    smtpClient = typedNodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.auth && { auth: config.auth }),
    });
    return smtpClient;
}

async function recordSmtpHealth(status: 'ok' | 'error', details: Record<string, unknown>) {
    try {
        await query(
            `INSERT INTO system_health (check_type, status, details, checked_at)
             VALUES ($1, $2, $3::jsonb, NOW())`,
            ['smtp', status, JSON.stringify(details)]
        );
    } catch (error) {
        console.error('Failed to record SMTP health:', error);
    }
}

async function runSmtpProbe(): Promise<void> {
    let host = process.env.SMTP_HOST?.trim() || null;
    try {
        const config = smtpConfig();
        host = config.host;
        await getSmtpClient().sendMail({
            from: config.from,
            to: config.checkTo,
            subject: '[KSeF Auto] Test SMTP',
            text: 'Konfiguracja SMTP KSeF Auto działa poprawnie.',
            html: '<p>Konfiguracja SMTP KSeF Auto działa poprawnie.</p>',
        });
        await recordSmtpHealth('ok', { phase: 'first-run-probe', host });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordSmtpHealth('error', { phase: 'first-run-probe', host, error: message });
        throw error;
    }
}

export async function checkMailTransportOperationally(): Promise<void> {
    if (selectedTransport() !== 'smtp') return;
    smtpProbe ||= (async () => {
        const previous = await query(
            `SELECT 1 FROM system_health
             WHERE check_type = 'smtp' AND status = 'ok'
               AND details->>'phase' = 'first-run-probe'
             LIMIT 1`
        );
        if (previous.rows.length > 0) return;
        await runSmtpProbe();
    })();
    await smtpProbe;
}

async function sendSmtp(message: MailMessage) {
    const config = smtpConfig();
    await checkMailTransportOperationally();
    try {
        await getSmtpClient().sendMail({ from: config.from, ...message });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await recordSmtpHealth('error', { phase: 'delivery', host: config.host, error: errorMessage });
        throw error;
    }
}

async function resendAttachments(attachments: MailAttachment[] | undefined) {
    if (!attachments?.length) return undefined;
    return Promise.all(attachments.map(async attachment => {
        const raw = attachment.content ?? (attachment.path ? await readFile(attachment.path) : undefined);
        if (raw === undefined) {
            throw new MailTransportError(`Attachment ${attachment.filename} has no content or path`);
        }
        return {
            filename: attachment.filename,
            content: Buffer.isBuffer(raw) ? raw.toString('base64') : Buffer.from(raw).toString('base64'),
            ...(attachment.contentType && { content_type: attachment.contentType }),
        };
    }));
}

async function sendResend(message: MailMessage) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new MailTransportError('RESEND_API_KEY is not configured');
    const response = await fetch(RESEND_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'KSeF Auto <noreply@ksef.auto>',
            ...message,
            attachments: await resendAttachments(message.attachments),
        }),
    });
    if (!response.ok) {
        throw new MailTransportError(`Resend rejected email with HTTP ${response.status}`);
    }
}

export async function sendMail(message: MailMessage): Promise<void> {
    assertMailTransportConfigured();
    const transport = selectedTransport();
    if (transport === 'smtp') return sendSmtp(message);
    return sendResend(message);
}
