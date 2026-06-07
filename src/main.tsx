import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

async function initSerialPolyfill() {
  if (typeof navigator !== 'undefined' && !(navigator as any).serial) {
    try {
      const { SerialPort } = await import('web-serial-polyfill');
      if ((navigator as any).usb) {
        (window as any).__serialPolyfill = { serial: { requestPort: () => (navigator as any).usb.requestDevice({ filters: [] }).then((usbDevice: any) => new SerialPort(usbDevice)), getPorts: () => Promise.resolve([]) } };
        console.log('[Serial] WebUSB polyfill initialized for Android support');
      }
    } catch (e) { console.log('[Serial] Polyfill not available:', e); }
  }
}
initSerialPolyfill();

const resizeObserverError = "ResizeObserver loop completed with undelivered notifications.";
const originalResizeObserver = window.ResizeObserver;
window.ResizeObserver = class ResizeObserver extends originalResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super((entries, observer) => { window.requestAnimationFrame(() => { if (!Array.isArray(entries) || !entries.length) return; callback(entries, observer); }); });
  }
};
window.addEventListener("error", (e) => {
  if (e.message === resizeObserverError || e.message === "ResizeObserver loop limit exceeded") e.stopImmediatePropagation();
});

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
