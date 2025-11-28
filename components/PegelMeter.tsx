import React, { forwardRef } from 'react';

interface PegelMeterProps {
  label: string;
  colorClass?: string;
}

// Using forwardRef so the parent can directly access the DOM element
// to update width without triggering React re-renders (Game Loop style).
export const PegelMeter = forwardRef<HTMLDivElement, PegelMeterProps>(({ label, colorClass = "bg-emerald-500" }, ref) => {
  return (
    <div className="w-full flex flex-col gap-1">
      <div className="flex justify-between items-end">
        <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest">{label}</span>
      </div>
      <div className="h-3 w-full bg-slate-950 rounded-sm overflow-hidden border border-slate-800 relative">
        <div 
          ref={ref}
          className={`h-full ${colorClass} transition-none`} // Removed transition for instant updates
          style={{ width: '0%' }}
        />
      </div>
    </div>
  );
});

PegelMeter.displayName = 'PegelMeter';