#!/usr/bin/env node

require('should');

const cp = require('child_process');
const fs = require('fs');
const request = require('request');
const path = require('path');
const streamSplitter = require('stream-splitter');
const Mqtt = require('mqtt');

if (process.platform === 'darwin') {
    cp.exec('brew services start mosquitto')
}

let mqtt = Mqtt.connect('mqtt://127.0.0.1');

const msCmd = path.join(__dirname, '/mockdate.js');
const msArgs = ['-d', __dirname + '/testscripts', '-v', 'debug'];
let ms;
let msPipeOut;
let msPipeErr;
const msSubscriptions = {};
const msBuffer = [];

let subIndex = 0;

function subscribe(type, rx, cb) {
    subIndex += 1;
    if (type === 'ms') {
        msSubscriptions[subIndex] = {rx, cb};
    }
    matchSubscriptions(type);
    return subIndex;
}

function unsubscribe(type, subIndex) {
    if (type === 'ms') {
        delete msSubscriptions[subIndex];
    }
}

function matchSubscriptions(type, data) {
    let subs;
    let buf;
    if (type === 'sim') {
        subs = simSubscriptions;
        buf = simBuffer;
    } else if (type === 'ms') {
        subs = msSubscriptions;
        buf = msBuffer;
    }
    if (data) {
        buf.push(data);
    }
    buf.forEach((line, index) => {
        Object.keys(subs).forEach(key => {
            const sub = subs[key];
            let m;
            if (m = line.match(sub.rx)) {
                sub.cb(line, m);
                delete subs[key];
                buf.splice(index, 1);
            }
        });
    });
}

const mqttSubscriptions = {};
function mqttSubscribe(topic, callback) {
    if (mqttSubscriptions[topic]) {
        mqttSubscriptions[topic].push(callback);
    } else {
        mqttSubscriptions[topic] = [callback];
        mqtt.subscribe(topic);
    }
}
mqtt.on('message', (topic, payload) => {
    if (mqttSubscriptions[topic]) {
        mqttSubscriptions[topic].forEach((callback, index) => {
            callback(payload.toString());
        });
    }
});

function startMs() {
    ms = cp.spawn(msCmd, msArgs);
    msPipeOut = ms.stdout.pipe(streamSplitter('\n'));
    msPipeErr = ms.stderr.pipe(streamSplitter('\n'));
    msPipeOut.on('token', data => {
        console.log('ms', data.toString());
        matchSubscriptions('ms', data.toString());
    });
    msPipeErr.on('token', data => {
        console.log('ms', data.toString());
        matchSubscriptions('ms', data.toString());
    });
}



function end(code) {
    if (ms.kill) {
        ms.kill();
    }
    if (typeof code !== 'undefined') {
        process.exit(code);
    }
}

process.on('SIGINT', () => {
    end(1);
});

process.on('exit', () => {
    end();
});

describe('start daemon', () => {
    it('should start without error', function (done) {
        this.timeout(800);
        subscribe('ms', /mqtt-scripts [0-9.]+ starting/, data => {
            done();
        });
        startMs();
    });
    it('should connect to the mqtt broker', function (done) {
        this.timeout(800);
        subscribe('ms', /mqtt connected/, data => {
            done();
        });
     });
    it('should subscribe to #', function (done) {
        this.timeout(800);
        subscribe('ms', /mqtt subscribe #/, data => {
            done();
        });
    });
    it('should publish bridge state at logic/state', function (done) {
        this.timeout(800);
        mqttSubscribe('logic/state', payload => {
            console.log(payload);
            if (JSON.parse(payload).state === 'online' ) {
                mqtt.unsubscribe('logic/state');
                done();
            }
        });
    });
});

describe('script loading', () => {
    it('should load test1.js script file', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test1\.js loading/, data => {
            done();
        });
    });
    it('should execute test1.js script file', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test1\.js running/, data => {
            done();
        });
    });
    it('should catch a syntax error', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test3\.js SyntaxError/, data => {
            done();
        });
    });
    
});

describe('argument checks', () => {
    it('should throw on wrong arguments for subscribe() (1)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test4\.js.*TypeError: callback is not a function/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for subscribe() (2)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test5\.js.*TypeError: callback is not a function/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for subscribe() (3)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test16\.js.*TypeError: argument topic missing/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for subscribe() (4)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test6\.js.*Error: wrong number of arguments/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for subscribe() (5)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test17\.js.*Error: options.condition/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for sunSchedule() (1)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test8\.js.*TypeError: unknown suncalc event/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for sunSchedule() (2)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test9\.js.*Error: wrong number of arguments/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for sunSchedule() (3)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test10\.js.*TypeError: callback is not a function/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for sunSchedule() (4)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test11\.js.*TypeError: callback is not a function/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for sunSchedule() (5)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test15\.js.*Error: options.shift out of range/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for schedule() (1)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test12\.js.*TypeError: callback is not a function/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for schedule() (2)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test13\.js.*TypeError: callback is not a function/, data => {
            done();
        });
    });
    it('should throw on wrong arguments for schedule() (3)', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test14\.js.*Error: wrong number of arguments/, data => {
            done();
        });
    });
});

describe('testscripts/test1.js execution', () => {
    it('should log a msg', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test1\.js: test log/, () => {
            done();
        });
    });
    it('should return true on getPayload()', function (done) {
        this.timeout(800);
        subscribe('ms', /testscripts\/test1\.js: test1 true/, () => {
            done();
        });
    });

});

