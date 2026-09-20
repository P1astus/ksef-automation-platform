import { describe, it, expect } from 'vitest';
import { dueBetween, latestDue, wallClockKey, validateSchedule, InvalidScheduleError, type Schedule } from '../jobs/schedule';

const TZ = 'Europe/Warsaw';
const cron = (expr: string): Schedule => ({ kind: 'cron', expr, timezone: TZ });
const local = (d: Date) => wallClockKey(d, TZ);
const utc = (s: string) => new Date(s);

describe('wallClockKey', () => {
    it('is the LOCAL wall clock, whatever the process timezone', () => {
        expect(wallClockKey(utc('2026-09-05T06:00:00Z'), TZ)).toBe('2026-09-05T08:00'); // CEST, UTC+2
        expect(wallClockKey(utc('2026-11-05T07:00:00Z'), TZ)).toBe('2026-11-05T08:00'); // CET, UTC+1
        expect(wallClockKey(utc('2026-01-01T00:30:00Z'), TZ)).toBe('2026-01-01T01:30');
    });
    it('renders midnight as 00, not 24', () => {
        expect(wallClockKey(utc('2026-09-04T22:00:00Z'), TZ)).toBe('2026-09-05T00:00');
    });
});

describe('interval schedules are UTC-based', () => {
    const every15: Schedule = { kind: 'every', minutes: 15 };
    it('lists slots on the epoch grid in (from, to], oldest first', () => {
        const due = dueBetween(every15, utc('2026-09-21T10:00:00Z'), utc('2026-09-21T10:45:00Z'));
        expect(due.map(d => d.scheduledFor.toISOString())).toEqual(['2026-09-21T10:15:00.000Z', '2026-09-21T10:30:00.000Z', '2026-09-21T10:45:00.000Z']);
    });
    it('`from` is exclusive and `to` inclusive, so a boundary is never counted twice across adjacent windows', () => {
        const a = dueBetween(every15, utc('2026-09-21T09:45:00Z'), utc('2026-09-21T10:00:00Z'));
        const b = dueBetween(every15, utc('2026-09-21T10:00:00Z'), utc('2026-09-21T10:15:00Z'));
        expect(a.map(d => d.occurrenceKey)).toEqual(['every:2026-09-21T10:00:00.000Z']);
        expect(b.map(d => d.occurrenceKey)).toEqual(['every:2026-09-21T10:15:00.000Z']);
    });
    it('is unaffected by DST: 96 slots across the 23-hour spring-forward day and across the 25-hour fall-back day', () => {
        const day = (from: string, to: string) => dueBetween(every15, utc(from), utc(to)).length;
        expect(day('2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z')).toBe(92); // 23 h of wall clock
        expect(day('2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z')).toBe(100); // 25 h of wall clock
    });
    it('an empty or reversed window is empty', () => {
        expect(dueBetween(every15, utc('2026-09-21T10:00:00Z'), utc('2026-09-21T10:00:00Z'))).toEqual([]);
        expect(dueBetween(every15, utc('2026-09-21T11:00:00Z'), utc('2026-09-21T10:00:00Z'))).toEqual([]);
    });
});

