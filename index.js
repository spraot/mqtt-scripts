#!/usr/bin/env node
/* eslint-disable func-names */
/* eslint-disable func-name-matching */
/* eslint-disable camelcase */

/* eslint prefer-rest-params: "warn" */
/* eslint prefer-destructuring: "warn" */

/* eslint node/no-deprecated-api: "warn" */

const config = require('./lib/config.js');
const fs = require('fs');
const {isText} = require('istextorbinary');
const domain = require('domain');
const vm = require('vm');
const path = require('path');
const scheduler = require('node-schedule');
const suncalc = require('suncalc');
const mqttLib = require('mqtt');

if (config.logdir && typeof config.logdir === 'string') {
    config.logdir = path.join(config.logdir, pkg.name+'.log');
} else {
    config.logdir = undefined;
}

const mqttWildcard = require('mqtt-wildcard');
const pkg = require('./package.json');

const log = require('pino')({
    level: ['debug', 'info', 'warn', 'error'].indexOf(config.verbosity) === -1 ? 'info' : config.verbosity,
    timestamp: () => `,"dt":"${new Date(Date.now()).toISOString()}"`,
    base: undefined,
    messageKey: 'message',
    formatters: {
        level: label => ({level: label}),
    },
}, config.logdir);

const modules = {
    fs,
    path,
    vm,
    /* eslint-disable no-restricted-modules */
    domain,
    mqtt: mqttLib,
    'node-schedule': scheduler,
    suncalc,
};

log.info(pkg.name + ' ' + pkg.version + ' starting');
log.debug({config}, 'loaded config');

const sandboxModules = [];
const status = {};
const scripts = {};
const subscriptions = [];

const _global = {};

function listener() {
    if (!modules.express) {
        log.info('Requiring express');
        modules.express = require('express');
    } else {
        log.info('Express already loaded');
    }
    if (!_global.webhookListener) {
        _global.webhookListener = modules.express();
        _global.webhookListener.use(modules.express.json());
        _global.webhookListener.use(modules.express.urlencoded({extended: true}));
        _global.webhookListener.listen(config.webhookPort, () => {
            log.info(`Started webhook listener on ${config.webhookPort}`);
        });
    }
    return _global.webhookListener;
}

// Sun scheduling

const sunEvents = [];
let sunTimes = [{}, /* today */ {}, /* tomorrow */ {}];
function calculateSunTimes() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 86400000); // (24 * 60 * 60 * 1000));
    const tomorrow = new Date(today.getTime() + 86400000); // (24 * 60 * 60 * 1000));
    sunTimes = [
        suncalc.getTimes(yesterday, config.latitude, config.longitude),
        suncalc.getTimes(today, config.latitude, config.longitude),
        suncalc.getTimes(tomorrow, config.latitude, config.longitude)
    ];
}

calculateSunTimes();

scheduler.scheduleJob('0 0 * * *', () => {
    // Re-calculate every day
    calculateSunTimes();
    // Schedule events for this day
    sunEvents.forEach(event => {
        sunScheduleEvent(event);
    });
    log.info(`re-scheduled ${sunEvents.length} sun events`);
});

/* Schedule sun events for today */
function sunScheduleEvent(obj, shift) {
    // Shift = -1 -> yesterday
    // shift = 0 -> today
    // shift = 1 -> tomorrow
    let event = sunTimes[1 + (shift || 0)][obj.pattern];
    const now = new Date();

    if (event.toString() !== 'Invalid Date') {
        // Event will occur today

        if (obj.options.shift) {
            event = new Date(event.getTime() + ((parseFloat(obj.options.shift) || 0) * 1000));
        }

        if ((event.getDate() !== now.getDate()) && (typeof shift === 'undefined')) {
            // Event shifted to previous or next day
            sunScheduleEvent(obj, (event < now) ? 1 : -1);
            return;
        }

        if ((now.getTime() - event.getTime()) < 1000) {
            // Event is less than 1s in the past or occurs later this day

            if (obj.options.random) {
                event = new Date(
                    event.getTime() +
                    (Math.floor((parseFloat(obj.options.random) || 0) * Math.random()) * 1000)
                );
            }

            if ((event.getTime() - now.getTime()) < 1000) {
                // Event is less than 1s in the future or already in the past
                // (options.random may have shifted us further to the past)
                // call the callback immediately!
                obj.domain.bind(obj.callback)();
            } else {
                // Schedule the event!
                scheduler.scheduleJob(event, obj.domain.bind(obj.callback));
            }
        }
    }
}

