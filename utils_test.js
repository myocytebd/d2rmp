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
const util = require('node:util');

const { readdirSafeSync } = require('./utils');
const path = require('node:path');

function checkReaddirSafeSync(...args) {
    console.log(util.inspect(readdirSafeSync(...args), { maxArrayLength: null }));
}
checkReaddirSafeSync('.');
checkReaddirSafeSync('.', { withFileTypes: true });
checkReaddirSafeSync('.', { recursive: true });
checkReaddirSafeSync('.', { recursive: true });
checkReaddirSafeSync('.', { recursive: true, withFileTypes: true });

// console.log(util.inspect(fs.readdirSync('.', { recursive: true }), { maxArrayLength: null }));

checkReaddirSafeSync(path.resolve('.'), { recursive: true });
