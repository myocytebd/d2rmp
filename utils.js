'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const util = require('util');

const jsonc = require('jsonc-parser');
const convertPath = require('@stdlib/utils-convert-path');


function fatal(messageOrError, origin) {
    if (!messageOrError || typeof messageOrError === 'string') {
        exitReason ??= 'user-fatal';
        if (messageOrError) console.error(origin ?? '', messageOrError);
    } else {
        exitReason ??= 'manual-uncaughtException';
        console.error(origin ?? '', util.inspect(messageOrError));
    }
    process.exit(1);
}

function nativePath(_path) { return convertPath(_path, path === path.posix ? 'posix' : 'win32'); }
function normalizePath(_path) { return convertPath(_path, 'posix'); }
function scriptPath(_path) { return convertPath(_path, 'win32'); }

function readFileSyncNoThrow(filepath, { logError, binary } = {}) {
    logError ??= true;
    try {  // D2R files contains (illegal) BOM
        if (binary) {
            return [ fs.readFileSync(filepath), null ];
        } else {
            return [ fs.readFileSync(filepath, 'utf-8').replace(/^\uFEFF/, ''), null ];
        }
    } catch (e) {
        if (e.code === 'ENOENT') return [ null, null ];
        if (logError) console.error(`failed to read file: ${filepath}\n${util.inspect(e)}`);
        return [ null, e ];
    }
}

function writeFileSyncEx(filepath, content, { logError, throwError, /*addBOM,*/ binary } = {}) {
    logError ??= !throwError;
    try {
        if (!dryrun) {
            fs.writeFileSync(filepath, content, binary ? undefined : 'utf-8');
        } else {
            console.warn(`DRY-RUN: write file: ${filepath} | content:\n${content.slice(0, 1000)}`);
            // console.info(`DRY-RUN: write file: ${filepath}`);
        }
    } catch (e) {
        if (logError) console.error(`failed to write file: ${filepath}\n${util.inspect(e)}`);
        if (throwError) throw e;
        return [ false, e ];
    }
    return [ true, null ];
}
const writeFileSync = (filepath, content, options = {}) => writeFileSyncEx(filepath, content, Object.assign(options, { throwError: true }));
const writeFileSyncNoThrow = (filepath, content, options = {}) => writeFileSyncEx(filepath, content, Object.assign(options, { throwError: false }));

function statSyncNoThrow(filepath, { logError } = {}) {
    logError ??= true;
    try { return [ fs.statSync(filepath, { throwIfNoEntry: false }), null ]; } catch (e) {
        if (logError) console.error(`failed to stat file: ${filepath}\n${util.inspect(e)}`);
        return [ undefined, e ];
    }
}

// node fs.cp is confusing. vs posix cp:
//   -r ~~ recursive=true
//   -f ~~ force=true
//   -d ~~ dereference=false (default) + verbatimSymlinks=true
//   -n ~~ force=false (default) + errorOnExist=false (default) (actually --remove-destination)
//   --preserve=timestamps ~~ preserveTimestamps=true
//   NA ~~ force=false (default) + errorOnExist=true
function cpSync(srcPath, dstPath, { logError, throwError, ...options } = {}) {
    let force = options.force ?? false;
    try {
        if (!dryrun) {
            fs.cpSync(srcPath, dstPath, Object.assign({ force, recursive: true, errorOnExist: !force, preserveTimestamps: true, verbatimSymlinks: true }, options));
        } else {
            console.warn(`DRY-RUN: cp, dst: ${srcPath} | dst: ${dstPath} | ${util.inspect(options)}`);
        }
        return null;
    } catch (e) {
        if (logError) console.error(`failed to cp, src: ${srcPath} | dst: ${dstPath}\n${util.inspect(e)}`);
        if (throwError) throw e;
        return e;
    }
}

function mkdirSync(dirpath, options = {}) {
    if (!dryrun) {
        fs.mkdirSync(dirpath, Object.assign({ recursive: true }, options));
    } else {
        console.warn(`DRY-RUN: mkdir: ${dirpath} | ${util.inspect(options)}`);
    }
}

function rmSync(filepath, options = {}) {
    if (!dryrun) {
        fs.rmSync(filepath, Object.assign({ recursive: false, force: false }, options));
    } else {
        console.warn(`DRY-RUN: rm: ${filepath} | ${util.inspect(options)}`);
    }
}

