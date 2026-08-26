const express = require('express');
const { io } = require('socket.io-client');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════
const CONFIG = {
    socketUrl: process.env.SOCKET_URL || 'wss://ivas.tempnum.qzz.io:2087',
    userName: process.env.USER_NAME || 'Shoaib ahmed',
    email: process.env.EMAIL || 'erroraass1122@gmail.com',
    reconnectDelay: 5000,        // 5 seconds initial
    maxReconnectDelay: 30000,    // 30 seconds max
    heartbeatInterval: 25000,    // 25 seconds ping
    debugLog: true               // Socket events debug mode
};

// ═══════════════════════════════════════════
// DATA CACHE (Accumulator pattern)
// ═══════════════════════════════════════════
let CACHE = {
    sms: {
        allData: [],            // Poore din ke accumulated SMS
        seenIds: new Set(),     // Duplicate avoid karne ke liye
        lastUpdate: 0,
        date: null
    },
    numbers: {
        data: [],
        seenIds: new Set(),
        lastUpdate: 0,
        date: null
    },
    rawEvents: []               // Debugging ke liye last 50 raw events
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function logDebug(message, data = null) {
    if (!CONFIG.debugLog) return;
    const timestamp = new Date().toISOString();
    if (data) {
        console.log(`[${timestamp}] ${message}`, typeof data === 'object' ? JSON.stringify(data).slice(0, 500) : data);
    } else {
        console.log(`[${timestamp}] ${message}`);
    }
}

function saveRawEvent(eventName, data) {
    // Last 50 raw events save karo debug ke liye
    CACHE.rawEvents.push({
        timestamp: Date.now(),
        event: eventName,
        data: typeof data === 'string' ? data.slice(0, 1000) : data
    });
    if (CACHE.rawEvents.length > 50) {
        CACHE.rawEvents.shift();
    }
}

// ═══════════════════════════════════════════
// DATA NORMALIZATION
// ═══════════════════════════════════════════
function extractArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') {
        const possibleKeys = ['data', 'sms', 'messages', 'numbers', 'records', 'items', 'aaData'];
        for (const key of possibleKeys) {
            if (data[key] && Array.isArray(data[key])) {
                return data[key];
            }
        }
        for (const value of Object.values(data)) {
            if (Array.isArray(value)) return value;
        }
    }
    return [];
}

function normalizeSMSItem(item) {
    if (Array.isArray(item)) {
        return {
            id: item[0] || Date.now(),
            number: item[1] || '',
            date: item[2] || '',
            time: item[3] || '',
            message: (item[4] || '').trim(),
            cost: item[5] || '',
            status: item[6] || ''
        };
    } else if (typeof item === 'object' && item !== null) {
        return {
            id: item.id || item.sms_id || item.message_id || Date.now(),
            number: item.number || item.sender || item.from || item.msisdn || '',
            date: item.date || item.received_at || item.created_at || '',
            time: item.time || '',
            message: (item.message || item.body || item.text || item.content || '').trim(),
            cost: item.cost || item.price || '',
            status: item.status || ''
        };
    }
    return null;
}

function normalizeNumberItem(item) {
    if (Array.isArray(item)) {
        return {
            number: item[1] || item[0] || '',
            status: (item[3] || item[2] || '').replace(/<[^>]+>/g, '').trim(),
            date: (item[4] || item[3] || '').replace(/<[^>]+>/g, '').trim()
        };
    } else if (typeof item === 'object' && item !== null) {
        return {
            id: item.id || item.number_id || null,
            number: item.number || item.phone || item.msisdn || '',
            status: item.status || '',
            date: item.date || item.created_at || ''
        };
    }
    return null;
}

function accumulateSMS(newItems) {
    let addedCount = 0;
    for (const item of newItems) {
        const normalized = normalizeSMSItem(item);
        if (!normalized) continue;
        const key = normalized.id ? String(normalized.id) : JSON.stringify(normalized);
        if (!CACHE.sms.seenIds.has(key)) {
            CACHE.sms.seenIds.add(key);
            CACHE.sms.allData.push(normalized);
            addedCount++;
        }
    }
    if (addedCount > 0) {
        CACHE.sms.lastUpdate = Date.now();
        logDebug(`➕ ${addedCount} new SMS accumulated. Total: ${CACHE.sms.allData.length}`);
    }
    return addedCount;
}

function accumulateNumbers(newItems) {
    let addedCount = 0;
    for (const item of newItems) {
        const normalized = normalizeNumberItem(item);
        if (!normalized) continue;
        const key = normalized.number || JSON.stringify(normalized);
        if (!CACHE.numbers.seenIds.has(key)) {
            CACHE.numbers.seenIds.add(key);
            CACHE.numbers.data.push(normalized);
            addedCount++;
        }
    }
    if (addedCount > 0) {
        CACHE.numbers.lastUpdate = Date.now();
        logDebug(`📱 ${addedCount} new numbers accumulated. Total: ${CACHE.numbers.data.length}`);
    }
    return addedCount;
}

// ═══════════════════════════════════════════
// SOCKET CONNECTION (NO AUTH - Query Params only)
// ═══════════════════════════════════════════
let socket = null;
let reconnectAttempts = 0;
let reconnectTimer = null;

function buildSocketUrl() {
    const params = new URLSearchParams({
        UserName: CONFIG.userName,
        Email: CONFIG.email,
        EIO: '4',
        transport: 'websocket'
    });
    return `${CONFIG.socketUrl}/socket.io/?${params.toString()}`;
}

