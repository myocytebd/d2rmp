'use strict';

const path = require('node:path');
const { fatal } = require('./utils');

const { Level } = require('level')


const kElectronKeyPrefix = '_file://';

async function loadD2RMMSettings(d2rmmPath) {
    // Default options (keyEncoding/valueEncoding = 'utf8') seems to work.
    // But electron leveldb seems to have some binary (type?) prefix at key/value.
    // e.g. key prefix: '00 01', value prefix: '01'
    const db = new Level(path.join(d2rmmPath, 'Local Storage', 'leveldb'), { createIfMissing: false });
    const kJSONKeys = [ 'direct-mod', 'enabled-mods', 'mods-order', 'pre-extracted-data', ];
    let d2rmmSettings = {};
    for await (const [rawKey, rawValue] of db.iterator()) {
        if (!rawKey.startsWith(kElectronKeyPrefix)) continue;
        let key = rawKey.slice(kElectronKeyPrefix.length).slice(2), value = rawValue.slice(1);
        // console.debug(key, typeof value, value);
        if (kJSONKeys.includes(key)) {
            try { d2rmmSettings[key] = JSON.parse(value); } catch (e) {
                console.error(`Error reading D2RMM setting|${key}|: expected JSON string, got|${value}|`);
                fatal(e);
            }
        } else {
            d2rmmSettings[key] = value;
        }
    }
    await db.close();
    return d2rmmSettings;
}

module.exports = { loadD2RMMSettings };
