'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const { SimD2RMM } = require('./d2rmm_api');
const d2s_convert = require('./d2s_convert');
const pp = require('./pp');
const { FileResolver } = require('./resolver');
const { fatal, readFileSyncNoThrow, writeFileSync, cpSync, renameSync, rmFilesSync, tryParseJSON, nativePath } = require('./utils');

// Some D2RMM mods abuse top level return statement.
let tryWrapInFunctionScope = true;

async function resolveFileOp(promise) {
    try { return await promise; } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
    }
}

function filterGlobalPropertyDescriptors() {
    let pdMap = Object.getOwnPropertyDescriptors(global);
    delete pdMap.global;
    return pdMap;
}

class ExternScriptResolver {
    constructor(config) {
        this.path = config.path.externLibJSPath;
        /** @type {Object.<string, { code: string, script: vm.Script }>} */
        this.cache = {};
    }

    get valid() { return this.path; }

    /** @param {pp.ScriptSource} scriptSource */
    resolve(scriptSource) {
        let entry = this.cache[scriptSource.extern];
        if (!entry) {
            let libname = scriptSource.extern.slice(1);
            let jsPath = path.join(this.path, `${libname}.js`);
            let [ libjs, err ] = readFileSyncNoThrow(jsPath);
            if (err) { err.extra = `Failed to Load Lib: ${libname}`; throw err; }
            this.cache[scriptSource.extern] = entry = { code: libjs, script: new vm.Script(libjs, { filename: path.relative(process.cwd(), jsPath) }) };
        }
        scriptSource.code = entry.code;
        scriptSource.script = entry.script;
        return scriptSource;
    }
}

/** @param {ExternScriptResolver} scriptResolver */
function maybePreprocess(modData, scriptResolver) {
    let code = modData.js, lineOffset = 0;
    let scriptSources = pp.preprocessScript(code, { filename: modData.jsPath, lineOffset });
    if (scriptSources.length === 1 && tryWrapInFunctionScope) {  // Some D2RMM mods abuse top level return statement.
        if (tryWrapInFunctionScope) {
            scriptSources[0].info.lineOffset -= 1;
            scriptSources[0].code = String.raw`(function(require) {
${scriptSources[0].code}
})();`
        }
    }
    for (let scriptSource of scriptSources) {
        if (!scriptSource.extern) continue;
        scriptResolver.resolve(scriptSource);
    }
    return scriptSources;
}

class ScriptRunner {
    constructor(config, resolver) {
        this.config = config;
        this.resolver = resolver;
        this.scriptResolver = new ExternScriptResolver(config);
        let conditionalAddon = { require };
        this.upperGlobal = Object.defineProperties(Object.assign(conditionalAddon, { D2RMM: null, config: null, }), filterGlobalPropertyDescriptors());
    }

    runModScript(modData) {
        const lowerGlobal = Object.create(this.upperGlobal);
        vm.createContext(lowerGlobal);
        this.upperGlobal.D2RMM = new SimD2RMM(this.resolver, modData);
        this.upperGlobal.config = modData.config;
        console.log(`RUN: ${modData.name}`);
        try {
            let scriptSources = maybePreprocess(modData, this.scriptResolver);
            for (let scriptSource of scriptSources) {
                if (scriptSource.script) {
                    scriptSource.script.runInContext(lowerGlobal);
                } else {
                    vm.runInContext(scriptSource.code, lowerGlobal, scriptSource.info);
                }
            }
        } catch (e) { return [ undefined, e ]; }
        return [ undefined, null ];
    }
}

// D2RMM use mod.json[key].defaultValue if config.json[key] is missing.
function getModConfig(modData) {
    // Ensure key order
    let needUpdate = false, newConfig = {};
    for (let { id, defaultValue } of modData.mod.config ?? []) {
        if (modData.config[id] === undefined) { needUpdate = true; break; }
    }
    if (!needUpdate) return modData.config;
    for (let { id, defaultValue } of modData.mod.config)
        newConfig[id] = modData.config[id] ?? defaultValue;
    return newConfig;
}