function connectSocket() {
    const url = buildSocketUrl();
    logDebug(`🔌 Connecting to socket: ${url}`);

    socket = io(url, {
        transports: ['websocket'],           // Sirf websocket
        reconnection: false,                  // Custom reconnect karenge
        forceNew: true,
        timeout: 20000,
        rejectUnauthorized: false             // Self-signed certificates ke liye
    });

    // ─── Socket Event Handlers ───
    socket.on('connect', () => {
        logDebug('✅ Socket connected successfully');
        reconnectAttempts = 0;
        if (CONFIG.debugLog) {
            logDebug(`Socket ID: ${socket.id}`);
        }
    });

    socket.on('disconnect', (reason) => {
        logDebug(`❌ Socket disconnected: ${reason}`);
        scheduleReconnect();
    });

    socket.on('connect_error', (error) => {
        logDebug(`⚠️ Socket connection error: ${error.message}`);
    });

    socket.on('error', (error) => {
        logDebug(`⚠️ Socket error: ${error}`);
    });

    // ─── Catch ALL events (Real event names unknown hain) ───
    socket.onAny((eventName, ...args) => {
        const timestamp = Date.now();
        logDebug(`📨 Event received: "${eventName}"`, args[0]);
        saveRawEvent(eventName, args[0]);

        processSocketEvent(eventName, args[0]);
    });

    // ─── Common event patterns (Guess - actual names adjust honge) ───
    const commonEvents = ['sms', 'message', 'new_sms', 'received_sms', 'sms_received', 
                          'number', 'new_number', 'numbers', 'update', 'data'];
    
    commonEvents.forEach(evt => {
        socket.on(evt, (data) => {
            processSocketEvent(evt, data);
        });
    });
}

function processSocketEvent(eventName, data) {
    const eventLower = eventName.toLowerCase();

    // SMS events
    if (eventLower.includes('sms') || eventLower.includes('message') || eventLower.includes('received')) {
        const items = extractArray(data);
        if (items.length > 0) {
            accumulateSMS(items);
        } else if (data && typeof data === 'object') {
            accumulateSMS([data]);
        }
    }

    // Number events
    if (eventLower.includes('number') || eventLower.includes('msisdn')) {
        const items = extractArray(data);
        if (items.length > 0) {
            accumulateNumbers(items);
        } else if (data && typeof data === 'object') {
            accumulateNumbers([data]);
        }
    }
}

function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    
    const delay = Math.min(
        CONFIG.reconnectDelay * Math.pow(2, reconnectAttempts),
        CONFIG.maxReconnectDelay
    );
    
    reconnectAttempts++;
    logDebug(`🔄 Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
    
    reconnectTimer = setTimeout(() => {
        connectSocket();
    }, delay);
}

// ─── Heartbeat (connection alive rakhne ke liye) ───
setInterval(() => {
    if (socket && socket.connected) {
        socket.emit('ping');
        logDebug('💓 Heartbeat sent');
    }
}, CONFIG.heartbeatInterval);

// ═══════════════════════════════════════════
// DATE RESET CHECK
// ═══════════════════════════════════════════
setInterval(() => {
    const today = getTodayDate();
    if (CACHE.sms.date && CACHE.sms.date !== today) {
        logDebug('🌅 New day - SMS cache reset');
        CACHE.sms = { allData: [], seenIds: new Set(), lastUpdate: 0, date: null };
    }
    if (CACHE.numbers.date && CACHE.numbers.date !== today) {
        logDebug('🌅 New day - Numbers cache reset');
        CACHE.numbers = { data: [], seenIds: new Set(), lastUpdate: 0, date: null };
    }
}, 60000); // Har minute check karo

// ═══════════════════════════════════════════
// EXPRESS API ROUTES
// ═══════════════════════════════════════════
app.get('/api', (req, res) => {
    const { type } = req.query;
    const today = getTodayDate();

    if (type === 'sms') {
        // Date set karo agar null hai
        if (!CACHE.sms.date) CACHE.sms.date = today;
        
        return res.json({
            success: true,
            data: CACHE.sms.allData,
            total: CACHE.sms.allData.length,
            lastUpdate: CACHE.sms.lastUpdate,
            date: CACHE.sms.date
        });
    }

    if (type === 'numbers') {
        if (!CACHE.numbers.date) CACHE.numbers.date = today;
        
        return res.json({
            success: true,
            data: CACHE.numbers.data,
            total: CACHE.numbers.data.length,
            lastUpdate: CACHE.numbers.lastUpdate,
            date: CACHE.numbers.date
        });
    }

    return res.status(400).json({
        success: false,
        error: 'Use ?type=sms or ?type=numbers'
    });
});

// Debug route - raw events dekhne ke liye
app.get('/debug', (req, res) => {
    res.json({
        success: true,
        socketConnected: socket?.connected || false,
        socketId: socket?.id || null,
        rawEvents: CACHE.rawEvents,
        smsCount: CACHE.sms.allData.length,
        numbersCount: CACHE.numbers.data.length
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        socketConnected: socket?.connected || false,
        uptime: process.uptime()
    });
});

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════
app.listen(PORT, () => {
    console.log(`🚀 API server running on port ${PORT}`);
    console.log(`📌 Endpoints:`);
    console.log(`   GET /api?type=sms      -> aaj ke saare SMS`);
    console.log(`   GET /api?type=numbers  -> numbers list`);
    console.log(`   GET /debug             -> socket debug info`);
    console.log(`   GET /health            -> health check`);
    console.log('');
    console.log(`🔌 Socket URL: ${CONFIG.socketUrl}`);
    console.log(`👤 User: ${CONFIG.userName}`);
    console.log(`📧 Email: ${CONFIG.email}`);
});

// Initial socket connection
connectSocket();
