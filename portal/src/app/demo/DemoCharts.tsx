'use client';

import {
    AreaChart, Area, BarChart, Bar,
    XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

const CHART_DATA = [
    { day: 'Pon', sales: 8,  purchase: 12 },
    { day: 'Wt',  sales: 15, purchase: 9  },
    { day: 'Śr',  sales: 6,  purchase: 18 },
    { day: 'Czw', sales: 22, purchase: 14 },
    { day: 'Pt',  sales: 19, purchase: 11 },
    { day: 'Sob', sales: 3,  purchase: 2  },
    { day: 'Nd',  sales: 1,  purchase: 0  },
];

const BAR_DATA = [
    { name: 'Sprzedaż', value: 201 },
    { name: 'Zakup',    value: 318 },
];

const tickStyle = { fill: '#555770', fontSize: 11 };

export function DemoAreaChart() {
    return (
        <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={CHART_DATA} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <defs>
                    <linearGradient id="sales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#6366F1" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="purchase" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#22C55E" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={tickStyle} axisLine={false} tickLine={false} />
                <YAxis tick={tickStyle} axisLine={false} tickLine={false} />
                <Tooltip
                    contentStyle={{ background: '#15171F', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7, fontSize: 12 }}
                    labelStyle={{ color: '#8B8FA8' }}
                    itemStyle={{ color: '#F1F2F6' }}
                />
                <Area type="monotone" dataKey="sales"    stroke="#6366F1" strokeWidth={2} fill="url(#sales)"    name="Sprzedaż" />
                <Area type="monotone" dataKey="purchase" stroke="#22C55E" strokeWidth={2} fill="url(#purchase)" name="Zakup" />
            </AreaChart>
        </ResponsiveContainer>
    );
}

export function DemoBarChart() {
    return (
        <ResponsiveContainer width="100%" height={140}>
            <BarChart data={BAR_DATA} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={tickStyle} axisLine={false} tickLine={false} />
                <YAxis tick={tickStyle} axisLine={false} tickLine={false} />
                <Tooltip
                    contentStyle={{ background: '#15171F', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7, fontSize: 12 }}
                    labelStyle={{ color: '#8B8FA8' }}
                    itemStyle={{ color: '#F1F2F6' }}
                />
                <Bar dataKey="value" fill="#6366F1" radius={[4, 4, 0, 0]} name="Faktury" />
            </BarChart>
        </ResponsiveContainer>
    );
}
