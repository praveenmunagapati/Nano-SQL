var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var lie_ts_1 = require("lie-ts");
var std_query_1 = require("./query/std-query");
var transaction_1 = require("./query/transaction");
var really_small_events_1 = require("really-small-events");
var utilities_1 = require("./utilities");
var index_1 = require("./database/index");
var history_plugin_1 = require("./history-plugin");
var VERSION = 1.11;
// uglifyJS fix
var str = ["_util"];
/**
 * The primary abstraction class, there is no database implimintation code here.
 * Just events, quries and filters.
 *
 * @export
 * @class NanoSQLInstance
 */
var NanoSQLInstance = /** @class */ (function () {
    function NanoSQLInstance() {
        this.version = 1.06;
        var t = this;
        t._actions = {};
        t._views = {};
        t._models = {};
        t._events = ["*", "change", "delete", "upsert", "drop", "select", "error"];
        t._hasEvents = {};
        t._tableNames = [];
        t._plugins = [];
        t._randoms = [];
        t._queryPool = [];
        t._queryPtr = 0;
        t._randomPtr = 0;
        t.hasAnyEvents = false;
        for (var i = 0; i < 100; i++) {
            t._randoms.push(utilities_1.random16Bits().toString(16));
            t._queryPool.push(new std_query_1._NanoSQLQuery(t));
        }
        t._callbacks = {};
        t._callbacks["*"] = new really_small_events_1.ReallySmallEvents();
        t._instanceBackend = new index_1.NanoSQLDefaultBackend();
        var instanceConnectArgs = {
            models: {},
            actions: {},
            views: {},
            config: {},
            parent: this
        };
        if (t._instanceBackend.willConnect) {
            t._instanceBackend.willConnect(instanceConnectArgs, function () {
                if (t._instanceBackend.didConnect) {
                    t._instanceBackend.didConnect(instanceConnectArgs, function () {
                    });
                }
            });
        }
    }
    /**
     * nanoSQL generates 50 random 16 bit strings on every launch.
     * If you don't need true randomness you can use this function to get a psudorandom 16 bit string.
     * Performance is orders of a magnitude faster since no random number generator is needed.
     *
     * @returns {string}
     * @memberof NanoSQLInstance
     */
    NanoSQLInstance.prototype.fastRand = function () {
        this._randomPtr++;
        if (this._randomPtr >= this._randoms.length) {
            this._randomPtr = 0;
        }
        return this._randoms[this._randomPtr];
    };
    /**
     * Changes the table pointer to a new table.
     *
     * @param {string} [table]
     * @returns {NanoSQLInstance}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.table = function (table) {
        if (table)
            this.sTable = table;
        return this;
    };
    /**
     * Inits the backend database for use.
     *
     * Optionally include a custom database driver, otherwise the built in memory driver will be used.
     *
     * @param {NanoSQLBackend} [backend]
     * @returns {(Promise<Object | string>)}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.connect = function () {
        var _this = this;
        var t = this;
        return new utilities_1.Promise(function (res, rej) {
            var connectArgs = {
                models: t._models,
                actions: t._actions,
                views: t._views,
                config: t._config,
                parent: _this,
            };
            connectArgs.models[str[0]] = [
                { key: "key", type: "string", props: ["pk", "ai"] },
                { key: "value", type: "any" }
            ];
            _this._plugins = [];
            // if history is enabled, turn on the built in history plugin
            if (t._config && t._config.history) {
                _this.use(new history_plugin_1._NanoSQLHistoryPlugin(t._config.historyMode));
            }
            // If the db mode is not set to disable, add default store to the end of the plugin chain
            if (!t._config || t._config.mode !== false) {
                _this.use(new index_1.NanoSQLDefaultBackend());
            }
            utilities_1.fastCHAIN(_this._plugins, function (p, i, nextP) {
                if (p.willConnect) {
                    p.willConnect(connectArgs, function (newArgs) {
                        connectArgs = newArgs;
                        nextP();
                    });
                }
                else {
                    nextP();
                }
            }).then(function () {
                _this._models = connectArgs.models;
                _this._actions = connectArgs.actions;
                _this._views = connectArgs.views;
                _this._config = connectArgs.config;
                _this._plugins.forEach(function (plugin) {
                    if (plugin.didExec) {
                        _this.pluginsDoHasExec = true;
                    }
                });
                t._tableNames = Object.keys(_this._models);
                var completeConnect = function () {
                    utilities_1.fastALL(_this._plugins, function (p, i, nextP) {
                        if (p.didConnect) {
                            p.didConnect(connectArgs, function () {
                                nextP();
                            });
                        }
                        else {
                            nextP();
                        }
                    }).then(function () {
                        res(t._tableNames);
                    });
                };
                var updateVersion = function (rebuildIDX) {
                    _this.query("upsert", { key: "version", value: _this.version }).manualExec({ table: "_util" }).then(function () {
                        if (rebuildIDX) {
                            _this.extend("rebuild_idx").then(function () {
                                completeConnect();
                            });
                        }
                        else {
                            completeConnect();
                        }
                    });
                };
                _this.query("select").where(["key", "=", "version"]).manualExec({ table: "_util" }).then(function (rows) {
                    if (!rows.length) {
                        // new database or an old one that needs indexes rebuilt
                        updateVersion(true);
                    }
                    else {
                        if (rows[0].value < VERSION) {
                            updateVersion(false);
                        }
                        else {
                            // future migration messes go here
                            completeConnect();
                        }
                    }
                });
            });
        });
    };
    /**
     * Grab a copy of the database config object.
     *
     * @returns
     * @memberof NanoSQLInstance
     */
    NanoSQLInstance.prototype.getConfig = function () {
        return utilities_1._assign(this._config || {});
    };
    /**
     * Set the action/view filter function.  Called *before* the action/view is sent to the datastore
     *
     * @param {IActionViewMod} filterFunc
     * @returns
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.avFilter = function (filterFunc) {
        this._AVMod = filterFunc;
        return this;
    };
    NanoSQLInstance.prototype.use = function (plugin) {
        return this._plugins.push(plugin), this;
    };
    /**
     * Adds an event listener to the selected database table.
     *
     * @param {("change"|"delete"|"upsert"|"drop"|"select"|"error")} actions
     * @param {Function} callBack
     * @returns {NanoSQLInstance}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.on = function (actions, callBack) {
        var t = this;
        var l = t.sTable;
        var i = t._events.length;
        var a = actions.split(" ");
        if (Array.isArray(l))
            return this;
        if (!t._callbacks[l]) {
            t._callbacks[l] = new really_small_events_1.ReallySmallEvents();
        }
        i = a.length;
        while (i--) {
            if (t._events.indexOf(a[i]) !== -1) {
                t._callbacks[l].on(a[i], callBack);
            }
        }
        return t._refreshEventChecker();
    };
    /**
     * Remove a specific event handler from being triggered anymore.
     *
     * @param {Function} callBack
     * @returns {NanoSQLInstance}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.off = function (actions, callBack) {
        var t = this;
        var a = actions.split(" ");
        var i = a.length;
        var l = t.sTable;
        if (Array.isArray(l))
            return this;
        while (i--) {
            if (t._events.indexOf(a[i]) !== -1) {
                t._callbacks[l].off(a[i], callBack);
            }
        }
        return t._refreshEventChecker();
    };
    NanoSQLInstance.prototype._refreshEventChecker = function () {
        var _this = this;
        this._hasEvents = {};
        Object.keys(this._callbacks).concat(["*"]).forEach(function (table) {
            _this._hasEvents[table] = _this._events.reduce(function (prev, cur) {
                return prev + (_this._callbacks[table] && _this._callbacks[table].eventListeners[cur] ? _this._callbacks[table].eventListeners[cur].length : 0);
            }, 0) > 0;
        });
        this.hasAnyEvents = false;
        Object.keys(this._hasEvents).forEach(function (key) {
            _this.hasAnyEvents = _this.hasAnyEvents || _this._hasEvents[key];
        });
        return this;
    };
    /**
     * Declare the data model for the current selected table.
     *
     * Please reference the DataModel interface for how to impliment this, a quick example:
     *
     * ```ts
     * .model([
     *  {key:"id",type:"int",props:["ai","pk"]} //auto incriment and primary key
     *  {key:"name",type:"string"}
     * ])
     * ```
     *
     * @param {Array<DataModel>} dataModel
     * @returns {NanoSQLInstance}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.model = function (dataModel) {
        var t = this;
        var l = t.sTable;
        if (Array.isArray(l))
            return this;
        if (!t._callbacks[l]) {
            t._callbacks[l] = new really_small_events_1.ReallySmallEvents();
        }
        t._models[l] = dataModel;
        // t._tableNames.push(l);
        t._views[l] = [];
        t._actions[l] = [];
        return t;
    };
    /**
     * Declare the views for the current selected table.  Must be called before connect()
     *
     * Views are created like this:
     *
     * ```ts
     * .views([
     *  {
     *      name:"view-name",
     *      args: ["array","of","arguments"],
     *      call: function(args) {
     *          // Because of our "args" array the args input of this function will look like this:
     *          // NanoSQL will not let any other arguments into this function.
     *          args:{
     *              array:'',
     *              of:'',
     *              arguments:''
     *          }
     *          //We can use them in our query
     *          return this.query('select').where(['name','IN',args.array]).exec();
     *      }
     *  }
     * ])
     * ```
     *
     * Then later in your app..
     *
     * ```ts
     * NanoSQL("users").getView("view-name",{array:'',of:"",arguments:""}).then(function(result) {
     *  console.log(result) <=== result of your view will be there.
     * })
     * ```
     *
     * Optionally you can type cast the arguments at run time typescript style, just add the types after the arguments in the array.  Like this:
     *
     * ```ts
     * .views[{
     *      name:...
     *      args:["name:string","balance:float","active:bool"]
     *      call:...
     * }]
     * ```
     *
     * NanoSQL will force the arguments passed into the function to those types.
     *
     * Possible types are string, bool, float, int, map, array and bool.
     *
     * @param {Array<ActionOrView>} viewArray
     * @returns {NanoSQLInstance}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.views = function (viewArray) {
        if (Array.isArray(this.sTable))
            return this;
        return this._views[this.sTable] = viewArray, this;
    };
    /**
     * Execute a specific view.  Refernece the "views" function for more description.
     *
     * Example:
     * ```ts
     * NanoSQL("users").getView('view-name',{foo:"bar"}).then(function(result) {
     *  console.log(result) <== view result.
     * })
     * ```
     *
     * @param {string} viewName
     * @param {any} viewArgs
     * @returns {(Promise<Array<Object>>)}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.getView = function (viewName, viewArgs) {
        if (viewArgs === void 0) { viewArgs = {}; }
        if (Array.isArray(this.sTable))
            return new utilities_1.Promise(function (res, rej) { return rej(); });
        return this._doAV("View", this._views[this.sTable], viewName, viewArgs);
    };
    /**
     * Declare the actions for the current selected table.  Must be called before connect()
     *
     * Actions are created like this:
     * ```ts
     * .actions([
     *  {
     *      name:"action-name",
     *      args: ["array","of","arguments"],
     *      call: function(args) {
     *          // Because of our "args" array the args input of this function will look like this:
     *          // NanoSQL will not let any other arguments into this function.
     *          args:{
     *              array:'',
     *              of:'',
     *              arguments:''
     *          }
     *          //We can use them in our query
     *          return this.query("upsert",{balance:0}).where(['name','IN',args.array]).exec();
     *      }
     *  }
     * ])
     * ```
     *
     * Then later in your app..
     *
     * ```ts
     * NanoSQL("users").doAction("action-name",{array:'',of:"",arguments:""}).then(function(result) {
     *  console.log(result) <=== result of your view will be there.
     * })
     * ```
     *
     * Optionally you can type cast the arguments at run time typescript style, just add the types after the arguments in the array.  Like this:
     * ```ts
     * .actions[{
     *      name:...
     *      args:["name:string","balance:float","active:bool"]
     *      call:...
     * }]
     * ```
     *
     * NanoSQL will force the arguments passed into the function to those types.
     *
     * Possible types are string, bool, float, int, map, array and bool.
     *
     * @param {Array<ActionOrView>} actionArray
     * @returns {NanoSQLInstance}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.actions = function (actionArray) {
        if (Array.isArray(this.sTable))
            return this;
        return this._actions[this.sTable] = actionArray, this;
    };
    /**
     * Init an action for the current selected table. Reference the "actions" method for more info.
     *
     * Example:
     * ```ts
     * NanoSQL("users").doAction('action-name',{foo:"bar"}).then(function(result) {
     *      console.log(result) <== result of your action
     * });
     * ```
     *
     * @param {string} actionName
     * @param {any} actionArgs
     * @returns {(Promise<Array<Object>>)}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.doAction = function (actionName, actionArgs) {
        if (Array.isArray(this.sTable))
            return new utilities_1.Promise(function (res, rej) { return rej(); });
        return this._doAV("Action", this._actions[this.sTable], actionName, actionArgs);
    };
    /**
     * Adds a query filter to every request.
     *
     * @param {(args: DBExec, complete:(args: DBExec) => void) => void} callBack
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.queryFilter = function (callBack) {
        this._queryMod = callBack;
        return this;
    };
    /**
     * Internal function to fire action/views.
     *
     * @private
     * @param {("Action"|"View")} AVType
     * @param {ActionOrView[]} AVList
     * @param {string} AVName
     * @param {*} AVargs
     * @returns {(Promise<Array<DBRow>|NanoSQLInstance>)}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype._doAV = function (AVType, AVList, AVName, AVargs) {
        var _this = this;
        var t = this;
        var selAV = AVList.reduce(function (prev, cur) {
            if (cur.name === AVName)
                return cur;
            return prev;
        }, null);
        if (!selAV) {
            return new utilities_1.Promise(function (res, rej) { return rej("Action/View Not Found!"); });
        }
        t._activeAV = AVName;
        if (t._AVMod) {
            return new utilities_1.Promise(function (res, rej) {
                t._AVMod(_this.sTable, AVType, t._activeAV || "", AVargs, function (args) {
                    selAV.call(selAV.args ? utilities_1.cleanArgs(selAV.args, args) : {}, t).then(res).catch(rej);
                }, function (err) {
                    rej(err);
                });
            });
        }
        else {
            return selAV.call(selAV.args ? utilities_1.cleanArgs(selAV.args, AVargs) : {}, t);
        }
    };
    /**
     * Start a query into the current selected table.
     * Possibl querys are "select", "upsert", "delete", and "drop";
     *
     * ### Select
     *
     * Select is used to pull a set of rows or other data from the table.
     * When you use select the optional second argument of the query is an array of strings that allow you to show only specific columns.
     *
     * Examples:
     * ```ts
     * .query("select") // No arguments, select all columns
     * .query("select",['username']) // only get the username column
     * .query("select",["username","balance"]) //Get two columns, username and balance.
     * .query("select",["count(*)"]) //Get the length of records in the database
     * ```
     *
     * ### Upsert
     *
     * Upsert is used to add or modify data in the database.
     * If the primary key rows are null or undefined, the data will always be added in a new row. Otherwise, you might be updating existing rows.
     * The second argument of the query with upserts is always an Object of the data to upsert.
     *
     * Examples:
     * ```ts
     * .query("upsert",{id:1, username:"Scott"}) //If row ID 1 exists, set the username to scott, otherwise create a new row with this data.
     * .query("upsert",{username:"Scott"}) //Add a new row to the db with this username in the row.
     * .query("upsert",{balance:-35}).where(["balance","<",0]) // If you use a WHERE statement this data will be applied to the rows found with the where statement.
     * ```
     *
     * ### Delete
     *
     * Delete is used to remove data from the database.
     * It works exactly like select, except it removes data instead of selecting it.  The second argument is an array of columns to clear.  If no second argument is passed, the entire row is deleted.
     * If no where argument is passed, the entire table is dropped
     *
     * Examples:
     * ```ts
     * .query("delete",['balance']) //Clear the contents of the balance column on ALL rows.
     * .query("delete",['comments']).where(["accountType","=","spammer"]) // If a where statment is passed you'll only clear the columns of the rows selected by the where statement.
     * .query("delete").where(["balance","<",0]) // remove all rows with a balance less than zero
     * .query("delete") // Same as drop statement
     * ```
     *
     * ### Drop
     *
     * Drop is used to completely clear the contents of a database.  There are no arguments.
     *
     * Drop Examples:
     * ```ts
     * .query("drop")
     * ```
     *
     * @param {("select"|"upsert"|"delete"|"drop")} action
     * @param {any} [args]
     * @returns {NanoSQLInstance}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.query = function (action, args) {
        var t = this;
        t._queryPtr++;
        if (t._queryPtr > t._queryPool.length - 1) {
            t._queryPtr = 0;
        }
        var av = t._activeAV;
        t._activeAV = undefined;
        return t._queryPool[t._queryPtr].set(t.sTable, action.toLowerCase(), args, av);
    };
    /**
     * Trigger a database event
     *
     * @param {DatabaseEvent} eventData
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.triggerEvent = function (eventData) {
        var t = this;
        if (t._hasEvents["*"] || t._hasEvents[eventData.table]) {
            lie_ts_1.setFast(function () {
                var c;
                eventData.types.forEach(function (type) {
                    // trigger wildcard
                    t._callbacks["*"].trigger(type, eventData, t);
                    t._callbacks["*"].trigger("*", eventData, t);
                    // trigger specific table
                    if (eventData.table && t._callbacks[eventData.table]) {
                        t._callbacks[eventData.table].trigger(type, eventData, t);
                    }
                });
            });
        }
        return t;
    };
    /**
     * Returns a default object for the current table's data model, useful for forms.
     *
     * The optional argument lets you pass in an object to over write the data model's defaults as desired.
     *
     * Examples:
     *
     * ```ts
     * console.log(NanoSQL("users").default()) <= {username:"none", id:undefined, age: 0}
     * console.log(NanoSQL("users").default({username:"defalt"})) <= {username:"default", id:undefined, age: 0}
     * ```
     *
     * DO NOT use this inside upsert commands like `.query("upsert",NanoSQL("users").defalt({userObj}))..`.
     * The database defaults are already applied through the upsert path, you'll be doing double work.
     *
     * Only use this to pull default values into a form in your UI or similar situation.
     *
     * @param {*} [replaceObj]
     * @returns {{[key: string]: any}}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.default = function (replaceObj) {
        var newObj = {};
        var t = this;
        if (Array.isArray(t.sTable))
            return {};
        t._models[t.sTable].forEach(function (m) {
            // set key to object argument or the default value in the data model
            newObj[m.key] = (replaceObj && replaceObj[m.key]) ? replaceObj[m.key] : m.default;
            // Generate default value from type, eg int = 0, string = ""
            if (newObj[m.key] === undefined) {
                newObj[m.key] = utilities_1.cast(m.type, null);
            }
        });
        return newObj;
    };
    /**
     * Executes a transaction against the database, batching all the queries together.
     *
     * @param {((
     *         db: (table?: string) => {
     *             query: (action: "select"|"upsert"|"delete"|"drop"|"show tables"|"describe", args?: any) => _NanoSQLTransactionQuery;
     *             updateORM: (action: "add"|"delete"|"drop"|"set", column?: string, relationIDs?: any[]) => _NanoSQLTransactionORMQuery|undefined;
     *         }, complete: () => void) => void)} initTransaction
     * @returns {Promise<any>}
     *
     * @memberof NanoSQLInstance
     */
    NanoSQLInstance.prototype.doTransaction = function (initTransaction) {
        var _this = this;
        var t = this;
        var queries = [];
        var transactionID = utilities_1.random16Bits().toString(16);
        return new utilities_1.Promise(function (resolve, reject) {
            if (!t._plugins.length) {
                reject("Nothing to do, no plugins!");
                return;
            }
            utilities_1.fastCHAIN(t._plugins, function (p, i, nextP) {
                if (p.transactionBegin) {
                    p.transactionBegin(transactionID, nextP);
                }
                else {
                    nextP();
                }
            }).then(function () {
                if (Array.isArray(t.sTable))
                    return;
                initTransaction(function (table) {
                    var ta = table || t.sTable;
                    return {
                        query: function (action, args) {
                            return new transaction_1._NanoSQLTransactionQuery(action, args, ta, queries, transactionID);
                        }
                    };
                }, function () {
                    var tables = [];
                    utilities_1.fastCHAIN(queries, function (quer, i, nextQuery) {
                        tables.push(quer.table);
                        t.query(quer.action, quer.actionArgs).manualExec(__assign({}, quer, { table: quer.table, transaction: true, queryID: transactionID })).then(nextQuery);
                    }).then(function (results) {
                        utilities_1.fastCHAIN(_this._plugins, function (p, i, nextP) {
                            if (p.transactionEnd) {
                                p.transactionEnd(transactionID, nextP);
                            }
                            else {
                                nextP();
                            }
                        }).then(function () {
                            tables.filter(function (val, idx, self) {
                                return self.indexOf(val) === idx;
                            }).forEach(function (table) {
                                if (table.indexOf("_") !== 0) {
                                    t.triggerEvent({
                                        query: queries[0],
                                        table: table,
                                        time: new Date().getTime(),
                                        result: results,
                                        types: ["transaction"],
                                        actionOrView: "",
                                        notes: [],
                                        transactionID: transactionID,
                                        affectedRowPKS: [],
                                        affectedRows: []
                                    });
                                }
                            });
                            resolve(results);
                        });
                    });
                });
            });
        });
    };
    /**
     * Configure the database driver, must be called before the connect() method.
     *
     * @param {any} args
     * @returns {NanoSQLInstance}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.config = function (args) {
        this._config = args;
        return this;
    };
    /**
     * Perform a custom action supported by the database driver.
     *
     * @param {...Array<any>} args
     * @returns {*}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.extend = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var t = this;
        return new utilities_1.Promise(function (res, rej) {
            if (t._plugins.length) {
                var newArgs_1 = utilities_1._assign(args);
                var result_1 = [];
                utilities_1.fastCHAIN(t._plugins, function (p, i, nextP) {
                    if (p.extend) {
                        p.extend(function (nArgs, newResult) {
                            newArgs_1 = nArgs;
                            result_1 = newResult;
                            nextP();
                        }, newArgs_1, result_1);
                    }
                    else {
                        nextP();
                    }
                }).then(function () {
                    res(result_1);
                });
            }
            else {
                rej("No plugins!");
            }
        });
    };
    /**
     * Load JSON directly into the DB.
     * JSON must be an array of maps, like this:
     * ```ts
     * [
     *  {"name":"billy","age":20},
     *  {"name":"johnny":"age":30}
     * ]
     * ```
     *
     * Rows must align with the data model.  Row data that isn't in the data model will be ignored.
     *
     * @param {string} table
     * @param {Array<Object>} rows
     * @returns {Promise<Array<Object>>}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.loadJS = function (table, rows, useTransaction) {
        if (useTransaction === void 0) { useTransaction = true; }
        var t = this;
        if (useTransaction) {
            return t.doTransaction(function (db, complete) {
                rows.forEach(function (row) {
                    db(table).query("upsert", row).exec();
                });
                complete();
            });
        }
        else {
            return new utilities_1.Promise(function (res, rej) {
                utilities_1.fastCHAIN(rows, function (row, i, nextRow) {
                    exports.nSQL().query("upsert", row).manualExec({ table: table }).then(nextRow);
                }).then(function (rows) {
                    res(rows.map(function (r) { return r.shift(); }));
                });
            });
        }
    };
    /**
     * Load a CSV file into the DB.  Headers must exist and will be used to identify what columns to attach the data to.
     *
     * This function performs a bunch of upserts, so expect appropriate behavior based on the primary key.
     *
     * Rows must align with the data model.  Row data that isn't in the data model will be ignored.
     *
     * @param {string} csv
     * @returns {(Promise<Array<Object>>)}
     *
     * @memberOf NanoSQLInstance
     */
    NanoSQLInstance.prototype.loadCSV = function (table, csv, useTransaction) {
        if (useTransaction === void 0) { useTransaction = true; }
        var t = this;
        var fields = [];
        var rowData = csv.split("\n").map(function (v, k) {
            if (k === 0) {
                fields = v.split(",");
                return undefined;
            }
            else {
                var record = {};
                var row = v.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
                var i = fields.length;
                while (i--) {
                    if (row[i].indexOf("{") === 1 || row[i].indexOf("[") === 1) {
                        // tslint:disable-next-line
                        row[i] = JSON.parse(row[i].slice(1, row[i].length - 1).replace(/'/gm, '\"'));
                        // tslint:disable-next-line
                    }
                    else if (row[i].indexOf('"') === 0) {
                        row[i] = row[i].slice(1, row[i].length - 1);
                    }
                    record[fields[i]] = row[i];
                }
                return record;
            }
        }).filter(function (r) { return r; });
        if (useTransaction) {
            return t.doTransaction(function (db, complete) {
                rowData.forEach(function (row) {
                    db(table).query("upsert", row).exec();
                });
                complete();
            });
        }
        else {
            return new utilities_1.Promise(function (res, rej) {
                utilities_1.fastCHAIN(rowData, function (row, i, nextRow) {
                    exports.nSQL().query("upsert", row).manualExec({ table: table }).then(nextRow);
                }).then(function (rows) {
                    res(rows.map(function (r) { return r.shift(); }));
                });
            });
        }
    };
    return NanoSQLInstance;
}());
exports.NanoSQLInstance = NanoSQLInstance;
NanoSQLInstance.functions = {
    COUNT: {
        type: "A",
        call: function (rows, complete, column) {
            if (column && column !== "*") {
                complete(rows.filter(function (r) { return utilities_1.objQuery(column, r); }).length);
            }
            else {
                complete(rows.length);
            }
        }
    },
    MAX: {
        type: "A",
        call: function (rows, complete, column) {
            if (rows.length) {
                var max_1 = utilities_1.objQuery(column, rows[0]) || 0;
                rows.forEach(function (r) {
                    var v = utilities_1.objQuery(column, r);
                    if (utilities_1.objQuery(column, r) > max_1) {
                        max_1 = utilities_1.objQuery(column, r);
                    }
                });
                complete(max_1);
            }
            else {
                complete(0);
            }
        }
    },
    MIN: {
        type: "A",
        call: function (rows, complete, column) {
            if (rows.length) {
                var min_1 = utilities_1.objQuery(column, rows[0]) || 0;
                rows.forEach(function (r) {
                    var v = utilities_1.objQuery(column, r);
                    if (v < min_1) {
                        min_1 = v;
                    }
                });
                complete(min_1);
            }
            else {
                complete(0);
            }
        }
    },
    AVG: {
        type: "A",
        call: function (rows, complete, column) {
            complete(rows.reduce(function (prev, cur) { return prev + (utilities_1.objQuery(column, cur) || 0); }, 0) / rows.length);
        }
    },
    SUM: {
        type: "A",
        call: function (rows, complete, column) {
            complete(rows.reduce(function (prev, cur) { return prev + (utilities_1.objQuery(column, cur) || 0); }, 0));
        }
    },
    LOWER: {
        type: "S",
        call: function (rows, complete, column) {
            complete(rows.map(function (r) {
                return String(utilities_1.objQuery(column, r)).toLowerCase();
            }));
        }
    },
    UPPER: {
        type: "S",
        call: function (rows, complete, column) {
            complete(rows.map(function (r) {
                return String(utilities_1.objQuery(column, r)).toUpperCase();
            }));
        }
    },
    CAST: {
        type: "S",
        call: function (rows, complete, column, type) {
            complete(rows.map(function (r) {
                return utilities_1.cast(type, utilities_1.objQuery(column, r));
            }));
        }
    },
    ABS: {
        type: "S",
        call: function (rows, complete, column) {
            complete(rows.map(function (r) {
                return Math.abs(utilities_1.objQuery(column, r));
            }));
        }
    },
    CEIL: {
        type: "S",
        call: function (rows, complete, column) {
            complete(rows.map(function (r) {
                return Math.ceil(utilities_1.objQuery(column, r));
            }));
        }
    },
    POW: {
        type: "S",
        call: function (rows, complete, column, power) {
            complete(rows.map(function (r) {
                return Math.pow(utilities_1.objQuery(column, r), parseInt(power));
            }));
        }
    },
    ROUND: {
        type: "S",
        call: function (rows, complete, column) {
            complete(rows.map(function (r) {
                return Math.round(utilities_1.objQuery(column, r));
            }));
        }
    },
    SQRT: {
        type: "S",
        call: function (rows, complete, column) {
            complete(rows.map(function (r) {
                return Math.sqrt(utilities_1.objQuery(column, r));
            }));
        }
    }
};
/**
 * @internal
 */
var _NanoSQLStatic = new NanoSQLInstance();
exports.nSQL = function (setTablePointer) {
    return _NanoSQLStatic.table(setTablePointer);
};
