const express = require("express");
const { io } = require("socket.io-client");
const cors = require("cors");

// ==================== CONFIG ====================
const CONFIG = {
  wsUrl: "wss://ivas.tempnum.qzz.io:2087/socket.io/",
  wsQuery: {
    UserName: "Shoaib ahmed",
    Email: "erroraass1122@gmail.com",
    EIO: "4",
    transport: "websocket"
  },
  // ⚠️ APNE ACTUAL EVENTS YAHAN SET KAREIN
  events: {
    fetchNumbers: "getNumbers",
    fetchSms: "getSms",
    responseNumbers: "numbersData",
    responseSms: "smsData"
  },
  port: process.env.PORT || 3000
};

// ==================== WEBSOCKET CLIENT ====================
let socket = null;
let connected = false;

function connectWS() {
  return new Promise((resolve, reject) => {
    if (connected && socket?.connected) {
      return resolve();
    }

    socket = io(CONFIG.wsUrl, {
      query: CONFIG.wsQuery,
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socket.on("connect", () => {
      console.log("✅ WebSocket connected");
      connected = true;
      resolve();
    });

    socket.on("connect_error", (err) => {
      console.error("❌ WS Error:", err.message);
      reject(err);
    });

    socket.on("disconnect", () => {
      connected = false;
    });

    setTimeout(() => {
      if (!connected) reject(new Error("Connection timeout"));
    }, 15000);
  });
}

function emitAndWait(event, data = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!connected || !socket?.connected) {
      return reject(new Error("WebSocket not connected"));
    }

    let resolved = false;
    const responseEvent = event === CONFIG.events.fetchNumbers
      ? CONFIG.events.responseNumbers
      : CONFIG.events.responseSms;

    const handler = (response) => {
      if (!resolved) {
        resolved = true;
        socket.off(responseEvent, handler);
        resolve(response);
      }
    };

    socket.on(responseEvent, handler);
    socket.emit(event, data);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.off(responseEvent, handler);
        reject(new Error(`Timeout waiting for ${event}`));
      }
    }, timeout);
  });
}

// ==================== FIX FUNCTIONS (EXACT ORIGINAL) ====================
function fixNumbers(data) {
  if (!data?.aaData) return data;

  data.aaData = data.aaData.map(row => [
    row[1],
    "",
    row[3],
    (row[4] || "").replace(/<[^>]+>/g, "").trim(),
    (row[7] || "").replace(/<[^>]+>/g, "").trim()
  ]);

  return data;
}

function fixSMS(data) {
  if (!data?.aaData) return data;

  data.aaData = data.aaData
    .map(row => {
      let message = (row[5] || "")
        .replace(/legendhacker/gi, "")
        .trim();

      if (!message) return null;

      return [
        row[0],
        row[1],
        row[2],
        row[3],
        message,
        "$",
        row[7] || 0
      ];
    })
    .filter(Boolean);

  return data;
}

// ==================== EXPRESS APP ====================
const app = express();
app.use(cors());
app.use(express.json());

// ==================== API ROUTE ====================
app.get("/", async (req, res) => {
  const { type } = req.query;

  if (!type) {
    return res.json({
      error: "Use ?type=numbers or ?type=sms",
      endpoints: {
        numbers: "/?type=numbers",
        sms: "/?type=sms"
      }
    });
  }

  try {
    await connectWS();

    if (type === "numbers") {
      const raw = await emitAndWait(CONFIG.events.fetchNumbers, {});
      const cleaned = fixNumbers(raw);
      return res.json(cleaned);
    }

    if (type === "sms") {
      const raw = await emitAndWait(CONFIG.events.fetchSms, {});
      const cleaned = fixSMS(raw);
      return res.json(cleaned);
    }

    res.json({ error: "Invalid type" });

  } catch (err) {
    console.error("❌ Error:", err.message);
    res.json({
      error: err.message,
      aaData: []
    });
  }
});

// ==================== START SERVER ====================
app.listen(CONFIG.port, () => {
  console.log(`🚀 Server running on http://localhost:${CONFIG.port}`);
  console.log(`📡 Numbers: http://localhost:${CONFIG.port}/?type=numbers`);
  console.log(`📡 SMS: http://localhost:${CONFIG.port}/?type=sms`);
});
