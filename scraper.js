const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cheerio = require('cheerio');
const express = require('express');
const cors = require('cors');

const app = express();

// CORS setup
app.use(cors({
    origin: ['https://mykonosbusmap.com', 'http://localhost:3000'],
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning'],
    credentials: false
}));

// Custom delay function
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

async function scrapeTimetables() {
    let browser;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            args: chromium.args
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        console.log('Navigating to URL:', url);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('Waiting for content...');
        await delay(30000); // 30s for static content

        const content = await page.content();
        console.log('Page HTML length:', content.length);
        if (content.length < 1000) {
            console.error('Page content too short, likely failed to load');
            throw new Error('Page load incomplete');
        }
        const $ = cheerio.load(content);
        const times = {};

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
                let hasMiddleStop = false;
            
                const headers = table.find('tr:first-child td');
                if (headers.length >= 3) hasMiddleStop = true;
                console.log(`${routeName} hasMiddleStop: ${hasMiddleStop}, headers: ${headers.length}`);
            
                const rows = table.find('tr').slice(1); // Skip header row
                rows.each((i, row) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 2) {
                        // Extract times from <p> tags, ensuring <strong> tags are included
                        const oldPortCell = $(cells[0]).find('p').length
                            ? $(cells[0]).find('p').map((j, p) => {
                                  const text = $(p).find('strong').length ? $(p).find('strong').text().trim() : $(p).text().trim();
                                  return text.match(/^\d{2}:\d{2}$/) ? text : null;
                              }).get().filter(Boolean)
                            : $(cells[0]).text().trim().split(/\s+/).filter(t => t.match(/^\d{2}:\d{2}$/));
                        let newPortCell = [];
                        let midPortCell = [];
            
                        if (hasMiddleStop && cells.length >= 3) {
                            midPortCell = $(cells[1]).find('p').length
                                ? $(cells[1]).find('p').map((j, p) => {
                                      const text = $(p).find('strong').length ? $(p).find('strong').text().trim() : $(p).text().trim();
                                      return text.match(/^\d{2}:\d{2}$/) ? text : null;
                                  }).get().filter(Boolean)
                                : $(cells[1]).text().trim().split(/\s+/).filter(t => t.match(/^\d{2}:\d{2}$/));
                            newPortCell = $(cells[2]).find('p').length
                                ? $(cells[2]).find('p').map((j, p) => {
                                      const text = $(p).find('strong').length ? $(p).find('strong').text().trim() : $(p).text().trim();
                                      return text.match(/^\d{2}:\d{2}$/) ? text : null;
                                  }).get().filter(Boolean)
                                : $(cells[2]).text().trim().split(/\s+/).filter(t => t.match(/^\d{2}:\d{2}$/));
                        } else if (cells.length >= 2) {
                            newPortCell = $(cells[1]).find('p').length
                                ? $(cells[1]).find('p').map((j, p) => {
                                      const text = $(p).find('strong').length ? $(p).find('strong').text().trim() : $(p).text().trim();
                                      return text.match(/^\d{2}:\d{2}$/) ? text : null;
                                  }).get().filter(Boolean)
                                : $(cells[1]).text().trim().split(/\s+/).filter(t => t.match(/^\d{2}:\d{2}$/));
                        }
            
                        console.log(`Row ${i} for ${routeName}: oldPortCell=${oldPortCell}, midPortCell=${midPortCell}, newPortCell=${newPortCell}`);
            
                        if (Array.isArray(oldPortCell)) oldPortCell.forEach(time => oldPortTimes.push(time));
                        if (hasMiddleStop && Array.isArray(midPortCell)) midPortCell.forEach(time => midPortTimes.push(time));
                        if (Array.isArray(newPortCell)) newPortCell.forEach(time => newPortTimes.push(time));
                    }
                });
            
                // Require both oldPortTimes and newPortTimes to have times for two-stop routes
                const hasValidTimes = hasMiddleStop
                    ? (oldPortTimes.length > 0 && newPortTimes.length > 0 && midPortTimes.length > 0)
                    : (oldPortTimes.length > 0 && newPortTimes.length > 0);
            
                if (hasValidTimes) {
                    times[routeName] = {
                        ...times[routeName],
                        oldPort: [cleanHeader(0), ...oldPortTimes],
                        newPort: [cleanHeader(hasMiddleStop ? 2 : 1), ...newPortTimes],
                        midPort: hasMiddleStop && midPortTimes.length > 0 ? [cleanHeader(1), ...midPortTimes] : undefined,
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
        // Return partial results instead of fallback
        return times || {};
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

// Cache the scraped data with a timestamp
let cachedTimetables = null;
let cacheTimestamp = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

app.get('/', (req, res) => {
    console.log('Root route hit');
    res.send('Mykonos Bus Map API is running!');
});

app.get('/api/timetables', async (req, res) => {
    console.log('API /api/timetables requested');
    try {
        const now = Date.now();
        // Use cached data if available and not older than CACHE_DURATION
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
    try {
        cachedTimetables = null; // Clear cache
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

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));