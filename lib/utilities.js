Object.defineProperty(exports, "__esModule", { value: true });
var lie_ts_1 = require("lie-ts");
exports.Promise = (function () {
    return typeof window !== "undefined" && window["Promise"] ? window["Promise"] : typeof global !== "undefined" && global["Promise"] ? global["Promise"] : lie_ts_1.Promise;
})();
exports._assign = function (obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : null;
};
/**
 * Chain a set of async functions together, calling each as the previous one finishes.
 * Once the final one is done, pass the result.
 *
 * @export
 * @class CHAIN
 */
var CHAIN = /** @class */ (function () {
    function CHAIN(callbacks) {
        this.callbacks = callbacks;
    }
    CHAIN.prototype.then = function (complete) {
        var _this = this;
        var results = [];
        var ptr = 0;
        if (!this.callbacks || !this.callbacks.length) {
            complete([]);
        }
        var next = function () {
            if (ptr < _this.callbacks.length) {
                _this.callbacks[ptr](function (result) {
                    results.push(result);
                    ptr++;
                    // Breaks up the call stack
                    exports.Promise.resolve().then(next);
                });
            }
            else {
                complete(results);
            }
        };
        next();
    };
    return CHAIN;
}());
exports.CHAIN = CHAIN;
/**
 * Call a set of async functions all at once.
 * Completes once every async function is done, returning the results in the order the functions were called in.
 *
 * @export
 * @class ALL
 */
var ALL = /** @class */ (function () {
    function ALL(callbacks) {
        this.callbacks = callbacks;
    }
    ALL.prototype.then = function (complete) {
        var _this = this;
        var results = [];
        var ptr = 0;
        if (!this.callbacks || !this.callbacks.length) {
            complete([]);
        }
        this.callbacks.forEach(function (cb, i) {
            cb(function (response) {
                results[i] = response;
                ptr++;
                if (ptr === _this.callbacks.length) {
                    complete(results);
                }
            });
        });
    };
    return ALL;
}());
exports.ALL = ALL;
exports.fastCHAIN = function (items, callback) {
    return new exports.Promise(function (res, rej) {
        if (!items || !items.length) {
            res([]);
            return;
        }
        var results = [];
        var step = function () {
            if (results.length < items.length) {
                callback(items[results.length], results.length, function (result) {
                    results.push(result);
                    results.length < 100 ? step() : lie_ts_1.setFast(step);
                });
            }
            else {
                res(results);
            }
        };
        step();
    });
};
exports.fastALL = function (items, callback) {
    return new exports.Promise(function (res, rej) {
        if (!items || !items.length) {
            res([]);
            return;
        }
        var i = items.length;
        var results = [];
        while (i--) {
            callback(items[i], i, function (result) {
                results.push(result);
                if (results.length === items.length) {
                    res(results);
                }
            });
        }
    });
};
/*
export const ALL = (callbacks: ((result: (result?: any) => void) => void)[]) => {
    return new Promise((res, rej) => {
        let results: any[] = [];
        let ptr = 0;

        if (!callbacks || !callbacks.length) {
            res([]);
        }

        callbacks.forEach((cb, i) => {
            cb((response) => {
                results[i] = response;
                ptr++;
                if (ptr === callbacks.length) {
                    res(results);
                }
            });
        });
    });
};*/
var ua = typeof window === "undefined" ? "" : navigator.userAgent;
// Detects iOS device OR Safari running on desktop
exports.isSafari = ua.length === 0 ? false : (/^((?!chrome|android).)*safari/i.test(ua)) || (/iPad|iPhone|iPod/.test(ua) && !window["MSStream"]);
// Detect Edge or Internet Explorer
exports.isMSBrowser = ua.length === 0 ? false : ua.indexOf("MSIE ") > 0 || ua.indexOf("Trident/") > 0 || ua.indexOf("Edge/") > 0;
// detect Android
exports.isAndroid = /Android/.test(ua);
// Generate a random 16 bit number using strongest crypto available.
exports.random16Bits = function () {
    if (typeof crypto === "undefined") {
        return Math.round(Math.random() * Math.pow(2, 16)); // Less random fallback.
    }
    else {
        if (crypto.getRandomValues) {
            var buf = new Uint16Array(1);
            crypto.getRandomValues(buf);
            return buf[0];
        }
        else if (global !== "undefined" && global._crypto.randomBytes) {
            return global._crypto.randomBytes(2).reduce(function (prev, cur) { return cur * prev; });
        }
        else {
            return Math.round(Math.random() * Math.pow(2, 16)); // Less random fallback.
        }
    }
};
// Generate a TimeID for use in the database.
exports.timeid = function (ms) {
    var time = Math.round((new Date().getTime()) / (ms ? 1 : 1000)).toString();
    while (time.length < (ms ? 13 : 10)) {
        time = "0" + time;
    }
    return time + "-" + (exports.random16Bits() + exports.random16Bits()).toString(16);
};
// Generates a valid V4 UUID.
exports.uuid = function () {
    var r, s, b = "";
    return [b, b, b, b, b, b, b, b, b].reduce(function (prev, cur, i) {
        r = exports.random16Bits();
        s = (i === 4 ? i : (i === 5 ? (r % 16 & 0x3 | 0x8).toString(16) : b));
        r = r.toString(16);
        while (r.length < 4)
            r = "0" + r;
        return prev + ([3, 4, 5, 6].indexOf(i) > -1 ? "-" : b) + (s + r).slice(0, 4);
    }, b);
};
// A quick and dirty hashing function, turns a string into a md5 style hash.
// stolen from https://github.com/darkskyapp/string-hash
exports.hash = function (str) {
    var hash = 5381, i = str.length;
    while (i) {
        hash = (hash * 33) ^ str.charCodeAt(--i);
    }
    return (hash >>> 0).toString(16);
};
var idTypes = {
    "int": function (value) { return value; },
    "uuid": exports.uuid,
    "timeId": function () { return exports.timeid(); },
    "timeIdms": function () { return exports.timeid(true); }
};
// Generate a row ID given the primary key type.
exports.generateID = function (primaryKeyType, incrimentValue) {
    return idTypes[primaryKeyType] ? idTypes[primaryKeyType](incrimentValue || 1) : "";
};
// Clean the arguments from an object given an array of arguments and their types.
exports.cleanArgs = function (argDeclarations, args) {
    var a = {};
    var i = argDeclarations.length;
    while (i--) {
        var k2 = argDeclarations[i].split(":");
        if (k2.length > 1) {
            a[k2[0]] = exports.cast(k2[1], args[k2[0]] || undefined);
        }
        else {
            a[k2[0]] = args[k2[0]] || undefined;
        }
    }
    return a;
};
/**
 * Determine if a given value is a javascript object or not. Exludes Arrays, Functions, Null, Undefined, etc.
 *
 * @param {*} val
 * @returns {boolean}
 */
