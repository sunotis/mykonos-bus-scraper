const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cheerio = require('cheerio');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// CORS setup
app.use(cors({
    origin: ['https://mykonosbusmap.com', 'http://localhost:3000'],
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning'],
    credentials: false
}));

// Rate limiting to prevent request spikes
app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Max 100 requests per IP
    message: 'Too many requests, please try again later.'
}));

// Cache setup
let cachedTimetables = null;
let cacheTimestamp = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Browser instance
let browser = null;

// Clean header function
function cleanHeader(index, table) {
    const headers = table.find('tr:first-child td');
    return headers.eq(index).text().trim() || `Column ${index}`;
}

// Custom delay function (restored from original)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const lineIdMapping = {
    "fabrika (mykonos town) - airport": "1559047590770-061945df-35ac",
    "airport - new port": "1559047898109-40e76be5-801f",
    "fabrika (mykonos town) - new port": "1559047739472-642fcb84-9720",
    "old port (mykonos town) - new port": "1555955289108-dff46428-1b66",
    "fabrika (mykonos town) - platis gialos": "1555958487476-d80d7cc8-d066",
    "fabrika (mykonos town) - paradise": "1555958831438-01ea3ba0-76f7",
    "fabrika (mykonos town) - super paradise": "1555959036342-cf638a7d-ae31",
    "fabrika (mykonos town) - paraga": "1555958067687-34a62bad-9d2a",
    "old port (mykonos town) - elia": "1555957001095-b4b0a91c-695a",
    "old port (mykonos town) - ano mera": "1555955564212-f820a83b-d513",
    "old port (mykonos town) - kalafatis": "1555955724133-aa71677d-efab",
    "fabrika (mykonos town) - ornos - agios ioannis": "1555953369529-535afd32-cab3",
    "old port (mykonos town) - agios stefanos - new port": "1555953369558-22c24d44-888a"
};

const imageMapping = {
    "fabrika (mykonos town) - airport": "stops_fabrika-airport_01.svg",
    "airport - new port": "stops_airport-newport_01.svg",
    "fabrika (mykonos town) - new port": "stops_fabrika-newport_01.svg",
    "old port (mykonos town) - new port": "stops_oldport-newport_01.svg",
    "fabrika (mykonos town) - platis gialos": "stops_fabrika-platis_01.svg",
    "fabrika (mykonos town) - paradise": "stops_fabrika-paradise_01.svg",
    "fabrika (mykonos town) - super paradise": "stops_fabrika-super_01.svg",
    "fabrika (mykonos town) - paraga": "stops_fabrika-paraga_01.svg",
    "old port (mykonos town) - elia": "stops_oldport-elia_01.svg",
    "old port (mykonos town) - ano mera": "stops_oldport-anomera_01.svg",
    "old port (mykonos town) - kalafatis": "stops_oldport-kalafatis_01.svg",
    "fabrika (mykonos town) - ornos - agios ioannis": "stops_fabrika-ornos-agios_01.svg",
    "old port (mykonos town) - agios stefanos - new port": "stops_oldport-agios-newport_01.svg"
};

const url = 'https://mykonosbus.com/bus-timetables/';

async function getBrowser() {
    if (!browser) {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--blink-settings=imagesEnabled=false'
            ]
        });
    }
    return browser;
}

