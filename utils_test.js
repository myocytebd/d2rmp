'use strict';

const fs = require('node:fs');
const util = require('node:util');

const { readdirSafeSync } = require('./utils');
const path = require('node:path');

function checkReaddirSafeSync(...args) {
    console.log(util.inspect(readdirSafeSync(...args), { maxArrayLength: null }));
}
checkReaddirSafeSync('.');
checkReaddirSafeSync('.', { withFileTypes: true });
checkReaddirSafeSync('.', { recursive: true });
checkReaddirSafeSync('.', { recursive: true });
checkReaddirSafeSync('.', { recursive: true, withFileTypes: true });

// console.log(util.inspect(fs.readdirSync('.', { recursive: true }), { maxArrayLength: null }));

checkReaddirSafeSync(path.resolve('.'), { recursive: true });
