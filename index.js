const fs = require('fs');
const { URL, URLSearchParams } = require('url');
const cheerio = require('cheerio');
const { request } = require("./requestQueue.js");

const ancestryBaseUrl = 'https://search.ancestry.com/';
const recordFolder = './records';
const pageFolder = './pages'
const currentPageFile = './url.txt'

if (!fs.existsSync(recordFolder)) {
  fs.mkdirSync(recordFolder);
}

if (!fs.existsSync(pageFolder)) {
  fs.mkdirSync(pageFolder);
}

const pageSize = 50;

const getRecordUrl = (rid, pid, dbid) => ('https://search.ancestry.com/Mercury/Pages/Ajax/IndivRecHoverRecordService.aspx?' + [
  'IndivAjax=1',
  `recid=${rid}`,
  `h=${pid}`,
  `db=${dbid}`
].join('&'));

const getRecords = async pageUrl => {
  const result = await request(pageUrl);
  const html = result.data;

  const $ = cheerio.load(html);
  if ($('.navSubscribeLink').length) {
    throw new Error("Logged out. Please refresh cookies");
  }

  return html;
}

const parseTotalRecords = records => {
  const $ = cheerio.load(records);
  const resultsHeader = $('#results-header').text();
  return parseInt(resultsHeader.split('of')[1].trim().replace(',', ''))
}

const getCurrentPageUrl = () => {
  return fs.readFileSync(currentPageFile, { encoding: 'utf8' }).trim();
}

const parseNextPageQuery = records => {
  const $ = cheerio.load(records)
  const $nextPageLink = $('.pagination li.next a')
  return $nextPageLink.attr('href');
}

const parseRecords = records => {
  const $ = cheerio.load(records)
  const $records = $('tr.record');
  return new Array($records.length).fill(0).map((n, i) => {
    const $record = $records.eq(i);
    const rid = $record.attr('rid');
    const pid = $record.attr('pid');
    const dbid = $record.attr('dbid');
    return { rid, pid, dbid };
  });
}

const getRecord = async ({rid, pid, dbid}) => {
  const recordUrl = getRecordUrl(rid, pid, dbid);
  const result = await request(recordUrl);
  return result.data;
}

const getPageFile = page => `${pageFolder}/${page.toString().padStart(4, '0')}.page`
const getRecordKey = record => `${record.rid}-${record.pid}-${record.dbid}`
const getRecordFile = record => `${recordFolder}/${getRecordKey(record)}.json`


const parseRecordValue = $value => {
  if ($value.children().length === 0) {
    return $value.text();
  } else {
    const values = [];
    const $values = $value.find('.unveiled_label');
    for (let i = 0; i < $values.length; i++) {
      values.push($values.eq(i).text());
    }
    return values;
  }
}

const saveRecord = (record, contents) => {
  const $ = cheerio.load(contents);
  const data = {};
  const $fields = $('.hoverDataWrapper > table > tbody > tr');

  console.log("Parsing", $fields.length, "fields");

  for (let i = 0; i < $fields.length; i++) {
    const $field = $fields.eq(i);
    const key = $field.children('td').eq(0).text().replace(':', '');
    const $value = $field.children('td').eq(1);
    data[key] = parseRecordValue($value);
  }

  fs.writeFileSync(getRecordFile(record), JSON.stringify(data, null, 2));
}

const processCurrentPage = async () => {
  if (!fs.existsSync(currentPageFile)) {
    throw new Error("No current page file", currentPageFile);
  }

  const currentPageUrl = getCurrentPageUrl();
  if (!currentPageUrl.length) {
    throw new Error("No URL in", currentPageFile);
  }

  try {
    new URL(currentPageUrl);
  } catch (e) {
    console.log("Problem with url in", currentPageFile, currentPageUrl, e);
  }

  const result = await getRecords(currentPageUrl);
  const records = parseRecords(result);

  if (!records.length) {
    console.log(result);
  }

  const operations = records.map(async record => {
    const recordFile = getRecordFile(record);
    if (fs.existsSync(recordFile)) {
      console.log('Skipping record', recordFile);
    }

    const data = await getRecord(record);
    saveRecord(record, data);
  });

  await Promise.all(operations);
  const nextPageQuery = parseNextPageQuery(result);
  if (!nextPageQuery) return;

  const nextPageUrl = currentPageUrl.split('?')[0] + nextPageQuery;
  fs.writeFileSync(currentPageFile, nextPageUrl);
  return nextPageUrl;
}


const main = async () => {
  const result = await getRecords(getCurrentPageUrl());
  const totalRecords = parseTotalRecords(result);
  console.log("Downloading", totalRecords, 'records');

  let hasMoreRecords = true;
  while (hasMoreRecords) {
    hasMoreRecords = await processCurrentPage();

    if (hasMoreRecords) {
      const url = new URL(hasMoreRecords);
      const offset = Number(url.searchParams.get('fh'));
      const maxRecords = Math.min(totalRecords, offset+pageSize);
      console.log("Downloading", offset+1, 'through', maxRecords);
    }
  }

  console.log("Done!");
}

if (require.main === module) {
  main();
} else {
  module.exports = main;
}

    // <key>com.apple.security.application-groups</key>
    // <array>
    //   <string>$(GOOGLE_COMMON_APPLICATION_GROUP)</string>
    //   <string>$(GOOGLE_HOME_APPLICATION_GROUP)</string>
    // </array>