function renameSync(oldpath, newpath) {
    if (!dryrun) {
        fs.renameSync(oldpath, newpath);
    } else {
        console.warn(`DRY-RUN: mv: ${oldpath} => ${newpath}`);
    }
}

// node fs.readdir follows all symlink!
// Allows dir to be symlink, otherwise does not follow any symlink.
function readdirSafeSync(dirpath, { recursive, withFileTypes, ...options } = {}) {
    recursive ??= false;
    withFileTypes ??= false;
    if (!recursive) return fs.readdirSync(dirpath, { withFileTypes, ...options });
    const dirWalk = (results, pathArray, startPath) => {
        let parentPath = pathArray.length === 0 ? '' : path.join(...pathArray);
        let dirents = fs.readdirSync(path.join(startPath, parentPath), { withFileTypes: true });
        pathArray.push('');
        for (let dirent of dirents) {
            if (withFileTypes) {
                dirent.parentPath = parentPath;
                results.push(dirent);
            } else {
                results.push(path.join(parentPath, dirent.name));
            }
            pathArray[pathArray.length - 1] = dirent.name;
            if (dirent.isDirectory()) dirWalk(results, pathArray, startPath);
        }
        pathArray.pop();
        return results;
    };
    return dirWalk([], [], dirpath);
}

// Remove only files and leave directories.
function rmFilesSync(dirpath, options = {}) {
    if (dryrun) console.warn(`DRY-RUN: rmFilesSync: ${dirpath} | ${util.inspect(options)}`);
    // node readdir follows all symlink!!!
    let files = readdirSafeSync(dirpath, Object.assign({ recursive: options.recursive ?? false })).map(file => path.join(dirpath, file)).filter(file => fs.lstatSync(file).isFile());
    for (let filepath of files) {
        if (!dryrun) {
            fs.rmSync(filepath, { recursive: false, force: options.force ?? false });
        } else {
            console.warn(`DRY-RUN: rmFilesSync/rm: ${filepath}`);
        }
    }
}

/** @returns {[ any, ?string, ?Error ]} [ result, type, error ] */
function tryParseJSON(content, knownType) {
    let jsonError = null, jsoncErrors = [];
    if (!knownType || knownType === 'json') {
        try { return [ JSON.parse(content), 'json', null ];
        } catch (e) { jsonError = e; }
    }
    let json = jsonc.parse(content, jsoncErrors, { allowTrailingComma: true });
    if (jsoncErrors.length == 0) {
        return [ json, 'jsonc', null ];
    } else {
        return [ undefined, null, new SyntaxError(`In JSON at position ${jsoncErrors[0].offset}, length=${jsoncErrors[0].length}`) ];
    }
}

/** @param {string} cwd  start path (for linux/wine search) */
function probeWin32Home(cwd) {
    if (os.platform === 'win32') return os.homedir();
    let dirs = path.parse(cwd).dir.split(path.sep), i = dirs.lastIndexOf('drive_c');
    if (i < 0) return null;
    let maybeWineDir = '/' + path.join(...dirs.slice(0, i));
    return fs.existsSync(path.join(maybeWineDir, 'user.reg')) && fs.existsSync(path.join(maybeWineDir, 'system.reg')) ? maybeWineDir : null;
}

/** @param {string} gameModName  @param {string} cwd */
function probeSavePath(gameModName, cwd, { check }) {
    let win32Home = probeWin32Home(cwd);
    if (!win32Home) {
        if (check) throw new Error(`Cannot locate user home from: ${cwd}`);
        return null;
    }
    let usersDir = `${win32Home}/drive_c/users`, userName = fs.readdirSync(usersDir).find(name => name !== 'Public');
    let baseDir = `${usersDir}/${userName}/Saved Games/Diablo II Resurrected`;
    let saveDir = gameModName ? path.join(baseDir, 'mods', gameModName) : baseDir;
    if (!fs.existsSync(path.join(saveDir, 'Settings.json')) || !fs.existsSync(path.join(saveDir, 'SharedStashSoftCoreV2.d2i'))) {
        if (check) throw new Error(`D2R save dir does not look like correct: ${saveDir}`);
        return null;
    }
    return saveDir;
}

module.exports = {
    fatal,
    convertPath, nativePath, normalizePath, scriptPath,
    readFileSyncNoThrow, writeFileSync, writeFileSyncNoThrow, statSyncNoThrow, readdirSafeSync,
    cpSync, mkdirSync, rmSync, renameSync, rmFilesSync,
    tryParseJSON,
    probeWin32Home, probeSavePath,
};
