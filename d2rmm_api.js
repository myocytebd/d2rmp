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
const fs = require('node:fs');
const path = require('node:path');

const { FileResolver } = require('./resolver');
const { cpSync, mkdirSync, tryParseJSON } = require('./utils');
const prettyStringify = require('json-stringify-pretty-compact');


/**
 * @typedef {string[]} TSVHeader
 * @typedef {Object<string, string|number>} TSVRow
 * @typedef {{ headers: TSVHeader, rows: TSVRow[] }} TSVData
 */

class SimD2RMM {
    /** @param {FileResolver} resolver */
    constructor(resolver, modData) {
        this._resolver = resolver;
        this._modData = modData;
    }

    getVersion() { return 1.5; }

    readTxt(txtPath) {
        let [ content, error ] = this._resolver.readAutoInputFileSync(txtPath);
        if (error) { error.extra = `readTxt: ${txtPath}`; throw error; }
        if (content === null) throw new Error(`Input File Not Found: ${txtPath}`);
        return content || '';
    }
    
    writeTxt(txtPath, content) {
        this._resolver.updateOutputFile(txtPath, content);
    }

    readJson(jsonPath) {
        let [ content, error, outputInfo ] = this._resolver.readAutoInputFileSync(jsonPath);
        if (error) {  error.extra = `readJson: ${jsonPath}`; return error; }
        if (content === null) throw new Error(`Input File Not Found: ${jsonPath}`);
        // D2RMM uses json5 to parse, however probably jsonc is sufficient.
        let [ json, type, parseError ] = tryParseJSON(content, outputInfo.type);
        if (parseError) { parseError.extra = `Parsing: ${jsonPath}`; throw parseError; }
        if (type !== 'json') console.warn(`JSONC: ${outputInfo.relPath}`);
        outputInfo.type = type;
        return json;
    }

    /** @param {string} jsonPath  @param {{ indent?: string|number, width?: number }} */
    writeJson(jsonPath, json, { indent, width } = {}) {
        let content;
        if (width === undefined && indent === undefined) {
            content = JSON.stringify(json);
        } else {
            const indentUnit = typeof indent === 'string' ? indent : ' '.repeat(indent ?? 0);
            content = prettyStringify(json, { indent: indentUnit, maxLength: width })
        }
        let [ ,, outputInfo ] = this._resolver.updateOutputFile(jsonPath, content, { addBOM: false });
        outputInfo.type = 'json';
    }

    /** @param {string} tsvPath  @returns {TSVData} */
    readTsv(tsvPath) {
        let [ content, error ] = this._resolver.readAutoInputFileSync(tsvPath);
        if (error) { error.extra = `readTsv: ${tsvPath}`; return error; }
        if (content === null) throw new Error(`Input File not Found: ${tsvPath}`);
        // if (content === null) return { headers: [], rows: [] };
        const [ headersRaw, ...rowsRaw ] = content.split('\n');
        const headers = headersRaw.split('\t');
        const rows = [];
        for (let rowStr of rowsRaw) {
            const row = {};
            if (rowStr === '') continue;  // D2RMM behavior to skip empty lines. Questionable: should only appy to final line(s).
            for (let [ index, value ] of rowStr.split('\t').entries()) row[headers[index]] = value;
            rows.push(row);
        }
        return { headers, rows };
    }

    /** @param {string} tsvPath  @param {TSVData} tsvData */
    writeTsv(tsvPath, tsvData) {
        const { headers, rows } = tsvData;
        const headersRaw = headers.join('\t');
        const rowsRaw = rows.map((row) => headers.map((header) => row[header] ?? '').join('\t'));
        const content = [ headersRaw, ...rowsRaw, '' ].join('\n');
        this._resolver.updateOutputFile(tsvPath, content);
    }

    getNextStringID() { return this._resolver.acquireNextStringID(); }

    /** @param {string} mixedSrcPath Relative to D2RMM mod  @param {string} mixedDstPath Relative to output D2R mod  @param {boolean} overwrite */
    copyFile(mixedSrcPath, mixedDstPath, overwrite) {
        let dstPath = this._resolver.getNativePath(this._resolver.outputPath, mixedDstPath);
        let srcPath = this._resolver.getNativePath(this._modData.path, mixedSrcPath);
        if (!fs.existsSync(srcPath)) throw new Error(`Invalid Copy Source: ${mixedSrcPath}`);
        mkdirSync(path.dirname(dstPath));
        cpSync(srcPath, dstPath, { force: !!overwrite });
    }
}

module.exports = { SimD2RMM };
