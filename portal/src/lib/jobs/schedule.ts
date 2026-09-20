import { Cron } from 'croner';

// Pure schedule arithmetic: no database, no clock (callers pass `from`/`to`). This is where the timezone/DST policy lives.
//
// Declared DST policy for cron schedules (Europe/Warsaw in practice):
//   * A wall-clock time that does not exist (spring forward, 02:30 on 2026-03-29) runs ONCE, at the next valid time.
//   * A wall-clock time that occurs twice (fall back, 02:30 on 2026-10-25) runs ONCE, not twice.
// croner already behaves this way (pinned by tests). The occurrence key is the LOCAL wall-clock label, so even if a
// library change ever produced two instants for one label, the (job_name, occurrence_key) unique constraint would still
// admit only one. Interval schedules ('every N minutes') are UTC-based and unaffected by DST.

export type Schedule =
    | { kind: 'every'; minutes: number }
    | { kind: 'cron'; expr: string; timezone: string };

export interface Due {
    occurrenceKey: string;
    scheduledFor: Date;
}

const MAX_OCCURRENCES = 10_000; // a runaway window is a bug, not something to iterate through

export class InvalidScheduleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidScheduleError';
    }
}

/** 'YYYY-MM-DDTHH:mm' as the wall clock reads in `timezone`. */
export function wallClockKey(d: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function validateSchedule(schedule: Schedule): void {
    if (schedule.kind === 'every') {
        if (!Number.isInteger(schedule.minutes) || schedule.minutes < 1) {
            throw new InvalidScheduleError(`'every' needs a whole number of minutes >= 1, got ${schedule.minutes}`);
        }
        return;
    }
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timezone });
    } catch {
        throw new InvalidScheduleError(`unknown timezone '${schedule.timezone}'`);
    }
    try {
        new Cron(schedule.expr, { timezone: schedule.timezone, paused: true });
    } catch (err: any) {
        throw new InvalidScheduleError(`invalid cron '${schedule.expr}': ${err?.message ?? err}`);
    }
}

/** Every occurrence in (from, to], oldest first. `from` is exclusive so a boundary instant is never counted twice. */
export function dueBetween(schedule: Schedule, from: Date, to: Date): Due[] {
    validateSchedule(schedule);
    if (to.getTime() <= from.getTime()) return [];
    const out: Due[] = [];

    if (schedule.kind === 'every') {
        const step = schedule.minutes * 60_000;
        for (let t = (Math.floor(from.getTime() / step) + 1) * step; t <= to.getTime(); t += step) {
            if (out.length >= MAX_OCCURRENCES) throw new InvalidScheduleError('window produced too many occurrences');
            const scheduledFor = new Date(t);
            out.push({ occurrenceKey: `every:${scheduledFor.toISOString()}`, scheduledFor });
        }
        return out;
    }

    const cron = new Cron(schedule.expr, { timezone: schedule.timezone });
    const seen = new Set<string>();
    let cursor: Date | null = cron.nextRun(from);
    while (cursor && cursor.getTime() <= to.getTime()) {
        if (out.length >= MAX_OCCURRENCES) throw new InvalidScheduleError('window produced too many occurrences');
        const key = `cron:${wallClockKey(cursor, schedule.timezone)}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push({ occurrenceKey: key, scheduledFor: cursor });
        }
        cursor = cron.nextRun(cursor);
    }
    return out;
}

/** Catch-up policy: after downtime run the MOST RECENT missed occurrence once, never a storm of every missed one. */
export function latestDue(schedule: Schedule, from: Date, to: Date): Due | null {
    const all = dueBetween(schedule, from, to);
    return all.length ? all[all.length - 1] : null;
}
