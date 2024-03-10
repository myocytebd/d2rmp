'use strict';

const vm = require('node:vm');

const { preprocessScript } = require('./pp');

const kLineWidth = 80;
const kLineSeparator = '='.repeat(kLineWidth);
function runScriptSource(scriptSource, contextGlobal, { useScript }) {
    if (scriptSource.extern) {
        console.log(kLineSeparator);
        console.warn(`extern-lib: ${scriptSource.extern}`);
    } else {
        console.log(``.padEnd(kLineWidth, '='));
        console.log(scriptSource.code);
        console.log(`---- OUTPUT `.padEnd(kLineWidth, '-'));
        if (useScript) {
            new vm.Script(scriptSource.code, scriptSource.info).runInContext(contextGlobal);
        } else {
            vm.runInContext(scriptSource.code, contextGlobal, scriptSource.info);
        }
    }
}

function testPreprocess(code, { lineOffset, useScript }) {
    let scriptSources = preprocessScript(code.replace(/^\n/, '').replace(/\n$/, ''), { filename: 'VM', lineOffset });
    let contextGlobal = vm.createContext({ console });
    for (let scriptSource of scriptSources)
        runScriptSource(scriptSource, contextGlobal, { useScript });
    console.log(kLineSeparator);
}

testPreprocess(`
'use strict';
console.log('pre-lib');
/// #pragma lib-begin abc
console.log('lib');
/// #pragma lib-end
console.log('post-lib');
`, { useScript: false });

testPreprocess(`
'use strict';
console.log('pre-lib');
console.log(new Error('pre-lib'));
/// #pragma lib-begin abc
console.log('lib');
/// #pragma lib-end
console.log('post-lib');
console.log(new Error('post-lib'));
`, { useScript: true });
