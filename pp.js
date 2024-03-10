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

const vm = require('node:vm');


class LineRun {
    /** @param {string} type  @param {number} [lineBegin]  @param {number} [lineEnd] */
    constructor(type, data, lineBegin, lineEnd) {
        this.type = type;
        this.lineBegin = lineBegin ?? -1;
        this.lineEnd = lineEnd ?? -1;
        this.data = data;
    }
}

class LineRunStack {
    /** @param {string} type  @param {{ origin?: string, depthLimit?: number }} */
    constructor(type, { depthLimit }) {
        this.origin = this.origin ?? 'PP?';
        this.type = type;
        this.depthLimit = depthLimit ?? -1;
        /** @type {LineRun[]} */
        this.stack = [];
    }

    top() { return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null; }

    push(lineBegin, data) {
        if (this.depthLimit > 0 && this.stack.length >= this.depthLimit) throw new Error(`${this.origin}: LineRunStack-${this.type} overflow, last open entry from: ${this.top().lineBegin}`);
        this.stack.push(new LineRun(this.type, data, lineBegin));
        return this.top();
    }

    pop(lineEnd) {
        if (this.stack.length === 0) throw new Error(`${this.origin}: LineRunStack-${this.type} underflow at: ${lineEnd - 1}`);
        this.top().lineEnd = lineEnd;
        return this.stack.pop();
    }
}

class LineBlock {
    /** @param {LineRun} run */
    constructor(run) {
        this.type = run.type;
        this.run = run;
        this.disableCode = false;
        this.splitBlock = false;
        this.extern = null;
    }

    init() {
        if (this.type === 'lib') {
            this.disableCode = true;
            this.splitBlock = true;
            this.extern = `$${this.run.data.extern}`;
        }
        return this;
    }

    get lineBegin() { return this.run.lineBegin; }
    get lineEnd() { return this.run.lineEnd; }
}

class LineBlockSet {
    /** @param {string[]} lines  @param {ScriptSourceInfo} scriptSourceInfo */
    constructor(lines, scriptSourceInfo) {
        this.lines = lines;
        this.sourceInfo = scriptSourceInfo;
        /** @type {LineBlock[]} */
        this.blocks = [];
    }

    /** @param {LineRun} run */
    add(run) {
        this.blocks.push(new LineBlock(run).init());
    }

    complete() {
        let sourceInfo = this.sourceInfo;
        let lines = this.lines.slice(), linesDisabled = new Array(lines.length).fill(false);
        const disableBlock = (lineBegin, lineEnd) => {
            for (let i = lineBegin; i < lineEnd; i++) {
                if (!linesDisabled[i]) {
                    linesDisabled[i] = true;
                    lines[i] = '// ' + lines[i];
                }
            }
        };
        const addCodeBlock = (lineBegin, lineEnd) => {
            if (lineEnd <= lineBegin) return;
            let blockLines = lines.slice(lineBegin, lineEnd), lineOffset = sourceInfo.lineOffset + lineBegin;
            if (!reUseStrict.test(lines[lineBegin])) {
                lineOffset -= 1;
                blockLines.unshift(`'use strict';`);
            }
            scriptSources.push(new ScriptSource(blockLines.join('\n'), null, new ScriptSourceInfo(sourceInfo.filename, lineOffset, sourceInfo.columnOffset)));
        };
        const addExternCode = (extern) => {
            scriptSources.push(new ScriptSource(null, extern, new ScriptSourceInfo(extern)));
        };
        /** @type {ScriptSource[]} */
        let scriptSources = [], nextCodeStart = 0;
        for (let block of this.blocks) {
            if (block.splitBlock) addCodeBlock(nextCodeStart, block.lineBegin);
            if (block.disableBlock) disableBlock(block.lineBegin, block.lineEnd)
            if (block.extern) {
                addExternCode(block.extern);
                nextCodeStart = block.lineEnd;
            }
        }
        addCodeBlock(nextCodeStart, lines.length);
        return scriptSources;
    }
}

class ScriptSourceInfo {
    /** @param {string} filename  @param {number} {lineOffset}  @param {number} {columnOffset} */
    constructor(filename, lineOffset, columnOffset) {
        this.filename = filename;
        this.lineOffset = lineOffset ?? 0;
        this.columnOffset = columnOffset ?? 0;
    }
}

class ScriptSource {
    /** @param {string} code  @param  */
    constructor(code, extern, sourceInfo) {
        this.code = code;
        this.info = sourceInfo;
        this.extern = extern;
        /** @type {vm.Script} */
        this.script = null;
    }
}

const rePreprocessor = new RegExp(String.raw`^///[\s]+#(pragma)[\s]+(.*)`);
const rePreprocessorPragmaLib = new RegExp(String.raw`^(lib-begin|lib-end)[\s]*(.*)`);
const reUseStrict = new RegExp(`^["']use strict["'];[\s]*$`);

const kPPState_Free = null;
const kPPState_WaitLib = 'lib';

/** @param {string} code, @param { filename: string, lineOffset?: number, columnOffset?: number } */
function preprocessScript(code, { filename, lineOffset, columnOffset }) {
    const scriptSourceInfo = new ScriptSourceInfo(filename, lineOffset, columnOffset);
    const lines = code.split('\n');
    let nextExpectedState = kPPState_Free;
    let libStack = new LineRunStack('lib', { origin: filename, depthLimit: 1 });
    let blockSet = new LineBlockSet(lines, scriptSourceInfo);
    for (let [ lineIndex, line ] of lines.entries()) {
        let r0 = line.match(rePreprocessor);
        if (!r0) continue;
        if (nextExpectedState === kPPState_Free || nextExpectedState == kPPState_WaitLib) {
            let r1 = r0[2].match(rePreprocessorPragmaLib);
            if (r1) {
                let pragmaCmd = r1[1];
                if (pragmaCmd === 'lib-begin') {
                    let libname = r1[2];
                    libStack.push(lineIndex, { extern: libname });
                    nextExpectedState = kPPState_WaitLib;
                } else if (pragmaCmd === 'lib-end') {
                    blockSet.add(libStack.pop(lineIndex + 1));
                    nextExpectedState = kPPState_Free;
                }
            }
        }
    }
    return blockSet.complete();
}

module.exports = { preprocessScript, ScriptSource, ScriptSourceInfo };