// MQTT
const mqtt = mqttLib.connect(config.url, {
    username: config.username, 
    password: config.password, 
    port: config.port, 
    will: {topic: config.name + '/state', payload: JSON.stringify({state: 'offline'}), retain: true}
});

/* Handle mqtt connection */
mqtt.on('connect', () => {
    log.info('mqtt connected ' + mqtt.options.host);
    log.debug('mqtt subscribe #');
    start();
    mqtt.publish(config.name + '/state', JSON.stringify({state: 'online'}), {retain: true});

    for (sub in subscriptions) {
        mqtt.subscribe(sub.topic);
    }
});

/* Handle mqtt disconnection */
mqtt.on('close', () => {
    log.info('mqtt closed ' + mqtt.options.host);
});

/* istanbul ignore next */
mqtt.on('error', () => {
    log.error('mqtt error ' + mqtt.options.host);
});

/* Handle mqtt messages */
mqtt.on('message', (topic, payloadBuf, msg) => {
    const payload = _parsePayload(topic, payloadBuf);

    const oldState = status[topic];
    status[topic] = payload;
    
    subscriptions.forEach(subs => {
        const options = subs.options || {};
        let delay;

        const match = mqttWildcard(topic, subs.topic);

        if (match && typeof options.condition === 'function') {
            if (!options.condition(topic, payload, oldState)) {
                return;
            }
        }

        if (match && typeof subs.callback === 'function') {
            if (msg.retain && !options.retain) {
                return;
            }
            if (options.change && (payload === oldState)) {
                return;
            }

            delay = 0;
            if (options.shift) {
                delay += ((parseFloat(options.shift) || 0) * 1000);
            }
            if (options.random) {
                delay += ((parseFloat(options.random) || 0) * Math.random() * 1000);
            }

            delay = Math.floor(delay);

            setTimeout(() => {
                /**
                 * @callback subscribeCallback
                 * @param {string} topic - the topic that triggered this callback. +/status/# will be replaced by +//#
                 * @param {object} payload - new payload - the whole payload object (e.g. {"val": true, "ts": 12346345, "lc": 12346345} )
                 * @param {object} payloadPrev - previous payload - the whole payload object
                 * @param {object} msg - the mqtt message as received from MQTT.js
                 */
                subs.callback(topic, payload, oldState);
            }, delay);
        }
    });
});

function _parsePayload(topic, payload) {
    if (isText(null, payload)) {
        try {
            return JSON.parse(payload);
        } catch (err) {
            log.debug(`payload at ${topic} is a string, but not JSON`);
            return payload.toString();
        }
    } else {
        log.debug(`payload at ${topic} is binary`);
        return payload;
    }
}

function createScript(source, name) {
    log.debug(`${name} compiling`);
    try {
        return new vm.Script(source, {filename: name});
    } catch (err) {
        log.error({err}, `${err.name}: ${err.message}`);
        return false;
    }
}

