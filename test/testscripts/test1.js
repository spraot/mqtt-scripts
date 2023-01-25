log.info('test log');

subscribe('test/set/incr', function (topic, val) {
    val += 1;
    publish('test/status/incr', val);
});

link('test/src', 'test/target');
link(['test/src1', 'test/src2'], ['test/target1', 'test/target2']);
link('test/src3', 'test/target3', '1337');
link('test/src4', 'test/target4', val => 2 * val);

schedule('* * * * *', () => {
    log.info('schedule callback');
});

setTimeout(function () {
    throw new Error('test exception!');
}, 100);

schedule('0 0 * * *', () => {
    log.info('midnight!');
});

schedule({hour: 0, minute: 0, second: 3}, () => {
    log.info('schedule date');
});

let mscount = 1;

schedule(['0 0 0 * * *', '1 0 0 * * *'], {random: 2}, () => {
    log.info('multi schedule', mscount++);
});

subscribe('test/condition', 'payload=="muh"', (topic, val) => {
    log.info(topic, getPayload(topic));
});

subscribe('test/change', {change: true}, (topic, val) => {
    log.info(topic, val)
});

subscribe('test/randomshift', {random: 1, shift: 1}, (topic, val) => {
    log.info('callback for '+topic, val);
});

subscribe(/regexp/, (topic, val) => {
    log.info(topic, val);
});



log.info(require('./lib/libtest.js'));
log.info(require('dummy'));
require('./lib/libtest2.js');
const suncalc = require('suncalc');

sunSchedule('sunrise', {shift: -1620, random: 360}, () => {
    log.info('27-33min before sunrise');
});

sunSchedule(['dawn', 'dusk'], () => {
    log.info('multiple sun events');
});

subscribe('test1', (topic, val) => {
    log.info(topic, getPayload('test1'));
});

publish(['test1', 'test2'], true);

log.info('appended!');

log.info('appended!');

log.info('appended!');

log.info('appended!');

log.info('appended!');

log.info('appended!');

log.info('appended!');

log.info('appended!');
