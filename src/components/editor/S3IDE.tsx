import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { useToast } from '../../contexts/ToastContext';
import {
  Cpu, Play, Download, Terminal, Library, Settings,
  ChevronDown, ChevronRight, Plus, Trash2, Search,
  FileCode, X, Upload, Zap, HardDrive, MemoryStick,
  RefreshCw, Plug, Unplug, Monitor, Usb
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
  const { showToast } = useToast();

  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('editor');
  const [files, setFiles] = useState<SketchFile[]>([{ path: 'sketch.ino', content: DEFAULT_CODE, language: 'cpp' }]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const activeFile = files[activeFileIdx] || files[0];

  const [isCompiling, setIsCompiling] = useState(false);
  const [compiledBinary, setCompiledBinary] = useState<string | null>(null);
  const [memoryUsage, setMemoryUsage] = useState({ flash: '-', ram: '-' });

  const [boardVariant, setBoardVariant] = useState('esp32s3');
  const [sdkVersion, setSdkVersion] = useState('v3.0.1');
  const [psramMode, setPsramMode] = useState('opi');
  const [flashSize, setFlashSize] = useState('16MB');
  const [usbCdcMode, setUsbCdcMode] = useState('enabled');
  const [partitionScheme, setPartitionScheme] = useState('default-16mb');

  const [serialLines, setSerialLines] = useState<string[]>(['[Serial] Waiting for connection...']);
  const [serialInput, setSerialInput] = useState('');
  const [serialConnected, setSerialConnected] = useState(false);
  const serialPortRef = useRef<SerialPort | null>(null);
  const serialReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

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
        setLibraries(await res.json());
      } catch {}
    })();
  }, [libCategory, libSearch]);

  const handleCompile = useCallback(async () => {
    setIsCompiling(true);
    setConsoleLogs(prev => [...prev, `[COMPILE] Building for ${boardVariant}...`, `[COMPILE] SDK: ${sdkVersion}, PSRAM: ${psramMode}, Flash: ${flashSize}`]);
    try {
      const res = await fetch('/api/compile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activeFile.content, boardId: `esp32:${boardVariant}`, sdkVersion, psramMode, flashSize, usbCdcMode, partitionScheme })
      });
      const data = await res.json();
      if (data.success) {
        setCompiledBinary(data.binary);
        setMemoryUsage(data.usage);
        setConsoleLogs(prev => [...prev, data.logs, '[SUCCESS] Build complete.']);
        showToast('Compilation successful!', 'success');
      } else {
        setConsoleLogs(prev => [...prev, `[ERROR] ${data.logs}`]);
        showToast('Compilation failed', 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConsoleLogs(prev => [...prev, `[ERROR] ${msg}`]);
      showToast(`Compilation error: ${msg}`, 'error');
    } finally { setIsCompiling(false); }
  }, [activeFile, boardVariant, sdkVersion, psramMode, flashSize, usbCdcMode, partitionScheme, showToast]);

  const connectSerial = useCallback(async () => {
    if (!('serial' in navigator)) { showToast('Web Serial not supported', 'error'); return; }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;
      setSerialConnected(true); setHardwareConnected(true);
      setSerialLines(prev => [...prev, '[Serial] Connected']);
      showToast('Serial connected', 'success');
      const decoder = new TextDecoderStream();
      port.readable!.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      serialReaderRef.current = reader;
      (async () => { try { while (true) { const { value, done } = await reader.read(); if (done) break; if (value) setSerialLines(prev => [...prev.slice(-200), ...value.split('\n').filter(Boolean)]); } } catch {} })();
    } catch (err: any) { if (err.name !== 'NotFoundError') showToast(`Serial error: ${err.message}`, 'error'); }
  }, [showToast]);

  const disconnectSerial = useCallback(async () => {
    try { if (serialReaderRef.current) { await serialReaderRef.current.cancel(); serialReaderRef.current = null; } if (serialPortRef.current) { await serialPortRef.current.close(); serialPortRef.current = null; } } catch {}
    setSerialConnected(false); setHardwareConnected(false);
    setSerialLines(prev => [...prev, '[Serial] Disconnected']);
    showToast('Serial disconnected', 'info');
  }, [showToast]);

  const sendSerialLine = useCallback(async () => {
    if (!serialPortRef.current || !serialInput) return;
    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(serialPortRef.current.writable!);
    const writer = encoder.writable.getWriter();
    await writer.write(serialInput + '\n');
    writer.releaseLock();
    setSerialInput('');
  }, [serialInput]);

  const handleFlash = useCallback(async () => {
    if (!compiledBinary) { showToast('Compile first', 'warning'); return; }
    if (!serialPortRef.current) { showToast('Connect hardware first', 'warning'); return; }
    setIsFlashing(true); setFlashProgress(0);
    setConsoleLogs(prev => [...prev, '[FLASH] Starting firmware upload...']);
    try {
      const { ESPLoader, Transport } = await import('esptool-js');
      const transport = new Transport(serialPortRef.current, true);
      const loader = new ESPLoader({ transport, baudrate: 115200, romfamily: 'ESP32-S3' });
      await loader.main();
      setFlashProgress(30);
      setConsoleLogs(prev => [...prev, '[FLASH] Chip detected, writing firmware...']);
      const binaryData = Uint8Array.from(atob(compiledBinary), c => c.charCodeAt(0));
      await loader.writeFlash({ fileArray: [{ data: binaryData, address: 0x10000 }], eraseAll: false, compress: true });
      setFlashProgress(90);
      await loader.hardReset();
      setFlashProgress(100);
      setConsoleLogs(prev => [...prev, '[SUCCESS] Firmware flashed!']);
      showToast('Firmware flashed!', 'success');
    } catch (err: any) {
      setConsoleLogs(prev => [...prev, `[FLASH ERROR] ${err?.message || err}`]);
      showToast('Flash failed', 'error');
    } finally { setIsFlashing(false); setFlashProgress(0); }
  }, [compiledBinary, showToast]);

  const toggleLibrary = useCallback(async (lib: LibItem) => {
    try {
      await fetch(lib.installed ? '/api/libraries/uninstall' : '/api/libraries/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lib.id })
      });
      setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, installed: !l.installed } : l));
      showToast(lib.installed ? `Removed ${lib.name}` : `Installed ${lib.name}`, 'success');
    } catch { showToast('Library operation failed', 'error'); }
  }, [showToast]);

  const addFile = useCallback(() => {
    const name = prompt('File name (e.g. utils.h):');
    if (!name) return;
    const ext = name.split('.').pop() || 'ino';
    setFiles(prev => [...prev, { path: name, content: '', language: ext === 'h' || ext === 'hpp' ? 'cpp' : 'cpp' }]);
    setActiveFileIdx(files.length);
  }, [files.length]);

  const removeFile = useCallback((idx: number) => {
    if (files.length <= 1) return;
    setFiles(prev => prev.filter((_, i) => i !== idx));
    if (activeFileIdx >= files.length - 1) setActiveFileIdx(Math.max(0, files.length - 2));
  }, [files, activeFileIdx]);

  const updateFileContent = useCallback((value: string | undefined) => {
    if (value === undefined) return;
    setFiles(prev => prev.map((f, i) => i === activeFileIdx ? { ...f, content: value } : f));
  }, [activeFileIdx]);

  const handleZipUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('library', file);
    try {
      const res = await fetch('/api/libraries/upload-zip', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); const libRes = await fetch(`/api/libraries?category=${libCategory}&q=${libSearch}`); setLibraries(await libRes.json()); }
      else showToast(data.error || 'Upload failed', 'error');
    } catch { showToast('Upload failed', 'error'); }
    if (uploadZipRef.current) uploadZipRef.current.value = '';
  }, [libCategory, libSearch, showToast]);

  const categories = ['All', 'Communication', 'Display', 'Sensors', 'IoT', 'Data Processing', 'Control', 'Human Interface', 'Custom'];

  const renderEditor = () => (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center bg-[#18181b] border-b border-zinc-800 px-2 h-9 shrink-0 overflow-x-auto">
        {files.map((f, i) => (
          <button key={f.path} onClick={() => setActiveFileIdx(i)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
              i === activeFileIdx ? 'text-white bg-[#1e1e22] border-b-2 border-[#00979c]' : 'text-zinc-500 hover:text-zinc-300')}>
            <FileCode size={12} />{f.path}
            {files.length > 1 && <span onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="ml-1 hover:text-red-400"><X size={10} /></span>}
          </button>
        ))}
        <button onClick={addFile} className="px-2 py-1 text-zinc-500 hover:text-white"><Plus size={14} /></button>
      </div>
      <div className="flex-1 min-h-0">
        <Editor height="100%" language="cpp" theme="vs-dark" value={activeFile.content} onChange={updateFileContent}
          options={{ fontSize: 13, fontFamily: '"JetBrains Mono", monospace', minimap: { enabled: !isMobile }, scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, automaticLayout: true, padding: { top: 8 } }} />
      </div>
    </div>
  );

  const renderConsole = () => (
    <div className={cn('border-t border-zinc-800 bg-[#0f0f12] flex flex-col shrink-0', consoleCollapsed ? 'h-8' : isMobile ? 'h-40' : 'h-44')}>
      <div className="flex items-center justify-between px-3 h-8 bg-[#18181b] cursor-pointer select-none shrink-0" onClick={() => setConsoleCollapsed(!consoleCollapsed)}>
        <div className="flex items-center gap-2 text-xs text-zinc-400"><Terminal size={12} /><span>Console</span>
          {memoryUsage.flash !== '-' && <span className="ml-2 text-[10px] text-emerald-400 font-mono">Flash: {memoryUsage.flash} | RAM: {memoryUsage.ram}</span>}
        </div>
        {consoleCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </div>
      {!consoleCollapsed && (
        <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-zinc-400 content-scrollbar">
          {consoleLogs.map((log, i) => <div key={i} className={cn(log.includes('[ERROR]') && 'text-red-400', log.includes('[SUCCESS]') && 'text-emerald-400', log.includes('[FLASH') && 'text-sky-400')}>{log}</div>)}
        </div>
      )}
    </div>
  );

  const renderSerialMonitor = () => (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      <div className="flex items-center justify-between px-3 h-9 bg-[#18181b] border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 text-xs text-zinc-400"><Monitor size={12} /><span>Serial Monitor</span>
          <span className={cn('w-2 h-2 rounded-full', serialConnected ? 'bg-emerald-400' : 'bg-zinc-600')} />
        </div>
        {serialConnected ? (
          <button onClick={disconnectSerial} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-red-500/10 text-red-400 rounded hover:bg-red-500/20"><Unplug size={10} /> Disconnect</button>
        ) : (
          <button onClick={connectSerial} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#00979c]/10 text-[#00979c] rounded hover:bg-[#00979c]/20"><Plug size={10} /> Connect</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] text-zinc-400 content-scrollbar">
        {serialLines.map((line, i) => <div key={i}>{line}</div>)}
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-[#18181b] border-t border-zinc-800 shrink-0">
        <input value={serialInput} onChange={e => setSerialInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendSerialLine()}
          placeholder="Send to serial..." disabled={!serialConnected}
          className="flex-1 bg-[#0f0f12] border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-[#00979c] disabled:opacity-50" />
        <button onClick={sendSerialLine} disabled={!serialConnected || !serialInput} className="px-2 py-1 text-xs bg-[#00979c]/10 text-[#00979c] rounded hover:bg-[#00979c]/20 disabled:opacity-50">Send</button>
      </div>
    </div>
  );

  const renderLibraryManager = () => (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      <div className="px-4 py-3 bg-[#18181b] border-b border-zinc-800 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Library size={14} /> Libraries</h3>
          <div><input ref={uploadZipRef} type="file" accept=".zip" onChange={handleZipUpload} className="hidden" />
            <button onClick={() => uploadZipRef.current?.click()} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#00979c]/10 text-[#00979c] rounded hover:bg-[#00979c]/20"><Upload size={10} /> Import ZIP</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Search libraries..."
              className="w-full bg-[#0f0f12] border border-zinc-800 rounded pl-7 pr-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#00979c]" />
          </div>
          <select value={libCategory} onChange={e => setLibCategory(e.target.value)}
            className="bg-[#0f0f12] border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#00979c]">
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 content-scrollbar">
        {libraries.map(lib => (
          <div key={lib.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors">
            <div className="min-w-0"><div className="text-xs font-semibold text-white truncate">{lib.name}</div><div className="text-[10px] text-zinc-500 truncate">{lib.author} - {lib.description}</div></div>
            <button onClick={() => toggleLibrary(lib)}
              className={cn('shrink-0 px-2 py-1 rounded text-[10px] font-bold transition-all',
                lib.installed ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-[#00979c]/10 text-[#00979c] hover:bg-[#00979c]/20')}>
              {lib.installed ? 'Remove' : 'Install'}
            </button>
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
        {[{ label: 'Board', val: boardVariant, set: setBoardVariant, opts: [['esp32s3', 'ESP32-S3 DevKitC-1'], ['adafruit_feather_esp32s3', 'Adafruit Feather S3'], ['seeed_xiao_esp32s3', 'Seeed XIAO S3'], ['esp32s3_cam', 'ESP32-S3 Camera']] },
          { label: 'SDK', val: sdkVersion, set: setSdkVersion, opts: [['v3.0.1', 'Core v3.0.1'], ['v2.0.17', 'Core v2.0.17'], ['esp-idf', 'ESP-IDF v5.2']] },
          { label: 'PSRAM', val: psramMode, set: setPsramMode, opts: [['opi', 'OPI PSRAM'], ['qio', 'QIO PSRAM'], ['sram', 'SRAM Only']] },
          { label: 'Flash', val: flashSize, set: setFlashSize, opts: [['4MB', '4 MB'], ['8MB', '8 MB'], ['16MB', '16 MB']] },
          { label: 'USB CDC', val: usbCdcMode, set: setUsbCdcMode, opts: [['enabled', 'Enabled'], ['disabled', 'Disabled']] },
          { label: 'Partition', val: partitionScheme, set: setPartitionScheme, opts: [['default-16mb', 'Default 16MB'], ['default-8mb', 'Default 8MB'], ['default-4mb', 'Default 4MB'], ['huge-app', 'Huge App'], ['spiffs', 'With SPIFFS']] }
        ].map(({ label, val, set, opts }) => (
          <label key={label} className="space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{label}</span>
            <select value={val} onChange={e => set(e.target.value)}
              className="w-full bg-[#0f0f12] border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#00979c]">
              {(opts as string[][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  );

  const renderDeployPanel = () => (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      <div className="px-4 py-3 bg-[#18181b] border-b border-zinc-800 shrink-0">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Zap size={14} /> Deploy</h3>
      </div>
      <div className="flex-1 overflow-y-auto content-scrollbar">
        {renderBoardConfig()}
        <div className="px-4 py-3 border-t border-zinc-800 space-y-3">
          <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg',
            hardwareConnected ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-zinc-800/30 border border-zinc-800')}>
            {hardwareConnected ? <Usb size={14} className="text-emerald-400" /> : <Unplug size={14} className="text-zinc-500" />}
            <span className={cn('text-xs font-medium', hardwareConnected ? 'text-emerald-400' : 'text-zinc-500')}>
              {hardwareConnected ? 'Hardware Connected' : 'No Hardware Detected'}
            </span>
          </div>
          <button onClick={handleCompile} disabled={isCompiling}
            className={cn('w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
              isCompiling ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-[#00979c] hover:bg-[#00979c]/90 text-white shadow-lg')}>
            {isCompiling ? <><RefreshCw size={14} className="animate-spin" /> Compiling...</> : <><Play size={14} /> Compile</>}
          </button>
          <button onClick={handleFlash} disabled={isFlashing || !compiledBinary || !hardwareConnected}
            className={cn('w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
              isFlashing ? 'bg-sky-500/20 text-sky-400' : !compiledBinary || !hardwareConnected ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20')}>
            {isFlashing ? <><RefreshCw size={14} className="animate-spin" /> Flashing... {flashProgress}%</> : <><Download size={14} /> Flash to Board</>}
          </button>
          {isFlashing && <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden"><div className="bg-sky-400 h-full transition-all duration-300" style={{ width: `${flashProgress}%` }} /></div>}
          {compiledBinary && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-800/30 rounded-lg p-2 flex items-center gap-2"><HardDrive size={12} className="text-emerald-400" /><div><div className="text-[10px] text-zinc-500">Flash</div><div className="text-xs font-bold text-white">{memoryUsage.flash}</div></div></div>
              <div className="bg-zinc-800/30 rounded-lg p-2 flex items-center gap-2"><MemoryStick size={12} className="text-sky-400" /><div><div className="text-[10px] text-zinc-500">RAM</div><div className="text-xs font-bold text-white">{memoryUsage.ram}</div></div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-[#0d0e12]">
        <div className="flex items-center justify-between px-3 h-11 bg-[#18181b] border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2"><Cpu size={14} className="text-[#00979c]" /><span className="text-xs font-bold text-white">ESP32-S3</span></div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleCompile} disabled={isCompiling} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#00979c] rounded text-[10px] font-bold text-white disabled:opacity-50"><Play size={11} /> {isCompiling ? '...' : 'Build'}</button>
            <button onClick={handleFlash} disabled={isFlashing || !compiledBinary || !hardwareConnected} className="flex items-center gap-1 px-2.5 py-1.5 bg-sky-500/10 border border-sky-500/20 rounded text-[10px] font-bold text-sky-400 disabled:opacity-50"><Download size={11} /> Flash</button>
            <button onClick={connectSerial} className="p-1.5 text-zinc-400 hover:text-white">{serialConnected ? <Usb size={14} className="text-emerald-400" /> : <Plug size={14} />}</button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {mobileTab === 'editor' && <div className="flex flex-col h-full">{renderEditor()}{renderConsole()}</div>}
          {mobileTab === 'deploy' && renderDeployPanel()}
          {mobileTab === 'libraries' && renderLibraryManager()}
          {mobileTab === 'serial' && renderSerialMonitor()}
        </div>
        <div className="flex items-center justify-around bg-[#18181b] border-t border-zinc-800 h-14 shrink-0">
          {([['editor', FileCode, 'Editor'], ['deploy', Zap, 'Deploy'], ['libraries', Library, 'Libs'], ['serial', Terminal, 'Serial']] as [MobileTab, typeof FileCode, string][]).map(([key, Icon, label]) => (
            <button key={key} onClick={() => setMobileTab(key)}
              className={cn('flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 rounded-lg transition-all min-w-[56px]',
                mobileTab === key ? 'text-[#00979c]' : 'text-zinc-500 hover:text-zinc-300')}>
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