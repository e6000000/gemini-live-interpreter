import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PegelMeter } from './components/PegelMeter';
import { LiveClient } from './services/liveClient';
import { AudioDevice, LanguageMode } from './types';

// Icons
const MicIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
);
const SpeakerIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
);
const LanguageIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
);
const ChevronDown = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
);

const SUPPORTED_LANGUAGES = [
  'English', 'German', 'Thai', 'Korean', 'French', 'Spanish', 
  'Italian', 'Portuguese', 'Chinese (Mandarin)', 'Japanese', 
  'Russian', 'Arabic', 'Hindi', 'Turkish', 'Vietnamese'
];

const App: React.FC = () => {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageMode>(LanguageMode.AUTO_TO_GERMAN);
  
  // Custom language state
  const [customSource, setCustomSource] = useState('Auto Detect');
  const [customTarget, setCustomTarget] = useState('German');

  const clientRef = useRef<LiveClient | null>(null);
  
  // Direct DOM refs for High Performance metering (No React Renders)
  const inputMeterRef = useRef<HTMLDivElement>(null);
  const outputMeterRef = useRef<HTMLDivElement>(null);

  // Initialize Client
  useEffect(() => {
    clientRef.current = new LiveClient();
    return () => {
      if (clientRef.current) {
        clientRef.current.stop();
      }
    };
  }, []);

  // Fetch Devices
  const refreshDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput').map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${d.deviceId.slice(0, 5)}...`
      }));
      const outputs = devices.filter(d => d.kind === 'audiooutput').map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Speaker ${d.deviceId.slice(0, 5)}...`
      }));

      setInputDevices(inputs);
      setOutputDevices(outputs);

      if (inputs.length > 0 && !selectedMic) setSelectedMic(inputs[0].deviceId);
      if (outputs.length > 0 && !selectedSpeaker) setSelectedSpeaker(outputs[0].deviceId);
    } catch (err) {
      console.error("Failed to list devices", err);
    }
  }, [selectedMic, selectedSpeaker]);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

  // Start Session
  const startSession = async () => {
    if (active || loading) return;

    if (!selectedMic) {
      alert("Please select a microphone first.");
      return;
    }
    setLoading(true);
    try {
      await clientRef.current?.connect({
        micDeviceId: selectedMic,
        speakerDeviceId: selectedSpeaker,
        languageMode: selectedLanguage,
        customSource: selectedLanguage === LanguageMode.CUSTOM ? customSource : undefined,
        customTarget: selectedLanguage === LanguageMode.CUSTOM ? customTarget : undefined,
        onVolumeChange: (type, vol) => {
          // Direct DOM manipulation - Zero React Overhead
          const el = type === 'input' ? inputMeterRef.current : outputMeterRef.current;
          if (el) {
            const percent = Math.min(100, vol * 100);
            el.style.width = `${percent}%`;
          }
        }
      });
      setActive(true);
    } catch (err) {
      console.error("Failed to start session", err);
      alert("Failed to start interpreter session. Check console for details.");
      setActive(false);
    } finally {
      setLoading(false);
    }
  };

  // Stop Session
  const stopSession = async () => {
    if (!active || loading) return;
    
    setLoading(true);
    try {
      await clientRef.current?.stop();
      setActive(false);
      // Reset meters directly
      if (inputMeterRef.current) inputMeterRef.current.style.width = '0%';
      if (outputMeterRef.current) outputMeterRef.current.style.width = '0%';
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white overflow-hidden">
      
      {/* Header */}
      <header className="flex-none px-6 py-4 bg-slate-950 border-b border-slate-800 z-10 flex justify-between items-center">
         <div className="flex items-center gap-3">
             <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-md flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
             </div>
             <div>
               <h1 className="text-lg font-bold tracking-tight text-white leading-tight">Gemini Live Interpreter</h1>
             </div>
          </div>
          <div className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${active ? 'bg-red-500/10 text-red-400 border-red-500/30 animate-pulse' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
            {active ? 'LIVE' : 'STANDBY'}
          </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-6 gap-6 relative overflow-y-auto">
        
        {/* TOP: Meters */}
        <div className="flex flex-col md:flex-row gap-4 md:gap-8 bg-slate-900/50 p-4 rounded-xl border border-slate-800/50">
           <PegelMeter 
            ref={inputMeterRef}
            label="Input Microphone" 
            colorClass="bg-emerald-500" 
           />
           <PegelMeter 
            ref={outputMeterRef}
            label="Output Speaker" 
            colorClass="bg-amber-500" 
           />
        </div>

        {/* CENTER: Main Action */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-[250px] relative gap-10">
           
           {/* START BUTTON (Mic) - 3D Design */}
           <div className="relative">
              {/* Ambient Glow */}
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full blur-[60px] transition-all duration-700 ${active ? 'bg-blue-600/30' : 'bg-transparent'}`} />
              
              <button
                onClick={startSession}
                disabled={active || loading}
                className={`
                  relative group flex items-center justify-center w-36 h-36 rounded-[2.5rem] transition-all duration-300
                  ${active 
                    ? 'cursor-default scale-100 ring-2 ring-blue-500/50' 
                    : 'cursor-pointer hover:scale-105 hover:-translate-y-1 shadow-2xl shadow-black/60'
                  }
                `}
                style={{
                   // 3D iPad-like gradient and shadows
                   background: active ? 'linear-gradient(145deg, #0f172a, #1e293b)' : 'linear-gradient(145deg, #1e293b, #0f172a)',
                   boxShadow: active 
                      ? 'inset 0 4px 8px rgba(0,0,0,0.5)' 
                      : '8px 8px 16px #0b1120, -8px -8px 16px #2a3a52, inset 0 1px 1px rgba(255,255,255,0.1)'
                }}
               >
                 {loading ? (
                    <span className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-blue-500 animate-spin"></span>
                 ) : (
                    <MicIcon className={`w-14 h-14 transition-all duration-300 drop-shadow-lg ${active ? 'text-blue-400' : 'text-slate-400 group-hover:text-white'}`} />
                 )}
               </button>
           </div>
           
           {/* OFF BUTTON - Always visible, Gradient 33deg, Wide */}
           <button 
              onClick={stopSession}
              disabled={!active || loading}
              className={`
                w-64 h-14 rounded-xl flex items-center justify-center border transition-all duration-300
                text-lg font-bold uppercase tracking-widest shadow-xl
                ${active && !loading
                  ? 'bg-gradient-to-br from-orange-700 via-purple-800 to-teal-700 border-white/10 text-white hover:scale-105 active:scale-95 shadow-purple-900/40 cursor-pointer'
                  : 'bg-slate-800 border-slate-700 text-slate-600 opacity-50 cursor-not-allowed shadow-none grayscale'
                }
              `}
            >
              OFF
           </button>

        </div>

        {/* BOTTOM: Settings */}
        <div className="bg-slate-800/40 backdrop-blur rounded-xl border border-slate-700/50 p-4 md:p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Input Selector */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <MicIcon className="w-3 h-3" /> Input Source
            </label>
            <div className="relative">
              <select 
                value={selectedMic} 
                onChange={e => setSelectedMic(e.target.value)}
                disabled={active || loading}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:opacity-50 appearance-none"
              >
                {inputDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
                {inputDevices.length === 0 && <option>Default Microphone</option>}
              </select>
              <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500"><ChevronDown/></div>
            </div>
          </div>

          {/* Output Selector */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <SpeakerIcon /> Output Target
            </label>
            <div className="relative">
                <select 
                value={selectedSpeaker} 
                onChange={e => setSelectedSpeaker(e.target.value)}
                disabled={active || loading}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:opacity-50 appearance-none"
              >
                {outputDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
                  {outputDevices.length === 0 && <option>Default Speaker</option>}
              </select>
              <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500"><ChevronDown/></div>
            </div>
          </div>

          {/* Language Selector */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <LanguageIcon /> Translation
            </label>
            <div className="relative">
               <select 
                value={selectedLanguage} 
                onChange={e => !active && !loading && setSelectedLanguage(e.target.value as LanguageMode)}
                disabled={active || loading}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:opacity-50 appearance-none"
              >
                 {(Object.values(LanguageMode) as string[]).map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                 ))}
              </select>
               <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500"><ChevronDown/></div>
            </div>

            {/* CUSTOM MODE SELECTORS */}
            {selectedLanguage === LanguageMode.CUSTOM && (
              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-700/50 animate-[fadeIn_0.3s_ease-out]">
                 <div className="relative">
                    <select
                      value={customSource}
                      onChange={e => setCustomSource(e.target.value)}
                      disabled={active || loading}
                      className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-300 focus:ring-1 focus:ring-indigo-500 focus:outline-none appearance-none"
                    >
                      <option>Auto Detect</option>
                      {SUPPORTED_LANGUAGES.map(lang => <option key={lang}>{lang}</option>)}
                    </select>
                 </div>
                 <div className="relative">
                    <select
                      value={customTarget}
                      onChange={e => setCustomTarget(e.target.value)}
                      disabled={active || loading}
                      className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-300 focus:ring-1 focus:ring-indigo-500 focus:outline-none appearance-none"
                    >
                       {SUPPORTED_LANGUAGES.map(lang => <option key={lang}>{lang}</option>)}
                    </select>
                 </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;