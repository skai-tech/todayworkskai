// Minimal Twilio <Stream> ↔ ElevenLabs gateway (no Express)
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Buffer } from "buffer";

// --- CONFIG ---
// For now you can hardcode; recommended to move to env vars later.
const ELEVEN_API_KEY = "2b25e1ed34b699c6ea94255841592a4172558a27df81138a41d0c934ff33d80d";
const ELEVEN_WS = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=<your-agent-id>";
const PORT = process.env.PORT || 8080;

// Basic health server
const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Skai Gateway running\n");
  } else {
    res.writeHead(404);
    res.end();
  }
});

// WS server for Twilio media streams
const wss = new WebSocketServer({ server, path: "/twilio" });

wss.on("connection", (twilioWS) => {
  console.log("🔗 Twilio connected.");

  // Connect to ElevenLabs realtime
  const elWS = new WebSocket(ELEVEN_WS, {
    headers: { "xi-api-key": ELEVEN_API_KEY }
  });

  elWS.on("open", () => console.log("🎙️ ElevenLabs connected"));

  // Twilio -> ElevenLabs
  twilioWS.on("message", (msg) => {
    const evt = JSON.parse(msg.toString());

    if (evt.event === "media") {
      const ulaw = Buffer.from(evt.media.payload, "base64");
      // NOTE: This forwards 8k PCMU bytes directly. For best results,
      // you’ll later add resampling/codec conversion to 16k PCM.
      elWS.readyState === WebSocket.OPEN && elWS.send(ulaw);
    }
    if (evt.event === "stop") {
      try { elWS.close(); } catch {}
      try { twilioWS.close(); } catch {}
    }
  });

  // ElevenLabs -> Twilio
  elWS.on("message", (data) => {
    // Some frames may be JSON; others may be raw/binary.
    try {
      const obj = JSON.parse(data.toString());
      if (obj?.audio) {
        // If ElevenLabs returns base64 audio in JSON
        twilioWS.send(JSON.stringify({ event: "media", media: { payload: obj.audio } }));
        return;
      }
    } catch (_) { /* not JSON, fall through */ }

    // Treat as binary; send base64 to Twilio
    const payload = (Buffer.isBuffer(data) ? data : Buffer.from(data)).toString("base64");
    twilioWS.send(JSON.stringify({ event: "media", media: { payload } }));
  });

  elWS.on("close", () => console.log("❌ ElevenLabs closed"));
  elWS.on("error", (e) => console.error("ElevenLabs error:", e));
});

server.listen(PORT, () => {
  console.log(`🚀 Gateway listening on port ${PORT}. WS path: /twilio`);
});