exports.isObject = function (val) {
    return Object.prototype.toString.call(val) === "[object Object]";
};
/**
 * Cast a javascript variable to a given type. Supports typescript primitives and more specific types.
 *
 * @param {string} type
 * @param {*} [val]
 * @returns {*}
 */
exports.cast = function (type, val) {
    if (type === "any" || type === "blob")
        return val;
    var t = typeof val;
    if (t === "undefined" || val === null) {
        return val;
    }
    var entityMap = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
        "/": "&#x2F;",
        "`": "&#x60;",
        "=": "&#x3D;"
    };
    var types = function (type, val) {
        switch (type) {
            case "safestr": return types("string", val).replace(/[&<>"'`=\/]/gmi, function (s) { return entityMap[s]; });
            case "int": return (t !== "number" || val % 1 !== 0) ? parseInt(val || 0) : val;
            case "number":
            case "float": return t !== "number" ? parseFloat(val || 0) : val;
            case "any[]":
            case "array": return Array.isArray(val) ? val : [];
            case "uuid":
            case "timeId":
            case "timeIdms":
            case "string": return t !== "string" ? String(val) : val;
            case "object":
            case "obj":
            case "map": return exports.isObject(val) ? val : {};
            case "boolean":
            case "bool": return val === true;
        }
        return val;
    };
    var newVal = types(String(type || "").toLowerCase(), val);
    if (type.indexOf("[]") !== -1) {
        var arrayOf_1 = type.slice(0, type.lastIndexOf("[]"));
        return (val || []).map(function (v) {
            return exports.cast(arrayOf_1, v);
        });
    }
    else if (newVal !== undefined) {
        if (["int", "float", "number"].indexOf(type) > -1) {
            return isNaN(newVal) ? 0 : newVal;
        }
        else {
            return newVal;
        }
    }
    return undefined;
};
/**
 * Insert a value into a given array, efficiently gaurantees records are sorted on insert.
 *
 * @param {any[]} arr
 * @param {*} value
 * @param {number} [startVal]
 * @param {number} [endVal]
 * @returns {any[]}
 */
exports.sortedInsert = function (arr, value, startVal, endVal) {
    if (arr.length) {
        arr.splice(exports.binarySearch(arr, value), 0, value);
        return arr;
    }
    else {
        arr.push(value);
        return arr;
    }
};
/**
 * Given a sorted array and a value, find where that value fits into the array.
 *
 * @param {any[]} arr
 * @param {*} value
 * @param {number} [startVal]
 * @param {number} [endVal]
 * @returns {number}
 */
exports.binarySearch = function (arr, value, startVal, endVal) {
    var length = arr.length;
    var start = startVal || 0;
    var end = endVal !== undefined ? endVal : length - 1;
    if (length === 0) {
        return 0;
    }
    if (value > arr[end]) {
        return end + 1;
    }
    if (value < arr[start]) {
        return start;
    }
    if (start >= end) {
        return 0;
    }
    var m = start + Math.floor((end - start) / 2);
    if (value < arr[m]) {
        return exports.binarySearch(arr, value, start, m - 1);
    }
    if (value > arr[m]) {
        return exports.binarySearch(arr, value, m + 1, end);
    }
    return 0;
};
/**
 * Quickly removes duplicates from a sorted array.
 *
 * @param {any[]} arr
 * @returns {any[]}
 */
exports.removeDuplicates = function (arr) {
    if (!arr.length)
        return [];
    var newarr = [arr[0]];
    for (var i = 1; i < arr.length; i++) {
        if (arr[i] !== arr[i - 1])
            newarr.push(arr[i]);
    }
    return newarr;
};
/**
 * Recursively freeze a javascript object to prevent it from being modified.
 *
 * @param {*} obj
 * @returns
 */
exports.deepFreeze = function (obj) {
    Object.getOwnPropertyNames(obj || {}).forEach(function (name) {
        var prop = obj[name];
        if (typeof prop === "object" && prop !== null) {
            obj[name] = exports.deepFreeze(prop);
        }
    });
    // Freeze self (no-op if already frozen)
    return Object.freeze(obj);
};
var objectPathCache = {};
/**
 * Take an object and a string like "value.length" or "val[length]" and safely get that value in the object.
 *
 * @param {string} pathQuery
 * @param {*} object
 * @param {boolean} [ignoreFirstPath]
 * @returns {*}
 */
exports.objQuery = function (pathQuery, object, ignoreFirstPath) {
    var val;
    var safeGet = function (getPath, pathIdx, object) {
        if (!getPath[pathIdx] || !object)
            return object;
        return safeGet(getPath, pathIdx + 1, object[getPath[pathIdx]]);
    };
    var cacheKey = pathQuery + (ignoreFirstPath ? "1" : "0");
    // cached path arrays, skips the expensive regex on subsequent identical path requests.
    var path = objectPathCache[cacheKey] || [];
    if (path.length) {
        return safeGet(path, 0, object);
    }
    // need to turn path into array of strings, ie value[hey][there].length => [value, hey, there, length];
    path = pathQuery.indexOf("[") > -1 ?
        // handle complex mix of dots and brackets like "users.value[meta][value].length"
        [].concat.apply([], pathQuery.split(".").map(function (v) { return v.match(/([^\[]+)|\[([^\]]+)\]\[/gmi) || v; })).map(function (v) { return v.replace(/\[|\]/gmi, ""); }) :
        // handle simple dot paths like "users.meta.value.length"
        pathQuery.split(".");
    // handle joins where each row is defined as table.column
    if (ignoreFirstPath) {
        var firstPath = path.shift() + "." + path.shift();
        path.unshift(firstPath);
    }
    objectPathCache[cacheKey] = path;
    return safeGet(path, 0, object);
};
