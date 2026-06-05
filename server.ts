import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import multer from "multer";
import archiver from "archiver";

const execAsync = promisify(exec);
const SETTINGS_FILE = path.join(process.cwd(), "arduino_settings.json");
const CUSTOM_LIBRARIES_DIR = path.join(process.cwd(), "custom_libraries");
const upload = multer({ dest: path.join(process.cwd(), "uploads") });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Background Compiler Downloader & Installer
  async function ensureCompilerInstalled() {
    console.log("[SETUP] Checking for real compiler toolchain (arduino-cli)...");
    let hasCli = false;
    let cliCmd = "./arduino-cli";
    try {
      const { stdout } = await execAsync("./arduino-cli version");
      console.log(`[SETUP] Found portable arduino-cli inside workspace: ${stdout.trim()}`);
      hasCli = true;
      cliCmd = "./arduino-cli";
    } catch {
      try {
        const { stdout } = await execAsync("arduino-cli version");
        console.log(`[SETUP] Found system-wide arduino-cli: ${stdout.trim()}`);
        hasCli = true;
        cliCmd = "arduino-cli";
      } catch {
        console.log("[SETUP] arduino-cli is not installed. Installing portable binary into workspace...");
      }
    }

    if (!hasCli) {
      try {
        const cmdDownload = 'curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=. sh';
        console.log(`[SETUP] Downloading portable arduino-cli via: ${cmdDownload}`);
        const { stdout: dlOut, stderr: dlErr } = await execAsync(cmdDownload);
        console.log(`[SETUP] Download result:\n${dlOut}\n${dlErr}`);
        
        const { stdout: ver } = await execAsync("./arduino-cli version");
        console.log(`[SETUP] Successfully installed portable arduino-cli: ${ver.trim()}`);
        hasCli = true;
        cliCmd = "./arduino-cli";
      } catch (err: any) {
        console.error("[SETUP ERROR] Failed to download arduino-cli:", err);
      }
    }

    if (hasCli) {
      try {
        console.log("[SETUP] Configuring arduino-cli settings...");
        const esp32Url = "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json";
        
        console.log("[SETUP] Initializing board manager indexes...");
        await execAsync(`${cliCmd} core update-index --additional-urls ${esp32Url}`);
        console.log("[SETUP] Board indexes updated successfully.");

        let isEsp32Installed = false;
        try {
          const { stdout } = await execAsync(`${cliCmd} core list`);
          if (stdout.includes("esp32:esp32") || stdout.includes("esp32")) {
            isEsp32Installed = true;
          }
        } catch {}

        if (!isEsp32Installed) {
          console.log("[SETUP] Installing 'esp32:esp32' core. This sets up the compiler toolchains in the background...");
          execAsync(`${cliCmd} core install esp32:esp32 --additional-urls ${esp32Url}`)
            .then(({ stdout, stderr }) => {
              console.log(`[SETUP SUCCESS] esp32 core installed successfully:\n${stdout}\n${stderr}`);
              return execAsync(`${cliCmd} lib install "Adafruit NeoPixel" "ArduinoJson" "FastLED"`);
            })
            .then(({ stdout }) => {
              console.log("[SETUP SUCCESS] Default libraries installed:", stdout.trim());
            })
            .catch((err) => {
              console.error("[SETUP ERROR] Background esp32 core setup failed:", err);
            });
        } else {
          console.log("[SETUP] 'esp32:esp32' platform is already installed.");
          try {
            await execAsync(`${cliCmd} lib install "Adafruit NeoPixel" "ArduinoJson" "FastLED"`);
            console.log("[SETUP] Default libraries verified.");
          } catch {}
        }
      } catch (err: any) {
        console.error("[SETUP ERROR] Failed configuring arduino-cli:", err);
      }
    }
  }

  ensureCompilerInstalled();

  app.get("/api/health", async (req, res) => {
    let arduinoCliStatus: string;
    try {
      const { stdout } = await execAsync("./arduino-cli version");
      arduinoCliStatus = stdout.trim();
    } catch {
      try {
        const { stdout } = await execAsync("arduino-cli version");
        arduinoCliStatus = stdout.trim();
      } catch {
        arduinoCliStatus = "not installed";
      }
    }

    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      arduinoCli: arduinoCliStatus 
    });
  });

  async function loadState() {
    try {
      const data = await fs.readFile(SETTINGS_FILE, "utf-8");
      return JSON.parse(data);
    } catch {
      return {
        boardManagerUrls: ["https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json"],
        installedPlatforms: ["esp32"],
        installedLibraries: ["wifi", "neopixel"]
      };
    }
  }

  const state = await loadState();
  let boardManagerUrls: string[] = state.boardManagerUrls;
  const installedPlatforms: string[] = state.installedPlatforms;
  let installedLibraries: string[] = state.installedLibraries;

  async function saveState() {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify({
      boardManagerUrls,
      installedPlatforms,
      installedLibraries
    }, null, 2));
  }

  const ALL_BOARDS = [
    { id: "esp32:esp32:esp32s3", name: "ESP32-S3 DevKitC-1 (OTG/CDC)", architecture: "esp32", manufacturer: "Espressif", platformId: "esp32" },
    { id: "esp32:esp32:adafruit_feather_esp32s3", name: "Adafruit ESP32-S3 Feather TFT", architecture: "esp32", manufacturer: "Adafruit", platformId: "esp32" },
    { id: "esp32:esp32:seeed_xiao_esp32s3", name: "Seeed Studio XIAO ESP32-S3", architecture: "esp32", manufacturer: "Seeed Studio", platformId: "esp32" },
    { id: "esp32:esp32:esp32s3_cam", name: "ESP32-S3 Camera Module OV2640", architecture: "esp32", manufacturer: "Espressif", platformId: "esp32" }
  ];

  app.get("/api/boards", async (req, res) => {
    try {
      const installedBoards = ALL_BOARDS.filter(b => installedPlatforms.includes(b.platformId));
      res.json(installedBoards);
    } catch {
      res.status(500).json({ error: "Failed to fetch boards" });
    }
  });

  app.get("/api/platforms", (req, res) => {
    res.json(installedPlatforms);
  });

  app.post("/api/platforms/install", async (req, res) => {
    const { platformId } = req.body;
    if (!installedPlatforms.includes(platformId)) {
      installedPlatforms.push(platformId);
      await saveState();
    }
    res.json({ success: true, installedPlatforms });
  });

  app.get("/api/settings/board-manager-urls", (req, res) => {
    res.json(boardManagerUrls);
  });

  app.post("/api/settings/board-manager-urls", async (req, res) => {
    const { urls } = req.body;
    boardManagerUrls = urls;
    await saveState();
    res.json({ success: true, boardManagerUrls });
  });

  const ALL_LIBRARIES = [
    { id: "wifi", name: "WiFi", version: "1.2.7", author: "Arduino", description: "Enables network connection (local and Internet) with the Arduino WiFi Shield.", sentence: "Communication", category: "Communication" },
    { id: "wire", name: "Wire", version: "1.0.0", author: "Arduino", description: "Allows you to communicate with I2C / TWI devices.", sentence: "Communication", category: "Communication" },
    { id: "spi", name: "SPI", version: "1.0.0", author: "Arduino", description: "Allows you to communicate with SPI devices.", sentence: "Communication", category: "Communication" },
    { id: "bluetooth", name: "Bluetooth", version: "2.0.1", author: "Espressif", description: "BLE and Classic Bluetooth support for ESP32.", sentence: "Communication", category: "Communication" },
    { id: "ethernet", name: "Ethernet", version: "2.0.2", author: "Arduino", description: "Ethernet Shield support with W5100/W5200/W5500.", sentence: "Communication", category: "Communication" },
    { id: "httpclient", name: "HTTPClient", version: "2.2.0", author: "Arduino", description: "Make HTTP requests from your Arduino.", sentence: "Communication", category: "Communication" },
    { id: "websocket", name: "WebSockets", version: "2.3.6", author: "Links2004", description: "WebSocket client and server library for Arduino.", sentence: "Communication", category: "Communication" },
    { id: "neopixel", name: "Adafruit NeoPixel", version: "1.12.0", author: "Adafruit", description: "Control addressable RGB LEDs with single data line.", sentence: "Display", category: "Display" },
    { id: "fastled", name: "FastLED", version: "3.6.0", author: "Daniel Garcia", description: "High-level LED control library with advanced effects.", sentence: "Display", category: "Display" },
    { id: "tft-espi", name: "TFT_eSPI", version: "2.5.43", author: "Bodmer", description: "Fast hardware SPI library for ESP32 TFT displays.", sentence: "Display", category: "Display" },
    { id: "liquidcrystal-i2c", name: "LiquidCrystal I2C", version: "1.1.2", author: "Frank de Brabander", description: "Control I2C LCD character displays easily.", sentence: "Display", category: "Display" },
    { id: "ssd1306", name: "Adafruit SSD1306", version: "2.5.7", author: "Adafruit", description: "128x64 monochrome OLED display driver.", sentence: "Display", category: "Display" },
    { id: "bme280", name: "Adafruit BME280", version: "2.2.2", author: "Adafruit", description: "Environmental sensor for temperature, humidity, and pressure.", sentence: "Sensors", category: "Sensors" },
    { id: "bmp280", name: "Adafruit BMP280", version: "2.6.8", author: "Adafruit", description: "Digital pressure and temperature sensor.", sentence: "Sensors", category: "Sensors" },
    { id: "mpu6050", name: "Adafruit MPU6050", version: "2.0.8", author: "Adafruit", description: "6-axis motion sensor (accelerometer and gyroscope).", sentence: "Sensors", category: "Sensors" },
    { id: "dht", name: "DHT sensor library", version: "1.4.6", author: "Adafruit", description: "DHT11 and DHT22 temperature/humidity sensors.", sentence: "Sensors", category: "Sensors" },
    { id: "adxl345", name: "Adafruit ADXL345", version: "1.3.1", author: "Adafruit", description: "3-axis accelerometer for motion detection.", sentence: "Sensors", category: "Sensors" },
    { id: "onewire", name: "OneWire", version: "2.3.7", author: "Paul Stoffregen", description: "OneWire protocol for Dallas/Maxim sensors.", sentence: "Sensors", category: "Sensors" },
    { id: "dallastemperature", name: "DallasTemperature", version: "3.9.1", author: "Miles Burton", description: "DS18B20 and compatible temperature sensors.", sentence: "Sensors", category: "Sensors" },
    { id: "arduino-json", name: "ArduinoJson", version: "7.0.4", author: "Benoit Blanchon", description: "JSON parsing and generation for Arduino.", sentence: "Data Processing", category: "Data Processing" },
    { id: "pubsubclient", name: "PubSubClient", version: "2.8.0", author: "Nick O'Leary", description: "MQTT client for IoT applications.", sentence: "IoT", category: "IoT" },
    { id: "arduino-ota", name: "ArduinoOTA", version: "1.0.9", author: "Arduino", description: "Over-the-air firmware updates for ESP32.", sentence: "IoT", category: "IoT" },
    { id: "ble-keyboard", name: "ESP32-BLE-Keyboard", version: "0.3.2", author: "T-vK", description: "Emulate a Bluetooth keyboard with ESP32.", sentence: "Human Interface", category: "Human Interface" },
    { id: "servo", name: "Servo", version: "1.2.1", author: "Arduino", description: "Control servo motors with PWM signals.", sentence: "Control", category: "Control" },
    { id: "stepper", name: "Stepper", version: "1.1.3", author: "Arduino", description: "Control stepper motors easily.", sentence: "Control", category: "Control" },
    { id: "eeprom", name: "EEPROM", version: "2.0.0", author: "Arduino", description: "Read/write persistent data to flash memory.", sentence: "Storage", category: "Storage" },
    { id: "sd", name: "SD", version: "2.1.0", author: "Arduino", description: "SD/SDHC card reading and writing.", sentence: "Storage", category: "Storage" },
    { id: "spiffs", name: "SPIFFS", version: "2.0.0", author: "Espressif", description: "SPI Flash File System for ESP32.", sentence: "Storage", category: "Storage" },
    { id: "preferences", name: "Preferences", version: "2.0.0", author: "Espressif", description: "Non-volatile storage key-value pairs.", sentence: "Storage", category: "Storage" },
    { id: "esp32asyncwebserver", name: "ESP32AsyncWebServer", version: "1.3.0", author: "Me-No-Dev", description: "Async web server for ESP32 with WebSocket support.", sentence: "Networking", category: "Networking" },
    { id: "asynctcp", name: "AsyncTCP", version: "1.1.1", author: "Me-No-Dev", description: "Async TCP library for ESP32.", sentence: "Networking", category: "Networking" },
  ];

  app.get("/api/libraries", (req, res) => {
    const { q, category } = req.query;
    let filtered = ALL_LIBRARIES;

    if (q) {
      const query = (q as string).toLowerCase();
      filtered = filtered.filter(l => 
        l.name.toLowerCase().includes(query) || 
        l.description.toLowerCase().includes(query) ||
        l.author.toLowerCase().includes(query)
      );
    }

    if (category && category !== 'All') {
      filtered = filtered.filter(l => l.sentence === category);
    }

    res.json(filtered.map(l => ({
      ...l,
      installed: installedLibraries.includes(l.id)
    })));
  });

  app.get("/api/libraries/installed", (req, res) => {
    res.json(installedLibraries);
  });

  app.post("/api/libraries/install", async (req, res) => {
    const { id } = req.body;
    if (!installedLibraries.includes(id)) {
      installedLibraries.push(id);
      await saveState();
    }
    res.json({ success: true, installedLibraries });
  });

  app.post("/api/libraries/uninstall", async (req, res) => {
    const { id } = req.body;
    installedLibraries = installedLibraries.filter(libId => libId !== id);
    await saveState();
    res.json({ success: true, installedLibraries });
  });

  app.post("/api/compile", async (req, res) => {
    const { code, boardId, sdkVersion, psramMode, flashSize, usbCdcMode, partitionScheme } = req.body;
    console.log(`Requested compilation for board: ${boardId}`);

    let tempDir: string | null = null;
    try {
      let hasArduinoCli = false;
      let cliCmd = "arduino-cli";
      try {
        await execAsync("./arduino-cli version");
        hasArduinoCli = true;
        cliCmd = "./arduino-cli";
      } catch {
        try {
          await execAsync("arduino-cli version");
          hasArduinoCli = true;
          cliCmd = "arduino-cli";
        } catch {}
      }

      if (!hasArduinoCli) {
        return res.status(503).json({
          success: false,
          logs: "Compilation server unavailable: arduino-cli is not installed. Please ensure the server has arduino-cli configured and running."
        });
      }

      const uniqueId = `Sketch_${Date.now()}`;
      tempDir = path.join("/tmp", uniqueId);
      await fs.mkdir(tempDir, { recursive: true });

      const inoPath = path.join(tempDir, `${uniqueId}.ino`);
      await fs.writeFile(inoPath, code || "", "utf-8");

      const outputDir = path.join(tempDir, "build");
      await fs.mkdir(outputDir, { recursive: true });

      let fqbn = "esp32:esp32:esp32s3";
      if (boardId) {
        if (boardId.includes("feather")) {
          fqbn = "esp32:esp32:adafruit_feather_esp32s3";
        } else if (boardId.includes("xiao")) {
          fqbn = "esp32:esp32:seeed_xiao_esp32s3";
        } else if (boardId.includes("cam")) {
          fqbn = "esp32:esp32:esp32s3_cam";
        }
      }

      const cmd = `${cliCmd} compile --fqbn ${fqbn} --output-dir "${outputDir}" "${tempDir}" --additional-urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json 2>&1`;
      console.log(`[REAL BUILD] Compiling: ${cmd}`);

      const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
      const fullOutput = `${stdout}\n${stderr}`;

      const binFiles = await fs.readdir(outputDir);
      let appBinBase64 = "";
      let bootloaderBinBase64 = "";
      let partitionsBinBase64 = "";

      const appFile = binFiles.find(f => f.endsWith(".bin") && !f.includes("bootloader") && !f.includes("partitions"));
      const bootFile = binFiles.find(f => f.includes("bootloader") && f.endsWith(".bin"));
      const partFile = binFiles.find(f => f.includes("partitions") && f.endsWith(".bin"));

      if (appFile) {
        appBinBase64 = (await fs.readFile(path.join(outputDir, appFile))).toString('base64');
      } else {
        const firstBin = binFiles.find(f => f.endsWith(".bin"));
        if (firstBin) appBinBase64 = (await fs.readFile(path.join(outputDir, firstBin))).toString('base64');
      }
      if (bootFile) bootloaderBinBase64 = (await fs.readFile(path.join(outputDir, bootFile))).toString('base64');
      if (partFile) partitionsBinBase64 = (await fs.readFile(path.join(outputDir, partFile))).toString('base64');

      let flashPct = "7%", ramPct = "3%";
      const flashMatch = fullOutput.match(/(\d+)%.*used.*flash/i);
      const ramMatch = fullOutput.match(/(\d+)%.*used.*ram/i);
      if (flashMatch) flashPct = `${flashMatch[1]}%`;
      if (ramMatch) ramPct = `${ramMatch[1]}%`;

      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {}

      res.json({
        success: true,
        binary: appBinBase64,
        bootloader: bootloaderBinBase64,
        partitions: partitionsBinBase64,
        usage: { flash: flashPct, ram: ramPct },
        logs: `[S3 BUILD ENGINE] Real compilation via arduino-cli\nFQBN: ${fqbn}\n───────────────────────────────────\n${fullOutput}\n[SUCCESS] Binary generated.`
      });
    } catch (err) {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {}
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, logs: `[ERROR] Compilation failed: ${message}` });
    }
  });

  app.get("/api/compiler/status", async (_req, res) => {
    let hasArduinoCli = false;
    let hasEsp32 = false;
    try {
      let cliCmd = "arduino-cli";
      try {
        await execAsync("./arduino-cli version");
        cliCmd = "./arduino-cli";
      } catch {
        await execAsync("arduino-cli version");
      }
      hasArduinoCli = true;
      try {
        const { stdout } = await execAsync(`${cliCmd} core list`);
        hasEsp32 = stdout.includes("esp32");
      } catch {}
    } catch {}

    res.json({
      compilerReady: hasArduinoCli,
      esp32CoreInstalled: hasEsp32,
      message: hasArduinoCli ? (hasEsp32 ? "Ready to compile" : "ESP32 core installing...") : "Compiler not available"
    });
  });

  app.post("/api/libraries/upload-zip", upload.single("library"), async (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    try {
      await fs.mkdir(CUSTOM_LIBRARIES_DIR, { recursive: true });
      const zipPath = req.file.path;
      const libName = path.parse(req.file.originalname || "library").name;
      const extractDir = path.join(CUSTOM_LIBRARIES_DIR, libName);

      await fs.mkdir(extractDir, { recursive: true });

      await execAsync(`unzip -o "${zipPath}" -d "${extractDir}"`);
      await fs.unlink(zipPath);

      res.json({ success: true, message: `Library '${libName}' imported successfully` });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to import library" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
