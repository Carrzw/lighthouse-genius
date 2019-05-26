const puppeteer = require('puppeteer');

const lighthouse = require('lighthouse');

const csvParse     = require('csv-parse/lib/sync');
const csvStringify = require('csv-stringify/lib/sync');

const fs = require('fs');
const { URL } = require('url');

// lighthouse result return both "title"(for display) and "name", we use name as key for mapping data later
// const categoriesauditsNameTitleMap

const categoriesNameTitleMap = {
  'performance':    'Performance',
  'accessibility':  'Accessibility',
  'best-practices': 'Best-practices',
  'seo':            'SEO',
  'pwa':            'PWA',
};

const auditsNameTitleMap = {
  'first-contentful-paint':     'First Contentful Paint',
  'first-meaningful-paint':     'First Meaningful Paint',
  'speed-index':                'Speed Index',
  'estimated-input-latency':    'Estimated Input Latency',
  'interactive':                'Time to Interactive',
  'first-cpu-idle':             'First CPU Idle',
  'render-blocking-resources':  'Eliminate render-blocking resources',
  'uses-rel-preconnect':        'Preconnect to required origins',
  'uses-text-compression':      'Enable text compression',
  'time-to-first-byte':         'Server response times are low (TTFB)',
  'offscreen-images':           'Defer offscreen images',
  'uses-webp-images':           'Serve images in next-gen formats',
  'uses-optimized-images':      'Efficiently encode images',
  'uses-responsive-images':     'Properly size images',
  'unminified-javascript':      'Minify JavaScript',
  'uses-rel-preload':           'Preload key requests',
  'unused-css-rules':           'Remove unused CSS',
  'efficient-animated-content': 'Use video formats for animated content',
  'unminified-css':             'Minify CSS',
  'mainthread-work-breakdown':  'Minimize main-thread work',
  'dom-size':                   'Avoid an excessive DOM size',
  'uses-long-cache-ttl':        'Serve static assets with an efficient cache policy',
  'bootup-time':                'Reduce JavaScript execution time',
  'critical-request-chains':    'Minimize Critical Requests Depth',
  'user-timings':               'User Timing marks and measures',
  'font-display':               'All text remains visible during webfont loads',
  'total-byte-weight':          'Avoids enormous network payloads',
};

const inputColumnsHeader = ['Device', 'URL'];
// use orderMap to record the index of each "name", lighthouse result 
// from target urls could use this index to find correct column
const orderMap         = {};
Object.keys({ ...categoriesNameTitleMap, ...auditsNameTitleMap }).forEach((element, i) => {
  orderMap[element] = i + inputColumnsHeader.length;
});


let config = {
  extends:  'lighthouse:default',
  settings: {
    // onlyAudits: Object.keys(auditsNameTitleMap),
    throttlingMethod: 'simulate',
    // https://github.com/GoogleChrome/lighthouse/blob/656b9b1934ca34f87e0f823c4b6f961af5c94112/lighthouse-core/report/html/renderer/util.js
  },
  passes: [
    {
      useThrottling: true,
    }
  ]
};

const startTime = Date.now();

(async() => {  

  input = fs.readFileSync('./input.csv', { encoding: 'utf8' });
  
  const auditTargets = csvParse(input, {
    columns:          true,
    skip_empty_lines: true,
    trim:             true,
  });
  const totalTasks   = auditTargets.length;
  let countingDown   = totalTasks;

  // Use Puppeteer to launch headful Chrome and don't use its default 800x600 viewport.
  const browser = await puppeteer.launch({
    headless:        true,
    args:            ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null,
  });
  const lighthousePort = new URL(browser.wsEndpoint()).port;
  const genDateTime    = new Date().toISOString();
  const writeStream    = fs.createWriteStream(`${genDateTime.slice(0, 16)}.csv`);

  const header = Object.values(auditsNameTitleMap);
  header.unshift(...Object.values(categoriesNameTitleMap));
  header.unshift(...inputColumnsHeader);
  
  const headerRow = csvStringify([header], { delimiter: ',' });
  writeStream.write(headerRow);

  for (const target of auditTargets) {

    console.log(`Device = ${target.Device} || URL = ${target.URL}`);
    console.log(`Total: ${totalTasks} || Current: ${countingDown--}`);

    const resultRow = [target[`${inputColumnsHeader[0]}`], target[`${inputColumnsHeader[1]}`]];
    try {
      config.settings.emulatedFormFactor = target.Device;
      const { lhr } = await lighthouse(target.URL, { port: lighthousePort }, config);
      const csv     = generateReportCSV(lhr);
      const result  = csvParse(csv, {
        columns:          true,
        skip_empty_lines: true,
        trim:             true,
      });

      result.forEach(item => {
        let position        = orderMap[item.name];
        resultRow[position] = item.displayValue;
      });

      Object.keys(lhr.categories).forEach(ck => {
        let position        = orderMap[ck];
        resultRow[position] = lhr.categories[ck].score;
      });

    } catch (e) {
      console.log(e);
    } finally {
      const csvResult = csvStringify([resultRow], { delimiter: ',' });
      writeStream.write(csvResult);
    }
  }

  return { browser, writeStream };
})().then(async (resources) => {
  const elapsed    = Date.now() - startTime;
  const difference = new Date(elapsed);
  console.log(`Total time to accomplish all tasks: ${difference.getHours()} hours ${difference.getMinutes()} minutes`);
  resources.browser.close();
  resources.writeStream.end();
});

const normalizeResult = (value) => {
  const matchNumber = /\d+/.exec(value);
  return /^-?\d+/.test(value) ? value :
    matchNumber ? `${value.slice(matchNumber.index)} (${value.slice(0, matchNumber.index - 1)})` : value;
}

const generateReportCSV = (lhr) => {
  // To keep things "official" we follow the CSV specification (RFC4180)
  // The document describes how to deal with escaping commas and quotes etc.
  const CRLF      = '\r\n';
  const separator = ',';
  /** @param {string} value @returns {string} */
  const escape = value => `"${value.replace(/"/g, '""')}"`;

  // Possible TODO: tightly couple headers and row values
  const header = ['category', 'name', 'title', 'type', 'score', 'displayValue'];
  const table = Object.values(lhr.categories).map(category => {
    return category.auditRefs.map(auditRef => {
      const audit = lhr.audits[auditRef.id];
      // CSV validator wants all scores to be numeric, use -1 for now
      const numericScore = audit.score === null ? -1 : audit.score;
      return [category.title, audit.id, audit.title, audit.scoreDisplayMode, numericScore, audit.displayValue || numericScore]
        .map(value => value.toString())
        .map(value => normalizeResult(value))
        .map(escape);
    });
  });

  return [header].concat(...table)
    .map(row => row.join(separator)).join(CRLF);
}
