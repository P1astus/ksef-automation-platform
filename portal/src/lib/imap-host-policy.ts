import dns from 'dns/promises';
import { BlockList, isIP } from 'net';
import { capabilities } from './deployment';

// Where a firm's IMAP settings may point. The portal opens a TCP connection to
// that host, so without a policy a firm admin could aim it at the platform's
// own services (database, sidecar, n8n) or any other internal address, and use
// the result as a port scanner.
//
// Hosted: public addresses only, IMAP ports only.
// Local (the firm's own install): a mail server on the office LAN is legitimate,
// so private ranges are allowed, but loopback, link-local/metadata, unspecified
// and multicast addresses and bare service names (ksef_db, xades-sidecar, ...)
// are not.
//
// Every address the name resolves to must pass, and callers connect to the
// returned address (keeping the name only for TLS), so a DNS answer cannot
// change between the check and the connection.

export class ImapHostNotAllowedError extends Error {
    constructor(message = 'Ten serwer IMAP nie jest dozwolony. Podaj publiczny adres serwera poczty.') {
        super(message);
        this.name = 'ImapHostNotAllowedError';
    }
}

const HOSTED_PORTS = new Set([143, 993]);

const neverAllowed = new BlockList();
neverAllowed.addSubnet('0.0.0.0', 8, 'ipv4');
neverAllowed.addSubnet('127.0.0.0', 8, 'ipv4');
neverAllowed.addSubnet('169.254.0.0', 16, 'ipv4');
neverAllowed.addSubnet('224.0.0.0', 3, 'ipv4');
neverAllowed.addAddress('::', 'ipv6');
neverAllowed.addAddress('::1', 'ipv6');
neverAllowed.addSubnet('fe80::', 10, 'ipv6');
neverAllowed.addSubnet('ff00::', 8, 'ipv6');

const nonPublic = new BlockList();
nonPublic.addSubnet('10.0.0.0', 8, 'ipv4');
nonPublic.addSubnet('100.64.0.0', 10, 'ipv4');
nonPublic.addSubnet('172.16.0.0', 12, 'ipv4');
nonPublic.addSubnet('192.0.0.0', 24, 'ipv4');
nonPublic.addSubnet('192.168.0.0', 16, 'ipv4');
nonPublic.addSubnet('198.18.0.0', 15, 'ipv4');
nonPublic.addSubnet('fc00::', 7, 'ipv6');
nonPublic.addSubnet('64:ff9b::', 96, 'ipv6');

function family(address: string): 'ipv4' | 'ipv6' {
    return isIP(address) === 6 ? 'ipv6' : 'ipv4';
}

function addressAllowed(raw: string, local: boolean): boolean {
    // An IPv4-mapped IPv6 address (::ffff:10.0.0.1) is judged as the IPv4 it wraps.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
    const address = mapped ? mapped[1] : raw;
    const f = family(address);
    if (neverAllowed.check(address, f)) return false;
    return local || !nonPublic.check(address, f);
}

export async function resolveImapTarget(hostInput: string, port: number): Promise<{ address: string; servername: string }> {
    const host = String(hostInput ?? '').trim().replace(/^\[|\]$/g, '').toLowerCase();
    const local = capabilities().mode === 'local';
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new ImapHostNotAllowedError();
    if (!local && !HOSTED_PORTS.has(port)) {
        throw new ImapHostNotAllowedError('Dozwolone porty serwera IMAP to 993 (TLS) i 143.');
    }
    // A bare name (no dot) is a container/service or intranet alias, never a
    // mail provider: refused in both editions.
    if (!isIP(host) && (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost'))) {
        throw new ImapHostNotAllowedError();
    }
    let results: { address: string }[];
    try {
        results = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
        throw new ImapHostNotAllowedError('Nie można odnaleźć serwera IMAP o tej nazwie.');
    }
    if (results.length === 0 || !results.every(r => addressAllowed(r.address, local))) {
        throw new ImapHostNotAllowedError();
    }
    return { address: results[0].address, servername: host };
}
