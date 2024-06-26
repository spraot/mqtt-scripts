# mqtt-scripts

[![License][mit-badge]][mit-url]

> mqtt-scripts is a Node.js based script runner for use in mqtt based smart home environments. 

It's intentended to be used as the "logic layer" in your smart home, and offers a zero-boilerplate, straight forward 
scripting environment.

# Getting started

Prerequisites: mqtt-scripts needs Node.js >= 6.0.

* Install mqtt-scripts globally:

```sudo npm install -g https://github.com/spraot/mqtt-scripts.git```

* Create a folder from where mqtt-scripts will load the scripts:

```mkdir -p /opt/mqtt-smarthome/scripts```

* Create a folder to install node modules that can be used in the scripts:

```mkdir /opt/mqtt-smarthome/scripts/node_modules```    
(You can then just use npm install in the directory /opt/mqtt-smarthome/scripts)

* Put some files in you script dir:

```
echo "log.info('my first script!')" > /opt/mqtt-smarthome/scripts/test1.js
```   

* Start mqtt-scripts

```mqtt-scripts -d /opt/mqtt-smarthome/scripts```  


### Run with Docker

To run with Docker, build an image with ```docker build -t mqtt-scripts:1 .```. Then substitute node-command you would have used by the Docker command, for e.g.:

```mqtt-scripts --help```  

becomes

```docker run dersimn/mqtt-scripts:1 --help```

An example for a productive configuration would be:

```
docker run -d --restart=always --name=logic \
    -e "TZ=Europe/Berlin" \
    -v /opt/hma/etc/scripts:/scripts:ro \
    dersimn/mqtt-scripts:1 \
    --url mqtt://10.1.1.50 \
    --dir /scripts
```

Configure via `MQTTSCRIPTS_` env variables when using Docker Compose.


#### Build

Docker development build:

```
    docker build -t mqtt-scripts .
    docker run --rm mqtt-scripts --help
```

Docker Hub deploy:

```
    docker buildx create --name mybuilder
    docker buildx use mybuilder
    docker buildx build --platform linux/amd64,linux/arm/v7 -t dersimn/mqtt-scripts:1 -t dersimn/mqtt-scripts:1.x.x --push .
```


# Command Line Options

<pre>
Usage: mqtt-scripts [options]

Options:
  --version                Show version number                         [boolean]
  -c, --config             Path to JSON config file
  -d, --dir                directory to scan for .js files. can be used multiple
                           times.
  -h, --help               Show help                                   [boolean]
  -n, --name               instance name. used as mqtt client id and as prefix
                           for connected topic                [default: "logic"]
  -u, --url                mqtt broker url. See
                           https://github.com/mqttjs/MQTT.js#connect-using-a-url
                                                   [default: "mqtt://127.0.0.1"]
  -v, --verbosity          possible values: "error", "warn", "info", "debug"
                                                               [default: "info"]
  -w, --disable-watch      disable file watching (don't exit process on file
                           changes)                             [default: false]
  -l, --latitude                                              [default: 48.7408]
  -m, --longitude                                              [default: 9.1778]                                            
</pre>

If you're running multiple instances of mqtt-scripts you have to decide which one should handle variables and disable 
the variables on all other instances with the --disable-variable option.


# Script Examples

#### Use hm2mqtt and hue2mqtt to control a hue lamp with a homematic remote control

```javascript
link('hm//RC4:1/PRESS_CONT', 'hue//lights/Hobbyraum/bri_inc', -16);

subscribe('hm//RC4:2/PRESS_CONT', function () {
    if (!getPayload('hue//lights/Hobbyraum')) {
        publish('hue//lights/Hobbyraum', 1);
    } else {
        publish('hue//lights/Hobbyraum/bri_inc', 16);
    }
});

link('hm//RC4:1/PRESS_SHORT', 'hue//lights/Hobbyraum', 0);
link('hm//RC4:2/PRESS_SHORT', 'hue//lights/Hobbyraum', 254);
link('hm//RC4:3/PRESS_CONT', 'hue//lights/Hobbyraum/ct_inc', -16);
link('hm//RC4:4/PRESS_CONT', 'hue//lights/Hobbyraum/ct_inc', 16);
link('hm//RC4:3/PRESS_SHORT', 'hue//lights/Hobbyraum/ct', 153);
link('hm//RC4:4/PRESS_SHORT', 'hue//lights/Hobbyraum/ct', 500);
```

#### retrieve fuel prices from tankerkoenig

```javascript
var request =   require('request');
var cred =      require('./lib/credentials.js');

var url = 'https://creativecommons.tankerkoenig.de/json/detail.php';

var tankstellen = {
    'OMV': 'cb1f0588-d517-40f0-8ce3-3edadebea40d',
    'Shell': '4267c196-eea1-47be-96b7-d790b2fbd17a'
};

schedule('0/12 * * * *', function () {
    for (var topic in tankstellen) {
        getData(topic, tankstellen[topic]);
    }
});

function getData(topic, id) {
    request.get(url + '?id=' + id + '&apikey=' + cred.tankerkoenig.apikey, function (err, res) {
        if (err) {
            log.error(err);
            return;
        }
        var data = JSON.parse(res.body).station;
        publish('$Tankstelle/' + topic + '/Diesel',    data.diesel);
        publish('$Tankstelle/' + topic + '/E5',        data.e5);
        publish('$Tankstelle/' + topic + '/Offen',     data.isOpen);
    });
}
```

#### Send payload changes to Pushover

```Javascript
var cred = require('./lib/credentials.js');

var pushoverNotifications = require('pushover-notifications');

var push = new pushoverNotifications( {
    user: cred.pushover.user,
    token: cred.pushover.token,
    onerror: function (error) {
        log.error(error);
    }
});

function pushover(msg) {
    if (typeof msg !== 'object' || typeof msg.message !== 'string') msg = {message: '' + msg};
    msg.title = msg.title || "Smart Home";
    msg.priority = msg.priority || 0;
    msg.device = msg.device || 'iphone5';
    push.send(msg, function(err, result) {
        if (err) {
            log.error(err);
        }
    });
}

subscribe('$Anwesenheit', {change: true}, function () {
    pushover({
        title:'Anwesenheit',
        message: getPayload($Anwesenheit, 'logic_textual'),
        priority: -1
    });
});
```

# API

