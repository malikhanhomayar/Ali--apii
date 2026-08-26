const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// --- IMPORT ALL PANELS ---
const np = require("./api/np");
const ivas = require("./api/ivas");
const gn = require("./api/gn");
const ch = require("./api/ch");
const cs = require("./api/cs");
const fs = require("./api/fs");
const hs = require("./api/hs");
const msi = require("./api/msi");// <-- NEW

// --- ROUTES ---
app.use("/api/np", np);
app.use("/api/ivas", ivas);
app.use("/api/gn", gn);
app.use("/api/ch", ch);
app.use("/api/cs", cs);
app.use("/api/fs", fs);
app.use("/api/hs", hs);
app.use("/api/msi", msi);// <-- NEW

// --- HEALTH CHECK ---
app.get("/", (req,res)=> res.send("API RUNNING ✅"));

// --- START SERVER ---
app.listen(PORT, "0.0.0.0", ()=>console.log(`🚀 Server running on port ${PORT}`));