function maybeFixupModConfig(modData, shouldSave) {
    modData.config = getModConfig(modData);
    if (shouldSave) {
        let newConfigString = JSON.stringify(modData.config, null, 4);
        if (newConfigString === '{}' || newConfigString === modData.configString?.trim()) return;
        writeFileSync(path.join(modData.path, 'config.json'), newConfigString, {});
    }
}

/** @param {import('./main').RunConfig} */
async function runD2RMMTask(config) {
    let modsDir = path.join(config.base.d2rmm_path, 'mods');
    let modEnableMap = Object.assign({}, config.d2rmm['enabled-mods']), modNamesOrdered = config.task.override_ordered_mods ?? config.d2rmm['mods-order'];
    let modsMap = {};
    for (let modName of config.task.override_ordered_mods ?? []) modEnableMap[modName] = true;
    for (let modName of config.task.include_mods ?? []) {
        modNamesOrdered.push(modName);
        modEnableMap[modName] = true;
    }
    for (let modName of config.task.exclude_mods ?? []) modEnableMap[modName] = false;
    for (let modName of modNamesOrdered) {
        if (!modEnableMap[modName]) continue;
        let modPath = path.join(modsDir, modName), jsPath = path.join(modPath, 'mod.js');
        modsMap[modName] = {
            name: modName, path: modPath,
            mod: fsp.readFile(path.join(modPath, 'mod.json'), 'utf-8'),
            config: fsp.readFile(path.join(modPath, 'config.json'), 'utf-8'),
            js: fsp.readFile(jsPath, 'utf-8'),
            jsPath: path.relative(process.cwd(), jsPath),
            configString: '',
        };
    }

    let resolver = new FileResolver(config.path);
    if (config.task.clean_output_dir ?? false) {  // Remove output dir and update modinfo.json
        console.info(`Clean up output dir: ${config.path.outputPath}`);
        rmFilesSync(config.path.outputPath, { recursive: true, force: true });
        resolver.writeOutputFile('../modinfo.json', JSON.stringify({ name: config.d2rmod.name, savepath: config.d2rmod.savePath }));
    }
    if (config.task.output_copy_user_input_files ?? false) {  // Ensure files under <path_user_input_data> copied even if no mod script copy or save them.
        if (config.path.baseInputPath === config.path.userInputPath) {
            console.warn(`Skip copy user input data files, because input data and user input data path are same.`);
        } else {
            console.info(`Copy user input data files to output: ${config.path.userInputPath} => ${config.path.outputPath}`);
            cpSync(config.path.userInputPath, config.path.outputPath, { force: true });
        }
    }

    let runner = new ScriptRunner(config, resolver);
    let totalModsCount = Object.entries(modsMap).length, successModsCount = 0, skipModsCount = 0;
    for (let [ modName, modData ] of Object.entries(modsMap)) {
        modData.mod = await resolveFileOp(modData.mod);
        if (!modData.mod) {
            skipModsCount++;
            console.log(`Mod: ${modName} does not exist or is invalid`);
            continue;
        }
        modData.mod = JSON.parse(modData.mod)
        modData.js = await resolveFileOp(modData.js);
        modData.configString = await resolveFileOp(modData.config);
        modData.config = JSON.parse(modData.configString ?? '{}');
        if (!modData.js) {
            skipModsCount++;
            console.log(`Mod: ${modName} does not have mod.js`);
            continue;
        }
        maybeFixupModConfig(modData, !!config.base.d2rmm_config_completion);
        let [ rv, err ] = runner.runModScript(modData);
        if (err) {
            console.error(`Error during Mod: ${modData.name} |`, err);
            break;
        }
        successModsCount++;
    }
    resolver.flush();
    if (successModsCount + skipModsCount === totalModsCount) {
        console.info(`DONE: ${successModsCount}/${totalModsCount} Installed. (${skipModsCount} skipped)`);
    } else {
        fatal(`FAIL: ${successModsCount}/${totalModsCount} Installed. (${skipModsCount} skipped)`);
    }
}

function filterExtInDir(dir, exts) {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && exts.includes(path.parse(d.name).ext) && d.name !== 'Settings.json').map(d => d.name);
}

