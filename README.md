# ESP32-S3 Web IDE

A professional, cross-platform ESP32-S3 development environment that works on desktop and smartphones with **real compilation, real flashing, and zero simulation**.

## Features

- **Real Compilation**: Uses `arduino-cli` on the backend to compile actual ESP32-S3 sketches into real binaries
- **Real Flashing**: Writes compiled firmware to actual ESP32-S3 hardware via Web Serial (desktop) or WebUSB (Android)
- **Cross-Platform**: Works on desktop Chrome/Edge and Android Chrome with USB OTG adapter
- **Mobile-First GUI**: CodeMirror 6 editor on mobile, Monaco Editor on desktop
- **30+ Built-in Libraries**: WiFi, Bluetooth, Display, Sensors, IoT, Storage, and more
- **Custom Library Import**: Upload .zip files to add your own libraries
- **Serial Monitor**: Real-time communication with your ESP32-S3
- **Board Configuration**: Choose board variant, PSRAM mode, flash size, USB CDC mode, partition scheme
- **Device Capability Detection**: Automatically detects what features your browser and hardware support

## Quick Start

### Desktop (Chrome/Edge on Windows/Mac/Linux)

1. **Prerequisites:**
   - Node.js (v16+)
   - Arduino CLI installed or available in PATH
   - ESP32-S3 board connected via USB cable

2. **Setup:**
   ```bash
   npm install
   npm run build
   npm run start
   ```

3. **Open in browser:**
   - Go to `http://localhost:3000`
   - Write or paste your Arduino sketch
   - Click "Compile" to build
   - Click "Connect" and select your ESP32-S3 port
   - Click "Flash to Board" to upload

### Android Phone (Chrome with USB OTG Adapter)

1. **Prerequisites:**
   - Android phone with Chrome browser
   - USB OTG adapter
   - ESP32-S3 board
   - Server running on desktop/laptop accessible from phone's network

2. **Setup:**
   - On server machine: run `npm run start`
   - Note the server IP address (shown in console)
   - On phone: connect to same WiFi network
   - Open Chrome and navigate to `http://<server-ip>:3000`
   - Connect USB OTG adapter → ESP32-S3 board
   - Follow same compile/flash workflow

## Architecture

### Backend (server.ts)

- **Real Compilation Only**: Uses `arduino-cli` to compile code. If not available, returns clear error (HTTP 503)
- **No Simulation**: Every response is either real binary output or a real error message
- **API Endpoints:**
  - `POST /api/compile` - Compile sketch code
  - `GET /api/compiler/status` - Check if compiler is ready
  - `GET /api/libraries` - List available libraries
  - `POST /api/libraries/install` - Install library
  - `POST /api/libraries/uninstall` - Uninstall library
  - `POST /api/libraries/upload-zip` - Import custom library from ZIP
  - `GET /api/boards` - List supported boards
  - `GET /api/health` - Server health check

### Frontend (React + TypeScript)

- **S3IDE.tsx** - Main IDE component with editor, console, serial monitor, deploy panel
- **CodeMirrorEditor.tsx** - Lightweight code editor for mobile (replaces Monaco on mobile)
- **serial-connection.ts** - Abstraction layer supporting both Web Serial and web-serial-polyfill
- **useDeviceCapabilities.ts** - Hook for detecting browser/hardware capabilities at startup

### Device Support

| Device | API | Connection | Status |
|--------|-----|-----------|--------|
| Desktop Chrome/Edge | Web Serial (native) | USB cable | ✅ Full support |
| Android Chrome | web-serial-polyfill (WebUSB) | USB OTG adapter | ✅ Full support |
| Safari | Not supported | - | ❌ No Web Serial |
| Firefox | Not supported | - | ❌ No Web Serial |

## Supported Boards

- ESP32-S3 DevKitC-1
- Adafruit Feather ESP32-S3
- Seeed Studio XIAO ESP32-S3
- ESP32-S3 Camera Module

## Built-in Libraries (30+)

**Communication**: WiFi, Wire (I2C), SPI, Bluetooth, Ethernet, HTTPClient, WebSockets

**Display**: Adafruit NeoPixel, FastLED, TFT_eSPI, LiquidCrystal I2C, Adafruit SSD1306

**Sensors**: DHT, Adafruit BME280/BMP280, Adafruit MPU6050, OneWire, DallasTemperature, ADXL345

**IoT**: PubSubClient (MQTT), ArduinoOTA

**Data Processing**: ArduinoJson

**Storage**: EEPROM, SD, SPIFFS, Preferences

**Control**: Servo, Stepper

**Human Interface**: ESP32-BLE-Keyboard

**Networking**: ESP32AsyncWebServer, AsyncTCP

## Development

### Local Development

```bash
npm install
npm run dev  # Runs with Vite hot reload
```

### Build for Production

```bash
npm run build  # Compiles frontend and server
npm run start  # Runs production build
```

### Type Checking

```bash
npx tsc --noEmit
```

## Technical Details

### Real Compilation Flow

1. User writes code in editor
2. Clicks "Compile"
3. Code is sent to `/api/compile` endpoint
4. Server runs: `arduino-cli compile --fqbn esp32:esp32:esp32s3 ...`
5. Compiler outputs real `.bin` files
6. Files are base64-encoded and sent to frontend
7. User downloads or flashes to board

### Real Flashing Flow

1. User connects ESP32-S3 via USB (desktop) or USB OTG (Android)
2. Clicks "Connect" to request serial port (browser prompts user to select port)
3. Browser establishes serial connection at 115200 baud
4. User clicks "Flash to Board"
5. esptool-js writes real binary to real flash memory
6. ESP32-S3 reboots and runs the uploaded code

### Mobile Support

**Desktop (native Web Serial):**
- Uses `navigator.serial` API directly
- Works out-of-the-box on Chrome/Edge

**Android (web-serial-polyfill):**
- Library bridges WebUSB to provide serial-like API
- Requires USB permission grant
- Works with any USB OTG adapter

## Error Handling

- **Compiler not available**: Returns HTTP 503 with error message — no fake output
- **Compilation fails**: Returns real compiler error output
- **Network unreachable**: Shows clear error in UI
- **Hardware not detected**: Shows status message with instructions
- **Browser not supported**: Displays capability message on startup

## Important: No Simulation

This IDE **never simulates compilation or flashing**. It is either:

1. **Working**: Real compilation via arduino-cli, real flashing to real hardware
2. **Failing with a clear error**: Compiler unavailable, hardware not detected, etc.

There is no fallback mode, no fake binaries, no simulated output. This ensures you always know exactly what will run on your device.

## Troubleshooting

### "Compilation server unavailable"
- Ensure server is running: `npm run start`
- Ensure `arduino-cli` is installed on server
- Try: `arduino-cli version` in terminal

### "Web Serial not available"
- Use Chrome or Edge (not Safari or Firefox)
- On Android, use Chrome with USB OTG adapter

### "Cannot connect to hardware"
- Check USB cable/adapter
- Grant browser permission when prompted
- Try replugging USB connection

### "Compiler initializing..."
- ESP32 core is being installed on first run
- Wait 1-2 minutes for setup to complete
- Server logs show progress

## License

MIT

## Support

For issues or questions, please refer to the [Arduino CLI documentation](https://github.com/arduino/arduino-cli) and [esptool-js documentation](https://github.com/espressif/esptool-js).
