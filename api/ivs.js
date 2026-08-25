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

// ==================== FIX FUNCTIONS ====================
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

// ==================== HANDLER FUNCTION ====================
async function handleRequest(type) {
  await connectWS();

  if (type === "numbers") {
    const raw = await emitAndWait(CONFIG.events.fetchNumbers, {});
    return fixNumbers(raw);
  }

  if (type === "sms") {
    const raw = await emitAndWait(CONFIG.events.fetchSms, {});
    return fixSMS(raw);
  }

  throw new Error("Invalid type");
}

// ==================== EXPRESS APP ====================
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Route 1: "/?type=numbers"
app.get("/", async (req, res) => {
  const { type } = req.query;

  if (!type) {
    return res.json({
      error: "Use ?type=numbers or ?type=sms",
      endpoints: {
        numbers: "/?type=numbers",
        sms: "/?type=sms",
        api: "/api?type=numbers",
        apiIvs: "/api/ivs?type=numbers"
      }
    });
  }

  try {
    const result = await handleRequest(type);
    res.json(result);
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.json({ error: err.message, aaData: [] });
  }
});

// ✅ Route 2: "/api?type=numbers"
app.get("/api", async (req, res) => {
  const { type } = req.query;

  if (!type) {
    return res.json({
      error: "Use ?type=numbers or ?type=sms"
    });
  }

  try {
    const result = await handleRequest(type);
    res.json(result);
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.json({ error: err.message, aaData: [] });
  }
});

// ✅ Route 3: "/api/ivs?type=numbers"
app.get("/api/ivs", async (req, res) => {
  const { type } = req.query;

  if (!type) {
    return res.json({
      error: "Use ?type=numbers or ?type=sms"
    });
  }

  try {
    const result = await handleRequest(type);
    res.json(result);
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.json({ error: err.message, aaData: [] });
  }
});

// ==================== START SERVER ====================
app.listen(CONFIG.port, () => {
  console.log(`🚀 Server running on http://localhost:${CONFIG.port}`);
  console.log(`\n📡 Endpoints:`);
  console.log(`   http://localhost:${CONFIG.port}/?type=numbers`);
  console.log(`   http://localhost:${CONFIG.port}/?type=sms`);
  console.log(`   http://localhost:${CONFIG.port}/api?type=numbers`);
  console.log(`   http://localhost:${CONFIG.port}/api?type=sms`);
  console.log(`   http://localhost:${CONFIG.port}/api/ivs?type=numbers`);
  console.log(`   http://localhost:${CONFIG.port}/api/ivs?type=sms`);
});
