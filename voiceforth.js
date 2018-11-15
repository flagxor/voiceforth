#! /usr/bin/env node

'use strict';

const child_process = require('child_process');
const http = require('http');
const fs = require('fs');
const process = require('process');
const readline = require('readline');

const expected_passwd = fs.readFileSync('passwd').toString().trim();
var pendingSlideCommand = '';
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
        speechBiasingHints: [],
      },
    ],
  };
  return reply;
};

function filterQuery(query) {
  query = ' ' + query.toLowerCase() + ' ';
  query = query.replace('\n', ' ');
  query = query.replace('\r', ' ');
  query = query.replace('\t', ' ');
  query = query.replace(' colon ', ' : ');
  query = query.replace(' define ', ' : ');
  query = query.replace(' semicolon ', ' ; ');
  query = query.replace(' end ', ' ; ');
  query = query.replace(' dot ', ' . ');
  query = query.replace(' period ', ' . ');
  query = query.replace(' print ', ' . ');
  query = query.replace(' comma ', ' , ');
  query = query.replace(' load ', ' @ ');
  query = query.replace(' fetch ', ' @ ');
  query = query.replace(' store ', ' ! ');
  query = query.replace(' plus ', ' + ');
  query = query.replace(' add ', ' + ');
  query = query.replace(' minus ', ' - ');
  query = query.replace(' subtract ', ' - ');
  query = query.replace(' star slash ', ' */ ');
  query = query.replace(' times ', ' * ');
  query = query.replace(' multiply ', ' * ');
  query = query.replace(' star ', ' * ');
  query = query.replace(' divide ', ' / ');
  query = query.replace(' slash ', ' / ');
  query = query.replace(' dupe ', ' dup ');
  query = query.replace(' back rot ', ' -rot ');
  query = query.replace(' carriage return ', ' cr ');
  query = query.replace(' push ', ' >r ');
  query = query.replace(' pop ', ' r> ');
  query = query.replace(' does ', ' does> ');
  query = query.replace(' the ', ' ');
  query = query.replace(' a ', ' ');
  query = query.replace(' an ', ' ');
  return query.trim();
}

function handleQuery(passwd, query) {
  query = filterQuery(query);
  if (passwd != expected_passwd) {
    if (expected_passwd) {
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
  if (query.toLowerCase() == 'previous slide') {
    pendingSlideCommand = 'p';
    return Promise.resolve(prepReply(passwd, 'ok', ''));
  }
  if (query.toLowerCase() == 'next slide') {
    pendingSlideCommand = 'n';
    return Promise.resolve(prepReply(passwd, 'ok', ''));
  }
  if (query.toLowerCase().search(/^goto slide/) >= 0) {
    pendingSlideCommand = 'g' + query.substr(11);
    return Promise.resolve(prepReply(passwd, 'ok', ''));
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
      if (request.url == '/voicecheck') {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.writeHead(200, {'Content-Type': 'text/plain'});
        response.write(pendingSlideCommand);
        pendingSlideCommand = '';
        response.end();
        return;
      }
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

