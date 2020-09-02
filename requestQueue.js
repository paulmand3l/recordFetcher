const _ = require('lodash');
const axios = require('axios');
const { formatSeconds } = require('./utils.js');
const { Cookie } = require('./options.js');

// Settings
const maxParallelRequests = 5;
const maxRequestDurations = 100;


const queue = [];
let nRequests = 0;
const requestDurations = [];


const processRequest = async request => {
  nRequests++;
  const start = Date.now();
  console.log("-->", request.url);
  var result;
  try {
    result = await axios.get(request.url, { headers: { Cookie } });
  } catch (e) {
    console.log("xxx", request.url);
    if (e.response  && e.response.status) {
      const code = e.response.status;
      console.log("  Status", code);
      if (400 <= code && code <= 499) {
        request.reject(e);
      } else {
        console.log("  Retrying...")
        request.resolve(queueRequest(request.url));
      }
    }
  }

  console.log("<--", request.url);

  requestDurations.push(Date.now() - start);
  if (requestDurations.length > maxRequestDurations) requestDurations.shift();

  request.resolve(result);
  nRequests--;
}

const processQueue = async () => {
  console.log("Requests:", nRequests, "Queue:", queue.length);
  if (queue.length < 1 || nRequests >= maxParallelRequests) return;
  await processRequest(queue.shift());
  processQueue();
}

const queueRequest = url => {
  return new Promise((resolve, reject) => {
    console.log("+++",  url);
    queue.push({ url, resolve, reject });
    processQueue();
  });
}

const estimateTimeRemaining = n => {
  const timePerRequest = _.sum(requestDurations) / requestDurations.length;
  console.log("Est. time remaining:", formatSeconds((nRequests + queue.length + n) * timePerRequest / 1000));
}

module.exports.request = queueRequest
module.exports.eta = estimateTimeRemaining
