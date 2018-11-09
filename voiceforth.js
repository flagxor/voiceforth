#! /usr/bin/env node

const child_process = require('child_process');
const http = require('http');
const process = require('process');

const gforth = child_process.spawn('gforth');

var pendingOutput = '';

gforth.stdout.on('data', (data) => {
  pendingOutput += data.toString();
});

gforth.stderr.on('data', (data) => {
  pendingOutput += data.toString();
});

gforth.on('exit', (code) => {
  process.exit(code);
});

function prepReply(text) {
  const reply = {
    conversationToken: '',
    expectUserResponse: true,
    expectedInputs: [
      {
        inputPrompt: {
          richInitialPrompt: {
            items: [
              {
                simpleResponse: {
                  textToSpeech: text,
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
          }
        ],
      },
    ],
  };
  return JSON.stringify(reply);
};

const server = http.createServer((request, response) => {
  var requestBody = '';
  request.on('data', function(data) {
    requestBody += data;
  });
  request.on('end', function() {
    try {
      const req = JSON.parse(requestBody);
      gforth.stdin.write(req.inputs[0].rawInputs[0].query + '\n');
    } catch (e) {
      response.end();
      return;
    }
    pendingOutput = '';  // Something better?
    setTimeout(() => {
      response.writeHead(200, {'Content-Type': 'text/html'});
      response.write(prepReply(pendingOutput));
      pending = '';
      response.end();
    }, 100);
  });
});

server.on('clientError', (err, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(8000);
