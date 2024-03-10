'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readFileSyncNoThrow, readdirSafeSync } = require('./utils');


/**
 * @typedef {string[]} TSVHeader
 * @typedef {Object<string, string|number>} TSVRow
 * @typedef {{ headers: TSVHeader, rows: TSVRow[] }} TSVData
 */

const excel = {
    kPath: 'global\\excel',
    actinfo: 0, armor: 'code', automagic: 0, automap: 0, belts: 0, books: 0, charstats: 0, cubemain: 0, difficultylevels: 0, experience: 0,
    gamble: 0, gems: 0, hireling: 0, hirelingdesc: 0, inventory: 0, itemratio: 0, itemstatcost: 0, itemtypes: 0, levelgroups: 0,
    levels: 0, lvlmaze: 0, lvlprest: 0, lvlsub: 0, lvltypes: 0, lvlwarp: 0, magicprefix: 0, magicsuffix: 0, misc: 'code', missiles: 0,
    monai: 0, monequip: 0, monlvl: 0, monpreset: 0, monprop: 0, monseq: 0, monsounds: 0, monstats: 0, monstats2: 0, montype: 0, monumod: 0,
    npc: 0, objects: 0, objgroup: 0, objpreset: 0, overlay: 0, pettype: 0, properties: 0, qualityitems: 0, rareprefix: 0, raresuffix: 0,
    runes: 0, setitems: 0, sets: 0, shrines: 0, skilldesc: 0, skills: 0, soundenviron: 0, sounds: 0, states: 0, superuniques: 0,
    treasureclassex: 0, uniqueappellation: 0, uniqueitems: 0, uniqueprefix: 0, uniquesuffix: 0, wanderingmon: 0, weapons: 'code',
};

/** CSV/TSV are not strictly defined. Below are from CSV RFC-4180. */
// CRLF; last record may or may not have an line break; no trailing separator.
// Field may or may not be enclosed in double quotes. If fields are not enclosed with double quotes, then double quotes may not appear inside the fields.
// Fields containing line breaks (CRLF), double quotes, and commas should be enclosed in double-quotes.
// If double-quotes are used to enclose fields, then a double-quote appearing inside a field must be escaped by preceding it with another double quote.

/** @param {string} rawValue */
function decodeCSVField(rawValue) {
    if (rawValue === undefined) return undefined;
    if (rawValue[0] == '"') {
        if (rawValue[rawValue.length - 1] !== '"') throw new Error(`Invalid CSV/TSV Field: ${rawValue}`);
        return rawValue.slice(1, -1).replace(/""/g, '"');
    } else {
        return rawValue;
    }
}

/** @param {string} content */
function parseTsv(content, keyCol) {
    const [ headersRaw, ...rowsRaw ] = content.split('\n');
    const headers = headersRaw.split('\t').map(header => header.trim()), rows = [], rowMap = {};
    for (let rowStr of rowsRaw) {
        const row = {};
        if (rowStr.trim() === '') continue;  // Skip trailing new line
        for (let [ index, value ] of rowStr.split('\t').entries()) {
            value = value.trim();
            row[headers[index]] = decodeCSVField(value === '' ? undefined : value);
        }
        if (keyCol) rowMap[row[keyCol]] = row;
        rows.push(row);
    }
    return { headers, rows, rowMap, keyCol };
}

function compareString(a, b) {
    if (a === b) {
        return 0;
    } else if (a < b) {
        return -1;
    } else { // a > b
        return 1;
    }
}

function diffExistence(srcPath, dstPath) {
    let srcExists = fs.existsSync(srcPath), dstExists = fs.existsSync(dstPath);
    if (srcExists !== dstExists) {
        if (srcExists) {
            return [ -1, `Destination Missing: ${srcPath}` ];
        } else {
            return [ 1, `Source Missing: ${dstPath}` ];
        }
    }
    return [ 0, '' ];
}

function diffBinary(srcPath, dstPath) {
    let rvExistence = diffExistence(srcPath, dstPath);
    if (rvExistence[0] !== 0) return rvExistence;
    let srcBuf = fs.readFileSync(srcPath), dstBuf = fs.readFileSync(dstPath);
    let rv = dstBuf.compare(srcBuf);
    return rv === 0 ? [ rv, '' ] : [ rv, 'diff' ];
}

function diffTextBase(srcPath, dstPath) {
    let rvExistence = diffExistence(srcPath, dstPath);
    if (rvExistence[0] !== 0) return rvExistence;
    let [ srcContent, srcErr ] = readFileSyncNoThrow(srcPath);
    let [ dstContent, dstErr ] = readFileSyncNoThrow(dstPath);
    if (srcErr ?? dstErr) throw srcErr ?? dstErr;
    let c = compareString(dstContent, srcContent);
    if (c === 0) {
        return [ 0, '' ];
    } else {
        return [ c, 'text diff', srcContent, dstContent ];
    }
}

function diffJSON(srcPath, dstPath) {
    return diffTextBase(srcPath, dstPath).slice(0, 2);
}

