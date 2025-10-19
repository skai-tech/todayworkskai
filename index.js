// Basic Twilio ↔ ElevenLabs Realtime Gateway (no manual TLS setup)
// Save as index.js

import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Buffer } from "buffer";

const ELEVEN_API_KEY = "2b25e1ed34b699c6ea94255841592a4172558a27df81138a41d0c934ff33d80d";
const ELEVEN_WS = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=<your-agent-id>";

const PORT = process.env.PORT || 8080;

// 1. Basic HTTP server for health checks
const app = express();
app.get("/", (_, res) => res.send("Skai Gateway is running."));
const server = http.createServer(app);

// 2. WebSocket server to receive Twilio <Stream>
const wss = new WebSocketServer({ server, path: "/twilio" });

wss.on("connection", async (twilioWS) => {
  console.log("🔗 Twilio connected.");

  // Connect to ElevenLabs realtime
  const elWS = new WebSocket(ELEVEN_WS, {
    headers: { "xi-api-key": ELEVEN_API_KEY },
  });

  elWS.on("open", () => console.log("🎙️ Connected to ElevenLabs Realtime"));

  // From Twilio → to ElevenLabs
  twilioWS.on("message", async (msg) => {
    const evt = JSON.parse(msg.toString());

    if (evt.event === "media") {
      // Raw µ-law (8kHz) audio from Twilio
      const ulaw = Buffer.from(evt.media.payload, "base64");

      // For now, forward directly to ElevenLabs if supported
      // (You can later resample to 16k PCM)
      elWS.send(ulaw);
    }

    if (evt.event === "stop") {
      console.log("Call ended.");
      elWS.close();
      twilioWS.close();
    }
  });

  // From ElevenLabs → back to Twilio
  elWS.on("message", (data) => {
    try {
      const response = JSON.parse(data.toString());

      // If ElevenLabs sends audio chunks as base64 PCM data
      if (response?.audio) {
        const payload = response.audio; // base64 string
        twilioWS.send(
          JSON.stringify({ event: "media", media: { payload } })
        );
      }
    } catch (e) {
      // Some ElevenLabs messages aren't JSON (may be binary audio)
      if (Buffer.isBuffer(data)) {
        const payload = data.toString("base64");
        twilioWS.send(
          JSON.stringify({ event: "media", media: { payload } })
        );
      }
    }
  });

  elWS.on("close", () => console.log("❌ ElevenLabs closed."));
  elWS.on("error", (err) => console.error("ElevenLabs error:", err));
});

server.listen(PORT, () =>
  console.log(`🚀 Gateway live on port ${PORT} (ws://localhost:${PORT}/twilio)`)
);
