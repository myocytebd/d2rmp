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

const { nativePath, normalizePath, scriptPath, readFileSyncNoThrow, writeFileSync, mkdirSync } = require('./utils');

const kNextStringIDPath = 'local/lng/next_string_id.txt';
function parseNextStringID(content) {
    let ma = content.match(/[0-9]+/);
    if (!ma) throw new Error(`Invalid NextStringID File`);
    return parseInt(ma[0]);
}
function updateNextStringID(content, newID) { return content.replace(/[0-9]+/, '' + newID); }

/** @typedef {{ relPath: string, realPath: string, content, type: ?string }} FileResolverInputInfo */
/** @typedef { FileResolverInputInfo & { dirty: boolean, evicted : boolean } } FileResolverOutputInfo */
class FileResolver {
    constructor({ outputPath, baseInputPath, userInputPath }) {
        this.outputPath = outputPath || null;
        this.baseInputPath = baseInputPath;
        this.userInputPath = userInputPath || null;
        /** @type {string[]} */ this.inputPaths = [];
        /** @type {Object.<string, FileResolverOutputInfo>} */
        this.implicitOutputMap = {};  // rel-path : { realPath, dirty, content }
        /** @type {Object.<string, FileResolverInputInfo>} */
        this.implicitInputMap = {};  // rel-path : { realPath, content }
        this.nextStringID = -1;
        this.init();
    }

    init() {
        this.inputPaths = Array.from(new Set([ this.userInputPath, this.baseInputPath ]).values()).filter(s => s);
    }

    getPath(...mixedPaths) { return normalizePath(path.join(...mixedPaths)); }
    getNativePath(...mixedPaths) { return nativePath(this.getPath(...mixedPaths)); }

    resolveImplicitOutput(mixeModResPath) {
        let outputRelPath = normalizePath(mixeModResPath);
        let outputInfo = this.implicitOutputMap[outputRelPath];
        if (!outputInfo) {
            this.implicitOutputMap[outputRelPath] = outputInfo = { relPath: outputRelPath, realPath: null, dirty: false, evicted: false, content: null };
            outputInfo.realPath = this.getNativePath(this.outputPath, outputRelPath);
            outputInfo.evicted = fs.existsSync(outputInfo.realPath);
            console.debug(`FileResolver: init output mapping: ${outputRelPath} => ${outputInfo.realPath} (evicted=${outputInfo.evicted})`);
        }
        return outputInfo;
    }

    resolveImplicitInput(mixedAnyRelPath) {
        let inputRelPath = normalizePath(mixedAnyRelPath);
        let inputInfo = this.implicitInputMap[inputRelPath];
        if (!inputInfo) {
            this.implicitInputMap[inputRelPath] = inputInfo = { relPath: inputRelPath, realPath : null, content: null };
            let resPathCands = this.inputPaths.map(inputPath => this.getNativePath(inputPath, inputRelPath));
            for (let resPathCand of resPathCands) {
                if (fs.existsSync(resPathCand)) { inputInfo.realPath = resPathCand; break; }
            }
            console.debug(`FileResolver: init input mapping: ${inputRelPath} => ${inputInfo.realPath}`)
        }
        return inputInfo;
    }

    flush() {
        for (let [ outputRelPath, outputInfo ] of Object.entries(this.implicitOutputMap)) {
            if (outputInfo.dirty) this.flush1Ex(outputInfo);
        }
        this.flushNextStringID();
    }

    flush1Ex(outputInfo) {
        if (!outputInfo.dirty) return [ true, null ];
        outputInfo.dirty = false;
        if (!outputInfo.realPath.startsWith(path.resolve(this.outputPath, '..'))) throw new Error;
        console.log(`FileResolver: write back: ${outputInfo.relPath}`);
        mkdirSync(path.dirname(outputInfo.realPath));
        writeFileSync(outputInfo.realPath, outputInfo.content, { addBOM: false });
        return [ true, null ];
    }
    flush1(mixedModResPath) { return this.flush1Ex(this.resolveImplicitOutput(mixedModResPath)); }

