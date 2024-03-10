'use strict';
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const jsonc = require('jsonc-parser').safe;

const { runD2RMMTask, runD2STask } = require('./runner');
const { fatal, nativePath, normalizePath, scriptPath, tryParseJSON, probeSavePath } = require('./utils');
const { match } = require('node:assert');

let forceDryRun = false, replaceConsole = true;

const kDefaultBaseConfigFilepath = path.join(__dirname, 'default.jsonc');
const kDefaultTaskConfigFilepath = path.join(__dirname, 'default_task.jsonc');

/** @typedef {{}} Config */
/** @typedef {{ mode: string }} TaskConfig */
const kDefaultConfig = { log_level: 'debug' };

globalThis.nodeConsole = console;

workaroundBrokenUnhandledRejectionsDetection();
main();


function printHelpAndExit() {
    console.info(`Usage: node ${path.basename(__filename)} [CONFIG-FILE.jsonc] [TASK-CONFIG-FILE.jsonc] ...
Default config file ${path.basename(kDefaultBaseConfigFilepath)} is used if the program run without <CONFIG-FILE.jsonc>.
Default task config file ${path.basename(kDefaultTaskConfigFilepath)} is used if the program run without <TASK-CONFIG-FILE.jsonc>.
`);
    process.exit(1);
}

function main() {
    let inputBaseConfigFilepath = process.argv[2], inputTaskConfigFilepath = process.argv[3];
    let baseConfigFilepath = inputBaseConfigFilepath ?? kDefaultBaseConfigFilepath, taskConfigFilepath = inputTaskConfigFilepath ?? kDefaultTaskConfigFilepath;
    let baseConfig, taskConfig, err;
    if (!fs.existsSync(baseConfigFilepath)) {
        console.info(`${ inputBaseConfigFilepath ? 'Specified' : 'Default' } config file does not exist: ${baseConfigFilepath}`);
        return printHelpAndExit();
    } else {
        console.info(`Using ${ inputBaseConfigFilepath ? 'specified' : 'default' } config file: ${baseConfigFilepath}`);
        [ baseConfig, , err ] = tryParseJSON(fs.readFileSync(baseConfigFilepath, 'utf-8'), 'jsonc');
        if (err) fatal(`Invalid config file: ${baseConfigFilepath}\n${util.inspect(err)}`);
    }
    if (!fs.existsSync(taskConfigFilepath)) {
        console.info(`${ inputTaskConfigFilepath ? 'Specified' : 'Default' } task config file does not exist: ${taskConfigFilepath}`);
        return printHelpAndExit();
    } else {
        console.info(`Using ${ inputTaskConfigFilepath ? 'specified' : 'default' } task config file: ${taskConfigFilepath}`);
        [ taskConfig, , err ] = tryParseJSON(fs.readFileSync(taskConfigFilepath, 'utf-8'), 'jsonc');
        if (err) fatal(`Invalid config file: ${taskConfigFilepath} | ${util.inspect(err)}`);
    }
    setImmediate(() => asyncMain(baseConfig, taskConfig));
}


/** @typedef {{ outputPath: string, baseInputPath: string, userInputPath: string, externLibJSPath: string, task: Object.<string,string> }} PathConfig */
/** @typedef {{ base: Config, task: TaskConfig, d2rmm: any, path: PathConfig, d2rmod: { name: string, savePath: string }, argv: string[] }} RunConfig */


/** @param {PathConfig} pathConfig  @param {TaskConfig} taskConfig */
function resolveTaskPaths(pathConfig, taskConfig, gameModName) {
    const kMacroMap = {
        $output: pathConfig.outputPath, $input: pathConfig.baseInputPath, $user: pathConfig.userInputPath,
        $save: () => probeSavePath(gameModName, pathConfig.outputPath, { check: true }),
    };
    const expandPath = (pathValue) => nativePath(pathValue.replace(/\$output|\$input|\$user|\$save/, (matchString) => {
        let template = kMacroMap[matchString];
        return typeof template === 'string' ? template : template();
    }));
    let /** @type {Object.<string,boolean>} */ spec = {};
    if (taskConfig.mode.startsWith('d2s.')) {
        spec.path_excel_input_data = null;
        spec.path_override_save_path = '$save';
        if (taskConfig.mode === 'd2s.migrate') spec.path_aux_excel_input_data = null;
    }
    const /** @type {Object.<string,string>} */ taskPathConfig = {};
    for (let [ prop, defaultValue ] of Object.entries(spec)) {
        if (!taskConfig[prop] && !defaultValue) fatal(`Task path: ${prop} not configured for task mode ${taskConfig.mode}`);
        if (taskConfig[prop]) {
            taskPathConfig[prop] = expandPath(taskConfig[prop]);
            console.info(`Task path: ${prop} use: ${taskConfig[prop]} as: ${taskPathConfig[prop]}`);
        } else {
            taskPathConfig[prop] = expandPath(defaultValue);
            console.info(`Task path: ${prop} use default: ${defaultValue} as: ${taskPathConfig[prop]}`);
        }
    }
    return taskPathConfig;
}

