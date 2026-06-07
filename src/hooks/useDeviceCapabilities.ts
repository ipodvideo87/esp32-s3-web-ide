import { useState, useEffect } from 'react';
import { SerialConnection } from '../lib/serial-connection';

export interface DeviceCapabilities {
  hasWebSerial: boolean;
  isNativeWebSerial: boolean;
  isPolyfillAvailable: boolean;
  hasWebUSB: boolean;
  compilerReady: boolean;
  esp32CoreReady: boolean;
  browser: string;
  isMobile: boolean;
  serialMethod: string;
  message: string;
}

export function useDeviceCapabilities() {
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>({
    hasWebSerial: false, isNativeWebSerial: false, isPolyfillAvailable: false, hasWebUSB: false,
    compilerReady: false, esp32CoreReady: false, browser: "unknown", isMobile: false,
    serialMethod: "none", message: "Detecting...",
  });

  useEffect(() => {
    const detect = async () => {
      const ua = navigator.userAgent;
      let browser = "Unknown";
      if (ua.includes("Edg")) browser = "Edge";
      else if (ua.includes("Chrome")) browser = "Chrome";
      else if (ua.includes("Safari")) browser = "Safari";
      else if (ua.includes("Firefox")) browser = "Firefox";

      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua) || window.innerWidth < 768;
      const hasWebSerial = SerialConnection.isSerialAvailable();
      const isNative = SerialConnection.isWebSerialNative();
      const isPolyfill = SerialConnection.isUsingPolyfill();
      const hasWebUSB = SerialConnection.isWebUSBAvailable();

      let compilerReady = false; let esp32CoreReady = false;
      try {
        const res = await fetch("/api/compiler/status");
        if (res.ok) { const data = await res.json(); compilerReady = data.compilerReady; esp32CoreReady = data.esp32CoreInstalled; }
      } catch {}

      let serialMethod = "none"; let message = "";
      if (hasWebSerial) {
        serialMethod = isNative ? "native" : "polyfill";
        message = compilerReady ? "Ready: Connect your ESP32-S3 via USB" + (isMobile ? " OTG adapter" : " cable") : "Compiler initializing...";
      } else if (hasWebUSB && (browser === "Chrome" || browser === "Edge")) {
        serialMethod = "webusb-possible";
        message = isMobile ? "Connect via USB OTG adapter. If serial doesn't appear, try reloading." : "Web Serial should be available in this browser.";
      } else if (browser === "Safari" || browser === "Firefox") {
        serialMethod = "unsupported";
        message = `${browser} does not support Web Serial. Please use Chrome or Edge to flash hardware.`;
      } else {
        serialMethod = "unsupported";
        message = "This browser does not support Web Serial. Use Chrome or Edge.";
      }
      if (!compilerReady && hasWebSerial) message = "Server not reachable. Ensure the compilation server is running.";

      setCapabilities({ hasWebSerial, isNativeWebSerial: isNative, isPolyfillAvailable: isPolyfill, hasWebUSB, compilerReady, esp32CoreReady, browser, isMobile, serialMethod, message });
    };
    detect();
    const interval = setInterval(detect, 10000);
    return () => clearInterval(interval);
  }, []);

  return capabilities;
}