/** @param bindTxtInfo  taskConfig.bind_txt  @param {function} resolveFn */
async function prepareExcelData(bindTxtInfo, resolveFn, { debug, dataDir } = {}) {
    const cfgWorkaroundD2SDefect = true;
    const prepareTxt1 = (txt) => {
        let txtPath = resolveFn(`global/excel/${txt}.txt`);
        if (!txtPath) throw new Error(`Missing ${txt}.txt`);
        opFiles[`${txt}.txt`] = fsp.readFile(txtPath, 'utf-8');
    };
    const prepareLNG1 = (lng) => {
        let lngPath = resolveFn(`local/lng/strings/${lng}`);
        if (!lngPath) throw new Error(`Missing ${lng}`);
        opFiles[lng] = fsp.readFile(lngPath, 'utf-8');
    };
    let opFiles = {};
    prepareTxt1('itemstatcost');
    for (let [ name, enabled ] of Object.entries(bindTxtInfo)) {
        if (!debug && !enabled) continue;
        if (name === 'mma') {
            for (let mma1 of [ 'magicsuffix', 'magicprefix', 'automagic' ]) prepareTxt1(mma1);
        } else if (name === 'wam') {
            for (let wam1 of [ 'weapons', 'armor', 'misc' ]) prepareTxt1(wam1);
        } else {
            prepareTxt1(name);
        }
    }
    // D2S is ill-designed to must have unnecessary txts and jsons. TODO: revamp D2S and remove this.
    if (cfgWorkaroundD2SDefect) {
        for (let txt of [ 'charstats', 'playerclass', 'skilldesc', 'raresuffix', 'rareprefix', 'properties', 'itemtypes', 'gems' ]) prepareTxt1(txt);
        for (let lng of [ 'item-gems.json', 'item-modifiers.json', 'item-nameaffixes.json', 'item-names.json', 'item-runes.json', 'skills.json' ]) prepareLNG1(lng);
    }
    return opFiles;
}

async function resolveExcelData(opFiles) {
    const filesMap = {};
    for (let [ name, promise ] of Object.entries(opFiles)) filesMap[name] = await promise;
    return filesMap;
}

/** @param {import('./main').RunConfig} config  @param {string} excelDir */
function makeBestEffortResolver(config, excelDir) {
    if (!excelDir) return null;
    let /** @type {FileResolver} */ resolver = null;
    let /** @type {FileResolver} */ resolverFallback = null;
    if (excelDir === path.join(config.path.outputPath, 'global', 'excel')) {
        resolver = new FileResolver(config.path);
    } else {
        let dirs = excelDir.split(path.sep);
        if (dirs.length > 2 && dirs.slice(-2).join('/') === 'global/excel') {
            let dataDir = nativePath(path.join(excelDir, '../..'))
            resolver = new FileResolver({ outputPath: null, baseInputPath: dataDir, userInputPath: null });
        } else {
            resolverFallback = new FileResolver({ outputPath: null, baseInputPath: config.path.baseInputPath, userInputPath: null });
        }
    }
    return (filePath) => {
        if (resolver) {
            return resolver.resolveAutoInputFile(filePath)?.realPath ?? null;
        } else {
            let flatFilePath = path.join(excelDir, path.posix.parse(filePath).base);
            if (fs.existsSync(flatFilePath)) {
                return flatFilePath;
            } else {
                return resolverFallback.resolveAutoInputFile(filePath)?.realPath ?? null;
            }
        }
    };
}

