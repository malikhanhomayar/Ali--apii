const express = require('express');
const axios = require('axios');
const router = express.Router();

// --- CONFIGURATION ---
const CREDENTIALS = {
    username: "Alisindhi",
    password: "Alisindhi"
};

const BASE_URL = "http://139.99.9.4/ints";
const STATS_PAGE_URL = `${BASE_URL}/agent/SMSCDRReports`;

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE_URL,
    "Accept-Language": "en-US,en;q=0.9,ur-PK;q=0.8,ur;q=0.7"
};

// --- GLOBAL STATE ---
let STATE = {
    cookie: null,
    sessKey: null,
    signinPromise: null
};

// --- HELPERS ---
function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function extractKey(html) {
    const patterns = [
        /sesskey=([A-Za-z0-9+/=]+)/,
        /sesskey\s*[:=]\s*["']([^"']+)["']/,
        /[?&]sesskey=([^&"'\s]+)/,
        /sesskey","([^"]+)"/,
    ];
    for (const p of patterns) {
        const m = html.match(p);
        if (m && m[1]) {
            console.log(`✅ sessKey found: ${m[1].substring(0,20)}...`);
            return m[1];
        }
    }
    console.error("❌ sessKey not found. Sample:", html.substring(0, 1500));
    return null;
}

// --- CORE SIGNIN ---
function performsignin() {
    if (STATE.signinPromise) {
        console.log("⏳ signin already in progress, waiting...");
        return STATE.signinPromise;
    }
    STATE.signinPromise = _dosignin().finally(() => {
        STATE.signinPromise = null;
    });
    return STATE.signinPromise;
}

async function _dosignin() {
    console.log("🔐 Starting signin...");

    const instance = axios.create({
        headers: COMMON_HEADERS,
        timeout: 20000,
        withCredentials: true
    });

    let tempCookie = "";

    try {
        const r1 = await instance.get(`${BASE_URL}/signin`);

        if (r1.headers['set-cookie']) {
            const c = r1.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (c) tempCookie = c.split(';')[0];
        }

        const match = r1.data.match(/What is\s+(\d+)\s*\+\s*(\d+)/i);
        const ans = match ? parseInt(match[1]) + parseInt(match[2]) : 4;

        const r2 = await instance.post(
            `${BASE_URL}/signin`,
            new URLSearchParams({
                username: CREDENTIALS.username,
                password: CREDENTIALS.password,
                capt: String(ans)
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cookie": tempCookie,
                    "Referer": `${BASE_URL}/signin`
                },
                maxRedirects: 0,
                validateStatus: () => true
            }
        );

        if (r2.headers['set-cookie']) {
            const newC = r2.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            STATE.cookie = newC ? newC.split(';')[0] : tempCookie;
        } else {
            STATE.cookie = tempCookie;
        }

    } catch (e) {
        console.error("❌ signin failed:", e.message);
        throw e;
    }

    try {
        const r3 = await axios.get(STATS_PAGE_URL, {
            headers: {
                ...COMMON_HEADERS,
                "Cookie": STATE.cookie,
                "Referer": `${BASE_URL}/agent/SMSDashboard`
            }
        });

        const key = extractKey(r3.data);
        if (key) {
            STATE.sessKey = key;
            console.log("✅ signin complete! sessKey stored.");
        } else {
            await tryFetchSessKeyFromCDR();
        }
    } catch (e) {
        console.error("❌ sessKey fetch failed:", e.message);
    }
}

async function tryFetchSessKeyFromCDR() {
    try {
        const r = await axios.get(`${BASE_URL}/agent/SMSCDRReports`, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie }
        });
        const key = extractKey(r.data);
        if (key) STATE.sessKey = key;
    } catch(e) {}
}

// Auto Refresh
setInterval(() => {
    performsignin().catch(() => {});
}, 90000);

// ================= MAIN ROUTE =================
router.get('/', async (req, res) => {
    const { type } = req.query;

    if (!STATE.cookie || !STATE.sessKey) {
        try { await performsignin(); } catch(e) {
            return res.status(500).json({ error: "signin failed: " + e.message });
        }
    }

    const ts = Date.now();
    const today = getTodayDate();
    let targetUrl = "", referer = "";

    if (type === 'numbers') {
        referer = `${BASE_URL}/agent/MySMSNumbers`;
        targetUrl = `${BASE_URL}/agent/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=8&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    } else if (type === 'sms') {
        referer = `${BASE_URL}/agent/SMSCDRReports`;
        targetUrl = `${BASE_URL}/agent/res/data_smscdr.php` +
            `?fdate1=${today}%2000:00:00&fdate2=${today}%2023:59:59` +
            `&frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgclient=&fgnumber=&fgcli=&fg=0` +
            `&sesskey=${STATE.sessKey}` +
            `&sEcho=1&iColumns=9&iDisplayStart=0&iDisplayLength=5000` +
            `&iSortCol_0=0&sSortDir_0=desc&_=${ts}`;
    } else {
        return res.status(400).json({ error: "Invalid type. Use ?type=numbers or ?type=sms" });
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie, "Referer": referer }
        });

        if (typeof response.data === 'string' &&
            (response.data.includes('<html') || response.data.toLowerCase().includes('signin'))) {
            STATE.cookie = null;
            STATE.sessKey = null;
            await performsignin();
            return res.status(503).json({ error: "Session expired. Please retry." });
        }

        let result = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

        if (type === 'numbers') result = fixNumbers(result);
        if (type === 'sms')     result = fixSMS(result);

        res.json(result);

    } catch (e) {
        if (e.response?.status === 403) {
            STATE.cookie = null;
            STATE.sessKey = null;
            performsignin().catch(() => {});
            return res.status(403).json({ error: "Session expired, retry again." });
        }
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;

performsignin().catch(e => console.error("Initial signin error:", e.message));

/* ================= FIX NUMBERS ================= */
function fixNumbers(data) {
    if (!data.aaData) return data;
    data.aaData = data.aaData.map(row => [
        row[1], "", row[3],
        (row[4] || "").replace(/<[^>]+>/g, "").trim(),
        (row[7] || "").replace(/<[^>]+>/g, "").trim()
    ]);
    return data;
}

/* ================= FIX SMS ================= */
function fixSMS(data) {
    if (!data.aaData) return data;
    data.aaData = data.aaData.map(row => {
        let message = (row[5] || row[4] || "").toString().trim();
        message = cleanMessage(message);
        if (!message) return null;
        return [row[0], row[1], row[2], row[3], message, "$", row[7] || 0];
    }).filter(Boolean);
    return data;
}

/* ================= MESSAGE CLEANER ================= */
function cleanMessage(msg) {
    if (!msg) return "";

    // WhatsApp — sirf code nikalo, baaki sab hatao
    if (msg.toLowerCase().includes('whatsapp')) {
        const m = msg.match(/(\d{3}[-\s]\d{3})/);
        if (m) return `Your WhatsApp code ${m[1]}`;
        const m2 = msg.match(/\b(\d{6})\b/);
        if (m2) return `Your WhatsApp code ${m2[1]}`;
    }

    // Baaki messages — newlines space se replace karo
    return msg
        .replace(/\\n/g, " ")
        .replace(/\n/g, " ")
        .replace(/\r/g, " ")
        .replace(/  +/g, " ")
        .trim();
}
