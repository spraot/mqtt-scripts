const config = require('yargs')
    .env('MQTTSCRIPTS')
    .usage('Usage: $0 [options]')
    .describe('verbosity', 'possible values: "error", "warn", "info", "debug"')
    .describe('name', 'instance name. used as mqtt client id and as prefix for connected topic')
    .describe('url', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
    .describe('help', 'show help')
    .describe('logdir', 'Write stdout & stderr to this directory, if unset use stdout')
    .describe('dir', 'directory to scan for .js files. can be used multiple times.')
    .describe('disable-watch', 'disable file watching (don\'t exit process on file changes)')
    .describe('webhookPort', 'Port for the webhook webserver to listen on')
    .alias({
        c: 'config',
        d: 'dir',
        h: 'help',
        l: 'latitude',
        L: 'logdir',
        m: 'longitude',
        n: 'name',
        p: 'webhookPort',
        u: 'url',
        v: 'verbosity',
        w: 'disable-watch'

    })
    .default({
        url: 'mqtt://127.0.0.1',
        latitude: 48.7408,
        longitude: 9.1778,
        name: 'logic',
        verbosity: 'info',
        'disable-watch': false,
        logdir: null,
        webhookPort: 3001
    })
    .config('config')
    .version()
    .help('help')
    .argv;

module.exports = config;
