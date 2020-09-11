const fs = require('fs');
const cheerio = require('cheerio');
const { searchUrl, Cookie } = require('./options.js');
const { request, eta } = require("./requestQueue.js");

const recordFolder = './records';
const pageFolder = './pages'

if (!fs.existsSync(recordFolder)) {
  fs.mkdirSync(recordFolder);
}

if (!fs.existsSync(pageFolder)) {
  fs.mkdirSync(pageFolder);
}

const pageSize = 50;
const getRecordsUrl = page => {
  const pageUrl = new URL(searchUrl);
  pageUrl.searchParams.set('count', pageSize);
  pageUrl.searchParams.set('fh', page*pageSize);
  return pageUrl.toString();
}

const getRecordUrl = (rid, pid, dbid) => ('https://search.ancestry.com/Mercury/Pages/Ajax/IndivRecHoverRecordService.aspx?' + [
  'IndivAjax=1',
  `recid=${rid}`,
  `h=${pid}`,
  `db=${dbid}`
].join('&'));

const getRecords = async page => {
  const pageUrl = getRecordsUrl(page);
  const result = await request(pageUrl);
  return result.data;
}

const parseTotalRecords = records => {
  const $ = cheerio.load(records);
  const resultsHeader = $('#results-header').text();
  return parseInt(resultsHeader.split('of')[1].trim().replace(',', ''))
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

  for (let i = 0; i < $fields.length; i++) {
    const $field = $fields.eq(i);
    const key = $field.children('td').eq(0).text().replace(':', '');
    const $value = $field.children('td').eq(1);
    data[key] = parseRecordValue($value);
  }

  fs.writeFileSync(getRecordFile(record), JSON.stringify(data, null, 2));
}


const main = async () => {
  const result = await getRecords(0);
  const totalRecords = parseTotalRecords(result);
  console.log("Downloading", totalRecords, 'records');

  for (let i = 0; i < totalRecords/pageSize; i++) {
    if (fs.existsSync(getPageFile(i))) {
      console.log("Skipping page", i);
      continue;
    } else {
      console.log("Downloading page", i);
    }

    eta(totalRecords - i*pageSize);

    const result = await getRecords(i);
    const records = parseRecords(result);

    const operations = records.map(async record => {
      const recordFile = getRecordFile(record);
      if (fs.existsSync(recordFile)) {
        console.log('Skipping record', recordFile);
      }

      const data = await getRecord(record);
      saveRecord(record, data);
    });

    await Promise.all(operations);
    fs.writeFileSync(getPageFile(i), '');
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = main;
}

