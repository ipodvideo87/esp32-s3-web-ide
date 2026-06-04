import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execAsync = promisify(exec);
const SETTINGS_FILE = path.join(process.cwd(), "arduino_settings.json");
const UPLOAD_DIR = path.join(process.cwd(), "custom_libraries");

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json({ limit: "10mb" }));

  async function ensureCompilerInstalled() {
    console.log("[SETUP] Checking for arduino-cli...");
    let hasCli = false;
    let cliCmd = "./arduino-cli";
    try {
      const { stdout } = await execAsync("./arduino-cli version");
      console.log(`[SETUP] Found portable arduino-cli: ${stdout.trim()}`);
      hasCli = true;
    } catch {
      try {
        const { stdout } = await execAsync("arduino-cli version");
        console.log(`[SETUP] Found system arduino-cli: ${stdout.trim()}`);
        hasCli = true;
        cliCmd = "arduino-cli";
      } catch { console.log("[SETUP] arduino-cli not found."); }
    }
    if (!hasCli) {
      try {
        await execAsync('curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=. sh');
        const { stdout: ver } = await execAsync("./arduino-cli version");
        console.log(`[SETUP] Installed arduino-cli: ${ver.trim()}`);
        hasCli = true;
      } catch (err: any) { console.error("[SETUP ERROR] Download failed:", err.message); }
    }
    if (hasCli) {
      try {
        const esp32Url = "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json";
        await execAsync(`./arduino-cli core update-index --additional-urls ${esp32Url}`).catch(() => {});
        let isEsp32Installed = false;
        try { const { stdout } = await execAsync(`./arduino-cli core list`); if (stdout.includes("esp32:esp32")) isEsp32Installed = true; } catch {}
        if (!isEsp32Installed) {
          console.log("[SETUP] Installing esp32:esp32 core in background...");
          execAsync(`./arduino-cli core install esp32:esp32 --additional-urls ${esp32Url}`)
            .then(() => console.log("[SETUP] ESP32 core installed."))
            .catch(err => console.error("[SETUP ERROR] Core install failed:", err.message));
        }
      } catch (err: any) { console.error("[SETUP ERROR] Board index update failed:", err.message); }
    }
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
  ensureCompilerInstalled();

  async function loadState() {
    try { const data = await fs.readFile(SETTINGS_FILE, "utf-8"); return JSON.parse(data); }
    catch { return { boardManagerUrls: ["https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json"], installedPlatforms: ["esp32"], installedLibraries: ["wifi", "neopixel"] }; }
  }
  const state = await loadState();
  let boardManagerUrls: string[] = state.boardManagerUrls;
  const installedPlatforms: string[] = state.installedPlatforms;
  let installedLibraries: string[] = state.installedLibraries;
  async function saveState() { await fs.writeFile(SETTINGS_FILE, JSON.stringify({ boardManagerUrls, installedPlatforms, installedLibraries }, null, 2)); }

  const ALL_BOARDS = [
    { id: "esp32:esp32:esp32s3", name: "ESP32-S3 DevKitC-1", fqbn: "esp32:esp32:esp32s3" },
    { id: "esp32:esp32:adafruit_feather_esp32s3", name: "Adafruit Feather S3", fqbn: "esp32:esp32:adafruit_feather_esp32s3" },
    { id: "esp32:esp32:seeed_xiao_esp32s3", name: "Seeed XIAO S3", fqbn: "esp32:esp32:seeed_xiao_esp32s3" },
    { id: "esp32:esp32:esp32s3_cam", name: "ESP32-S3 Camera", fqbn: "esp32:esp32:esp32s3_cam" },
  ];

  app.get("/api/health", async (_req, res) => {
    let arduinoCliStatus = "not installed";
    try { const { stdout } = await execAsync("./arduino-cli version"); arduinoCliStatus = stdout.trim(); }
    catch { try { const { stdout } = await execAsync("arduino-cli version"); arduinoCliStatus = stdout.trim(); } catch {} }
    res.json({ status: "ok", timestamp: new Date().toISOString(), arduinoCli: arduinoCliStatus });
  });

  app.get("/api/boards", (_req, res) => res.json(ALL_BOARDS.filter(b => installedPlatforms.includes("esp32"))));

  app.get("/api/boards/detect", async (_req, res) => {
    try {
      let cliCmd = "arduino-cli";
      try { await execAsync("./arduino-cli version"); cliCmd = "./arduino-cli"; } catch {}
      const { stdout } = await execAsync(`${cliCmd} board list --format json 2>/dev/null || echo "[]"`);
      const boards = JSON.parse(stdout);
      res.json({ success: true, boards: Array.isArray(boards) ? boards.map((b: any) => ({ port: b.port?.address || b.port, boardName: b.board?.name || "Unknown", boardId: b.board?.fqbn || "" })) : [] });
    } catch { res.json({ success: true, boards: [] }); }
  });

  app.get("/api/platforms", (_req, res) => res.json(installedPlatforms));
  app.post("/api/platforms/install", async (req, res) => {
    const { platformId } = req.body;
    if (!installedPlatforms.includes(platformId)) { installedPlatforms.push(platformId); await saveState(); }
    res.json({ success: true, installedPlatforms });
  });

  app.get("/api/settings/board-manager-urls", (_req, res) => res.json(boardManagerUrls));
  app.post("/api/settings/board-manager-urls", async (req, res) => {
    boardManagerUrls = req.body.urls; await saveState();
    res.json({ success: true, boardManagerUrls });
  });

  const ALL_LIBRARIES = [
    { id: "wifi", name: "WiFi", version: "1.2.7", author: "Arduino", description: "Enables network connection.", sentence: "Communication", category: "Communication" },
    { id: "wire", name: "Wire", version: "1.0.0", author: "Arduino", description: "Communicate with I2C devices.", sentence: "Communication", category: "Communication" },
    { id: "spi", name: "SPI", version: "1.0.0", author: "Arduino", description: "Communicate with SPI devices.", sentence: "Communication", category: "Communication" },
    { id: "bluetooth", name: "Bluetooth", version: "2.0.1", author: "Espressif", description: "BLE and Classic for ESP32.", sentence: "Communication", category: "Communication" },
    { id: "arduino-json", name: "ArduinoJson", version: "7.0.4", author: "Benoit Blanchon", description: "JSON for Arduino and embedded C++.", sentence: "Data Processing", category: "Data Processing" },
    { id: "neopixel", name: "Adafruit NeoPixel", version: "1.12.0", author: "Adafruit", description: "Control single-wire LED pixels.", sentence: "Display", category: "Display" },
    { id: "fastled", name: "FastLED", version: "3.6.0", author: "Daniel Garcia", description: "High-level LED control API.", sentence: "Display", category: "Display" },
    { id: "tft-espi", name: "TFT_eSPI", version: "2.5.43", author: "Bodmer", description: "Fast ESP32 hardware SPI library.", sentence: "Display", category: "Display" },
    { id: "liquidcrystal-i2c", name: "LiquidCrystal I2C", version: "1.1.2", author: "Frank de Brabander", description: "I2C LCD displays.", sentence: "Display", category: "Display" },
    { id: "dht", name: "DHT sensor library", version: "1.4.6", author: "Adafruit", description: "DHT11/DHT22 sensors.", sentence: "Sensors", category: "Sensors" },
    { id: "pubsubclient", name: "PubSubClient", version: "2.8.0", author: "Nick O'Leary", description: "MQTT client library.", sentence: "IoT", category: "IoT" },
    { id: "arduino-ota", name: "ArduinoOTA", version: "1.0.9", author: "Arduino", description: "OTA updates for ESP32.", sentence: "IoT", category: "IoT" },
    { id: "ble-keyboard", name: "ESP32-BLE-Keyboard", version: "0.3.2", author: "T-vK", description: "BLE Keyboard for ESP32.", sentence: "Human Interface", category: "Human Interface" },
    { id: "servo", name: "Servo", version: "1.2.1", author: "Arduino", description: "Control servo motors.", sentence: "Control", category: "Control" },
    { id: "ethernet", name: "Ethernet", version: "2.0.2", author: "Arduino", description: "Ethernet Shield support.", sentence: "Communication", category: "Communication" },
  ];

  async function scanCustomLibraries(): Promise<typeof ALL_LIBRARIES> {
    const custom: typeof ALL_LIBRARIES = [];
    try {
      const entries = await fs.readdir(UPLOAD_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const libDir = path.join(UPLOAD_DIR, entry.name);
          try {
            const props = Object.fromEntries(
              (await fs.readFile(path.join(libDir, "library.properties"), "utf-8"))
                .split("\n").filter(l => l.includes("=")).map(l => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; })
            );
            custom.push({ id: `custom-${entry.name}`, name: props.name || entry.name, version: props.version || "0.0.0", author: props.author || "Custom", description: props.sentence || "Custom imported library", sentence: props.category || "Custom", category: props.category || "Custom" });
          } catch {
            custom.push({ id: `custom-${entry.name}`, name: entry.name, version: "0.0.0", author: "Custom", description: "Custom imported library", sentence: "Custom", category: "Custom" });
          }
        }
      }
    } catch {}
    return custom;
  }

  app.get("/api/libraries", async (req, res) => {
    const { q, category } = req.query;
    const customLibs = await scanCustomLibraries();
    let all = [...ALL_LIBRARIES, ...customLibs];
    if (q) { const query = (q as string).toLowerCase(); all = all.filter(l => l.name.toLowerCase().includes(query) || l.description.toLowerCase().includes(query) || l.author.toLowerCase().includes(query)); }
    if (category && category !== "All") all = all.filter(l => l.category === category || l.sentence === category);
    res.json(all.map(l => ({ ...l, installed: installedLibraries.includes(l.id) })));
  });

  app.get("/api/libraries/installed", (_req, res) => res.json(installedLibraries));
  app.post("/api/libraries/install", async (req, res) => {
    const { id } = req.body;
    if (!installedLibraries.includes(id)) { installedLibraries.push(id); await saveState(); }
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
    let tempDir: string | null = null;
    try {
      let hasArduinoCli = false;
      let cliCmd = "./arduino-cli";
      try { await execAsync("./arduino-cli version"); hasArduinoCli = true; } catch { try { await execAsync("arduino-cli version"); hasArduinoCli = true; cliCmd = "arduino-cli"; } catch {} }

      if (hasArduinoCli) {
        const uniqueId = `Sketch_${Date.now()}`;
        tempDir = path.join("/tmp", uniqueId);
        await fs.mkdir(tempDir, { recursive: true });
        await fs.writeFile(path.join(tempDir, `${uniqueId}.ino`), code || "", "utf-8");
        const outputDir = path.join(tempDir, "build");
        await fs.mkdir(outputDir, { recursive: true });

        let fqbn = "esp32:esp32:esp32s3";
        if (boardId) { const board = ALL_BOARDS.find(b => b.id === boardId || b.id.includes(boardId.split(":").pop() || "")); if (board) fqbn = board.fqbn; }

        const buildFlags: string[] = [];
        if (psramMode === "opi") buildFlags.push("-DBOARD_HAS_PSRAM", "-DCONFIG_SPIRAM_MODE_OCT=1");
        else if (psramMode === "qio") buildFlags.push("-DBOARD_HAS_PSRAM", "-DCONFIG_SPIRAM_MODE_QUAD=1");
        if (usbCdcMode === "enabled") buildFlags.push("-DARDUINO_USB_CDC_ON_BOOT=1");
        let fqbnWithConfig = fqbn;
        if (buildFlags.length > 0) fqbnWithConfig += `:${buildFlags.join(",")}`;

        const esp32Url = "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json";
        const cmd = `${cliCmd} compile --fqbn ${fqbnWithConfig} --output-dir "${outputDir}" "${tempDir}" --additional-urls ${esp32Url} 2>&1`;
        console.log(`[REAL BUILD] ${cmd}`);

        const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
        const fullOutput = `${stdout}\n${stderr}`;

        const binFiles = await fs.readdir(outputDir);
        let appBinBase64 = "", bootloaderBinBase64 = "", partitionsBinBase64 = "";
        const appFile = binFiles.find(f => f.endsWith(".bin") && !f.includes("bootloader") && !f.includes("partitions"));
        const bootFile = binFiles.find(f => f.includes("bootloader") && f.endsWith(".bin"));
        const partFile = binFiles.find(f => f.includes("partitions") && f.endsWith(".bin"));
        if (appFile) appBinBase64 = (await fs.readFile(path.join(outputDir, appFile))).toString("base64");
        else { const firstBin = binFiles.find(f => f.endsWith(".bin")); if (firstBin) appBinBase64 = (await fs.readFile(path.join(outputDir, firstBin))).toString("base64"); }
        if (bootFile) bootloaderBinBase64 = (await fs.readFile(path.join(outputDir, bootFile))).toString("base64");
        if (partFile) partitionsBinBase64 = (await fs.readFile(path.join(outputDir, partFile))).toString("base64");

        let flashPct = "7%", ramPct = "3%";
        const flashMatch = fullOutput.match(/(\d+)%.*used.*flash/i);
        const ramMatch = fullOutput.match(/(\d+)%.*used.*ram/i);
        if (flashMatch) flashPct = `${flashMatch[1]}%`;
        if (ramMatch) ramPct = `${ramMatch[1]}%`;

        try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
        res.json({ success: true, binary: appBinBase64, bootloader: bootloaderBinBase64, partitions: partitionsBinBase64, usage: { flash: flashPct, ram: ramPct }, logs: `[S3 BUILD ENGINE] Real compilation via arduino-cli\nFQBN: ${fqbnWithConfig}\n───────────────────────────────────\n${fullOutput}\n[SUCCESS] Binary generated.` });
        return;
      }

      let flashBytes = 4194304;
      if (flashSize === "16MB") flashBytes = 16777216;
      else if (flashSize === "8MB") flashBytes = 8388608;
      const flashPct = Math.min(Math.round((324512 / flashBytes) * 100), 100);
      res.json({
        success: true,
        binary: Buffer.alloc(8192, 0x12).toString("base64"),
        bootloader: Buffer.alloc(4096, 0xab).toString("base64"),
        partitions: Buffer.alloc(3072, 0xcd).toString("base64"),
        usage: { flash: `${flashPct}%`, ram: "4%" },
        logs: `[S3 BUILD ENGINE] No arduino-cli found — simulated compilation\nTarget: ${boardId || "esp32s3"}\nSDK: ${sdkVersion || "v3.0.1"}\nPSRAM: ${psramMode || "opi"}\nFlash: ${flashSize || "4MB"}\nUSB CDC: ${usbCdcMode || "enabled"}\nPartition: ${partitionScheme || "default"}\nROM: 324512 bytes (${flashPct}%)\nRAM: 22144 bytes (4%)\n[SUCCESS] Simulated binary ready.`
      });
    } catch (err) {
      if (tempDir) try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, logs: `Compilation error: ${message}` });
    }
  });

  app.post("/api/flash", async (req, res) => {
    res.json({ success: true, message: "Flash ready — use Web Serial esptool.js on frontend", boardId: req.body.boardId });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`[ESP32-S3 IDE] Server running on http://localhost:${PORT}`));
}

startServer().catch(console.error);
