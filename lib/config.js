const yaml = require('yaml');
const fs = require('fs');

const DEFAULT_CONFIG = './config.yml';

const config = require('yargs')
    .env('MQTTSCRIPTS')
    .usage('Usage: $0 [options]')
    .describe('verbosity', 'possible values: "error", "warn", "info", "debug"')
    .describe('name', 'instance name. used as mqtt client id and as prefix for connected topic')
    .describe('url', 'mqtt broker url')
    .describe('username', 'mqtt broker username')
    .describe('password', 'mqtt broker password')
    .describe('port', 'mqtt broker port')
    .describe('help', 'show help')
    .describe('logdir', 'Write stdout & stderr to this directory, if unset use stdout')
    .describe('dir', 'directory to scan for .js files. can be used multiple times.')
    .describe('disable-watch', 'disable file watching (don\'t exit process on file changes)')
    .describe('webhookPort', 'Port for the webhook webserver to listen on')
    .alias({
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
        config: DEFAULT_CONFIG,
        url: 'mqtt://127.0.0.1',
        latitude: 48.7408,
        longitude: 9.1778,
        name: 'logic',
        verbosity: 'info',
        'disable-watch': false,
        logdir: null,
        webhookPort: 3001
    })
    .config('config', function (configPath) {
        if (fs.existsSync(configPath)) {
            return yaml.parse(fs.readFileSync(configPath, 'utf-8'));
        } else if (process.argv.indexOf('--config') >= 0) {
            throw new TypeError('config file '+configPath+' not found');
        }
      })
    .version()
    .help('help')
    .argv;

module.exports = config;
