const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cheerio = require('cheerio');
const express = require('express');
const cors = require('cors');

const app = express();

// CORS setup for mykonosbusmap.com
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
    // Disabled routes (not supported currently, may enable in the future)
    // "old port (mykonos town) - kalo livadi": "1555957517174-c6496040-c68b",
    // "old port (mykonos town) - panormos": "1557747887993-356701dd-5541",
    // "fabrika (mykonos town) - kalo livadi": "1720281530535-d5be00b4-2271"
};

// Mapping of route names to image filenames
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
    // Disabled routes (not supported currently, may enable in the future)
    // "old port (mykonos town) - kalo livadi": "stops_oldport-kalolivadi_01.svg",
    // "old port (mykonos town) - panormos": "stops_oldport-panormos_01.svg",
    // "fabrika (mykonos town) - kalo livadi": "stops_fabrika-kalolivadi_01.svg"
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
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        console.log('Navigating to URL:', url);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('Waiting for content to load...');
        await delay(20000); // 20 seconds to ensure content loads

        const content = await page.content();
        const $ = cheerio.load(content);
        const times = {};

        // Map lineId to route name for lookup
        const routeIdMapping = {};
        for (const [route, id] of Object.entries(lineIdMapping)) {
            routeIdMapping[id] = route;
        }

        // Ensure all routes in lineIdMapping are included, even if not found on the page
        for (const [route, lineId] of Object.entries(lineIdMapping)) {
            times[route] = {
                lineId: lineId,
                headerImage: `https://mykonosbusmap.com/images/${imageMapping[route] || 'placeholder_01.svg'}`
            };
        }

        const sections = $('div.vc_tta-panel');
        console.log('Found timetable sections:', sections.length);

        sections.each((index, section) => {
            const lineId = $(section).attr('id');
            console.log(`Processing section with lineId: ${lineId}`);
            const routeName = routeIdMapping[lineId];
            if (!routeName) {
                console.log(`No route name found for lineId: ${lineId}`);
                return; // Skip if no matching route
            }

            const title = $(section).find('span.vc_tta-title-text').text().trim().replace(/\s+/g, ' ').toLowerCase();
            console.log(`Route name from page: "${title}"`);
            console.log(`Mapped route name: "${routeName}"`);

            const table = $(section).find('table.aligncenter').first();
            console.log(`Table found for ${routeName}:`, table.length > 0);

            if (table.length) {
                const oldPortTimes = [];
                const newPortTimes = [];
                const midPortTimes = [];
                let hasMiddleStop = false;

                const headers = table.find('thead tr th');
                if (headers.length === 3) hasMiddleStop = true;

                table.find('tbody tr').each((i, row) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 2) {
                        // Extract times, removing extra <p> tags and whitespace
                        const oldPortCell = $(cells[0]).find('p').length
                            ? $(cells[0]).find('p').map((j, p) => $(p).text().trim()).get().filter(t => t)
                            : [$(cells[0]).text().trim()];
                        const newPortCell = $(cells[1]).find('p').length
                            ? $(cells[1]).find('p').map((j, p) => $(p).text().trim()).get().filter(t => t)
                            : [$(cells[1]).text().trim()];

                        if (hasMiddleStop) {
                            const midPortCell = $(cells[1]).find('p').length
                                ? $(cells[1]).find('p').map((j, p) => $(p).text().trim()).get().filter(t => t)
                                : [$(cells[1]).text().trim()];
                            midPortCell.forEach(time => midPortTimes.push(time));
                            newPortCell.forEach(time => newPortTimes.push($(cells[2]).text().trim()));
                        } else {
                            oldPortCell.forEach(time => oldPortTimes.push(time));
                            newPortCell.forEach(time => newPortTimes.push(time));
                        }
                    }
                });

                if (oldPortTimes.length > 0) {
                    times[routeName] = {
                        ...times[routeName],
                        oldPort: oldPortTimes,
                        newPort: newPortTimes,
                        midPort: hasMiddleStop ? midPortTimes : undefined,
                        hasMiddleStop
                    };
                }
            } else {
                console.log(`No timetable found for ${routeName} - likely out of season.`);
                times[routeName] = {
                    ...times[routeName],
                    message: "No service available—check back in summer"
                };
            }
        });

        console.log('Scraped routes:', Object.keys(times));
        if (Object.keys(times).length === 0) {
            console.warn('No routes scraped, returning fallback');
            return {
                "fabrika (mykonos town) - airport": {
                    "lineId": "1559047590770-061945df-35ac",
                    "oldPort": ["09:00", "10:00", "11:00"],
                    "newPort": ["09:15", "10:15", "11:15"],
                    "headerImage": "https://mykonosbusmap.com/images/stops_fabrika-airport_01.svg"
                }
            };
        }
        return times;
    } catch (error) {
        console.error('Error scraping:', error.message);
        return {
            "fabrika (mykonos town) - airport": {
                "lineId": "1559047590770-061945df-35ac",
                "oldPort": ["09:00", "10:00", "11:00"],
                "newPort": ["09:15", "10:15", "11:15"],
                "headerImage": "https://mykonosbusmap.com/images/stops_fabrika-airport_01.svg"
            }
        };
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
        console.log('API response:', cachedTimetables);
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
        console.log('API response after refresh:', cachedTimetables);
        res.json(cachedTimetables);
    } catch (error) {
        console.error('Error in /api/refresh:', error.message);
        res.status(500).json({ error: 'Failed to refresh timetables' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));