/** @param {import('./main').RunConfig} config */
async function runD2STask(config) {
    const saveNameToFile = (baseName) => baseName.startsWith('SharedStash') ? `${baseName}.d2i` : `${baseName}.d2s`;
    const changeExtension = (baseName, newExt) => {
        let pathInfo = path.parse(baseName);
        return path.join(pathInfo.dir, pathInfo.name + (newExt[0] === '.' ? newExt : `.${newExt}`));
    };
    d2s_convert.config = config;
    let saveDir = config.path.task.path_override_save_path;
    const resolveFn = makeBestEffortResolver(config, config.path.task.path_excel_input_data);
    const resolveAuxFn = makeBestEffortResolver(config, config.path.task.path_aux_excel_input_data);
    // D2S is ill-designed to must have unnecessary txts and jsons.
    let opExcels = await prepareExcelData(config.task.bind_txt, resolveFn, { debug: true, dataDir: config.path.outputPath });
    let opAuxExcels = config.task.mode === 'd2s.migrate' && await prepareExcelData(config.task.bind_txt, resolveAuxFn, { debug: true, dataDir: config.path.outputPath });

    let /** @type {string[]} */ inputFiles = config.task.input_saves ?? [], exactInputFiles = false, filterExt = null;
    if ([ 'd2s.import', 'd2s.export' ].includes(config.task.mode)) {
        if (inputFiles.length === 0) filterExt = config.task.mode === 'd2s.export' ? '.d2s' : '.json';
    } else {
        inputFiles.push(...config.argv);
        if (inputFiles.length === 1) {
            if ([ '.d2s', '*.d2s' ].includes(inputFiles[0])) {
                filterExt = '.d2s';
            } else if ([ '.json', '*.json' ].includes(inputFiles[0])) {
                filterExt = '.json';
            }
        }
    }
    if (filterExt) {
        exactInputFiles = true;
        inputFiles = filterExtInDir(saveDir, (filterExt === '.d2s' ? [ '.d2s', '.d2i' ] : [ '.json' ]));
    }
    if (inputFiles.length === 0) return fatal(`No .d2s/.d2i/.json input files specified`);
    
    let /** @type {Object.<string,Promise<Buffer>>} */ opSaveInputs = {};
    for (let inputFileNameOrPath of inputFiles) {
        let saveFileInfo = path.parse(path.resolve(saveDir, inputFileNameOrPath)), inputFile = saveFileInfo.base;
        if (config.task.mode === 'd2s.export') {
            if (saveFileInfo.ext === '.json') { console.warn(`Skip ${inputFile}`); continue; }
            if (!exactInputFiles && ![ '.d2s', '.d2i' ].includes(saveFileInfo.ext)) inputFile = saveNameToFile(inputFile);
        } else if (config.task.mode === 'd2s.import') {
            if ([ '.d2s', '.d2i' ].includes(saveFileInfo.ext)) { console.warn(`Skip ${inputFile}`); continue; }
            if (!exactInputFiles && saveFileInfo.ext !== '.json') inputFile += '.json';
        }
        saveFileInfo = path.parse(inputFile);
        let savePath = path.join(saveDir, inputFile);
        opSaveInputs[saveFileInfo.base] = fsp.readFile(savePath, saveFileInfo.ext === '.json' ? { encoding: 'utf-8' } : undefined);
    }

    let excelsMap, excelsAuxMap;
    for (let [ inputFile, opSaveInput ] of Object.entries(opSaveInputs)) {
        let { name: inputName, ext } = path.parse(inputFile), saveType = ext.slice(1);
        let content = await resolveFileOp(opSaveInput), json = null, err = null;
        if (!content) throw new Error(`Save file: ${inputFile} does not exist or is unreadable`);
        if (typeof content === 'string') {
            [ json, , err ] = tryParseJSON(content, 'json');
            if (err) { console.error(`Corrupted JSON data: ${inputFile}`); throw err; }
        }
        let saveOut, d2sFileOut = path.join(saveDir, saveNameToFile(inputName)), jsonFileOut = path.join(saveDir, inputName + '.json'), d2sBakFile = d2sFileOut + '.bak';
        excelsMap ??= await resolveExcelData(opExcels);
        if (opAuxExcels) excelsAuxMap ??= await resolveExcelData(opAuxExcels);
        if (config.task.mode === 'd2s.export') {
            saveOut = await d2s_convert.toJSON(content, excelsMap, { saveType });
        } else if (config.task.mode === 'd2s.import') {
            saveOut = await d2s_convert.fromJSON(json, excelsMap);
        } else if (config.task.mode === 'd2s.patch') {
            saveOut = await d2s_convert.patch(json ?? content, excelsMap, { saveType });
        } else if (config.task.mode === 'd2s.migrate') {
            saveOut = await d2s_convert.migrate(json ?? content, excelsAuxMap, excelsMap, { saveType });
        }
        if (ArrayBuffer.isView(saveOut)) {
            renameSync(d2sFileOut, d2sBakFile);
            writeFileSync(d2sFileOut, saveOut, { binary: true });
        } else {
            writeFileSync(jsonFileOut, JSON.stringify(saveOut, null, 2));
        }
    }
}

module.exports = {
    runD2RMMTask, runD2STask,
};