describe('cron schedules are wall-clock in the declared timezone', () => {
    it("workflow 06's monthly JPK job (08:00 on the 5th, Warsaw) is 08:00 local in summer AND winter", () => {
        const due = dueBetween(cron('0 8 5 * *'), utc('2026-09-01T00:00:00Z'), utc('2026-12-31T00:00:00Z'));
        expect(due.map(d => local(d.scheduledFor))).toEqual(['2026-09-05T08:00', '2026-10-05T08:00', '2026-11-05T08:00', '2026-12-05T08:00']);
        expect(due[0].scheduledFor.toISOString()).toBe('2026-09-05T06:00:00.000Z'); // UTC+2
        expect(due[3].scheduledFor.toISOString()).toBe('2026-12-05T07:00:00.000Z'); // UTC+1
    });

    it("workflow 05's every-two-hours job stays on the Warsaw even hours", () => {
        const due = dueBetween(cron('0 */2 * * *'), utc('2026-09-21T08:00:00Z'), utc('2026-09-21T14:00:00Z'));
        expect(due.map(d => local(d.scheduledFor).slice(11))).toEqual(['12:00', '14:00', '16:00']);
    });

    it('`from` is exclusive: a boundary that is exactly a run time is not returned again', () => {
        const at8 = utc('2026-09-05T06:00:00Z');
        expect(dueBetween(cron('0 8 5 * *'), at8, utc('2026-09-06T00:00:00Z'))).toEqual([]);
        expect(dueBetween(cron('0 8 5 * *'), new Date(at8.getTime() - 1), at8).length).toBe(1);
    });

    describe('DST policy (pinned: a library upgrade must not silently change it)', () => {
        it('SPRING FORWARD: a time that does not exist (02:30 on 2026-03-29) runs ONCE, at the next valid time', () => {
            const due = dueBetween(cron('30 2 * * *'), utc('2026-03-27T12:00:00Z'), utc('2026-03-31T12:00:00Z'));
            expect(due.map(d => local(d.scheduledFor))).toEqual(['2026-03-28T02:30', '2026-03-29T03:30', '2026-03-30T02:30', '2026-03-31T02:30']);
        });

        it('FALL BACK: a time that occurs twice (02:30 on 2026-10-25) runs ONCE, not twice', () => {
            const due = dueBetween(cron('30 2 * * *'), utc('2026-10-23T12:00:00Z'), utc('2026-10-27T12:00:00Z'));
            const keys = due.map(d => d.occurrenceKey);
            expect(keys.filter(k => k === 'cron:2026-10-25T02:30').length).toBe(1);
            expect(new Set(keys).size).toBe(keys.length); // no duplicate occurrence keys anywhere
            expect(due.length).toBe(4);
        });

        it('FALL BACK, hourly: the repeated 02:00 hour never produces two occurrences with the same key', () => {
            const due = dueBetween(cron('0 * * * *'), utc('2026-10-24T22:30:00Z'), utc('2026-10-25T05:30:00Z'));
            const keys = due.map(d => d.occurrenceKey);
            expect(new Set(keys).size).toBe(keys.length);
            expect(keys).toContain('cron:2026-10-25T02:00');
        });
    });
});

describe('latestDue: catch-up after downtime runs the most recent occurrence once', () => {
    it('returns only the newest missed occurrence, not a storm', () => {
        const due = latestDue({ kind: 'every', minutes: 15 }, utc('2026-09-21T06:00:00Z'), utc('2026-09-21T10:20:00Z'));
        expect(due?.scheduledFor.toISOString()).toBe('2026-09-21T10:15:00.000Z');
    });
    it('is null when nothing is due', () => {
        expect(latestDue({ kind: 'every', minutes: 15 }, utc('2026-09-21T10:01:00Z'), utc('2026-09-21T10:10:00Z'))).toBeNull();
    });
    it('a monthly job missed by half an hour is still caught up inside its lookback window', () => {
        const due = latestDue(cron('0 8 5 * *'), utc('2026-09-04T09:00:00Z'), utc('2026-09-05T06:30:00Z'));
        expect(local(due!.scheduledFor)).toBe('2026-09-05T08:00');
    });
});

describe('validateSchedule fails loudly on a bad definition', () => {
    it.each([
        [{ kind: 'every', minutes: 0 } as Schedule, /minutes/],
        [{ kind: 'every', minutes: 1.5 } as Schedule, /minutes/],
        [{ kind: 'cron', expr: 'not a cron', timezone: TZ } as Schedule, /invalid cron/],
        [{ kind: 'cron', expr: '0 8 * * *', timezone: 'Mars/Olympus' } as Schedule, /timezone/],
    ])('%j', (s, pattern) => {
        expect(() => validateSchedule(s)).toThrow(InvalidScheduleError);
        expect(() => validateSchedule(s)).toThrow(pattern);
    });
    it('accepts the schedules the retired workflows used', () => {
        for (const s of [{ kind: 'every', minutes: 15 }, { kind: 'every', minutes: 30 }, cron('0 */2 * * *'), cron('0 8 5 * *'), cron('0 8 * * 1')] as Schedule[]) {
            expect(() => validateSchedule(s)).not.toThrow();
        }
    });
});
