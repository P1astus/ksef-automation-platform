'use client';

import { useState } from 'react';

export default function RunJobButton({ jobName }: { jobName: string }) {
    const [state, setState] = useState<'idle' | 'working' | 'queued' | 'error'>('idle');
    const [message, setMessage] = useState('');

    async function run() {
        setState('working');
        setMessage('');
        try {
            const response = await fetch('/api/jobs/run', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobName }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
            setState('queued');
            setMessage('Dodano do kolejki');
        } catch (error) {
            setState('error');
            setMessage(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button className="btn-primary" onClick={run} disabled={state === 'working'} style={{ padding: '7px 12px', fontSize: 12 }}>
                {state === 'working' ? 'Dodawanie…' : 'Uruchom teraz'}
            </button>
            {message && <span style={{ fontSize: 11.5, color: state === 'error' ? 'var(--error)' : 'var(--success)' }}>{message}</span>}
        </span>
    );
}
