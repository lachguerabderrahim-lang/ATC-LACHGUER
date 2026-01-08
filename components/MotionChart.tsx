import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { AccelerationData } from '../types';

interface MotionChartProps {
  data: AccelerationData[];
  dataKey: 'x' | 'y' | 'z';
  name: string;
  stroke: string;
  thresholds?: {
    la: number;
    li: number;
    lai: number;
  };
}

export const MotionChart: React.FC<MotionChartProps> = ({ data, dataKey, name, stroke, thresholds }) => {
  // On affiche les 200 derniers points pour plus de contexte en PK
  const displayData = data.slice(-200);

  return (
    <div className="h-[280px] w-full glass-card p-4 rounded-xl border border-slate-800/50">
      <h3 className="text-[10px] font-black mb-2 text-slate-500 uppercase tracking-widest flex justify-between items-center">
        <span>{name}</span>
        {thresholds && <span className="text-orange-500/70">Seuils (Symétriques ±)</span>}
      </h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={displayData} margin={{ top: 10, right: 35, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis 
            dataKey="pk" 
            type="number"
            domain={['auto', 'auto']}
            stroke="#475569"
            tick={{fontSize: 9, fill: '#94a3b8'}}
            tickFormatter={(val) => val?.toFixed(3)}
            label={{ value: 'Point Kilométrique (PK)', position: 'insideBottom', offset: -10, fill: '#475569', fontSize: 10, fontWeight: 'bold' }}
          />
          <YAxis 
            stroke="#475569" 
            domain={['auto', 'auto']} 
            tick={{fontSize: 9}} 
            width={35}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
            itemStyle={{ fontSize: '10px' }}
            labelFormatter={(val) => `PK: ${Number(val).toFixed(3)}`}
            labelStyle={{ color: '#94a3b8', fontSize: '10px', marginBottom: '4px' }}
          />
          
          <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
          
          {thresholds && (
            <>
              {/* Seuils positifs */}
              <ReferenceLine 
                y={thresholds.la} 
                stroke="#fbbf24" 
                strokeDasharray="5 5" 
                strokeOpacity={0.6} 
                label={{ position: 'right', value: 'LA', fill: '#fbbf24', fontSize: 10, fontWeight: 'bold' }}
              />
              <ReferenceLine 
                y={thresholds.li} 
                stroke="#f97316" 
                strokeDasharray="3 3" 
                strokeOpacity={0.8}
                label={{ position: 'right', value: 'LI', fill: '#f97316', fontSize: 10, fontWeight: 'bold' }}
              />
              <ReferenceLine 
                y={thresholds.lai} 
                stroke="#ef4444" 
                strokeWidth={1.5}
                label={{ position: 'right', value: 'LAI', fill: '#ef4444', fontSize: 10, fontWeight: 'bold' }}
              />
              
              {/* Seuils négatifs */}
              <ReferenceLine 
                y={-thresholds.la} 
                stroke="#fbbf24" 
                strokeDasharray="5 5" 
                strokeOpacity={0.4} 
                label={{ position: 'right', value: '-LA', fill: '#fbbf24', fontSize: 10, fontWeight: 'bold' }}
              />
              <ReferenceLine 
                y={-thresholds.li} 
                stroke="#f97316" 
                strokeDasharray="3 3" 
                strokeOpacity={0.5} 
                label={{ position: 'right', value: '-LI', fill: '#f97316', fontSize: 10, fontWeight: 'bold' }}
              />
              <ReferenceLine 
                y={-thresholds.lai} 
                stroke="#ef4444" 
                strokeWidth={1.2}
                strokeOpacity={0.6}
                label={{ position: 'right', value: '-LAI', fill: '#ef4444', fontSize: 10, fontWeight: 'bold' }}
              />
            </>
          )}

          <Line 
            type="monotone" 
            dataKey={dataKey} 
            name={name} 
            stroke={stroke} 
            strokeWidth={2} 
            dot={false} 
            isAnimationActive={false} 
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};