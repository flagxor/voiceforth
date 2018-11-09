#! /usr/bin/env node

const child_process = require('child_process');
const http = require('http');
const fs = require('fs');
const process = require('process');

var expected_passwd = fs.readFileSync('passwd').trim();
var pendingOutput = '';
var gforth;

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
      const query = req.inputs[0].rawInputs[0].query;
      if (req.userStorage != expected_pass) {
        if (query.toLowerCase() == expected_pass) {
          response.write(prepReply(expected_pass, 'ok'));
          response.end();
          return;
        }
        response.write(prepReply('', "What's the password?"));
        response.end();
        return;
      }
      if (gforth === undefined) {
        launchGforth();
      }
      if (query.toLowerCase() == 'talk to voice forth') {
        response.write(prepReply(req.userStorage, 'ok'));
        response.end();
        return;
      }
      gforth.stdin.write(query + '\n');
      pendingOutput = '';  // Something better?
      setTimeout(() => {
        response.writeHead(200, {'Content-Type': 'text/html'});
        // Strip input if the same.
        if (pendingOutput.substr(0, query.length) == query) {
          pendingOutput = pendingOutput.substr(query.length);
        }
        var tts = pendingOutput.split('\n')[0];
        tts = tts.replace(/:[0-9]+:/, '');
        response.write(prepReply(req.userStorage, pendingOutput, tts));
        pending = '';
        response.end();
      }, 100);
    } catch (e) {
      response.end();
      return;
    }
  });
});

server.on('clientError', (err, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(8000);