const kTSVEmptyCellDesc = `<blank>`;
function getTSVKeyCol(tsvPath) { return excel[path.parse(tsvPath).name] || null; }
function diffTSV(srcPath, dstPath) {
    let [ rvBase, descBase, srcContent, dstContent ] = diffTextBase(srcPath, dstPath);
    if (rvBase === 0) return [ rvBase, descBase ];
    let srcTSV = parseTsv(srcContent, getTSVKeyCol(srcPath)), dstTSV = parseTsv(dstContent, getTSVKeyCol(dstPath));
    // TODO: find column add/remove
    let headerComp = compareString(dstTSV.headers.join('|'), srcTSV.headers.join('|'));
    if (headerComp !== 0) {
        let diffDescs = [ 'header diff' ];
        let srcHeaders = new Set(srcTSV.headers), dstHeaders = new Set(dstTSV.headers);
        let srcOnlyHeaders = [], dstOnlyHeaders = [];
        for (let header of srcHeaders) {
            if (!dstHeaders.has(header)) srcOnlyHeaders.push(header);
        }
        for (let header of dstHeaders) {
            if (!srcHeaders.has(header)) srcOnlyHeaders.push(header);
        }
        if (srcOnlyHeaders.length > 0) diffDescs.push(`Source Only Headers: ${srcOnlyHeaders.join('|')}`);
        if (dstOnlyHeaders.length > 0) diffDescs.push(`Destination Only Headers: ${dstOnlyHeaders.join('|')}`);
        let srcCommonHeaders = srcTSV.headers.filter(header => !srcOnlyHeaders.includes(header));
        let dstCommonHeaders = dstTSV.headers.filter(header => !dstOnlyHeaders.includes(header));
        if (srcCommonHeaders.join('|') !== dstCommonHeaders.join('|')) {
            let firstDiffIndex;
            for (let i = 0; i < srcCommonHeaders.length; i++) {
                if (srcCommonHeaders[i] !== dstCommonHeaders[i]) { firstDiffIndex = i; break; }
            }
            diffDescs.push(`headers re-ordered since: ${srcCommonHeaders[firstDiffIndex]} | ${dstCommonHeaders[firstDiffIndex]}`);
        }
        return [ headerComp, diffDescs.join('\n') ];
    }
    // TODO: find row add/remove
    // TODO: guess row difference
    // Cell difference
    let indentUnit = ' '.repeat(4);
    let allDiffDescs = [], rv = 0, rowDiffCount = 0, cellDiffCount = 0;
    let descCol = getTSVKeyCol(srcPath) ?? srcTSV.headers[0];
    for (let i = 0; i < Math.min(srcTSV.rows.length, dstTSV.rows.length); i++) {
        let srcRow = srcTSV.rows[i], dstRow = dstTSV.rows[i];
        let diffDescs = [];
        for (let col of srcTSV.headers) {
            let srcValue = srcRow[col], dstValue = dstRow[col];
            if (srcValue === dstValue) continue;
            diffDescs.push(`[${col}]: {${srcValue ?? kTSVEmptyCellDesc}} vs {${dstValue ?? kTSVEmptyCellDesc}}`);
            if (rv === 0) rv = compareString(String(dstValue), String(srcValue));
        }
        if (diffDescs.length > 0) {
            rowDiffCount++;
            cellDiffCount += diffDescs.length;
            if (srcRow[descCol] === dstRow[descCol]) {
                allDiffDescs.push(`Row[${i + 1}] diff: (${diffDescs.length}) {${srcRow[descCol]}}`);
            } else {
                allDiffDescs.push(`Row[${i + 1}] diff: (${diffDescs.length}) {${srcRow[descCol]}} / {${dstRow[descCol]}}`);
            }
            for (let diffDesc of diffDescs) allDiffDescs.push(indentUnit + diffDesc);
        }
    }
    if (srcTSV.rows.length !== dstTSV.rows.length) {
        rv = Math.sign(dstTSV.rows.length - srcTSV.rows.length);
        if (srcTSV.rows.length > dstTSV.rows.length) {
            allDiffDescs.push(`Source has extra ${srcTSV.rows.length - dstTSV.rows.length} rows (${dstTSV.rows.length} - ${srcTSV.rows.length - 1})`);
        } else {
            allDiffDescs.push(`Destination has extra ${dstTSV.rows.length - srcTSV.rows.length} rows (${srcTSV.rows.length} - ${dstTSV.rows.length - 1})`);
        }
    }
    if (allDiffDescs.length > 0)
        allDiffDescs.push(`Rows/Cells Compare: ${rowDiffCount} Rows diff, ${cellDiffCount} Cells Diff`);
    return [ rv, allDiffDescs.join('\n') ];
}

