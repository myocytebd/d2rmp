/** d2rmp, a patcher script toolset for D2R mods.
 *  Copyright (C) 2024 myocytebd
 * 
 *  This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License
 *  as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *  This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty
 *  of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *  You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const saveAPILegacy = require('../d2s');

const { diffBufferToConsole, diffObjectToConsole } = require('./utils_diff');

let debug = true, selfCheck = true;
let /** @type {import('./main').Config} */ config = null;

/** @typedef {Object.<string,string>} GameDataInfo  filename : content (for now) */
/** @typedef {{ saveType?: string, selfCheck?: boolean, diff?: boolean, weakCheck?: boolean }} ConvertOptions */

// TBD: move some d2s mess out
class GameMetaData {
    constructor() {}
}

let saveAPIDataCache = new WeakMap;

class ConvertContxt {
    /** @param {GameDataInfo} gameData */
    constructor(gameData) {
        this.metaData = new GameMetaData(gameData.$knownMeta);
        this.gameData = gameData;
        this.saveAPIData = null;
        this.init();
    }

    init() {
        this.saveAPIData = saveAPIDataCache.get(this.gameData);
        if (!this.saveAPIData) {
            this.saveAPIData = saveAPILegacy.readConstantData(this.gameData);
            saveAPIDataCache.set(this.gameData, this.saveAPIData);
        }
    }
}

// TODO: remove d2s async insanity

// Check that exported JSON data can import to same d2s exactly.
async function checkExportRoundTripStrict(json, refSave, context) {
    let newSave = await fromJSONEx(json, context, { selfCheck: false });
    if (diffBufferToConsole(refSave, newSave, { desc: 'checkJSONStringifyRoundTrip', diffOnSizeMismatch: true }) !== 0)
        throw new Error(`Check Failure: d2s => JSON => d2s roundtrip`);
}

// Check that JSON data can be safely stringified.
function checkJSONSSerializeRoundTrip(json, context) {
    let jsonNew;
    assert.doesNotThrow(() => jsonNew = JSON.parse(JSON.stringify(json)), `Save export data is unserializable`);
    if (diffObjectToConsole(json, jsonNew, { desc: 'checkJSONSSerializeRoundTrip' }) !== 0) {
        throw new Error(`Check Failure: JSON serialization roundtrip`);
    }
}

// Check that imported d2s data can import to same JSON exactly.
// TODO: need a weaker comparison to ignore non-critical information.
async function checkImportRoundTripStrict(save, refJSON, context) {
    function eraseMutableJSONInfo(json) {
        if (json.type === 'd2s') {
            json.header.checksum = 0;
            json.header.filesize = 0;
        } else if (json.type === 'd2i') {
            for (let page of json.pages) page.header.size = 0;
        }
        return json;
    }
    let refJSONCopy = eraseMutableJSONInfo(cloneJSON(refJSON));
    let newJSON = await toJSONEx(save, context, { saveType: refJSON.type, selfCheck: false });
    eraseMutableJSONInfo(newJSON);
    if (diffObjectToConsole(refJSONCopy, newJSON, { desc: 'checkSaveImportRoundTripStrict' }) !== 0) throw new Error(`Check Failure: JSON => d2s => JSON roundtrip`);
}

function cloneJSON(json) { return JSON.parse(JSON.stringify(json)); }

/** @param {Buffer} save  @param {ConvertContxt} context  @param {ConvertOptions} options */
async function toJSONEx(save, context, { saveType, selfCheck }) {
    let jsonOut = saveType === 'd2s' ? await saveAPILegacy.read(save, context.saveAPIData) : await saveAPILegacy.readss(save, context.saveAPIData);
    if (selfCheck) {
        checkJSONSSerializeRoundTrip(jsonOut, context);
        checkExportRoundTripStrict(jsonOut, save, context)
    }
    return jsonOut;
}

/** @param {Buffer|object} json  @param {ConvertContxt} context  @param {ConvertOptions} options */
async function fromJSONEx(json, context, { selfCheck }) {
    let saveOut = await saveAPILegacy.write(json, context.saveAPIData);
    if (selfCheck) checkImportRoundTripStrict(saveOut, json, context);
    return saveOut;
}

/** @param {object} json  @param {ConvertContxt} context  @param {ConvertOptions} options */
function patchJSONEx(json, context, { selfCheck, diff }) {
    // JSON serialization roundtrip check should have been done at export.
    let jsonOut = (debug || diff) ? cloneJSON(json) : json;
    if (config.task.patch_jobs.waypoints_all && json.type === 'd2s') {
        for (let [ difficulty, waypoints ] of Object.entries(jsonOut.header.waypoints)) {
            for (let [ act, actWaypoints ] of Object.entries(waypoints)) {
                for (let waypointName of Object.keys(actWaypoints)) actWaypoints[waypointName] = true;
            }
        }
    }
    if (debug || diff) diffObjectToConsole(json, jsonOut, { desc: 'patchJSON', maxDiffCount: 1000 })
    return jsonOut;
}

/** @param {object} json  @param {GameDataInfo} srcGameData  @param {GameDataInfo} dstGameData */
function migrateJSONEx(json, srcGameData, dstGameData) {
    // JSON serialization roundtrip check should have been done at export.
    let jsonOut = debug ? cloneJSON(json) : json;
    // TODO: revamp d2s and remap most stuffs here
    return jsonOut;
}

/** @param {Buffer} save  @param {GameDataInfo} gameData */
async function toJSON(save, gameData, { saveType }) {
    return await toJSONEx(save, new ConvertContxt(gameData), { saveType, selfCheck });
}

/** @param {Buffer|object} json  @param {GameDataInfo} gameData */
async function fromJSON(json, gameData) {
    return await fromJSONEx(json, new ConvertContxt(gameData), { selfCheck });
}

/** @param {Buffer|object} jsonOrSave  @param {GameDataInfo} gameData */
async function patch(jsonOrSave, gameData, { saveType }) {
    let inputIsSave = Buffer.isBuffer(jsonOrSave);
    let context = new ConvertContxt(gameData), options = { selfCheck, diff: true };
    let json = inputIsSave ? await toJSONEx(jsonOrSave, context, { saveType, ...options }) : jsonOrSave;
    let jsonOut = patchJSONEx(json, context, options);
    let result = inputIsSave ? await fromJSONEx(jsonOut, context, options) : jsonOut;
    return result;
}

/** @param {Buffer} jsonOrSave  @param {GameDataInfo} srcGameData  @param {GameDataInfo} dstGameData */
async function migrate(jsonOrSave, srcGameData, dstGameData, { saveType }) {
    let inputIsSave = Buffer.isBuffer(jsonOrSave);
    let srcContext = new ConvertContxt(srcGameData),
        dstContext = new ConvertContxt(dstGameData), options = { selfCheck };
    let json = inputIsSave ? await toJSONEx(jsonOrSave, srcContext, { saveType, ...options }) : jsonOrSave;
    let jsonOut = migrateJSONEx(json, srcContext, dstContext, options);
    // TODO: Strict JSON check will definitely failure with different excels data.
    // let result = inputIsSave ? fromJSON(jsonOut, srcContext, dstContext, { ...options, selfCheck: false, weakCheck: true }) : jsonOut;
    let result = inputIsSave ? await fromJSONEx(jsonOut, dstContext, options) : jsonOut;
    return result;
}

exports = module.exports = {
    get debug() { return debug }, set debug(value) { debug = value; selfCheck &&= debug; },
    set config(mainConfig) { config = mainConfig; },
    toJSON, fromJSON, patch, migrate,
};
