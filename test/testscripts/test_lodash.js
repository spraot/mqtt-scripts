subscribe('foo/#', (topic, payload) => {
    log.debug(status(topic));
    log.debug(status(topic).c);

    if (
        _.isEqual(
            _.pick(status(topic), ['c']),
            payload
        )
    ) {
        log.debug('equals saved subset');
    }
});
