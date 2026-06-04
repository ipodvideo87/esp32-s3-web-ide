import { useState, useEffect } from 'react';
import S3IDE from './components/editor/S3IDE';
import { ToastProvider } from './contexts/ToastContext';
import { Cpu, Settings, Bell, Share2, CheckCircle, Zap } from 'lucide-react';

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

function AppContent() {
  const [projectName, setProjectName] = useState(() => localStorage.getItem('s3-project-name') || 'ESP32-S3 IoT Gateway');
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(projectName);

  useEffect(() => { localStorage.setItem('s3-project-name', projectName); }, [projectName]);

  const handleRename = () => {
    if (tempName.trim()) setProjectName(tempName.trim());
    setIsEditingName(false);
  };

  return (
    <div className="flex flex-col h-screen h-[100dvh] bg-[#0d0e12] overflow-hidden font-sans text-zinc-300">
      <header className="h-12 bg-[#0a0b0e] border-b border-zinc-800/80 flex items-center justify-between px-3 sm:px-4 shrink-0 z-50 select-none">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-7 h-7 bg-[#00979c]/15 border border-[#00979c]/40 rounded-lg flex items-center justify-center text-[#00979c] shrink-0"><Cpu size={14} /></div>
          <div className="hidden sm:flex flex-col">
            <span className="text-[9px] text-[#00979c] font-black uppercase tracking-widest">espressif esp32-s3</span>
            <span className="text-[11px] font-black text-white tracking-tight uppercase">PlatformIO Web IDE</span>
          </div>
          <div className="h-5 w-px bg-zinc-800 hidden sm:block shrink-0" />
          <div className="flex items-center min-w-0">
            {isEditingName ? (
              <input autoFocus value={tempName} onChange={e => setTempName(e.target.value)} onBlur={handleRename} onKeyDown={e => e.key === 'Enter' && handleRename()}
                className="text-xs font-bold text-white bg-[#15171f] border border-[#00979c]/40 rounded px-2 py-0.5 focus:outline-none max-w-[140px] sm:max-w-[200px]" />
            ) : (
              <span onClick={() => { setTempName(projectName); setIsEditingName(true); }}
                className="text-xs font-bold text-zinc-200 hover:text-[#00979c] transition-colors cursor-pointer truncate max-w-[100px] sm:max-w-[200px]">{projectName}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="hidden lg:flex items-center gap-2 text-[9px] text-zinc-400 font-mono">
            <span className="flex items-center gap-1 text-emerald-400"><CheckCircle size={9} /> Compiler Ready</span>
            <span className="text-zinc-700">|</span>
            <span className="flex items-center gap-1 text-[#00979c]"><Zap size={9} /> xtensa-elf-gcc</span>
          </div>
          <div className="h-4 w-px bg-zinc-800 hidden lg:block" />
          <div className="hidden sm:flex items-center gap-1">
            {[Bell, Settings].map((Icon, i) => (
              <button key={i} className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800/60 rounded-lg transition-all"><Icon size={14} /></button>
            ))}
          </div>
          <button className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-[#00979c] hover:brightness-110 text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all">
            <Share2 size={10} /> Share
          </button>
        </div>
      </header>
      <main className="flex-1 min-h-0 relative"><S3IDE /></main>
    </div>
  );
}
