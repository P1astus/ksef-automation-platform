'use client';

import { GTU_CODES, PROCEDURE_CODES, GTU_LABELS, PROCEDURE_LABELS, type GtuCode, type ProcedureCode } from '@/lib/jpk-markers';

// Checkbox grid for the JPK_V7M(3) row markers. Controlled: the invoice form
// keeps the state itself, the preview page pairs it with a save button.
export default function JpkMarkersFields({
    gtu, procedures, onChange, disabled,
}: {
    gtu: GtuCode[];
    procedures: ProcedureCode[];
    onChange: (next: { gtu: GtuCode[]; procedures: ProcedureCode[] }) => void;
    disabled?: boolean;
}) {
    const toggle = <T extends string>(list: T[], code: T): T[] =>
        list.includes(code) ? list.filter(c => c !== code) : [...list, code];

    const group = <T extends string>(title: string, codes: readonly T[], labels: Record<T, string>, selected: T[], set: (next: T[]) => void) => (
        <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                {codes.map(code => (
                    <label key={code} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--text-muted)' }}>
                        <input
                            type="checkbox"
                            checked={selected.includes(code)}
                            disabled={disabled}
                            onChange={() => set(toggle(selected, code))}
                        />
                        <span><span className="mono" style={{ color: 'var(--text)' }}>{code}</span> - {labels[code]}</span>
                    </label>
                ))}
            </div>
        </div>
    );

    return (
        <div style={{ display: 'grid', gap: 16 }}>
            {group('Oznaczenia GTU', GTU_CODES, GTU_LABELS, gtu, next => onChange({ gtu: next, procedures }))}
            {group('Oznaczenia procedur', PROCEDURE_CODES, PROCEDURE_LABELS, procedures, next => onChange({ gtu, procedures: next }))}
        </div>
    );
}
