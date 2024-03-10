'use strict';

const microdiff = require('microdiff').default;

/** @param {Uint8Array} buf0  @param {Uint8Array} buf1  @param { desc?: string, maxDiffCount?: number, diffOnSizeMismatch?: boolean } */
function diffBufferToConsole(buf0, buf1, { desc, maxDiffCount, diffOnSizeMismatch } = { desc: 'unnamed-buffer', maxDiffCount: 10, diffOnSizeMismatch: false }) {
    if (Buffer.compare(buf0, buf1) === 0) return 0;
    if (buf0.length !== buf1.length) {
        console.warn(`diffBuffer-${desc}: size mismatch: ${buf0.length} vs ${buf1.length}`);
        if (!diffOnSizeMismatch) return 1E6;
    }
    let diffCount = 0, headerPrinted = false;
    const ensureHeaderPrint = () => {
        if (headerPrinted) return;
        headerPrinted = true;
        if (buf0.length === buf1.length) console.info(`diffBuffer-${desc}: same size: ${buf0.length}`);
    };
    for (let i = 0, len = Math.min(buf0.length, buf1.length); i < len; i++) {
        const shortPrintSlice = (buf, pos) => Buffer.from(buf.slice(pos, pos + Math.min(80, len))).toString('hex');
        if (buf0[i] !== buf1[i]) {
            ensureHeaderPrint();
            console.warn(`diffBuffer-${desc}: first byte diff at: ${i}/${toHex(i)}, ${buf0[i]} vs ${buf1[i]}`);
            console.warn(`diffBuffer-${desc}: src[${toHex(i)}]: ${shortPrintSlice(buf0, i)}}`);
            console.warn(`diffBuffer-${desc}: dst[${toHex(i)}]: ${shortPrintSlice(buf1, i)}}`);
            if (++diffCount >= maxDiffCount) break;
        }
    }
    if (diffCount > 0) {
        if (diffCount === maxDiffCount) {
            console.warn(`diffBuffer-${desc}: total >=${diffCount} diffs (capped)`);
        } else {
            console.warn(`diffBuffer-${desc}: total ${diffCount} diffs`);
        }
    }
    return diffCount;
}

/** @param { desc?: string, maxDiffCount?: number } */
function diffObjectToConsole(obj0, obj1, { desc, maxDiffCount } = { desc: 'unnamed-object', maxDiffCount: 20 }) {
    let diffArray = microdiff(obj0, obj1);
    if (diffArray.length > 0) {
        console.warn(`diffObject-${desc}: found ${diffArray.length} diffs`);
        console.warn(diffArray.slice(0, maxDiffCount));
    }
    return diffArray.length;
}

module.exports = {
    diffBufferToConsole, diffObjectToConsole,
};
