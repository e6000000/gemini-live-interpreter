import React from 'react';

interface PegelMeterProps {
  level: number; // 0 to 1
  label: string;
  colorClass?: string;
}

export const PegelMeter: React.FC<PegelMeterProps> = ({ level, label, colorClass = "bg-emerald-500" }) => {
  // Simple clamped percentage, no complex math in render
  // Using transform: scaleX is often more performant than width for animations, 
  // but width is simpler for layout. Given the request for "simple", width is fine here.
  const widthPercent = Math.min(100, Math.max(0, level * 100));

  return (
    <div className="w-full flex flex-col gap-1">
      <div className="flex justify-between items-end">
        <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest">{label}</span>
      </div>
      <div className="h-3 w-full bg-slate-950 rounded-sm overflow-hidden border border-slate-800 relative">
        <div 
          className={`h-full ${colorClass} transition-all duration-75 ease-out`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
};