function diffFile(srcPath, dstPath, { checkTSVPath }) {
    checkTSVPath ??= false;
    let pathInfo = path.parse(srcPath);
    let rv, diffDesc;
    if (pathInfo.ext === '.txt' && (!checkTSVPath || pathInfo.dir.includes(path.join('global', 'excel')))) {
        [ rv, diffDesc ] = diffTSV(srcPath, dstPath);
    } else if (pathInfo.ext === '.json') {
        [ rv, diffDesc ] = diffJSON(srcPath, dstPath);
    } else {
        [ rv, diffDesc ] = diffBinary(srcPath, dstPath);
    }
    if (rv === 0) return;
    console.info(`Source: ${srcPath} vs Destination: ${dstPath}\n${diffDesc}`);
}

const reStripTrailingSep = new RegExp(`${path.sep}*$`);
function diffDir(srcDir, dstDir, { checkTSVPath }) {
    checkTSVPath ??= true;
    srcDir = srcDir.replace(reStripTrailingSep, '');
    dstDir = dstDir.replace(reStripTrailingSep, '');
    let srcFiles = readdirSafeSync(srcDir, { recursive: true }).filter(srcPath => fs.statSync(path.join(srcDir, srcPath)).isFile());
    let dstFiles = readdirSafeSync(dstDir, { recursive: true }).filter(dstPath => fs.statSync(path.join(dstDir, dstPath)).isFile());
    let srcFilesMap = new Map(srcFiles.map(path => [ path, false ])), dstFilesMap = new Map(dstFiles.map(path => [ path, false ]));
    console.info(`Compare Directory: Source: ${srcDir} vs Destination: ${dstDir}`);
    for (let srcPath of srcFilesMap.keys()) {
        if (dstFilesMap.get(srcPath) !== undefined) {
            srcFilesMap.set(srcPath, true);
            dstFilesMap.set(srcPath, true);
        }
    }
    const lineSeparator = '='.repeat(80);
    let srcOnlyCount = 0, dstOnlyCount = 0, fileDiffCount = 0;
    console.info(lineSeparator);
    for (let [ srcPath ] of [ ...srcFilesMap.entries() ].filter(([ , common ]) => !common)) {
        srcOnlyCount++;
        console.info(`Source only file: ${srcPath}`);
    }
    if (srcOnlyCount > 0) console.info(lineSeparator);
    for (let [ dstPath ] of [ ...dstFilesMap.entries() ].filter(([ , common ]) => !common)) {
        dstOnlyCount++;
        console.info(`Destination only file: ${dstPath}`);
    }
    if (dstOnlyCount > 0) console.info(lineSeparator);
    for (let [ commonPath ] of [ ...srcFilesMap.entries() ].filter(([ , common ]) => common)) {
        let pathInfo = path.parse(commonPath);
        let srcPath = path.join(srcDir, commonPath), dstPath = path.join(dstDir, commonPath);
        let rv, diffDesc;
        if (pathInfo.ext === '.txt' && (!checkTSVPath || pathInfo.dir.includes(path.join('global', 'excel')))) {
            [ rv, diffDesc ] = diffTSV(srcPath, dstPath);
        } else if (pathInfo.ext === '.json') {
            [ rv, diffDesc ] = diffJSON(srcPath, dstPath);
        } else {
            [ rv, diffDesc ] = diffBinary(srcPath, dstPath);
        }
        if (rv === 0) continue;
        console.info(`Source: ${srcPath} vs Destination: ${dstPath} ${diffDesc}`);
        console.info(lineSeparator);
    }
}

module.exports = { diffBinary, diffJSON, diffTSV, diffDir };
if (require.main === module) main();

// node <diff.js> <srcDir> <dstDir>
// node <diff.js> <srcFile> [<dstFile>]  (dstFile default to basename <srcFile>)
function printUsage() { return console.info(`
Usage: node ${path.basename(__filename)} <src-dir> <dst-dir>
Usage: node ${path.basename(__filename)} <src-file> [<dst-file>]  (dst-file default to basename <src-file>)
`.replace(/^\n/, '')); }

function main() {
    if (process.argv.length < 3) return printUsage();
    let srcPath = path.normalize(process.argv[2]), dstPath = process.argv[3] ? path.normalize(process.argv[3]) : undefined;
    if (!fs.existsSync(srcPath)) throw new Error(`Source does not exist: ${srcPath}`);
    if (dstPath !== undefined && !fs.existsSync(dstPath)) throw new Error(`Destination does not exist: ${dstPath}`);
    let compareDir = fs.statSync(srcPath).isDirectory();
    if (dstPath !== undefined && compareDir !== fs.statSync(dstPath).isDirectory()) throw new Error(`Cannot compare file vs directory`);
    if (compareDir) {
        if (dstPath === undefined) return printUsage();
        diffDir(srcPath, dstPath, { checkTSVPath: true });
    } else {
        let dstFile = dstPath;
        if (dstPath === undefined) {
            dstFile = path.basename(srcPath);
            if (!fs.statSync(dstFile, { throwIfNoEntry: false })?.isFile()) return printUsage();
        }
        diffFile(srcPath, dstFile, { checkTSVPath: false });
    }
}