async function scrapeTimetables() {
    let page;
    let times = {};
    try {
        console.log('Starting scrape...');
        const browser = await getBrowser();
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        console.log('Navigating to URL:', url);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('Waiting for content...');
        await delay(10000); // Reduced from 30s to 10s for memory efficiency

        const content = await page.content();
        console.log('Page HTML length:', content.length);
        if (content.length < 1000) {
            console.error('Page content too short, likely failed to load');
            throw new Error('Page load incomplete');
        }
        const $ = cheerio.load(content, { xmlMode: false, decodeEntities: true });

        for (const [route, lineId] of Object.entries(lineIdMapping)) {
            times[route] = {
                lineId: lineId,
                headerImage: `https://mykonosbusmap.com/images/${imageMapping[route] || 'placeholder_01.svg'}`
            };
        }

        const sections = $('div.vc_tta-panel');
        console.log('Found sections:', sections.length);

        sections.each((index, section) => {
            const lineId = $(section).attr('id');
            const routeName = Object.keys(lineIdMapping).find(route => lineIdMapping[route] === lineId);
            if (!routeName) {
                console.log(`No route for lineId: ${lineId}`);
                return;
            }

            console.log(`Processing ${routeName} (ID: ${lineId})`);
            let table = $(section).find('table.aligncenter').first();
            if (!table.length) {
                table = $(section).find('table').first();
                console.log(`Used fallback table selector for ${routeName}`);
            }

            if (table.length) {
                const oldPortTimes = [];
                const newPortTimes = [];
                const midPortTimes = [];
                const firstRow = table.find('tbody tr').first();
                const numColumns = firstRow.find('td').length;
                let hasMiddleStop = numColumns >= 3;
                console.log(`${routeName} hasMiddleStop: ${hasMiddleStop}, columns: ${numColumns}`);

                const headers = table.find('tr:first-child td');
                const rows = table.find('tr').slice(headers.length > 0 ? 1 : 0);

                function sortTimes(times) {
                    return times.sort((a, b) => {
                        const [hourA, minA] = a.split(':').map(Number);
                        const [hourB, minB] = b.split(':').map(Number);
                        const adjustedHourA = hourA < 4 ? hourA + 24 : hourA;
                        const adjustedHourB = hourB < 4 ? hourB + 24 : hourB;
                        if (adjustedHourA !== adjustedHourB) return adjustedHourA - adjustedHourB;
                        return minA - minB;
                    });
                }

                rows.each((i, row) => {
                    const cells = $(row).find('td');
                    console.log(`Row ${i} for ${routeName}: cells.length=${cells.length}, HTML=${$(row).html()}`);
                    if (cells.length >= 2) {
                        const oldPortCell = $(cells[0]).find('p, strong').map((j, el) => {
                            if ($(el).is('strong') && $(el).parent().is('p')) return null;
                            const text = $(el).is('strong') ? $(el).text().trim() : $(el).find('strong').length ? $(el).find('strong').text().trim() : $(el).text().trim();
                            console.log(`oldPortCell raw text [${routeName}]:`, $(el).html());
                            return text.match(/^\d{2}:\d{2}$/) ? text : null;
                        }).get().filter(Boolean);

                        const oldPortText = $(cells[0]).contents().filter(function() {
                            return this.nodeType === 3;
                        }).map((j, el) => $(el).text().trim()).get().filter(t => t.match(/^\d{2}:\d{2}$/));

                        let newPortCell = [];
                        let midPortCell = [];

                        if (hasMiddleStop && cells.length >= 3) {
                            midPortCell = $(cells[1]).find('p, strong').map((j, el) => {
                                if ($(el).is('strong') && $(el).parent().is('p')) return null;
                                const text = $(el).is('strong') ? $(el).text().trim() : $(el).find('strong').length ? $(el).find('strong').text().trim() : $(el).text().trim();
                                console.log(`midPortCell raw text [${routeName}]:`, $(el).html());
                                return text.match(/^\d{2}:\d{2}$/) ? text : null;
                            }).get().filter(Boolean);

                            newPortCell = $(cells[2]).find('p, strong').map((j, el) => {
                                if ($(el).is('strong') && $(el).parent().is('p')) return null;
                                const text = $(el).is('strong') ? $(el).text().trim() : $(el).find('strong').length ? $(el).find('strong').text().trim() : $(el).text().trim();
                                console.log(`newPortCell raw text [${routeName}]:`, $(el).html());
                                return text.match(/^\d{2}:\d{2}$/) ? text : null;
                            }).get().filter(Boolean);

                            const newPortText = $(cells[2]).contents().filter(function() {
                                return this.nodeType === 3;
                            }).map((j, el) => $(el).text().trim()).get().filter(t => t.match(/^\d{2}:\d{2}$/));
                            newPortCell = [...newPortCell, ...newPortText];
                        } else {
                            newPortCell = $(cells[1]).find('p, strong').map((j, el) => {
                                if ($(el).is('strong') && $(el).parent().is('p')) return null;
                                const text = $(el).is('strong') ? $(el).text().trim() : $(el).find('strong').length ? $(el).find('strong').text().trim() : $(el).text().trim();
                                console.log(`newPortCell raw text [${routeName}]:`, $(el).html());
                                return text.match(/^\d{2}:\d{2}$/) ? text : null;
                            }).get().filter(Boolean);

                            const newPortText = $(cells[1]).contents().filter(function() {
                                return this.nodeType === 3;
                            }).map((j, el) => $(el).text().trim()).get().filter(t => t.match(/^\d{2}:\d{2}$/));
                            newPortCell = [...newPortCell, ...newPortText];
                        }

                        const uniqueOldPortCell = sortTimes([...new Set([...oldPortCell, ...oldPortText])]);
                        const uniqueMidPortCell = sortTimes([...new Set(midPortCell)]);
                        const uniqueNewPortCell = sortTimes([...new Set(newPortCell)]);

                        console.log(`Row ${i} for ${routeName}: oldPortCell=${uniqueOldPortCell}, midPortCell=${uniqueMidPortCell}, newPortCell=${uniqueNewPortCell}`);

                        if (Array.isArray(uniqueOldPortCell)) uniqueOldPortCell.forEach(time => oldPortTimes.push(time));
                        if (hasMiddleStop && Array.isArray(uniqueMidPortCell)) uniqueMidPortCell.forEach(time => midPortTimes.push(time));
                        if (Array.isArray(uniqueNewPortCell)) uniqueNewPortCell.forEach(time => newPortTimes.push(time));
                    }
                });

                const hasValidTimes = oldPortTimes.length > 0 && newPortTimes.length > 0;
                console.log(`hasValidTimes for ${routeName}: oldPortTimes=${oldPortTimes.length}, newPortTimes=${newPortTimes.length}, midPortTimes=${midPortTimes.length}`);

                if (hasValidTimes) {
                    if (!hasMiddleStop && oldPortTimes.length !== newPortTimes.length) {
                        console.warn(`Mismatched times for ${routeName}: oldPort=${oldPortTimes.length}, newPort=${newPortTimes.length}`);
                        const minLength = Math.min(oldPortTimes.length, newPortTimes.length);
                        oldPortTimes.length = minLength;
                        newPortTimes.length = minLength;
                    }
                    times[routeName] = {
                        ...times[routeName],
                        oldPort: [cleanHeader(0, table), ...oldPortTimes],
                        newPort: [cleanHeader(hasMiddleStop ? 2 : 1, table), ...newPortTimes],
                        midPort: hasMiddleStop && midPortTimes.length > 0 ? [cleanHeader(1, table), ...midPortTimes] : undefined,
                        hasMiddleStop
                    };
                    console.log(`${routeName} times:`, JSON.stringify(times[routeName], null, 2));
                } else {
                    times[routeName] = {
                        ...times[routeName],
                        message: "No service available—check back later"
                    };
                    console.log(`${routeName} no times found: oldPortTimes=${oldPortTimes}, newPortTimes=${newPortTimes}, midPortTimes=${midPortTimes}`);
                }
            }
        });

        console.log('Scraped routes:', Object.keys(times));
        return times;
    } catch (error) {
        console.error('Scrape error:', error.message);
        return times;
    } finally {
        if (page) {
            console.log('Closing page...');
            await page.close();
        }
    }
}

