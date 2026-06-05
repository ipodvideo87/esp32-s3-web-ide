Run locally

1. In the repo root: 
◦ npm install

1. Start the app: 
◦ npm run dev

1. Open in your browser: 
◦ http://localhost:3000

Notes

• The server is server.ts and listens on port 3000.
• It uses arduino-cli for real compilation if available. If not installed, the server tries to download a portable arduino-cli automatically.
• For flashing/serial support, use a Chromium-based browser with Web Serial support and allow USB access.

Alternative production flow

• Build: npm run build
• Run: npm start

That’s the simplest local run path.
