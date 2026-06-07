// Abstraction layer for Web Serial and web-serial-polyfill
// Desktop Chrome/Edge: native navigator.serial
// Android Chrome: web-serial-polyfill bridges WebUSB to serial API

export interface SerialConnectionOptions {
  baudRate?: number;
  onData?: (data: string) => void;
  onError?: (error: Error) => void;
}

export class SerialConnection {
  private port: SerialPort | null = null;
  private reader: any = null;
  private isConnected = false;
  private options: Required<SerialConnectionOptions>;

  constructor(options: SerialConnectionOptions = {}) {
    this.options = {
      baudRate: options.baudRate || 115200,
      onData: options.onData || (() => {}),
      onError: options.onError || (() => {}),
    };
  }

  async requestPort(): Promise<boolean> {
    try {
      const serialAPI = this.getSerialAPI();
      if (!serialAPI) throw new Error("Web Serial API not available on this browser");
      this.port = await serialAPI.requestPort();
      return true;
    } catch (err) {
      if ((err as any).name !== "NotFoundError") {
        this.options.onError(err instanceof Error ? err : new Error(String(err)));
      }
      return false;
    }
  }

  async connect(): Promise<boolean> {
    if (!this.port) return false;
    try {
      await this.port.open({ baudRate: this.options.baudRate });
      this.isConnected = true;
      this.startReading();
      return true;
    } catch (err) {
      this.options.onError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  private startReading() {
    if (!this.port?.readable) return;
    const decoder = new TextDecoderStream();
    this.port.readable!.pipeTo(decoder.writable as any);
    this.reader = decoder.readable.getReader();
    (async () => {
      try {
        while (this.isConnected && this.reader) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this.options.onData(value);
        }
      } catch (err) {
        if (this.isConnected) this.options.onError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  }

  async write(data: string): Promise<boolean> {
    if (!this.port?.writable || !this.isConnected) return false;
    try {
      const encoder = new TextEncoderStream();
      encoder.readable.pipeTo(this.port.writable);
      const writer = encoder.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
      return true;
    } catch (err) {
      this.options.onError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    if (this.reader) { try { await this.reader.cancel(); } catch {} this.reader = null; }
    if (this.port) { try { await this.port.close(); } catch {} this.port = null; }
  }

  get connected(): boolean { return this.isConnected; }
  getPort(): SerialPort | null { return this.port; }

  private getSerialAPI(): any {
    if (typeof navigator !== "undefined" && (navigator as any).serial) return (navigator as any).serial;
    if (typeof window !== "undefined" && (window as any).__serialPolyfill?.serial) return (window as any).__serialPolyfill.serial;
    return null;
  }

  static isSerialAvailable(): boolean {
    if (typeof navigator !== "undefined" && (navigator as any).serial) return true;
    if (typeof window !== "undefined" && (window as any).__serialPolyfill?.serial) return true;
    return false;
  }

  static isWebSerialNative(): boolean {
    return typeof navigator !== "undefined" && !!(navigator as any).serial;
  }

  static isUsingPolyfill(): boolean {
    return !!(typeof window !== "undefined" && (window as any).__serialPolyfill?.serial) && !(typeof navigator !== "undefined" && (navigator as any).serial);
  }

  static isWebUSBAvailable(): boolean {
    return typeof navigator !== "undefined" && !!(navigator as any).usb;
  }
}
