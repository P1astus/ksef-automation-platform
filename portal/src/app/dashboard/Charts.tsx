'use client';

import {
    LineChart, Line, BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Area, AreaChart,
} from 'recharts';

interface InvoiceChartProps {
    data: { day: string; count: number }[];
}

export function InvoiceAreaChart({ data }: InvoiceChartProps) {
    return (
        <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                    <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                    contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    labelStyle={{ fontWeight: 600, color: '#1e293b' }}
                />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2.5} fill="url(#blueGrad)" dot={false} activeDot={{ r: 5, fill: '#2563eb' }} />
            </AreaChart>
        </ResponsiveContainer>
    );
}

interface ClientBarProps {
    data: { name: string; value: number }[];
}

export function ClientBarChart({ data }: ClientBarProps) {
    return (
        <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                    contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    cursor={{ fill: '#eff6ff' }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[5, 5, 0, 0]}
                    label={false}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

interface MiniLineProps {
    data: { v: number }[];
    color?: string;
}

export function MiniSparkline({ data, color = '#3b82f6' }: MiniLineProps) {
    return (
        <ResponsiveContainer width="100%" height={48}>
            <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
        </ResponsiveContainer>
    );
}