    /** @returns {[ ?string, ?Error, ?FileResolverInputInfo ]} */
    readAutoInputFileSync(mixedAnyRelPath, options) {
        let outputInfo = this.resolveImplicitOutput(mixedAnyRelPath);
        if (outputInfo.evicted) {
            let [ content, err ] = readFileSyncNoThrow(outputInfo.realPath, options);
            if (!err) {
                console.info(`FileResolver: reload output content: ${outputInfo.relPath}`);
                outputInfo.content = content;
            } else {  // Failure to read-back output file is a critical error
                console.error(`FileResolver: failed to reload output content: ${outputInfo.relPath}`);
                throw err;
            }
        }
        if (outputInfo.content) {
            console.debug(`FileResolver: readAutoInputFileSync: forward: ${outputInfo.relPath}`);
            return [ outputInfo.content, null, outputInfo ];
        }
        let inputInfo = this.resolveImplicitInput(mixedAnyRelPath);
        if (inputInfo.content) {
            console.debug(`FileResolver: readAutoInputFileSync: cached: ${inputInfo.relPath}`);
            return [ inputInfo.content, null, inputInfo ];
        }
        if (!inputInfo.realPath) {
            console.debug(`FileResolver: readAutoInputFileSync: not found: ${inputInfo.relPath}`);
            return [ null, null, null ];
        }
        let [ content, err ] = readFileSyncNoThrow(inputInfo.realPath, options);
        if (!err) {
            console.debug(`FileResolver: cache content: ${inputInfo.relPath}`);
            inputInfo.content = content;
        }
        return [ content, err, inputInfo ];
    }

    /** @returns {?FileResolverInputInfo} */
    resolveAutoInputFile(mixedAnyRelPath) {
        let outputInfo = this.outputPath ? this.resolveImplicitOutput(mixedAnyRelPath) : null;
        if (outputInfo?.evicted) {
            console.debug(`FileResolver: resolveAutoInputFile: found evicted output: ${outputInfo.relPath}`);
            return outputInfo;
        }
        let inputInfo = this.resolveImplicitInput(mixedAnyRelPath);
        if (inputInfo.realPath) {
            console.debug(`FileResolver: resolveAutoInputFile: found input: ${inputInfo.relPath}`);
            return inputInfo;
        } else {
            console.debug(`FileResolver: resolveAutoInputFile: not found: ${inputInfo.relPath}`);
            return null;
        }
    }

    /** @returns {[ boolean, ?Error, ?FileResolverOutputInfo ]} */
    updateOutputFile(mixedModResPath, content, options) {
        let outputInfo = this.resolveImplicitOutput(mixedModResPath);
        if (content !== outputInfo.content) {
            outputInfo.dirty = true;
            outputInfo.content = content;
            console.log(`FileResolver: output updated: ${outputInfo.relPath}`);
        } else {
            console.debug(`FileResolver: output unchanged: ${outputInfo.relPath}`);
        }
        return [ true, null, outputInfo ];
    }

    /** @returns {[ boolean, ?Error ]} */
    writeOutputFile(mixedModResPath, content, options) {
        this.updateOutputFile(mixedModResPath, content, options || {});
        return this.flush1(mixedModResPath);
    }

    acquireNextStringID() {
        if (this.nextStringID < 0) {
            let [ content, error ] = this.readAutoInputFileSync(kNextStringIDPath);
            if (error) { error.extra = `Input File not Found${kNextStringIDPath}`; throw error; }
            this.nextStringID = parseNextStringID(content);
            console.log(`FileResolver: initial NextStringID: ${this.nextStringID}`);
        }
        return this.nextStringID++;
    }

    flushNextStringID() {
        if (this.nextStringID < 0) return;
        let [ content, error ] = this.readAutoInputFileSync(kNextStringIDPath);
        if (error) { error.extra = `Input File not Found: ${kNextStringIDPath}`; throw error; }
        this.writeOutputFile(kNextStringIDPath, updateNextStringID(content, this.nextStringID));
    }
}

module.exports = { FileResolver };
