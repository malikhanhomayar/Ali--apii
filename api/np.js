const express = require('express');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const router = express.Router();

// --- Configuration ---
const baseURL = "https://tempnumbers.net";
const username = "Rahman007";
const password = "Rahman007";
const userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";

// --- State Variables ---
const jar = new CookieJar();
const client = wrapper(axios.create({
    jar,
    timeout: 10000,
    withCredentials: true
}));

let sessKey = "";
let isLoggedIn = false;
let smsCache = null;
let numberCache = null;

const captchaRegex = /What is (\d+) \+ (\d+) = \?/;
const sessKeyRegex = /sesskey=(\d+)/;

// --- Helper Functions ---
function getFormattedDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
}

/* ================= FIX NUMBERS (Smart Mapping) ================= */
function fixNumbers(data) {
    if (!data || !data.aaData) return data;
    const cleanData = { ...data };
    cleanData.aaData = data.aaData.map(row => {
        // کلائنٹ پینل میں row[2] پر نمبر ہے، اگر وہ نہ ملے تو row[1] (پرانا ایجنٹ پینل)
        const number = (row[2] && row[2].trim() !== "") ? row[2] : (row[1] || "");
        const range = row[0] || row[3] || "";
        const plan = (row[3] || row[4] || "").replace(/<[^>]+>/g, "").trim();
        const stats = (row[5] || row[7] || "").replace(/<[^>]+>/g, "").trim();

        // پرانے فرنٹ اینڈ کا سیم سٹرکچر واپسی ریٹرن ہوگا
        return [
            range,
            "",
            number,
            plan,
            stats
        ];
    });
    return cleanData;
}

/* ================= FIX SMS (Smart Mapping) ================= */
function fixSMS(data) {
    if (!data || !data.aaData) return data;
    const cleanData = { ...data };
    cleanData.aaData = data.aaData.map(row => {
        // 7 کالمز والے کلائنٹ پینل میں row[4] پر میسج اور row[6] پر پے آؤٹ ہوتا ہے
        let message = "";
        let payout = 0;

        if (row.length <= 7) {
            message = row[4] || "";
            payout = row[6] || 0;
        } else {
            message = row[5] || "";
            payout = row[7] || 0;
        }

        message = message.replace(/kamibroken/gi, "").trim();
        if (!message) return null;

        return [
            row[0] || "",
            row[1] || "",
            row[2] || "",
            row[3] || "",
            message,
            "$",
            payout
        ];
    }).filter(Boolean);
    return cleanData;
}

// --- Login Logic ---
async function doLogin() {
    console.log("Attempting to login and bypass captcha...");
    try {
        const resLogin = await client.get(`${baseURL}/login`, {
            headers: { 'User-Agent': userAgent }
        });

        const match = resLogin.data.match(captchaRegex);
        if (!match) throw new Error("Captcha not found on page");

        const ans = parseInt(match[1]) + parseInt(match[2]);

        const params = new URLSearchParams();
        params.append('username', username);
        params.append('password', password);
        params.append('capt', ans.toString());

        await client.post(`${baseURL}/signin`, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${baseURL}/login`,
                'User-Agent': userAgent
            }
        });

        // کلائنٹ پینل کے ڈیش بورڈ سے سیشن کی (sesskey) نکالنا
        const resDash = await client.get(`${baseURL}/client/SMSCDRStats`, {
            headers: { 
                'User-Agent': userAgent,
                'Referer': `${baseURL}/client/MySMSNumbers`
            }
        });

        const sessMatch = resDash.data.match(sessKeyRegex);
        if (!sessMatch) throw new Error("Sesskey not found, login might have failed");

        sessKey = sessMatch[1];
        isLoggedIn = true;
        console.log(`Successfully logged in! sesskey: ${sessKey}`);
    } catch (err) {
        console.error(`Login Error: ${err.message}`);
    }
}

// --- Data Fetching Logic ---
async function fetchData() {
    if (!isLoggedIn || !sessKey) {
        await doLogin();
        if (!isLoggedIn) return;
    }

    const todayStr = `${getFormattedDate(0)}%2000:00:00`;
    const todayEndStr = `${getFormattedDate(0)}%2023:59:59`;
    const timestamp = Date.now();

    // --- 1. FETCH SMS DATA ---
    const smsURL = `${baseURL}/client/res/data_smscdr.php?fdate1=${todayStr}&fdate2=${todayEndStr}&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${sessKey}&sEcho=1&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=50&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${timestamp}`;

    try {
        const resSMS = await client.get(smsURL, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${baseURL}/client/SMSCDRStats`,
                'User-Agent': userAgent
            }
        });
        
        if (typeof resSMS.data === 'string' && resSMS.data.trim().startsWith('<')) {
            console.log("Session expired during SMS fetch.");
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

    // --- 2. FETCH NUMBERS DATA ---
    if (isLoggedIn) {
        const numURL = `${baseURL}/client/res/data_smsnumbers.php?frange=&fclient=&sEcho=1&iColumns=6&sColumns=%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${Date.now()}`;

        try {
            const resNum = await client.get(numURL, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': `${baseURL}/client/MySMSNumbers`,
                    'User-Agent': userAgent
                }
            });

            if (typeof resNum.data === 'string' && resNum.data.trim().startsWith('<')) {
                console.log("Session expired during Numbers fetch.");
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

// --- Background Polling ---
fetchData();
setInterval(fetchData, 10000); // 10 سیکنڈز بعد ڈیٹا پول کرے گا

// --- API Route ---
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
