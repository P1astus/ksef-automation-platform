'use client';

import { useState, useEffect } from 'react';
import PlanErrorLink from '@/app/dashboard/PlanErrorLink';
import { interpretApiFailure } from '@/lib/plan-errors';
import { UserPlus, Trash2, Mail, Shield } from 'lucide-react';

interface Member {
    id: number;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
    created_at: string;
}

interface Invite {
    id: number;
    email: string;
    role: string;
    expires_at: string;
    created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
    admin: 'Administrator',
    member: 'Członek',
    readonly: 'Tylko podgląd',
};

const ROLE_COLORS: Record<string, string> = {
    admin: '#6366f1',
    member: '#22c55e',
    readonly: '#94a3b8',
};

export default function TeamPage() {
    const [members, setMembers] = useState<Member[]>([]);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('member');
    const [sending, setSending] = useState(false);
    const [inviteResult, setInviteResult] = useState('');
    const [invitePlanError, setInvitePlanError] = useState(false);

    async function load() {
        setLoading(true);
        try {
            const res = await fetch('/api/team');
            const data = await res.json();
            setMembers(Array.isArray(data.members) ? data.members : []);
            setInvites(Array.isArray(data.pendingInvites) ? data.pendingInvites : []);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    async function invite(e: React.FormEvent) {
        e.preventDefault();
        setSending(true);
        setInviteResult('');
        setInvitePlanError(false);
        try {
            const res = await fetch('/api/team', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, role }),
            });
            const data = await res.json();
            if (res.ok) {
                setInviteResult(
                    data.emailSent
                        ? `✓ Zaproszenie wysłane do ${email}`
                        : `✓ Zaproszenie utworzone, ale e-mail NIE został wysłany (poczta nie jest skonfigurowana). Przekaż link ręcznie: ${data.inviteUrl}`
                );
                setEmail('');
                load();
            } else {
                const failure = interpretApiFailure(res.status, data, 'Nie udało się wysłać zaproszenia');
                setInviteResult(`Błąd: ${failure.message}`);
                setInvitePlanError(failure.isPlanError);
            }
        } finally {
            setSending(false);
        }
    }

    async function removeMember(id: number) {
        if (!confirm('Usunąć użytkownika z zespołu?')) return;
        await fetch(`/api/team?memberId=${id}`, { method: 'DELETE' });
        load();
    }

    async function revokeInvite(id: number) {
        await fetch(`/api/team?inviteId=${id}`, { method: 'DELETE' });
        load();
    }

    return (
        <div style={{ maxWidth: 720 }}>
            <div style={{ marginBottom: 28, paddingTop: 28 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>Zespół</h1>
                <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>
                    Zarządzaj dostępem do konta biura rachunkowego
                </p>
            </div>

            {/* Invite form */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <UserPlus size={15} /> Zaproś nowego użytkownika
                </div>
                <form onSubmit={invite} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 220px' }}>
                        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="osoba@biuro.pl"
                            style={{ width: '100%' }}
                            required
                        />
                    </div>
                    <div style={{ flex: '0 0 160px' }}>
                        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Rola</label>
                        <select value={role} onChange={e => setRole(e.target.value)} style={{ width: '100%' }}>
                            <option value="admin">Administrator</option>
                            <option value="member">Członek</option>
                            <option value="readonly">Tylko podgląd</option>
                        </select>
                    </div>
                    <button type="submit" disabled={sending} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
                        {sending ? 'Wysyłanie…' : 'Wyślij zaproszenie'}
                    </button>
                </form>
                {inviteResult && (
                    <div style={{ marginTop: 10, fontSize: 13, color: inviteResult.startsWith('✓') ? '#22c55e' : '#ef4444' }}>
                        {inviteResult}<PlanErrorLink show={invitePlanError} />
                    </div>
                )}
            </div>

            {/* Members list */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
                    Aktywni użytkownicy ({members.length})
                </div>
                {loading ? (
                    <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Ładowanie…</div>
                ) : members.length === 0 ? (
                    <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Brak dodatkowych użytkowników</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {members.map(m => (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-base)', borderRadius: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                                        {(m.full_name || m.email)[0].toUpperCase()}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.full_name || m.email}</div>
                                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{m.email}</div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: ROLE_COLORS[m.role] || '#94a3b8', background: `${ROLE_COLORS[m.role] || '#94a3b8'}18`, padding: '2px 8px', borderRadius: 100 }}>
                                        {ROLE_LABELS[m.role] || m.role}
                                    </span>
                                    <button onClick={() => removeMember(m.id)} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Pending invites */}
            {invites.length > 0 && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
                        <Mail size={14} /> Oczekujące zaproszenia ({invites.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {invites.map(inv => (
                            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-base)', borderRadius: 8 }}>
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{inv.email}</div>
                                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                                        Rola: {ROLE_LABELS[inv.role] || inv.role} · Wygasa: {new Date(inv.expires_at).toLocaleDateString('pl-PL')}
                                    </div>
                                </div>
                                <button onClick={() => revokeInvite(inv.id)} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