function _getrequire(name, scriptDir, Sandbox) {
    
    function _require(md) {
        try {
            let tmp;
            if (md.match(/^\.\//) || md.match(/^\.\.\//)) {
                tmp = './' + path.relative(__dirname, path.join(scriptDir, md));
            } else {
                tmp = md;
                if (fs.existsSync(path.join(scriptDir, 'node_modules', md, 'package.json'))) {
                    tmp = './' + path.relative(__dirname, path.join(scriptDir, 'node_modules', md));
                }
            }
            if (tmp.startsWith('.')) {
                tmp = path.resolve(tmp);
            }
            if (modules[md]) {
                return modules[md];
            }

            Sandbox.log.debug('require', md);
            if (md.startsWith('.') && md.endsWith('.js')) {
                const fn = vm.compileFunction(fs.readFileSync(tmp).toString(), ['exports', 'require', 'module', '__filename', '__dirname'], {parsingContext: Sandbox});
                const module = {exports: {}}
                const module_dirname = path.dirname(tmp);
                fn(module.exports, _getrequire(name, module_dirname, Sandbox), module, tmp, module_dirname);
                modules[md] = module.exports;
                return module.exports;
            } else {
                modules[md] = require(tmp);
                return modules[md];
            }
        } catch (err) {
            const lines = err.stack.split('\n');
            err.stack = [];
            lines.some(line => {
                if (line.match(/^ *at Script\.runIn/)) return true;
                if (!line.match(/module\.js:/) && !line.match(/ *at require /)) {
                    err.stack.push(line);
                }
            });
            log.error({err}, `${name} ${err.name}: ${err.message}`);
        }
    }

    return _require;
}


function runScript(script, name) {
    const scriptDir = path.dirname(path.resolve(name));

    log.debug(`${name} creating domain`);
    const scriptDomain = domain.create();

    log.debug(`${name} creating sandbox`);

    const Sandbox = {

        global: _global,

        fetch,

        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,

        Buffer,

        /**
         * @class log
         * @classdesc Log to stdout/stderr. Messages are prefixed with a timestamp and the calling scripts path.
         */
        log: {
            /**
             * Log a debug message
             * @memberof log
             * @method debug
             * @param {...*}
             */
            debug() {
                if (typeof arguments[0] === 'string') {
                    // Preserves behaiviour in case of printf-like strings: "count: %d - yeah!"
                    arguments[0] = name + ' ' + arguments[0];
                    log.debug(...arguments);
                } else {
                    // Takes care of any other case
                    // https://gist.github.com/robatron/5681424
                    const args = Array.prototype.slice.call(arguments);
                    args.unshift(name);
                    log.debug(...args);
                }
            },
            /**
             * Log an info message
             * @memberof log
             * @method info
             * @param {...*}
             */
            info() {
                if (typeof arguments[0] === 'string') {
                    // Preserves behaiviour in case of printf-like strings: "count: %d - yeah!"
                    arguments[0] = name + ' ' + arguments[0];
                    log.info(...arguments);
                } else {
                    // Takes care of any other case
                    // https://gist.github.com/robatron/5681424
                    const args = Array.prototype.slice.call(arguments);
                    args.unshift(name);
                    log.info(...args);
                }
            },
            /**
             * Log a warning message
             * @memberof log
             * @method warn
             * @param {...*}
             */
            warn() {
                if (typeof arguments[0] === 'string') {
                    // Preserves behaiviour in case of printf-like strings: "count: %d - yeah!"
                    arguments[0] = name + ' ' + arguments[0];
                    log.warn(...arguments);
                } else {
                    // Takes care of any other case
                    // https://gist.github.com/robatron/5681424
                    const args = Array.prototype.slice.call(arguments);
                    args.unshift(name);
                    log.warn(...args);
                }
            },
            /**
             * Log an error message
             * @memberof log
             * @method error
             * @param {...*}
             */
            error() {
                if (typeof arguments[0] === 'string') {
                    // Preserves behaiviour in case of printf-like strings: "count: %d - yeah!"
                    arguments[0] = name + ' ' + arguments[0];
                    log.error(...arguments);
                } else {
                    // Takes care of any other case
                    // https://gist.github.com/robatron/5681424
                    const args = Array.prototype.slice.call(arguments);
                    args.unshift(name);
                    log.error(...args);
                }
            }
        },

        /**
         * Webhook
         */
        webhook: function Sandbox_webhook(route, method, callback) {
            const methodLower = method.toLowerCase();
            if (['get', 'post'].includes(methodLower)) {
                listener()[methodLower](route, callback);
            } else {
                log.error(`Method ${method} is not supported for webhooks`);
            }
        },

        /**
         * Subscribe to MQTT topic(s)
         * @method subscribe
         * @param {(string|string[])} topic - topic or array of topics to subscribe
         * @param {Object|string|function} [options] - Options object or as shorthand to options.condition a function or string
         * @param {number} [options.shift] - delay execution in seconds. Has to be positive
         * @param {number} [options.random] - random delay execution in seconds. Has to be positive
         * @param {boolean} [options.change] - if set to true callback is only called if val changed
         * @param {boolean} [options.retain] - if set to true callback is also called on retained messages
         * @param {(string|function)} [options.condition] - conditional function or condition string
         * @param {subscribeCallback} callback
         */
        subscribe: function Sandbox_subscribe(topic, /* optional */ options, callback) {
            if (typeof topic === 'undefined') {
                throw (new TypeError('argument topic missing'));
            }

            if (arguments.length === 2) {
                if (typeof arguments[1] !== 'function') {
                    throw new TypeError('callback is not a function');
                }

                callback = arguments[1];
                options = {};
            } else if (arguments.length === 3) {
                if (typeof arguments[2] !== 'function') {
                    throw new TypeError('callback is not a function');
                }
                options = arguments[1] || {};

                if (typeof options === 'string' || typeof options === 'function') {
                    options = {condition: options};
                }

                callback = arguments[2];
            } else if (arguments.length > 3) {
                throw (new Error('wrong number of arguments'));
            }

            if (typeof topic === 'string') {
                if (typeof options.condition === 'string') {
                    if (options.condition.indexOf('\n') !== -1) {
                        throw new Error('options.condition string must be one-line javascript');
                    }
                    /* eslint-disable no-new-func */
                    options.condition = new Function('topic', 'payload', 'oldState', 'return ' + options.condition + ';');
                }

                if (typeof options.condition === 'function') {
                    options.condition = scriptDomain.bind(options.condition);
                }

                subscriptions.push({topic, options, callback: (typeof callback === 'function') && scriptDomain.bind(callback)});

                if (options.retain && status[topic] && typeof callback === 'function') {
                    callback(topic, status[topic]);
                } else if (options.retain && (/\/\+\//.test(topic) || /\+$/.test(topic) || /\+/.test(topic) || topic.endsWith('#')) && typeof callback === 'function') {
                    for (const t in status) {
                        if (mqttWildcard(t, topic)) {
                            callback(t, status[t]);
                        }
                    }
                }

                mqtt.subscribe(topic);
            } else if (typeof topic === 'object' && Symbol.iterator in topic) {
                for (const tp of topic) {
                    Sandbox.subscribe(tp, options, callback);
                }
            }
        },
        /**
         * Schedule recurring and one-shot events
         * @method schedule
         * @param {(string|Date|Object|mixed[])} pattern - pattern or array of patterns. May be cron style string, Date object or node-schedule object literal. See {@link https://github.com/tejasmanohar/node-schedule/wiki}
         * @param {Object} [options]
         * @param {number} [options.random] - random delay execution in seconds. Has to be positive
         * @param {function} callback - is called with no arguments
         * @example // every full Hour.
         * schedule('0 * * * *', callback);
         *
         * // Monday till friday, random between 7:30am an 8:00am
         * schedule('30 7 * * 1-5', {random: 30 * 60}, callback);
         *
         * // once on 21. December 2018 at 5:30am
         * schedule(new Date(2018, 12, 21, 5, 30, 0), callback);
         *
         * // every Sunday at 2:30pm
         * schedule({hour: 14, minute: 30, dayOfWeek: 0}, callback);
         * @see {@link sunSchedule} for scheduling based on sun position.
         */
        schedule: function Sandbox_schedule(pattern, /* optional */ options, callback) {
            if (arguments.length === 2) {
                if (typeof arguments[1] !== 'function') {
                    throw new TypeError('callback is not a function');
                }
                callback = arguments[1];
                options = {};
            } else if (arguments.length === 3) {
                if (typeof arguments[2] !== 'function') {
                    throw new TypeError('callback is not a function');
                }
                options = arguments[1] || {};
                callback = arguments[2];
            } else {
                throw (new Error('wrong number of arguments'));
            }

            if (typeof pattern === 'object' && pattern.length > 0) {
                pattern = Array.prototype.slice.call(pattern);
                pattern.forEach(pt => {
                    Sandbox.schedule(pt, options, callback);
                });
                return;
            }

            if (options.random) {
                scheduler.scheduleJob(pattern, () => {
                    setTimeout(scriptDomain.bind(callback), (parseFloat(options.random) || 0) * 1000 * Math.random());
                });
            } else {
                scheduler.scheduleJob(pattern, scriptDomain.bind(callback));
            }
        },
        /**
         * Schedule a recurring event based on sun position
         * @method sunSchedule
         * @param {string|string[]} pattern - a suncalc event or an array of suncalc events. See {@link https://github.com/mourner/suncalc}
         * @param {Object} [options]
         * @param {number} [options.shift] - delay execution in seconds. Allowed Range: -86400...86400 (+/- 24h)
         * @param {number} [options.random] - random delay execution in seconds.
         * @param {function} callback - is called with no arguments
         * @example // Call callback 15 minutes before sunrise
         * sunSchedule('sunrise', {shift: -900}, callback);
         *
         * // Call callback random 0-15 minutes after sunset
         * sunSchedule('sunset', {random: 900}, callback);
         * @see {@link schedule} for time based scheduling.
         */
        sunSchedule: function Sandbox_sunSchedule(pattern, /* optional */ options, callback) {
            if (arguments.length === 2) {
                if (typeof arguments[1] !== 'function') {
                    throw new TypeError('callback is not a function');
                }
                callback = arguments[1];
                options = {};
            } else if (arguments.length === 3) {
                if (typeof arguments[2] !== 'function') {
                    throw new TypeError('callback is not a function');
                }
                options = arguments[1] || {};
                callback = arguments[2];
            } else {
                throw new Error('wrong number of arguments');
            }

            if ((typeof options.shift !== 'undefined') && (options.shift < -86400 || options.shift > 86400)) {
                throw new Error('options.shift out of range');
            }

            if (typeof pattern === 'object' && pattern.length > 0) {
                pattern = Array.prototype.slice.call(pattern);
                pattern.forEach(pt => {
                    Sandbox.sunSchedule(pt, options, callback);
                });
                return;
            }

            const event = sunTimes[0][pattern];
            if (typeof event === 'undefined') {
                throw new TypeError('unknown suncalc event ' + pattern);
            }

            const obj = {
                pattern,
                options,
                callback,
                context: Sandbox,
                domain: scriptDomain
            };

            sunEvents.push(obj);

            sunScheduleEvent(obj);
        },
        /**
         * Publish a MQTT message
         * @method publish
         * @param {(string|string[])} topic - topic or array of topics to publish to
         * @param {(string|Object)} payload - the payload string. If an object is given it will be JSON.stringified
         * @param {Object} [options] - the options to publish with
         * @param {number} [options.qos=0] - QoS Level
         * @param {boolean} [options.retain=false] - retain flag
         */
        publish: function Sandbox_publish(topic, payload, options) {
            if (typeof topic === 'object' && topic.length > 0) {
                topic = Array.prototype.slice.call(topic);
                topic.forEach(tp => {
                    Sandbox.publish(tp, payload, options);
                });
                return;
            }

            if (typeof payload === 'object') {
                payload = JSON.stringify(payload);
            } else {
                payload = String(payload);
            }
            mqtt.publish(topic, payload, options);
        },
        /**
         * @method getPayload
         * @param {string} topic
         * @returns {mixed} the topics value
         */
        getPayload: function Sandbox_getStatus(topic) {
            return status[topic];
        },

        getSunTimes(date) {
            return suncalc.getTimes(date, config.latitude, config.longitude);
        },
    };

    Sandbox.require = _getrequire(name, scriptDir, Sandbox);

    Sandbox.console = {
        log: Sandbox.log.info,
        info: Sandbox.log.info,
        warn: Sandbox.log.warn,
        debug: Sandbox.log.debug,
        error: Sandbox.log.error
    };

    Sandbox.module = {exports: {}};
    Sandbox.exports = Sandbox.module.exports;
    Sandbox.__filename = path.resolve(name)
    Sandbox.__dirname = scriptDir;

    sandboxModules.forEach(md => {
        md(Sandbox);
    });

    log.debug(`${name} contextifying sandbox`);
    const context = vm.createContext(Sandbox);

    scriptDomain.on('error', err => {
        /* istanbul ignore if */
        if (!err.stack) {
            log.error({err}, name + ' unknown exception');
            return;
        }
        const lines = err.stack.split('\n');
        err.stack = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/at ContextifyScript.Script.runInContext/)) {
                break;
            }
            err.stack.push(lines[i]);
        }

        log.error({err}, `${name} ${err.name}: ${err.message}`);
    });

    scriptDomain.run(() => {
        log.debug(`${name} running`);
        script.runInContext(context);
    });
}

