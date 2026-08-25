const express = require("express");
const { io } = require("socket.io-client");
const cors = require("cors");

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

let socket = null;
let connected = false;

function connectWS() {
  return new Promise((resolve, reject) => {
    if (connected && socket?.connected) return resolve();

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

function fixNumbers(data) {
  if (!data?.aaData) return data;
  data.aaData = data.aaData.map(row => [
    row[1], "", row[3],
    (row[4] || "").replace(/<[^>]+>/g, "").trim(),
    (row[7] || "").replace(/<[^>]+>/g, "").trim()
  ]);
  return data;
}

function fixSMS(data) {
  if (!data?.aaData) return data;
  data.aaData = data.aaData
    .map(row => {
      let message = (row[5] || "").replace(/legendhacker/gi, "").trim();
      if (!message) return null;
      return [row[0], row[1], row[2], row[3], message, "$", row[7] || 0];
    })
    .filter(Boolean);
  return data;
}

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
  throw new Error("Invalid type. Use 'numbers' or 'sms'");
}

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.get("/", async (req, res) => {
  const { type } = req.query;
  if (!type) {
    return res.json({
      message: "IVS Proxy API",
      usage: {
        numbers: "/?type=numbers",
        sms: "/?type=sms",
        apiNumbers: "/api?type=numbers",
        apiSms: "/api?type=sms",
        apiIvsNumbers: "/api/ivs?type=numbers",
        apiIvsSms: "/api/ivs?type=sms"
      }
    });
  }
  try {
    const result = await handleRequest(type);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, aaData: [] });
  }
});

app.get("/api", async (req, res) => {
  const { type } = req.query;
  if (!type) return res.json({ error: "Use ?type=numbers or ?type=sms" });
  try {
    const result = await handleRequest(type);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, aaData: [] });
  }
});

app.get("/api/ivs", async (req, res) => {
  const { type } = req.query;
  if (!type) return res.json({ error: "Use ?type=numbers or ?type=sms" });
  try {
    const result = await handleRequest(type);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, aaData: [] });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    availableRoutes: [
      "/?type=numbers",
      "/?type=sms",
      "/api?type=numbers",
      "/api?type=sms",
      "/api/ivs?type=numbers",
      "/api/ivs?type=sms"
    ]
  });
});

app.listen(CONFIG.port, () => {
  console.log(`🚀 Server running on port ${CONFIG.port}`);
});
