import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import CodeMirrorEditor from './CodeMirrorEditor';
import { SerialConnection } from '../../lib/serial-connection';
import { useDeviceCapabilities } from '../../hooks/useDeviceCapabilities';
import {
  Cpu, Play, Download, Terminal, Library, Settings,
  ChevronDown, ChevronRight, Plus, Trash2, Search,
  FileCode, X, Upload, Zap, HardDrive, MemoryStick,
  RefreshCw, Plug, Unplug, Monitor, Usb, AlertCircle, Check, Info
} from 'lucide-react';

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ');
}

const DEFAULT_CODE = `#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println("ESP32-S3 Ready!");
}

void loop() {
  digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
  Serial.println("Blink");
  delay(1000);
}
`;

type MobileTab = 'editor' | 'deploy' | 'libraries' | 'serial';

interface SketchFile { path: string; content: string; language: string; }
interface LibItem { id: string; name: string; version: string; author: string; description: string; category: string; installed: boolean; }

export default function S3IDE() {
  const capabilities = useDeviceCapabilities();
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('editor');

  const [files, setFiles] = useState<SketchFile[]>([{ path: 'sketch.ino', content: DEFAULT_CODE, language: 'cpp' }]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const activeFile = files[activeFileIdx] || files[0];

  const [isCompiling, setIsCompiling] = useState(false);
  const [compiledBinary, setCompiledBinary] = useState<string | null>(null);
  const [compiledBootloader, setCompiledBootloader] = useState<string | null>(null);
  const [compiledPartitions, setCompiledPartitions] = useState<string | null>(null);
  const [memoryUsage, setMemoryUsage] = useState({ flash: '-', ram: '-' });

  const [boardVariant, setBoardVariant] = useState('esp32s3');
  const [psramMode, setPsramMode] = useState('opi');
  const [flashSize, setFlashSize] = useState('16MB');
  const [usbCdcMode, setUsbCdcMode] = useState('enabled');
  const [partitionScheme, setPartitionScheme] = useState('default-16mb');

  const [serialLines, setSerialLines] = useState<string[]>(['[Serial] Waiting for connection...']);
  const [serialInput, setSerialInput] = useState('');
  const [serialConnected, setSerialConnected] = useState(false);
  const serialConnRef = useRef<SerialConnection | null>(null);

  const [libraries, setLibraries] = useState<LibItem[]>([]);
  const [libSearch, setLibSearch] = useState('');
  const [libCategory, setLibCategory] = useState('All');

  const [consoleLogs, setConsoleLogs] = useState<string[]>(['[S3 IDE] ESP32-S3 Web IDE Ready']);
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);

  const [hardwareConnected, setHardwareConnected] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);

  const uploadZipRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/libraries?category=${libCategory}&q=${libSearch}`);
        if (res.ok) setLibraries(await res.json());
      } catch {}
    })();
  }, [libCategory, libSearch]);

  // REAL COMPILE - no simulation, no fallback
  const handleCompile = useCallback(async () => {
    if (!capabilities.compilerReady) {
      setConsoleLogs(prev => [...prev, '[ERROR] Compilation server not reachable. Ensure the server is running and accessible from this device.']);
      return;
    }
    setIsCompiling(true);
    setConsoleLogs(prev => [...prev, `[COMPILE] Building for ${boardVariant}...`]);
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: activeFile.content,
          boardId: `esp32:${boardVariant}`,
          psramMode,
          flashSize,
          usbCdcMode,
          partitionScheme,
        }),
      });
      if (res.status === 503) {
        const data = await res.json();
        setConsoleLogs(prev => [...prev, `[ERROR] ${data.logs}`]);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setCompiledBinary(data.binary);
        setCompiledBootloader(data.bootloader);
        setCompiledPartitions(data.partitions);
        setMemoryUsage(data.usage);
        setConsoleLogs(prev => [...prev, data.logs]);
      } else {
        setConsoleLogs(prev => [...prev, `[ERROR] ${data.logs}`]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConsoleLogs(prev => [...prev, `[ERROR] Network error: ${msg}. Is the server running?`]);
    } finally {
      setIsCompiling(false);
    }
  }, [activeFile, boardVariant, psramMode, flashSize, usbCdcMode, partitionScheme, capabilities.compilerReady]);

  const connectSerial = useCallback(async () => {
    if (!capabilities.hasWebSerial && !capabilities.hasWebUSB) {
      setSerialLines(prev => [...prev, '[ERROR] Web Serial is not available. Use Chrome or Edge browser.']);
      return;
    }
    const serial = new SerialConnection({
      baudRate: 115200,
      onData: (data) => setSerialLines(prev => [...prev.slice(-200), ...data.split('\n').filter(Boolean)]),
      onError: (err) => setSerialLines(prev => [...prev, `[ERROR] ${err.message}`]),
    });
    if (!await serial.requestPort()) return;
    if (!await serial.connect()) return;
    serialConnRef.current = serial;
    setSerialConnected(true);
    setHardwareConnected(true);
    setSerialLines(prev => [...prev, `[Serial] Connected via ${capabilities.isNativeWebSerial ? 'Web Serial' : 'WebUSB polyfill'}`]);
  }, [capabilities]);

  const disconnectSerial = useCallback(async () => {
    if (serialConnRef.current) { await serialConnRef.current.disconnect(); serialConnRef.current = null; }
    setSerialConnected(false);
    setHardwareConnected(false);
    setSerialLines(prev => [...prev, '[Serial] Disconnected']);
  }, []);

  const sendSerialLine = useCallback(async () => {
    if (!serialConnRef.current || !serialInput) return;
    if (await serialConnRef.current.write(serialInput + '\n')) setSerialInput('');
  }, [serialInput]);

  const handleFlash = useCallback(async () => {
    if (!compiledBinary) { setConsoleLogs(prev => [...prev, '[ERROR] Compile first before flashing.']); return; }
    if (!serialConnRef.current?.connected) { setConsoleLogs(prev => [...prev, '[ERROR] Connect hardware first via the Serial tab.']); return; }
    setIsFlashing(true);
    setFlashProgress(0);
    setConsoleLogs(prev => [...prev, '[FLASH] Starting firmware upload to ESP32-S3...']);
    try {
      const { ESPLoader, Transport } = await import('esptool-js');
      const port = serialConnRef.current!.getPort();
      const transport = new Transport(port as any, true);
      const loader = new ESPLoader({ transport, baudrate: 115200 } as any);
      await loader.main();
      setFlashProgress(30);
      setConsoleLogs(prev => [...prev, '[FLASH] Chip detected, writing firmware...']);
      const binaryData = Uint8Array.from(atob(compiledBinary), c => c.charCodeAt(0));
      const fileArray: any[] = [{ data: binaryData, address: 0x10000 }];
      if (compiledBootloader) {
        const bootData = Uint8Array.from(atob(compiledBootloader), c => c.charCodeAt(0));
        fileArray.unshift({ data: bootData, address: 0x0 });
      }
      if (compiledPartitions) {
        const partData = Uint8Array.from(atob(compiledPartitions), c => c.charCodeAt(0));
        fileArray.splice(1, 0, { data: partData, address: 0x8000 });
      }
      await loader.writeFlash({ fileArray, eraseAll: false, compress: true, flashMode: 0, flashFreq: 40, flashSize: 4194304 } as any);
      setFlashProgress(90);
      try { (loader as any).hardReset?.(); } catch {}
      setFlashProgress(100);
      setConsoleLogs(prev => [...prev, '[SUCCESS] Firmware flashed to ESP32-S3!']);
    } catch (err: any) {
      setConsoleLogs(prev => [...prev, `[FLASH ERROR] ${err?.message || err}. Ensure the board is in download mode.`]);
    } finally {
      setIsFlashing(false);
      setFlashProgress(0);
    }
  }, [compiledBinary, compiledBootloader, compiledPartitions]);

  const toggleLibrary = useCallback(async (lib: LibItem) => {
    try {
      await fetch(lib.installed ? '/api/libraries/uninstall' : '/api/libraries/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lib.id }),
      });
      setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, installed: !l.installed } : l));
    } catch {}
  }, []);

  const addFile = useCallback(() => {
    const name = prompt('File name (e.g. utils.h):');
    if (!name) return;
    setFiles(prev => [...prev, { path: name, content: '', language: 'cpp' }]);
    setActiveFileIdx(files.length);
  }, [files.length]);

  const removeFile = useCallback((idx: number) => {
    if (files.length <= 1) return;
    setFiles(prev => prev.filter((_, i) => i !== idx));
    if (activeFileIdx >= files.length - 1) setActiveFileIdx(Math.max(0, files.length - 2));
  }, [files, activeFileIdx]);

  const updateFileContent = useCallback((value: string) => {
    setFiles(prev => prev.map((f, i) => i === activeFileIdx ? { ...f, content: value } : f));
  }, [activeFileIdx]);

  const handleZipUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('library', file);
    try {
      const res = await fetch('/api/libraries/upload-zip', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const libRes = await fetch(`/api/libraries?category=${libCategory}&q=${libSearch}`);
          if (libRes.ok) setLibraries(await libRes.json());
        }
      }
    } catch {}
    if (uploadZipRef.current) uploadZipRef.current.value = '';
  }, [libCategory, libSearch]);

  const categories = ['All', 'Communication', 'Display', 'Sensors', 'IoT', 'Data Processing', 'Control', 'Human Interface', 'Storage', 'Networking', 'Custom'];

  const renderStatusBanner = () => {
    const isReady = capabilities.compilerReady && capabilities.hasWebSerial;
    const hasIssue = !capabilities.compilerReady || !capabilities.hasWebSerial;
    if (!hasIssue && !capabilities.isMobile) return null;
    return (
      <div className={cn('px-3 py-2 text-xs flex items-center gap-2 border-b shrink-0',
        isReady ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300')}>
        <Info size={14} />
        <div className="flex-1 min-w-0 truncate">
          {!capabilities.compilerReady && <span className="mr-2">Server offline</span>}
          {!capabilities.hasWebSerial && <span className="mr-2">No serial (use Chrome/Edge)</span>}
          {isReady && <span>Ready</span>}
        </div>
        <span className="text-[10px] opacity-70 shrink-0">{capabilities.browser} | {capabilities.isMobile ? 'Mobile' : 'Desktop'}</span>
      </div>
    );
  };

  const renderEditor = () => (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center bg-[#18181b] border-b border-zinc-800 px-2 h-9 shrink-0 overflow-x-auto">
        {files.map((f, i) => (
          <button key={f.path} onClick={() => setActiveFileIdx(i)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap', i === activeFileIdx ? 'text-white bg-[#1e1e22] border-b-2 border-[#00979c]' : 'text-zinc-500 hover:text-zinc-300')}>
            <FileCode size={12} />{f.path}
            {files.length > 1 && <span onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="ml-1 hover:text-red-400"><X size={10} /></span>}
          </button>
        ))}
        <button onClick={addFile} className="px-2 py-1 text-zinc-500 hover:text-white"><Plus size={14} /></button>
      </div>
      <div className="flex-1 min-h-0">
        {isMobile ? (
          <CodeMirrorEditor value={activeFile.content} onChange={updateFileContent} />
        ) : (
          <Editor height="100%" language="cpp" theme="vs-dark" value={activeFile.content} onChange={(val) => updateFileContent(val || '')} options={{ fontSize: 13, fontFamily: '"JetBrains Mono", monospace', minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, automaticLayout: true, padding: { top: 8 } }} />
        )}
      </div>
    </div>
  );

  const renderConsole = () => (
    <div className={cn('border-t border-zinc-800 bg-[#0f0f12] flex flex-col shrink-0', consoleCollapsed ? 'h-8' : isMobile ? 'h-40' : 'h-44')}>
      <div className="flex items-center justify-between px-3 h-8 bg-[#18181b] cursor-pointer select-none shrink-0" onClick={() => setConsoleCollapsed(!consoleCollapsed)}>
        <div className="flex items-center gap-2 text-xs text-zinc-400"><Terminal size={12} /><span>Console</span>{memoryUsage.flash !== '-' && <span className="ml-2 text-[10px] text-emerald-400 font-mono">Flash: {memoryUsage.flash} | RAM: {memoryUsage.ram}</span>}</div>
        {consoleCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </div>
      {!consoleCollapsed && (
        <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-zinc-400">
          {consoleLogs.map((log, i) => <div key={i} className={cn(log.includes('[ERROR]') && 'text-red-400', log.includes('[SUCCESS]') && 'text-emerald-400', log.includes('[FLASH') && 'text-sky-400')}>{log}</div>)}
        </div>
      )}
    </div>
  );

  const renderSerialMonitor = () => (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      <div className="flex items-center justify-between px-3 h-9 bg-[#18181b] border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 text-xs text-zinc-400"><Monitor size={12} /><span>Serial Monitor</span><span className={cn('w-2 h-2 rounded-full', serialConnected ? 'bg-emerald-400' : 'bg-zinc-600')} /></div>
        {serialConnected ? (
          <button onClick={disconnectSerial} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-red-500/10 text-red-400 rounded hover:bg-red-500/20"><Unplug size={10} /> Disconnect</button>
        ) : (
          <button onClick={connectSerial} disabled={!capabilities.hasWebSerial && !capabilities.hasWebUSB} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#00979c]/10 text-[#00979c] rounded hover:bg-[#00979c]/20 disabled:opacity-50"><Plug size={10} /> Connect</button>
        )}
      </div>
      {!capabilities.hasWebSerial && !capabilities.hasWebUSB && (
        <div className="px-3 py-2 bg-yellow-500/10 text-yellow-300 text-[10px] border-b border-yellow-500/20">Web Serial not supported in {capabilities.browser}. Use Chrome or Edge to flash hardware.</div>
      )}
      <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] text-zinc-400">{serialLines.map((line, i) => <div key={i}>{line}</div>)}</div>
      <div className="flex items-center gap-2 px-3 py-2 bg-[#18181b] border-t border-zinc-800 shrink-0">
        <input value={serialInput} onChange={e => setSerialInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendSerialLine()} placeholder="Send to serial..." disabled={!serialConnected} className="flex-1 bg-[#0f0f12] border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-[#00979c] disabled:opacity-50" />
        <button onClick={sendSerialLine} disabled={!serialConnected || !serialInput} className="px-2 py-1 text-xs bg-[#00979c]/10 text-[#00979c] rounded hover:bg-[#00979c]/20 disabled:opacity-50">Send</button>
      </div>
    </div>
  );

  const renderLibraryManager = () => (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      <div className="px-4 py-3 bg-[#18181b] border-b border-zinc-800 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Library size={14} /> Libraries</h3>
          <div><input ref={uploadZipRef} type="file" accept=".zip" onChange={handleZipUpload} className="hidden" /><button onClick={() => uploadZipRef.current?.click()} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#00979c]/10 text-[#00979c] rounded hover:bg-[#00979c]/20"><Upload size={10} /> Import ZIP</button></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" /><input value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Search libraries..." className="w-full bg-[#0f0f12] border border-zinc-800 rounded pl-7 pr-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#00979c]" /></div>
          <select value={libCategory} onChange={e => setLibCategory(e.target.value)} className="bg-[#0f0f12] border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#00979c]">{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {libraries.map(lib => (
          <div key={lib.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors">
            <div className="min-w-0"><div className="text-xs font-semibold text-white truncate">{lib.name}</div><div className="text-[10px] text-zinc-500 truncate">{lib.author} - {lib.description}</div></div>
            <button onClick={() => toggleLibrary(lib)} className={cn('shrink-0 px-2 py-1 rounded text-[10px] font-bold transition-all min-w-[52px]', lib.installed ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-[#00979c]/10 text-[#00979c] hover:bg-[#00979c]/20')}>{lib.installed ? 'Remove' : 'Install'}</button>
          </div>
        ))}
        {libraries.length === 0 && <div className="text-center text-zinc-500 text-xs py-8">No libraries found</div>}
      </div>
    </div>
  );

  const renderBoardConfig = () => (
    <div className="space-y-3 p-4">
      <h3 className="text-sm font-bold text-white flex items-center gap-2"><Settings size={14} /> Board Config</h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Board', val: boardVariant, set: setBoardVariant, opts: [['esp32s3', 'ESP32-S3 DevKitC-1'], ['adafruit_feather_esp32s3', 'Adafruit Feather S3'], ['seeed_xiao_esp32s3', 'Seeed XIAO S3'], ['esp32s3_cam', 'ESP32-S3 Camera']] },
          { label: 'PSRAM', val: psramMode, set: setPsramMode, opts: [['opi', 'OPI PSRAM'], ['qio', 'QIO PSRAM'], ['sram', 'SRAM Only']] },
          { label: 'Flash', val: flashSize, set: setFlashSize, opts: [['4MB', '4 MB'], ['8MB', '8 MB'], ['16MB', '16 MB']] },
          { label: 'USB CDC', val: usbCdcMode, set: setUsbCdcMode, opts: [['enabled', 'Enabled'], ['disabled', 'Disabled']] },
          { label: 'Partition', val: partitionScheme, set: setPartitionScheme, opts: [['default-16mb', 'Default 16MB'], ['default-8mb', 'Default 8MB'], ['default-4mb', 'Default 4MB'], ['huge-app', 'Huge App'], ['spiffs', 'With SPIFFS']] },
        ].map(({ label, val, set, opts }) => (
          <label key={label} className="space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{label}</span>
            <select value={val} onChange={e => set(e.target.value)} className="w-full bg-[#0f0f12] border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#00979c]">{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        ))}
      </div>
    </div>
  );

  const renderDeployPanel = () => (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      <div className="px-4 py-3 bg-[#18181b] border-b border-zinc-800 shrink-0"><h3 className="text-sm font-bold text-white flex items-center gap-2"><Zap size={14} /> Deploy</h3></div>
      <div className="flex-1 overflow-y-auto">
        <div className={cn('mx-3 mt-3 px-3 py-2 rounded-lg border flex items-start gap-2', capabilities.hasWebSerial && capabilities.compilerReady ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-yellow-500/10 border-yellow-500/20')}>
          {capabilities.hasWebSerial && capabilities.compilerReady ? <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" /> : <AlertCircle size={14} className="text-yellow-400 mt-0.5 shrink-0" />}
          <div>
            <div className="text-xs font-bold">{capabilities.message}</div>
            <div className="text-[10px] text-zinc-400 mt-0.5">{capabilities.browser} | {capabilities.isMobile ? 'Mobile' : 'Desktop'} | Serial: {capabilities.isNativeWebSerial ? 'Native Web Serial' : capabilities.isPolyfillAvailable ? 'WebUSB Polyfill' : capabilities.hasWebUSB ? 'WebUSB available' : 'Unsupported'}</div>
            {!capabilities.hasWebSerial && capabilities.isMobile && <div className="text-[10px] text-yellow-300 mt-1">Android: Use USB OTG adapter + Chrome browser</div>}
          </div>
        </div>
        {renderBoardConfig()}
        <div className="px-4 py-3 border-t border-zinc-800 space-y-3">
          <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg', hardwareConnected ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-zinc-800/30 border border-zinc-800')}>
            {hardwareConnected ? <Usb size={14} className="text-emerald-400" /> : <Unplug size={14} className="text-zinc-500" />}
            <span className={cn('text-xs font-medium', hardwareConnected ? 'text-emerald-400' : 'text-zinc-500')}>{hardwareConnected ? 'Hardware Connected' : 'No Hardware Detected'}</span>
          </div>
          <button onClick={handleCompile} disabled={isCompiling || !capabilities.compilerReady} className={cn('w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all min-h-[44px]', isCompiling ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : !capabilities.compilerReady ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-[#00979c] hover:bg-[#00979c]/90 text-white shadow-lg')}>{isCompiling ? <><RefreshCw size={14} className="animate-spin" /> Compiling...</> : <><Play size={14} /> Compile</>}</button>
          <button onClick={handleFlash} disabled={isFlashing || !compiledBinary || !hardwareConnected} className={cn('w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all min-h-[44px]', isFlashing ? 'bg-sky-500/20 text-sky-400' : !compiledBinary || !hardwareConnected ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20')}>{isFlashing ? <><RefreshCw size={14} className="animate-spin" /> Flashing... {flashProgress}%</> : <><Download size={14} /> Flash to Board</>}</button>
          {isFlashing && <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden"><div className="bg-sky-400 h-full transition-all duration-300" style={{ width: `${flashProgress}%` }} /></div>}
          {compiledBinary && <div className="grid grid-cols-2 gap-2"><div className="bg-zinc-800/30 rounded-lg p-2 flex items-center gap-2"><HardDrive size={12} className="text-emerald-400" /><div><div className="text-[10px] text-zinc-500">Flash</div><div className="text-xs font-bold text-white">{memoryUsage.flash}</div></div></div><div className="bg-zinc-800/30 rounded-lg p-2 flex items-center gap-2"><MemoryStick size={12} className="text-sky-400" /><div><div className="text-[10px] text-zinc-500">RAM</div><div className="text-xs font-bold text-white">{memoryUsage.ram}</div></div></div></div>}
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-[#0d0e12]">
        {renderStatusBanner()}
        <div className="flex items-center justify-between px-3 h-11 bg-[#18181b] border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2"><Cpu size={14} className="text-[#00979c]" /><span className="text-xs font-bold text-white">ESP32-S3</span></div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleCompile} disabled={isCompiling || !capabilities.compilerReady} className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] bg-[#00979c] rounded text-[10px] font-bold text-white disabled:opacity-50"><Play size={11} /> {isCompiling ? '...' : 'Build'}</button>
            <button onClick={handleFlash} disabled={isFlashing || !compiledBinary || !hardwareConnected} className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] bg-sky-500/10 border border-sky-500/20 rounded text-[10px] font-bold text-sky-400 disabled:opacity-50"><Download size={11} /> Flash</button>
          </div>
        </div>
        <div className="flex-1 min-h-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {mobileTab === 'editor' && <div className="flex flex-col h-full">{renderEditor()}{renderConsole()}</div>}
          {mobileTab === 'deploy' && renderDeployPanel()}
          {mobileTab === 'libraries' && renderLibraryManager()}
          {mobileTab === 'serial' && renderSerialMonitor()}
        </div>
        <div className="fixed bottom-0 left-0 right-0 flex items-center justify-around bg-[#18181b] border-t border-zinc-800 shrink-0" style={{ height: 'calc(56px + env(safe-area-inset-bottom, 0px))', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {([['editor', FileCode, 'Editor'], ['deploy', Zap, 'Deploy'], ['libraries', Library, 'Libs'], ['serial', Terminal, 'Serial']] as [MobileTab, any, string][]).map(([key, Icon, label]) => (
            <button key={key} onClick={() => setMobileTab(key)} className={cn('flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg transition-all min-w-[56px] min-h-[44px]', mobileTab === key ? 'text-[#00979c]' : 'text-zinc-500 hover:text-zinc-300')}>
              <Icon size={18} /><span className="text-[9px] font-bold">{label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-[#0d0e12]">
      <div className="w-64 bg-[#0f0f12] border-r border-zinc-800 flex flex-col shrink-0">{renderDeployPanel()}</div>
      <div className="flex flex-col flex-1 min-w-0">{renderEditor()}{renderConsole()}</div>
      <div className="w-80 bg-[#0f0f12] border-l border-zinc-800 flex flex-col shrink-0">{renderSerialMonitor()}</div>
    </div>
  );
}
