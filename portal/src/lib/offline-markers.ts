// The two offline24 rules that used to live in n8n Code nodes (workflow 05) and, for the ladder, were copied into
// api/notify/offline24/route.ts. One definition each, used by the job and by the client-notification route.
//
// Highest-stakes path in the system: a wrong tier is a missed warning, a wrong JPK marker is a wrong filed report.

export type OfflineUrgency = 'overdue' | 'urgent_1h' | 'urgent_4h' | 'ok';

export interface UrgencyReading {
    urgency: OfflineUrgency;
    diffMs: number;
    /** Whole minutes, rounded like the workflow did (may be negative when overdue). */
    minutesRemaining: number;
    label: string;
}

/**
 * The urgency ladder: overdue (<= 0), urgent_1h (< 1 h), urgent_4h (< 4 h), else ok. Thresholds and label texts are
 * the ones workflow 05's "Calculate Time Remaining" node used. `nowMs` is a parameter so callers control the clock.
 */
export function offlineUrgency(deadline: Date | string, nowMs: number): UrgencyReading {
    const diffMs = new Date(deadline).getTime() - nowMs;
    const diffHours = diffMs / (1000 * 60 * 60);
    const minutesRemaining = Math.round(diffMs / (1000 * 60));
    const hours = Math.round(diffHours * 10) / 10;
    if (diffMs <= 0) return { urgency: 'overdue', diffMs, minutesRemaining, label: `OVERDUE by ${Math.abs(minutesRemaining)} minutes` };
    if (diffHours < 1) return { urgency: 'urgent_1h', diffMs, minutesRemaining, label: `${minutesRemaining} minutes remaining` };
    if (diffHours < 4) return { urgency: 'urgent_4h', diffMs, minutesRemaining, label: `${hours} hours remaining` };
    return { urgency: 'ok', diffMs, minutesRemaining, label: `${hours} hours remaining - safe` };
}

export type OfflineJpkMarker = 'OFF' | 'BFK';

/**
 * The JPK marker for an offline invoice that has now been found in KSeF: uploaded after its deadline = BFK (needs a
 * correction), otherwise OFF. The job computes the same rule in SQL (`<deadline>::timestamptz < NOW()`) so the comparison happens on the
 * DATABASE clock with real timestamptz semantics; a test pins the two together. The explicit cast is load-bearing
 * (round 11: comparing a `T`-formatted ISO string with `NOW()::text` marked every same-day-overdue invoice OFF).
 */
export function offlineMarker(deadline: Date | string, nowMs: number): OfflineJpkMarker {
    return new Date(deadline).getTime() < nowMs ? 'BFK' : 'OFF';
}