/** @param {Config} baseConfig  @param {TaskConfig} taskConfig */
async function asyncMain(baseConfig, taskConfig) {
    globalThis.dryrun = baseConfig.dry_run || taskConfig.dry_run || forceDryRun || false;
    console.info(`Run ${taskConfig.mode} mode`);
    if (dryrun) console.warn(`DRY RUN`);
    if (!baseConfig.d2rmm_path || !fs.existsSync(baseConfig.d2rmm_path)) fatal(`Invalid D2RMM path, set d2rmm_path: ${baseConfig.d2rmm_path}`);

    const d2rmmSettings = await require('./d2rmm_settings').loadD2RMMSettings(baseConfig.d2rmm_path);
    console.debug(`D2RMM settings:\n`, d2rmmSettings);
    let gameModName = d2rmmSettings['output-mod-name'];
    let gamePath = path.resolve(nativePath(baseConfig.path_override_d2r_game || d2rmmSettings.paths));  // Absolute
    let gameModPath = path.join(gamePath, 'mods', gameModName, `${gameModName}.mpq`);  // Absolute
    let outputPath = baseConfig.path_override_output_data || gameModPath;
    let baseInputPath = baseConfig.path_override_input_data || (d2rmmSettings['pre-extracted-data'] && d2rmmSettings['pre-extracted-data-path']) || null;
    let userInputPath = baseConfig.path_user_input_data || null;
    if (!baseInputPath && !userInputPath) fatal(`Input path not configured: set path_aux_input_data, path_override_input_data or D2RMM Pre-Extracted Data`);
    baseInputPath ??= userInputPath;
    let outputAbsPath = path.resolve(nativePath(outputPath), 'data');
    let baseInputAbsPath = path.resolve(nativePath(baseInputPath));
    let userInputAbsPath = userInputPath ? path.resolve(nativePath(userInputPath)) : null;
    console.info(`Use output to: ${outputPath} as: ${outputAbsPath}`);
    console.info(`Use input data from: ${baseInputPath} as: ${baseInputAbsPath}`);
    if (userInputPath) console.info(`Use user input data from: ${userInputPath} as: ${userInputAbsPath}`);
    if (/*outputPath === gameModPath &&*/ fs.existsSync(outputPath) && !fs.existsSync(path.join(outputPath, 'modinfo.json')))
        fatal(`Error: output path exists and does not look like D2R mod dir: ${outputPath}`);
    let externLibJSPath = path.resolve(__dirname, nativePath(baseConfig.path_extern_libjs ?? ''));
    console.log(`Use Extern Lib JS Path: ${externLibJSPath}`);

    /** @type {PathConfig} */
    let pathConfig = { outputPath: outputAbsPath, baseInputPath: baseInputAbsPath, userInputPath: userInputAbsPath, externLibJSPath };
    pathConfig.task = resolveTaskPaths(pathConfig, taskConfig, gameModName);
    let savePath = baseConfig.save_path || `${gameModName}/`;
    let taskMode = taskConfig.mode || 'd2rmm';
    if (replaceConsole) {
        globalThis.console = Object.assign(new console.Console(process.stdout), { Console: console.Console } );
        require('console-stamp')(globalThis.console, {
            format: ':date(yyyy/mm/dd HH:MM:ss.l) :label(7)',
            level: baseConfig.log_level || kDefaultConfig.log_level,
        });
    }
    /** @type {RunConfig} */
    let config = {
        base: baseConfig, task: taskConfig, path: pathConfig, d2rmod: { name: gameModName, savePath }, d2rmm: d2rmmSettings,
        argv: process.argv.slice(4),
    };
    try {
        if (taskMode === 'd2rmm') await runD2RMMTask(config);
        else if (taskMode.startsWith('d2s.')) await runD2STask(config);
    } catch (e) { fatal(e, 'asyncMain'); }
}

function workaroundBrokenUnhandledRejectionsDetection() {
    globalThis.exitReason = null;
    const unhandledRejections = new Map();
    process.on('unhandledRejection', (reason, promise) => { unhandledRejections.set(promise, reason); });
    process.on('rejectionHandled', (promise) => { unhandledRejections.delete(promise); });
    process.on('exit', (exitCode) => {
        if (exitCode !== 0) exitReason ??= `exit,0x${exitCode.toFixed(16)}`;
        if (exitReason) return console.log(`exit-reason: ${exitReason}`);  // Don't spam if process does not exit normally.
        if (unhandledRejections.size === 0) return;
        let summary = `Unhandled Rejections: ${unhandledRejections.size}`;
        nodeConsole.error([ summary ].concat([ ...unhandledRejections.values() ].map(util.inspect)).join('\n'));
    });
    // Detect some common exit reasons.
    process.on('uncaughtExceptionMonitor', (err, origin) => { exitReason ??= origin; });
};
