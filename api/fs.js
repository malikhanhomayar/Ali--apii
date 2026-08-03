const express = require('express');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const router = express.Router();

const baseURL = "http://54.39.104.241/ints";
const username = "AliSindhi";
const password = "AliSindhi";
const userAgent = "Mozilla/5.0 (Linux; Android 15; 2409BRN2CA Build/AP3A.240905.015.A2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.178 Mobile Safari/537.36";

// --- State Variables ---
const jar = new CookieJar();
const client = wrapper(axios.create({
    jar,
    timeout: 15000,
    withCredentials: true
}));

let sessKey = "";
let isLoggedIn = false;
let smsCache = null;
let numberCache = null;

// --- Regex Patterns ---
const captchaRegex = /What is (\d+) \+ (\d+) = \?/;
const sessKeyRegex = /sesskey=(\d+)/;

// --- Helper Functions ---
function getFormattedDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
}

/* ================= FIX NUMBERS ================= */
function fixNumbers(data) {
    if (!data || !data.aaData) return data;
    const cleanData = { ...data };
    cleanData.aaData = data.aaData.map(row => [
        row[1], // Range
        "",     // Client Placeholder
        row[3], // Number
        (row[4] || "").replace(/<[^>]+>/g, "").trim(), // Payout Amount Cleaned
        (row[7] || "").replace(/<[^>]+>/g, "").trim()  // Stats (SD/SW) Cleaned
    ]);
    return cleanData;
}

/* ================= FIX SMS ================= */
function fixSMS(data) {
    if (!data || !data.aaData) return data;
    const cleanData = { ...data };
    cleanData.aaData = data.aaData.map(row => {

        if (!row[0] || !row[0].includes('-')) return null;
        
        const message = (row[5] || "").trim();
        if (!message) return null;
        
        return [
            row[0], // Date
            row[1], // Range
            row[2], // Number
            row[3], // CLI
            message, // Cleaned Message
            "$",    // Currency
            row[7] || 0 // Payout
        ];
    }).filter(Boolean);
    return cleanData;
}

// --- Login & Sesskey Extraction Logic ---
async function doLogin() {
    console.log("Attempting to login and bypass captcha for Fire SMS...");
    try {
        const resLogin = await client.get(`${baseURL}/login`, {
            headers: { 'User-Agent': userAgent }
        });

        const match = resLogin.data.match(captchaRegex);
        if (!match) throw new Error("Math captcha text not found on page");

        const ans = parseInt(match[1]) + parseInt(match[2]);
        console.log(`Captcha found: ${match[1]} + ${match[2]} = ${ans}`);

        const params = new URLSearchParams();
        params.append('username', username);
        params.append('password', password);
        params.append('capt', ans.toString());

        await client.post(`${baseURL}/signin`, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${baseURL}/login`,
                'User-Agent': userAgent,
                'X-Requested-With': 'com.xbrowser.play'
            }
        });

        const resDash = await client.get(`${baseURL}/agent/SMSCDRReports`, {
            headers: { 
                'User-Agent': userAgent,
                'Referer': `${baseURL}/login`
            }
        });

        const sessMatch = resDash.data.match(sessKeyRegex);
        if (!sessMatch) throw new Error("Sesskey not found in page source, login failed");

        sessKey = sessMatch[1];
        isLoggedIn = true;
        console.log(`Successfully logged in! New sesskey extracted: ${sessKey}`);
    } catch (err) {
        console.error(`Login Error: ${err.message}`);
        isLoggedIn = false;
    }
}

// --- Data Fetching Logic ---
async function fetchData() {
    if (!isLoggedIn || !sessKey) {
        await doLogin();
        if (!isLoggedIn) return; 
    }

    const yesterdayStr = `${getFormattedDate(-1)}%2000:00:00`;
    const tomorrowStr = `${getFormattedDate(1)}%2023:59:59`;
    const timestamp = Date.now();

    // --- 1. FETCH SMS DATA ---
    const smsURL = `${baseURL}/agent/res/data_smscdr.php?fdate1=${yesterdayStr}&fdate2=${tomorrowStr}&frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgclient=&fgnumber=&fgcli=&fg=0&sesskey=${sessKey}&sEcho=1&iColumns=9&sColumns=%2C%2C%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=50&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&mDataProp_7=7&sSearch_7=&bRegex_7=false&bSearchable_7=true&bSortable_7=true&mDataProp_8=8&sSearch_8=&bRegex_8=false&bSearchable_8=true&bSortable_8=false&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${timestamp}`;

    try {
        const resSMS = await client.get(smsURL, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${baseURL}/agent/SMSCDRReports`,
                'User-Agent': userAgent
            }
        });
        
        if (typeof resSMS.data === 'string' && resSMS.data.trim().startsWith('<')) {
            console.log("Session expired while fetching SMS data.");
            isLoggedIn = false;
        } else {
            let rawData = resSMS.data;
            if (typeof rawData === 'string') {
                try { rawData = JSON.parse(rawData); } catch(e) {}
            }
            smsCache = fixSMS(rawData); 
        }
    } catch (e) {
        console.error(`SMS Fetch Error: ${e.message}`);
    }

    if (isLoggedIn) {
        const numURL = `${baseURL}/agent/res/data_smsnumbers.php?frange=&fclient=&sEcho=4&iColumns=8&sColumns=%2C%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=false&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&mDataProp_7=7&sSearch_7=&bRegex_7=false&bSearchable_7=true&bSortable_7=false&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${Date.now()}`;

        try {
            const resNum = await client.get(numURL, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': `${baseURL}/agent/MySMSNumbers`,
                    'User-Agent': userAgent
                }
            });

            if (typeof resNum.data === 'string' && resNum.data.trim().startsWith('<')) {
                console.log("Session expired while fetching Numbers data.");
                isLoggedIn = false;
            } else {
                let rawData = resNum.data;
                if (typeof rawData === 'string') {
                    try { rawData = JSON.parse(rawData); } catch(e) {}
                }
                numberCache = fixNumbers(rawData); 
            }
        } catch (e) {
            console.error(`Numbers Fetch Error: ${e.message}`);
        }
    }
}

fetchData(); 
setInterval(fetchData, 17000); 

// --- API Endpoints ---
router.get('/', (req, res) => {
    const type = req.query.type;

    if (type === 'sms') {
        if (!smsCache) return res.status(503).json({ error: "Data loading, please wait..." });
        return res.json(smsCache);
    } else if (type === 'numbers') {
        if (!numberCache) return res.status(503).json({ error: "Data loading, please wait..." });
        return res.json(numberCache);
    } else {
        return res.status(400).json({ error: "Invalid type. Use ?type=sms or ?type=numbers" });
    }
});

module.exports = router;