app.get('/', (req, res) => {
    console.log('Root route hit');
    res.send('Mykonos Bus Map API is running!');
});

app.get('/api/timetables', async (req, res) => {
    console.log('API /api/timetables requested, Memory usage:', process.memoryUsage());
    try {
        const now = Date.now();
        if (cachedTimetables && cacheTimestamp && (now - cacheTimestamp < CACHE_DURATION)) {
            console.log('Returning cached timetables');
            return res.json(cachedTimetables);
        }

        console.log('Scraping new timetables');
        cachedTimetables = await scrapeTimetables();
        cacheTimestamp = now;
        console.log('API response:', Object.keys(cachedTimetables));
        res.json(cachedTimetables);
    } catch (error) {
        console.error('Error in /api/timetables:', error.message);
        res.status(500).json({ error: 'Failed to fetch timetables' });
    }
});

app.get('/api/refresh', async (req, res) => {
    console.log('API /api/refresh requested');
    if (req.query.secret !== process.env.REFRESH_SECRET) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        cachedTimetables = null;
        cacheTimestamp = null;
        cachedTimetables = await scrapeTimetables();
        cacheTimestamp = Date.now();
        console.log('API response after refresh:', Object.keys(cachedTimetables));
        res.json(cachedTimetables);
    } catch (error) {
        console.error('Error in /api/refresh:', error.message);
        res.status(500).json({ error: 'Failed to refresh timetables' });
    }
});

// Preload cache on startup
const port = process.env.PORT || 10000;
app.listen(port, async () => {
    console.log(`Server running on port ${port}`);
    try {
        cachedTimetables = await scrapeTimetables();
        cacheTimestamp = Date.now();
        console.log('Cache preloaded with timetables');
    } catch (error) {
        console.error('Error preloading cache:', error.message);
    }
});

// Cleanup browser on process exit
process.on('SIGTERM', async () => {
    if (browser) {
        console.log('Closing browser on SIGTERM');
        await browser.close();
    }
    process.exit(0);
});