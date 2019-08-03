const fs = require('fs');
const { URL } = require('url');
const cluster = require('cluster');

const puppeteer = require('puppeteer');
const lighthouse = require('lighthouse');

const csvParse = require('csv-parse/lib/sync');
const csvStringify = require('csv-stringify/lib/sync');

// lighthouse result return both "title"(for display) and "name", we use name as key for mapping data later

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
// from target urls could use this index to find correct column.
const orderMap = {};
Object.keys({ ...categoriesNameTitleMap, ...auditsNameTitleMap }).forEach((element, i) => {
  orderMap[element] = i + inputColumnsHeader.length;
});

let config = {
  extends:  'lighthouse:default',
  settings: {
    throttlingMethod: 'simulate',
  },
  passes: [
    {
      useThrottling: true,
    }
  ]
};

const outputDirName = 'output';
const errLogDirName = 'errorLog';

const maxCountOfWorkers = 4;

// Above are global which could access both by master and worker

module.exports = function(inputFilePath) {
  cluster.isMaster ? masterTask(inputFilePath) : workerTask();
}

const masterTask = (inputFilePath) => {
  (async() => {
    try {
      input = fs.readFileSync(inputFilePath, { encoding: 'utf8' });  
    } catch (e) {
      console.log(e);
      console.log("Make sure \"input.csv\" is provided in the folder.");
    }
    const startTime = Date.now();
    const auditTargets = csvParse(input, {
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
    });

    const totalTasks = auditTargets.length;
    createOutputDir(outputDirName);
    createOutputDir(errLogDirName);
    const clock = new Date();
    const genDateTime = new Date(clock.getTime() - (clock.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    const writeStream = fs.createWriteStream(`./${outputDirName}/${genDateTime}.csv`);
    const errLogWriteStream = fs.createWriteStream(`./${errLogDirName}/${genDateTime}-error-log.csv`);

    const header = Object.values(auditsNameTitleMap);
    header.unshift(...Object.values(categoriesNameTitleMap));
    header.unshift(...inputColumnsHeader);
    
    const headerRow = csvStringify([header], { delimiter: ',' });
    writeStream.write(headerRow);

    const deliverTask = (worker) => {
      console.log(`Total: ${totalTasks} || Current: ${auditTargets.length}`);
      const newTask = auditTargets.shift();
      console.log(`Device = ${newTask.Device} || URL = ${newTask.URL}`);
      worker.send({ target: newTask });
    };

    cluster.on('online', (worker) => {
      deliverTask(worker);
    });

    cluster.on('message', (worker, { csvResult, error }) => {
      if (error) {
        errLogWriteStream.write(error);
      } else {
        writeStream.write(csvResult);
      }
      
      if (auditTargets.length !== 0) {
        deliverTask(worker);  
      } else {
        worker.kill();
      }
    });

    cluster.on('exit', (worker, code, signal) => {
      if (auditTargets.length !== 0) {
        cluster.fork();
      }
      if (Object.keys(cluster.workers).length === 0) {
        writeStream.end();
        errLogWriteStream.end();
        const elapsed = Date.now() - startTime;
        const totalTimeInSeconds = elapsed / 1000;
        const seconds = Math.floor(totalTimeInSeconds % 60);
        const minutes = Math.floor(totalTimeInSeconds / 60);
        console.log(`Total time to accomplish all tasks: ${minutes} minutes ${seconds} seconds`);
      }
    });

    for (let i = 0; i < maxCountOfWorkers; i++) {
      cluster.fork();
    }
  })();
}

const workerTask = () => {
  process.on('message', ({ target }) => {
    (async() => {
      let browser;
      const resultRow = [target[`${inputColumnsHeader[0]}`], target[`${inputColumnsHeader[1]}`]];
      const result = {
        csvResult: undefined,
        error:     undefined,
      };

      try {
        const executablePath = process.pkg ?
          puppeteer.executablePath().replace(__dirname, './bundle') :
          puppeteer.executablePath();

        browser = await puppeteer.launch({
          executablePath,
          headless:        true,
          args:            ['--no-sandbox', '--disable-setuid-sandbox'],
          defaultViewport: null,
        });

        const lighthousePort = new URL(browser.wsEndpoint()).port;
        config.settings.emulatedFormFactor = target.Device;
        const { lhr } = await lighthouse(target.URL, { port: lighthousePort }, config);
        const csv = generateReportCSV(lhr);
        const csvParseResult = csvParse(csv, {
          columns:          true,
          skip_empty_lines: true,
          trim:             true,
        });

        csvParseResult.forEach(item => {
          let position = orderMap[item.name];
          resultRow[position] = item.displayValue;
        });

        Object.keys(lhr.categories).forEach(categoryKey => {
          let position = orderMap[categoryKey];
          resultRow[position] = lhr.categories[categoryKey].score;
        });
      } catch (e) {
        console.log(e);
        const errorPairs = [resultRow[0], resultRow[1]];
        Object.entries(e).forEach(([key, value]) => {
          errorPairs.push(key, value);
        });
        const errResult = csvStringify([errorPairs], { delimiter: ',' }); 
        result.error = errResult;
      } finally {
        browser.close();
        const csvResult = csvStringify([resultRow], { delimiter: ',' }); 
        result.csvResult = csvResult;
        process.send(result);
      }
    })();
  });
}

const createOutputDir = (dir) => {
  try {
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir)
    }
  } catch (err) {
    console.error(err)
  }
}

const normalizeResult = (value) => {
  const matchNumber = /\d+/.exec(value);
  return /^-?\d+/.test(value) ? value :
    matchNumber ? `${value.slice(matchNumber.index)} (${value.slice(0, matchNumber.index - 1)})` : value;
}

const generateReportCSV = (lhr) => {
  // To keep things "official" we follow the CSV specification (RFC4180)
  // The document describes how to deal with escaping commas and quotes etc.
  const CRLF = '\r\n';
  const separator = ',';
  const escape = value => `"${value.replace(/"/g, '""')}"`;
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
  return [header].concat(...table).map(row => row.join(separator)).join(CRLF);
}