describe('require()', () => {
    it('should load a lib file', function (done) {
        this.timeout(2000);
        subscribe('ms', /require test/, () => {
            done();
        });
    });
    it('should load a module', function (done) {
        this.timeout(2000);
        subscribe('ms', /Dummy Module/, () => {
            done();
        });
    });
    it('should throw on invalid module', function (done) {
        this.timeout(2000);
        subscribe('ms', /ReferenceError: thisDoesNotExist is not defined/, () => {
            done();
        });
    });
});

describe('subscribe(), publish()', () => {
    it('should increase a number', function (done) {
        this.timeout(800);
        mqttSubscribe('test/status/incr', payload => {
            if (payload === '5') {
                done();
            }
        });
        mqtt.publish('test/set/incr', '4');
    });
});

describe('subscribe()', function () {
    it('should respect condition val==\'muh\'', function (done) {
        this.timeout(800);
        subscribe('ms', /test1\.js: test\/condition (.*)$/, (line, m) => {
            done(m[1] === 'muh' ? undefined : new Error());
        });
        mqtt.publish('test/condition', 'blub');
        mqtt.publish('test/condition', 'muh');
    });
    it('should respect change==true', function (done) {
        this.timeout(800);
        let count = 0;
        subscribe('ms', /test1\.js: test\/change 0/, (line, m) => {
            count += 1;
            console.log('test change = '+count);
        });
        subscribe('ms', /test1\.js: test\/change 1/, (line, m) => {
            count += 1;
            console.log('test change = '+count);
            if (count === 2) {
                done();
            }
        });
        setTimeout(() => {
            mqtt.publish('test/change', '0');
            mqtt.publish('test/change', '0');
            mqtt.publish('test/change', '0');
            mqtt.publish('test/change', '1');
            mqtt.publish('test/change', '1');
        }, 100);
    });
    it('should do randomshift', function (done) {
        this.timeout(2500);
        let early = true;
        setTimeout(function () {
            early = undefined;
        }, 900);
        subscribe('ms', /callback for test\/randomshift muh/, () => {
            done(early);
        });
        mqtt.publish('test/randomshift', 'muh');
        console.log('start randomshift test')
    })
});

describe('link()', () => {
    it('should link one topic to another', function (done) {
        this.timeout(800);
        mqttSubscribe('test/target', payload => {
            if (payload === 'test') {
                done();
            }
        });
        mqtt.publish('test/src', 'test');
    });
    it('should link multiple topic to other topics', function (done) {
        this.timeout(800);
        mqttSubscribe('test/target2', payload => {
            if (payload === 'test') {
                done();
            }
        });
        mqtt.publish('test/src1', 'test');
    });
    it('should link one topic to another with given value', function (done) {
        this.timeout(800);
        mqttSubscribe('test/target3', payload => {
            if (payload === '1337') {
                done();
            }
        });
        mqtt.publish('test/src3', 'test');
    });
    it('should link one topic to another with transformation function', function (done) {
        this.timeout(800);
        mqttSubscribe('test/target4', payload => {
            if (payload === '4') {
                done();
            }
        });
        mqtt.publish('test/src4', '2');
    });
});

describe('schedule()', () => {
    it('should execute a schedule callback for \'* * * * *\'', function (done) {
        this.timeout(10000);
        subscribe('ms', /schedule callback/, () => {
            done();
        });
    });
    it('should execute a schedule callback for \'0 0 * * *\'', function (done) {
        this.timeout(10000);
        subscribe('ms', /midnight/, () => {
            done();
        });
    });
    it('should re-schedule sun events', function (done) {
        subscribe('ms', /re\-scheduled [0-9]+ sun events/, () => {
            done();
        });
    });
    it('should execute a schedule callback for Date', function (done) {
        this.timeout(10000);
        subscribe('ms', /schedule date/, () => {
            done();
        });
    });
    it('should execute a schedule callback for multi schedule', function (done) {
        this.timeout(10000);
        let count = 0;
        subscribe('ms', /multi schedule 1/, () => {
            count += 1;    
        });
        subscribe('ms', /multi schedule 2/, () => {
            count += 1;
            if (count >= 2) {
                done();
            }
        });
    });
});

describe('exception', () => {
    it('should catch an exception occuring in a script', function (done) {
        this.timeout(3000);
        subscribe('ms', /testscripts\/test1\.js Error: test exception/, () => {
            done();
        });
    });
});


describe('mqtt connection', () => {
    it('should log mqtt disconnect', function (done) {
        this.timeout(4000);
        subscribe('ms', /mqtt closed/, function () {
            done();
        })
        if (process.platform === 'darwin') {
            cp.exec('brew services stop mosquitto')
        } else {
            cp.exec('sudo service mosquitto stop');
        }

    });
     it('should reconnect mqtt', function (done) {
        this.timeout(4000);
        subscribe('ms', /mqtt connected/, function () {
            done();
        });
        if (process.platform === 'darwin') {
            cp.exec('brew services start mosquitto')
        } else {
            cp.exec('sudo service mosquitto start');
        }
        
    });
});


describe('script file changes', () => {
    it('should quit when a script file changes', function (done) {
        this.timeout(10000);
        subscribe('ms', /change detected\. exiting/, () => {
            done();
        });
        setTimeout(function () {
            fs.appendFileSync(__dirname + '/testscripts/test1.js', '\nlog.info(\'appended!\');\n');
        }, 1000);
    });
});

setTimeout(() => {
    ms.kill();
    process.exit(1);
}, 200000);
