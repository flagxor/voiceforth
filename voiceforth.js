#! /usr/bin/env node

'use strict';

const child_process = require('child_process');
const http = require('http');
const fs = require('fs');
const process = require('process');
const readline = require('readline');

const expected_passwd = fs.readFileSync('passwd').toString().trim();
var pendingOutput = '';
var gforth;

function timeout(duration) {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

function launchGforth() {
  if (gforth !== undefined) {
    gforth.kill('SIGQUIT');
  }
  gforth = child_process.spawn('gforth', ['-e', 'quit']);
  gforth.stdout.on('data', (data) => {
    pendingOutput += data.toString();
  });
  gforth.stderr.on('data', (data) => {
    pendingOutput += data.toString();
  });
  gforth.on('exit', (code) => {
    gforth = undefined;
  });
}

function prepReply(passwd, text, tts) {
  if (tts === undefined) {
    tts = text;
  }
  const reply = {
    conversationToken: '',
    userStorage: passwd,
    expectUserResponse: true,
    expectedInputs: [
      {
        inputPrompt: {
          richInitialPrompt: {
            items: [
              {
                simpleResponse: {
                  textToSpeech: tts,
                  displayText: text,
                },
              },
            ],
            suggestions: [],
          },
        },
        possibleIntents: [
          {
            intent: 'actions.intent.TEXT',
          },
        ],
        speechBiasingHints: [
          ':',
          ';',
          '.',
          ',',
          '+',
          '-',
          '*',
          '/',
          '*/',
          'dup',
          'drop',
          'swap',
          'over',
          'rot',
          '-rot',
          'emit',
          'cr',
        ],
      },
    ],
  };
  return reply;
};

function handleQuery(passwd, query) {
  if (passwd != expected_passwd) {
    if (query.toLowerCase() == expected_passwd) {
      return Promise.resolve(prepReply(expected_passwd, 'ok'));
    }
    return Promise.resolve(prepReply('x', "What's the password?"));
  }
  if (gforth === undefined) {
    launchGforth();
  }
  if (query.toLowerCase() == 'talk to voice forth') {
    return Promise.resolve(prepReply(passwd, 'ok'));
  }
  if (query.toLowerCase() == 'sign out' ||
      query.toLowerCase() == 'log out' ||
      query.toLowerCase() == 'logout') {
    return Promise.resolve(prepReply('x', "Ok. What's the password?"));
  }
  gforth.stdin.write(query + '\n');
  pendingOutput = '';  // Something better?
  return timeout(50).then(() => {
    // Strip input if the same.
    if (pendingOutput.substr(0, query.length) == query) {
      pendingOutput = pendingOutput.substr(query.length);
    }
    var text = pendingOutput;
    var tts = pendingOutput;
    if (tts.search(/:[0-9]+:/) >= 0) {
      tts = tts.trim().split('\n')[0];
      tts = tts.replace(/:[0-9]+:/, '');
    }
    pendingOutput = '';
    return prepReply(passwd, text, tts);
  });
}

function runServer() {
  const server = http.createServer((request, response) => {
    var requestBody = '';
    request.on('data', function(data) {
      requestBody += data;
    });
    request.on('end', function() {
      try {
        const req = JSON.parse(requestBody);
        const query = req.inputs[0].rawInputs[0].query;
        const passwd = req.user.userStorage;
        handleQuery(passwd, query).then((result) => {
          response.writeHead(200, {'Content-Type': 'text/plain'});
          response.write(JSON.stringify(result));
          response.end();
        });
      } catch (e) {
        console.error(e.stack);
        response.end();
        return;
      }
    });
  });
  server.on('clientError', (err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.listen(8000);
}

function runReadline() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  var passwd = 'x';
  function doRound(query) {
    handleQuery(passwd, query).then((reply) => {
      passwd = reply.userStorage;
      const ip = reply.expectedInputs[0].inputPrompt.richInitialPrompt;
      console.log(ip.items[0].simpleResponse.textToSpeech);
      rl.question('> ', (answer) => {
        if (answer == 'cancel') {
          rl.close();
          process.exit(0);
          return;
        }
        doRound(answer);
      });
    });
  }
  doRound('talk to voice forth');
}

if (process.argv.length > 2 && process.argv[2] == 'con') {
  runReadline();
} else {
  runServer();
}