function loadScript(file) {
    /* istanbul ignore if */
    if (scripts[file]) {
        log.error(`${file} already loaded?!`);
        return;
    }

    log.info(`${file} loading`);
    fs.readFile(file, (err, src) => {
        /* istanbul ignore if */
        if (err && err.code === 'ENOENT') {
            log.error(`${file} not found`);
        } else if (err) {
            /* istanbul ignore next */
            log.error({err}, `${file} ${err.name}: ${err.message}`);
        } else {
            if (file.match(/\.js$/)) {
                scripts[file] = createScript(src, file);
            }
            if (scripts[file]) {
                runScript(scripts[file], file);
            }
        }
    });
}

function loadSandbox(callback) {
    const dir = path.join(__dirname, 'sandbox');
    fs.readdir(dir, (err, data) => {
        /* istanbul ignore if */
        if (err) {
            if (err.errno === 34) {
                log.error(`directory ${path.resolve(dir)} not found`);
            } else {
                log.error({err}, `readdir ${dir} ${err.name}: ${err.message}`);
            }
        } else {
            data.sort().forEach(file => {
                if (file.match(/\.js$/)) {
                    sandboxModules.push(require(path.join(dir, file)));
                }
            });

            callback();
        }
    });
}

function loadDir(dir) {
    fs.readdir(dir, (err, data) => {
        /* istanbul ignore if */
        if (err) {
            if (err.errno === 34) {
                log.error('directory ' + path.resolve(dir) + ' not found');
            } else {
                log.error({err}, `readdir ${dir} ${err.name}: ${err.message}`);
            }
        } else {
            data.sort().forEach(file => {
                if (file.match(/\.(js)$/)) {
                    loadScript(path.join(dir, file));
                }
            });
        }
    });
}

function start() {
    /* istanbul ignore if */
    if (config.file) {
        if (typeof config.file === 'string') {
            loadScript(config.file);
        } else {
            config.file.forEach(file => {
                loadScript(file);
            });
        }
    }

    loadSandbox(() => {
        if (config.dir) {
            /* istanbul ignore else */
            if (typeof config.dir === 'string') {
                loadDir(config.dir);
            } else {
                config.dir.forEach(dir => {
                    loadDir(dir);
                });
            }
        }
    });
}

/* istanbul ignore next */
process.on('SIGINT', () => {
    log.info('got SIGINT. exiting.');
    process.exit(0);
});

/* istanbul ignore next */
process.on('SIGTERM', () => {
    log.info('got SIGTERM. exiting.');
    process.exit(0);
});
 