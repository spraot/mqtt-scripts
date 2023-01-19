#!/usr/bin/env node

const tk = require('timekeeper');

tk.travel(new Date(2020, 0, 1, 23, 59, 55));

require('../index.js');
