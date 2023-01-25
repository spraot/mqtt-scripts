/* eslint-disable func-name-matching, func-names, camelcase */

const arrayCombineWhitelist = [
    'every',
    'filter',
    'find',
    'findIndex',
    'findLast',
    'findLastIndex',
    'map',
    'reduce',
    'reduceRight',
    'some'
]

const arrayCombineWhitelistNoCallback = [
    'includes',
    'join',
    'indexOf',
    'lastIndexOf'
]

module.exports = function (Sandbox) {
    /**
     * @method now
     * @returns {number} ms since epoch
     */
    Sandbox.now = function Sandbox_now() {
        return (new Date()).getTime();
    };

    /**
     * Link topic(s) to other topic(s)
     * @method link
     * @param {(string|string[])} source - topic or array of topics to subscribe
     * @param {(string|string[])} target - topic or array of topics to publish
     * @param {mixed} [value] - value to publish. If omitted the sources value is published. A function can be used to transform the value.
     * @param {Object} [options] - Options object that will be passed to nested subscribe and publish calls
     */
    Sandbox.link = function Sandbox_link(source, target, /* optional */ value, /* optional */ options) {
        Sandbox.subscribe(source, options, (topic, val) => {
            if (typeof value === 'function') {
                val = value(val);
            } else if (typeof value !== 'undefined') {
                val = value;
            }
            Sandbox.publish(target, val, options);
        });
    };

    /**
     * Combine topics using arbitrary array method, ie. combineArray(srcs, target, 'some', x => x>10)
     * @method combineArray
     * @param {string[]} srcs - array of topics to subscribe
     * @param {string} target - topic to publish
     * @param {string} method - method in Array.prototype to call
     * @param {string} callbackFn - a function to execute for each src's payload
     * @param {...any} args - args to provide to the prototype method
     */
    Sandbox.combineArray = function combineArray(srcs, target, method, callbackFn, ...args) {
        if (!method) {
            throw new TypeError('no method provided');
        }
        if (!arrayCombineWhitelist.includes(method)) {
            throw new TypeError('method is not supported');
        }
        if (typeof arguments[3] !== 'function') {
            throw new TypeError('callback is not a function');
        }

        const wrappedCallbackFn = (src, index, array) => callbackFn(Sandbox.getPayload(src), index, array);

        function combine() {
            const result = Array.prototype[method].call(srcs, wrappedCallbackFn, ...args);
            Sandbox.publish(target, result);
        }
        combine();
        Sandbox.subscribe(srcs, {retain: true}, combine);
    };

    /**
     * Combine topics using Array.prototype.some()
     * @method combineAny
     * @param {string[]} srcs - array of topics to subscribe
     * @param {string} target - topic to publish
     * @param {string} callbackFn - a function to execute for each element in the array
     */
    Sandbox.combineAny = function Sandbox_combineAny(srcs, target, /* optional */ callbackFn) {
        if (arguments.length < 3) {
            callbackFn = x => !!x;
        }
        Sandbox.combineArray(srcs, target, 'some', callbackFn);
    };

    /**
     * Combine topics using Array.prototype.every()
     * @method combineAll
     * @param {string[]} srcs - array of topics to subscribe
     * @param {string} target - topic to publish
     * @param {string} callbackFn - a function to execute for each element in the array
     */
    Sandbox.combineAll = function Sandbox_combineAll(srcs, target, /* optional */ callbackFn) {
        if (arguments.length < 3) {
            callbackFn = x => !!x;
        }
        Sandbox.combineArray(srcs, target, 'every', callbackFn);
    };

    /**
     * Publish maximum of combined topics
     * @method combineMax
     * @param {string[]} srcs - array of topics to subscribe
     * @param {string} target - topic to publish
     */
    Sandbox.combineMax = function (srcs, target) {
        function combine() {
            let result = 0;
            srcs.forEach(src => {
                const srcVal = Sandbox.getPayload(src);
                if (srcVal > result) {
                    result = srcVal;
                }
            });
            Sandbox.publish(target, result);
        }
        combine();
        Sandbox.subscribe(srcs, {retain: true}, combine);
    };

    const timeouts = {};
    /**
     * Publishes true on target for specific time after any src changed to true, then reverts target to false
     * @method timer
     * @param {(string|string[])} src - topic or array of topics to subscribe
     * @param {string} target - topic to publish
     * @param {number} time - timeout in milliseconds
     */
    Sandbox.timer = function (src, target, options) {
        if (typeof options !== 'object' || options === null) {
            options = {
                time: options
            }
        }
        const onValue = options.onValue !== undefined ? options.onValue : true;
        const offValue = options.offValue !== undefined ? options.offValue : false;

        Sandbox.subscribe(src, {retain: false}, (topic, val) => {
            if (val) {
                Sandbox.clearTimeout(timeouts[target]);
                if (!Sandbox.getPayload(target)) {
                    Sandbox.publish(target, onValue);
                }
                timeouts[target] = Sandbox.setTimeout(() => {
                    if (Sandbox.getPayload(target)) {
                        Sandbox.publish(target, offValue);
                    }
                }, options.time);
            }
        });

        timeouts[target] = Sandbox.setTimeout(() => {
            if (Sandbox.getPayload(target)) {
                Sandbox.publish(target, offValue);
            }
        }, options.time);
    };
};
