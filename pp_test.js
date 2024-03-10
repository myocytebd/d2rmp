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
