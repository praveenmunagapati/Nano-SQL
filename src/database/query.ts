import { IdbQuery } from "../query/std-query";
import { NanoSQLPlugin, DBConnect, DataModel, NanoSQLFunction, NanoSQLInstance, ORMArgs, nSQL } from "../index";
import { _NanoSQLStorage, DBRow } from "./storage";
import { fastALL, _assign, hash, deepFreeze, objQuery, uuid, fastCHAIN } from "../utilities";


const queryObj = {
    select: (self: _NanoSQLStorageQuery, next) => {
        self._select(next);
    },
    upsert: (self: _NanoSQLStorageQuery, next) => {
        self._upsert(next);
    },
    delete: (self: _NanoSQLStorageQuery, next) => {
        self._delete(next);
    },
    drop: (self: _NanoSQLStorageQuery, next) => {
        self._drop(next);
    },
    "show tables": (self: _NanoSQLStorageQuery, next) => {
        self._query.result = Object.keys(self._store.tableInfo) as any[];
        next(self._query);
    },
    describe: (self: _NanoSQLStorageQuery, next) => {
        if (typeof self._query.table !== "string") {
            next(self._query);
            return;
        }
        self._query.result = _assign(self._store.models[self._query.table]);
        next(self._query);
    },
};

/**
 * A new Storage Query class is inilitized for every query, performing the actions
 * against the storage class itself to get the desired outcome.
 *
 * @export
 * @class _NanoSQLStorageQuery
 */
// tslint:disable-next-line
export class _NanoSQLStorageQuery {

    /**
     * The Query object used for this query.
     *
     * @internal
     * @type {IdbQuery}
     * @memberof _NanoSQLStorageQuery
     */
    public _query: IdbQuery;

    /**
     * Wether an instance table is being used or not.
     *
     * @internal
     * @type {boolean}
     * @memberof _NanoSQLStorageQuery
     */
    private _isInstanceTable: boolean;

    constructor(
        public _store: _NanoSQLStorage
    ) {

    }

    /**
     * Execute the query against this class.
     *
     * @param {IdbQuery} query
     * @param {(q: IdbQuery) => void} next
     * @returns
     * @memberof _NanoSQLStorageQuery
     */
    public doQuery(query: IdbQuery, next: (q: IdbQuery) => void) {

        this._query = query;
        this._isInstanceTable = Array.isArray(query.table);

        queryObj[query.action](this, next);
    }

    /**
     * Retreive the selected rows for this query, works for instance tables and standard ones.
     *
     * @internal
     * @param {(rows: DBRow[]) => void} complete
     * @memberof _NanoSQLStorageQuery
     */
    private _getRows(complete: (rows: DBRow[]) => void) {
        if (this._isInstanceTable) {
            new InstanceSelection(this._query).getRows(complete);
        } else {
            new _RowSelection(this._query, this._store).getRows((rows) => {
                complete(rows.filter(r => r));
            });
        }
    }

    private _hash: string;

    private _invalidateCache(pks: any[]): void {
        if (!this._store._doCache) {
            return;
        }
        Object.keys(this._store._cacheKeys[this._query.table as any]).forEach((hash) => {
            let i = pks.length;
            let valid = true;
            while (i-- && valid) {
                if (this._store._cacheKeys[this._query.table as any][hash][pks[i]]) {
                    delete this._store._cache[this._query.table as any][hash];
                    delete this._store._cacheKeys[this._query.table as any][hash];
                    valid = false;
                }
            }
        });
    }

    private _setCache(rows: any[]) {
        this._store._cache[this._query.table as any][this._hash] = rows;

        // store primary keys for this cache, used for cache invalidation
        this._store._cacheKeys[this._query.table as any][this._hash] = {};
        rows.forEach((r) => {
            this._store._cacheKeys[this._query.table as any][this._hash][r[this._store.tableInfo[this._query.table as any]._pk]] = true;
        });
    }

    /**
     * Initilze a SELECT query.
     *
     * @internal
     * @param {(q: IdbQuery) => void} next
     * @returns
     * @memberof _NanoSQLStorageQuery
     */
    public _select(next: (q: IdbQuery) => void) {

        this._hash = hash(JSON.stringify({
            ...this._query,
            queryID: null
        }));

        const canCache = !this._query.join && !this._query.orm && this._store._doCache && !Array.isArray(this._query.table);

        // Query cache for the win!
        if (canCache && this._store._cache[this._query.table as any][this._hash]) {
            this._query.result = this._store._cache[this._query.table as any][this._hash];
            next(this._query);
            return;
        }

        this._getRows((rows) => {

            // No query arguments, we can skip the whole mutation selection class
            if (!["having", "orderBy", "offset", "limit", "actionArgs", "groupBy", "orm", "join"].filter(k => this._query[k]).length) {
                if (canCache) this._setCache(rows);
                this._query.result = rows;
                next(this._query);
            } else {
                new _MutateSelection(this._query, this._store)._executeQueryArguments(rows, (resultRows) => {
                    if (canCache) this._setCache(rows);
                    this._query.result = resultRows;
                    next(this._query);
                });
            }

        });
    }

    private _updateORMRows(relation: {
        _thisColumn: string;
        _thisType: "array" | "single";
        _fromTable: string;
        _fromColumn: string;
        _fromType: "array" | "single";
    }, fromPKs: any[], add: boolean, primaryKey: any, complete: () => void) {


        const fromPk = this._store.tableInfo[relation._fromTable]._pk;

        this._store._read(relation._fromTable, fromPKs as any, (rows) => {
            fastALL(rows, (row, i, rowDone) => {
                let newRow = Object.isFrozen(row) ? _assign(row) : row;

                if (relation._fromType === "array") {
                    newRow[relation._fromColumn] = newRow[relation._fromColumn] || [];
                    const idxOf = newRow[relation._fromColumn].indexOf(primaryKey);
                    if (add) { // add
                        if (idxOf === -1) {
                            newRow[relation._fromColumn].push(primaryKey);
                        } else {
                            rowDone();
                        }
                    } else { // remove
                        if (idxOf !== -1) {
                            newRow[relation._fromColumn].splice(idxOf, 1);
                        } else {
                            rowDone();
                        }
                    }
                    newRow[relation._fromColumn].sort();
                } else {
                    if (add) { // add
                        newRow[relation._fromColumn] = primaryKey;
                    } else { // remove
                        newRow[relation._fromColumn] = null;
                    }
                }
                this._store._nsql.query("upsert", newRow).comment("ORM Update").manualExec({ table: relation._fromTable }).then(rowDone);
            }).then(complete);
        });
    }

    private _syncORM(type: "del" | "add", oldRows: DBRow[], newRows: DBRow[], complete: () => void) {

        if (!this._store._hasORM) {
            complete();
            return;
        }

        const useRelations = this._store._relToTable[this._query.table as string];

        if (this._query.comments.indexOf("ORM Update") !== -1) {
            complete();
            return;
        }

        if (!useRelations || !useRelations.length) {
            complete();
            return;
        }

        // go over every relation and every changed row to make the needed updates.
        let cnt = Math.max(oldRows.length, newRows.length);
        let arra: any[] = [];
        while (cnt--) arra.push(" ");
        fastCHAIN(arra, (v, idx, rowDone) => {
            fastALL(useRelations, (relation, k, relationDone) => {


                const equals = (val1, val2) => {
                    if (Array.isArray(val1) && Array.isArray(val2)) {
                        if (val1.length !== val2.length) {
                            return false;
                        }
                        return val1.filter((v, i) => v !== val2[i]).length > 0;
                    } else {
                        return val1 === val2;
                    }
                };

                switch (type) {
                    case "del":
                        const delPrimarykey = oldRows[idx][this._store.tableInfo[this._query.table as any]._pk];
                        const updateIDs = relation._thisType === "array" ? (oldRows[idx][relation._thisColumn] || []) : ([oldRows[idx][relation._thisColumn]].filter(v => v));
                        this._updateORMRows(relation, updateIDs, false, delPrimarykey, relationDone);
                        break;
                    case "add":
                        const primaryKey = newRows[idx][this._store.tableInfo[this._query.table as any]._pk];

                        // possibly update existing relation
                        // if adding oldRows[idx] is possibly undefined (if theres no previouse row record)
                        if (oldRows[idx]) {
                            // previouse record exists
                            if (equals(oldRows[idx][relation._thisColumn], newRows[idx][relation._thisColumn])) {
                                // no update needed
                                relationDone();
                            } else {
                                if (relation._thisType === "array") {
                                    const addIds = (newRows[idx][relation._thisColumn] || []).filter(v => (oldRows[idx][relation._thisColumn] || []).indexOf(v) === -1);
                                    const removeIds = (oldRows[idx][relation._thisColumn] || []).filter(v => (newRows[idx][relation._thisColumn] || []).indexOf(v) === -1);
                                    fastALL([addIds, removeIds], (list, i, done) => {
                                        this._updateORMRows(relation, list, i === 0, primaryKey, done);
                                    }).then(relationDone);

                                } else {

                                    const addRelation = () => {
                                        // add new relation
                                        if (newRows[idx][relation._thisColumn] !== null && newRows[idx][relation._thisColumn] !== undefined) {
                                            this._updateORMRows(relation, [newRows[idx][relation._thisColumn]], true, primaryKey, relationDone);
                                        } else {
                                            // no new relation
                                            relationDone();
                                        }
                                    };

                                    // remove old connection
                                    if (oldRows[idx][relation._thisColumn] !== null && oldRows[idx][relation._thisColumn] !== undefined) {
                                        this._updateORMRows(relation, [oldRows[idx][relation._thisColumn]], false, primaryKey, addRelation);
                                    } else {
                                        // no old connection, just add the new one
                                        addRelation();
                                    }

                                }
                            }
                        } else { // new relation
                            const valuesToAdd = relation._thisType === "array" ? (newRows[idx][relation._thisColumn] || []) : ([newRows[idx][relation._thisColumn]].filter(v => v));
                            if (valuesToAdd && valuesToAdd.length) {
                                this._updateORMRows(relation, valuesToAdd, true, primaryKey, relationDone);
                            } else {
                                relationDone();
                            }
                        }
                        break;
                }
            }).then(rowDone);
        }).then(complete);
    }

    /**
     * Initilize an UPSERT query.
     *
     * @internal
     * @param {(q: IdbQuery) => void} next
     * @returns
     * @memberof _NanoSQLStorageQuery
     */
    public _upsert(next: (q: IdbQuery) => void) {

        const pk = this._store.tableInfo[this._query.table as any]._pk;

        if (this._isInstanceTable) {
            this._getRows((rows) => {
                this._query.result = (this._query.table as any[]).map((r) => {
                    if (rows.indexOf(r) === -1) {
                        return r;
                    }
                    return {
                        ...this._query.actionArgs,
                        ...r
                    };
                });
                next(this._query);
            });
            return;
        }

        if (this._query.where) { // has where statement, select rows then modify them

            this._getRows((rows) => {

                if (rows.length) {
                    fastCHAIN(rows, (r, i, rowDone) => {
                        this._store._write(this._query.table as any, r[pk], r, this._query.actionArgs || {}, rowDone);
                    }).then((newRows: DBRow[]) => {
                        // any changes to this table invalidates the cache
                        const pks = newRows.map(r => r[pk]);
                        this._invalidateCache(pks);

                        this._query.result = [{ msg: newRows.length + " row(s) modfied.", affectedRowPKS: pks, affectedRows: newRows }];
                        this._syncORM("add", rows, newRows, () => {
                            next(this._query);
                        });
                    });
                } else {
                    this._query.result = [{ msg: "0 row(s) modfied.", affectedRowPKS: [], affectedRows: [] }];
                    next(this._query);
                }
            });

        } else { // no where statement, perform direct upsert

            let row = this._query.actionArgs || {};
            this._store._cache[this._query.table as any] = {};
            const write = (oldRow: any) => {
                this._store._write(this._query.table as any, row[pk], oldRow, row, (result) => {
                    this._query.result = [{ msg: "1 row inserted.", affectedRowPKS: [result[pk]], affectedRows: [result] }];
                    if (this._store._hasORM) {
                        this._syncORM("add", [oldRow].filter(r => r), [result], () => {
                            next(this._query);
                        });
                    } else {
                        next(this._query);
                    }
                });
            };

            if (row[pk] !== undefined) {
                this._store._read(this._query.table as any, [row[pk]] as any, (rows) => {
                    if (rows.length) {
                        write(rows[0]);
                    } else {
                        write(null);
                    }
                });
            } else {
                write(null);
            }


        }
    }

    /**
     * Initilize a DELETE query.
     *
     * @internal
     * @param {(q: IdbQuery) => void} next
     * @returns
     * @memberof _NanoSQLStorageQuery
     */
    public _delete(next: (q: IdbQuery) => void) {

        if (this._isInstanceTable) {
            if (this._query.where) {
                this._getRows((rows) => {
                    this._query.result = (this._query.table as any[]).filter((row) => {
                        return rows.indexOf(row) === -1;
                    });
                    next(this._query);
                });
            } else {
                this._query.result = [];
                next(this._query);
            }
            return;
        }

        if (this._query.where) { // has where statement, select rows then delete them

            this._getRows((rows) => {

                rows = rows.filter(r => r);
                if (rows.length) {
                    fastALL(rows, (r, i, done) => {
                        this._store._delete(this._query.table as any, r[this._store.tableInfo[this._query.table as any]._pk], done);
                    }).then((affectedRows) => {
                        // any changes to this table invalidate the cache
                        this._store._cache[this._query.table as any] = {};
                        const pks = rows.map(r => r[this._store.tableInfo[this._query.table as any]._pk]);
                        this._invalidateCache(pks);

                        this._query.result = [{ msg: rows.length + " row(s) deleted.", affectedRowPKS: pks, affectedRows: rows }];
                        this._syncORM("del", rows, [], () => {
                            next(this._query);
                        });
                    });
                } else {
                    this._query.result = [{ msg: "0 row(s) deleted.", affectedRowPKS: [], affectedRows: [] }];
                    next(this._query);
                }
            });

        } else { // no where statement, perform drop
            this._drop(next);
        }
    }

    /**
     * Initilize a DROP query.
     *
     * @internal
     * @param {(q: IdbQuery) => void} next
     * @returns
     * @memberof _NanoSQLStorageQuery
     */
    public _drop(next: (q: IdbQuery) => void) {
        if (this._isInstanceTable) {
            this._query.result = [];
            next(this._query);
            return;
        }

        this._store._rangeReadIDX(this._query.table as string, undefined as any, undefined as any, (rows) => {
            this._store._cache[this._query.table as any] = {};
            this._store._cacheKeys[this._query.table as any] = {};

            this._store._drop(this._query.table as any, () => {
                this._query.result = [{ msg: "'" + this._query.table as any + "' table dropped.", affectedRowPKS: rows.map(r => r[this._store.tableInfo[this._query.table as any]._pk]), affectedRows: rows }];
                this._syncORM("del", rows, [], () => {
                    next(this._query);
                });
            });
        });

    }
}

/**
 * Takes a selection of rows and applys modifiers like orderBy, join and others to the rows.
 * Returns the affected rows updated in the way the query specified.
 *
 * @export
 * @class MutateSelection
 */
// tslint:disable-next-line
export class _MutateSelection {

    /**
     * Keep track of the columns to Group By
     *
     * @internal
     * @type {string[]}
     * @memberof _MutateSelection
     */
    private _groupByColumns: string[];


    /**
     * Keep track of the GroupBy Keys for applying functions.
     *
     * @internal
     * @type {{
     *         [groupKey: string]: any[];
     *     }}
     * @memberof _MutateSelection
     */
    private _sortGroups: {
        [groupKey: string]: any[];
    };

    constructor(
        public q: IdbQuery,
        public s: _NanoSQLStorage
    ) {
        this._groupByColumns = [];
    }

    /**
     * Peform a join command.
     *
     * @internal
     * @param {DBRow[]} rows
     * @param {(rows: DBRow[]) => void} complete
     * @returns {void}
     * @memberof _MutateSelection
     */
    private _join(rows: DBRow[], complete: (rows: DBRow[]) => void): void {
        if (!this.q.join) {
            return;
        }

        let joinConditions = {};
        if (this.q.join.type !== "cross" && this.q.join.where) {
            joinConditions = {
                _left: this.q.join.where[0],
                _check: this.q.join.where[1],
                _right: this.q.join.where[2]
            };
        }

        const leftTable = this.q.table as any;

        const rightTable = this.q.join.table;

        this._doJoin(this.q.join.type, leftTable as any, rightTable, joinConditions as any, (joinedRows) => {
            if (this.q.where) { // apply where statement to join
                complete(joinedRows.filter((row: any, idx) => {
                    return Array.isArray(this.q.where) ? _where(row, this.q.where || [], idx, true) : (this.q.where as any)(row, idx);
                }));
            } else if (this.q.range) { // apply range statement to join
                complete(joinedRows.filter((row: any, idx) => {
                    return this.q.range && this.q.range[0] >= idx && this.q.range[1] <= idx;
                }));
            } else { // send the whole result
                complete(joinedRows);
            }
        });
    }

    /**
     * Generate a unique group by key given a group by object and a row.
     *
     * @internal
     * @param {string[]} columns
     * @param {*} row
     * @returns {string}
     * @memberof _MutateSelection
     */
    private _groupByKey(columns: string[], row: any): string {
        return columns.reduce((p, c) => {
            // handle ".length"
            if (c.indexOf(".length") !== -1) {
                return p + "." + String((row[c.replace(".length", "")] || []).length);
            } else {
                return p + "." + String(row[c]);
            }
        }, "").slice(1);
    }

    /**
     * Perform the Group By mutation.
     *
     * @internal
     * @param {DBRow[]} rows
     * @returns {any[]}
     * @memberof _MutateSelection
     */
    private _groupBy(rows: DBRow[]): any[] {
        const columns = this.q.groupBy || {};

        const sortedRows = rows.sort((a: any, b: any) => {
            return this._sortObj(a, b, columns, true);
        });

        sortedRows.forEach((val, idx) => {
            const groupByKey = Object.keys(columns).map(k => String(val[k]) || "").join(".");
            if (!this._sortGroups) {
                this._sortGroups = {};
            }
            if (!this._sortGroups[groupByKey]) {
                this._sortGroups[groupByKey] = [];
            }
            this._sortGroups[groupByKey].push(idx);
        });

        return sortedRows;
    }

    /**
     * Perform HAVING mutation.
     *
     * @internal
     * @param {DBRow[]} rows
     * @returns {any[]}
     * @memberof _MutateSelection
     */
    private _having(rows: DBRow[]): any[] {
        return rows.filter((row: any, idx) => {
            return Array.isArray(this.q.having) ? _where(row, this.q.having || [], idx, true) : (this.q.having as any)(row, idx);
        });
    }

    /**
     * Perform the orderBy mutation.
     *
     * @internal
     * @param {DBRow[]} rows
     * @returns {any[]}
     * @memberof _MutateSelection
     */
    private _orderBy(rows: DBRow[]): any[] {
        return rows.sort((a: any, b: any) => {
            return this._sortObj(a, b, this.q.orderBy || {}, false);
        });
    }

    /**
     * Perform the Offset mutation.
     *
     * @internal
     * @param {DBRow[]} rows
     * @returns {any[]}
     * @memberof _MutateSelection
     */
    private _offset(rows: DBRow[]): any[] {
        return rows.filter((row: any, index: number) => {
            return this.q.offset ? index >= this.q.offset : true;
        });
    }

    /**
     * Perform the limit mutation.
     *
     * @internal
     * @param {DBRow[]} rows
     * @returns {any[]}
     * @memberof _MutateSelection
     */
    private _limit(rows: DBRow[]): any[] {
        return rows.filter((row: any, index: number) => {
            return this.q.limit ? index < this.q.limit : true;
        });
    }

    /**
     * Add ORM values to rows based on query.
     *
     * @internal
     * @param {DBRow[]} rows
     * @param {(rows: DBRow[]) => void} complete
     * @memberof _MutateSelection
     */
    private _orm(rows: DBRow[], complete: (rows: DBRow[]) => void): void {
        const ormQueries: ORMArgs[] = this.q.orm ? this.q.orm.map((o) => {
            if (typeof o === "string") {
                return {
                    key: o,
                    limit: 5
                };
            }
            return o as ORMArgs;
        }) : [];

        fastALL(rows, (row, i, rowResult) => {
            row = Object.isFrozen(row) ? _assign(row) : row;

            fastALL(ormQueries, (orm, k, ormResult) => {

                if (!row[orm.key] || !row[orm.key].length) {
                    ormResult();
                    return;
                }
                const relateData = this.s._columnsAreTables[this.q.table as string][orm.key];

                if (relateData) {
                    this.s._nsql.query("select").where([this.s.tableInfo[relateData._toTable]._pk, relateData._thisType === "array" ? "IN" : "=", row[orm.key]]).manualExec({ table: relateData._toTable }).then((rows) => {
                        const q = nSQL().query("select", orm.select);
                        if (orm.where) {
                            q.where(orm.where);
                        }
                        if (orm.limit !== undefined) {
                            q.limit(orm.limit);
                        }
                        if (orm.offset !== undefined) {
                            q.offset(orm.offset);
                        }
                        if (orm.orderBy) {
                            q.orderBy(orm.orderBy);
                        }
                        q.manualExec({ table: rows }).then((result) => {
                            if (!rows.filter(r => r).length) {
                                row[orm.key] = relateData._thisType === "array" ? [] : undefined;
                            } else {
                                row[orm.key] = relateData._thisType === "array" ? result.reverse() : result[0];
                            }
                            ormResult();
                        });
                    });
                } else {
                    ormResult();
                }
            }).then(() => {
                rowResult(row);
            });
        }).then(complete);

    }

    /**
     * Performs the actual JOIN mutation, including the O^2 select query to check all rows against every other row.
     *
     * @internal
     * @param {("left" | "inner" | "right" | "cross" | "outer")} type
     * @param {string} leftTable
     * @param {string} rightTable
     * @param {(null | { _left: string, _check: string, _right: string })} joinConditions
     * @param {(rows: DBRow[]) => void} complete
     * @memberof _MutateSelection
     */
    private _doJoin(type: "left" | "inner" | "right" | "cross" | "outer", leftTable: string, rightTable: string, joinConditions: null | { _left: string, _check: string, _right: string }, complete: (rows: DBRow[]) => void): void {
        const L = "left";
        const R = "right";
        const O = "outer";
        const C = "cross";
        let t = this;

        const firstTableData = t.s.tableInfo[type === R ? rightTable : leftTable];
        const seconTableData = t.s.tableInfo[type === R ? leftTable : rightTable];

        const doJoinRows = (leftRow: any, rightRow: any) => {
            return [firstTableData, seconTableData].reduce((prev, cur, i) => {
                cur._keys.forEach((k) => {
                    prev[cur._name + "." + k] = ((i === 0 ? leftRow : rightRow) || {})[k];
                });
                return prev;
            }, {});
        };

        let joinTable: any[] = [];

        const rightKey: string = joinConditions && joinConditions._right ? joinConditions._right.split(".").pop() || "" : "";
        const usedSecondTableRows: any = {};
        let secondRowCache: any[] = [];

        // O^2, YAY!
        t.s._read(firstTableData._name, (firstRow, idx, keep) => {
            let hasOneRelation = false;
            t.s._read(seconTableData._name, (secondRow, idx2, keep2) => {

                if (!joinConditions || type === C) { // no conditional to check OR cross join, always add
                    joinTable.push(doJoinRows(firstRow, secondRow));
                    hasOneRelation = true;
                } else { // check conditional statement to possibly join
                    const willJoinRows = _where({
                        [firstTableData._name]: firstRow,
                        [seconTableData._name]: secondRow
                    }, [joinConditions._left, joinConditions._check, type === R ? firstRow[rightKey] : secondRow[rightKey]], 0);
                    if (willJoinRows) {
                        if (type === O) usedSecondTableRows[idx2] = true;
                        joinTable.push(doJoinRows(firstRow, secondRow));
                        hasOneRelation = true;
                    } else {
                        if (type === O) secondRowCache[idx2] = secondRow;
                    }
                }
                keep2(false);
            }, () => {
                // left, right or outer join will cause rows without a relation to be added anyway with null relation
                if (!hasOneRelation && [L, R, O].indexOf(type) > -1) {
                    joinTable.push(doJoinRows(firstRow, null));
                }

                keep(false);
            });

        }, () => {

            // full outer join, add the secondary rows that haven't been added yet
            if (type === O) {
                const addRows = secondRowCache.filter((val, i) => !usedSecondTableRows[i]);
                let i = 0;
                while (i < addRows.length) {
                    joinTable.push(doJoinRows(null, addRows[i]));
                    i++;
                }
                complete(joinTable);

            } else {
                complete(joinTable);
            }
        });
    }

    /**
     * Get the sort direction for two objects given the objects, columns and resolve paths.
     *
     * @internal
     * @param {*} objA
     * @param {*} objB
     * @param {{ [key: string]: string }} columns
     * @param {boolean} resolvePaths
     * @returns {number}
     * @memberof _MutateSelection
     */
    private _sortObj(objA: any, objB: any, columns: { [key: string]: string }, resolvePaths: boolean): number {
        return Object.keys(columns).reduce((prev, cur) => {
            let A = resolvePaths ? objQuery(cur, objA) : objA[cur];
            let B = resolvePaths ? objQuery(cur, objB) : objB[cur];
            if (!prev) {
                if (A === B) return 0;
                return (A > B ? 1 : -1) * (columns[cur] === "desc" ? -1 : 1);
            } else {
                return prev;
            }
        }, 0);
    }

    /**
     * Apply AS, functions and Group By
     *
     * @internal
     * @param {DBRow[]} rows
     * @param {(rows: DBRow[]) => void} complete
     * @memberof _MutateSelection
     */
    private _mutateRows(rows: DBRow[], complete: (rows: DBRow[]) => void): void {

        const columnSelection: string[] = this.q.actionArgs;

        const functionResults: {
            [column: string]: any;
        } = {};

        const fnGroupByResults: {
            [groupByKey: string]: {
                [column: string]: any;
            }
        } = {};

        if (columnSelection && columnSelection.length) {
            // possibly has functions, AS statements
            let hasAggregateFun = false;

            let columnData: {
                [columnName: string]: {
                    fn: NanoSQLFunction,
                    key: string;
                }
            } = {};

            columnSelection.forEach((column) => {
                if (column.indexOf("(") === -1) {
                    return;
                }
                const fnName: string = (column.match(/^.*\(/g) || [""])[0].replace(/\(|\)/g, "").toUpperCase();
                const fn = NanoSQLInstance.functions[fnName];
                const key = column.split(" AS ").length === 1 ? fnName : (column.split(" AS ").pop() || "").trim();
                if (!fn) {
                    throw new Error("'" + fnName + "' is not a valid function!");
                }
                if (fn.type === "A") { // agregate function
                    hasAggregateFun = true;
                }
                columnData[column] = {
                    fn: fn,
                    key: key
                };
            });

            fastALL(columnSelection, (column, j, columnDone) => {

                    if (column.indexOf("(") > -1) { // function exists

                        const fnArgs: string[] = (column.match(/\(.*\)/g) || [""])[0].replace(/\(|\)/g, "").split(",").map(v => v.trim());

                        if (this._sortGroups && hasAggregateFun) { // group by exists with aggregate function
                            fastALL(Object.keys(this._sortGroups), (k, l, fnDone) => {
                                if (!fnGroupByResults[k]) {
                                    fnGroupByResults[k] = {};
                                }
                                    columnData[column].fn.call(rows.filter((r, i) => this._sortGroups[k].indexOf(i) > -1), (result) => {
                                        fnGroupByResults[k][columnData[column].key] = result;
                                        fnDone();
                                    }, ...fnArgs);
                            }).then(columnDone);
                        } else { // no group by
                            columnData[column].fn.call(rows, (result) => {
                                functionResults[columnData[column].key] = result;
                                columnDone();
                            }, ...fnArgs);
                        }

                    } else {
                        columnDone(); // no function
                    }
            }).then(() => {

                // time to rebuild row results

                const doMuateRows = (row: DBRow, idx: number, fnResults: { [column: string]: any }): any => {
                    let newRow = {};
                    // remove unselected columns, apply AS and integrate function results
                    columnSelection.forEach((column) => {
                        const hasFunc = column.indexOf("(") > -1;
                        const type = hasFunc ? columnData[column].fn.type : "";
                        if (column.indexOf(" AS ") > -1) { // alias column data
                            const alias: string[] = column.split(" AS ");
                            const key = hasFunc ? columnData[column].key : alias[0].trim();
                            newRow[alias[1]] = hasFunc ? (type === "A" ? fnResults[key] : fnResults[key][idx]) : objQuery(key, row, this.q.join !== undefined);
                        } else {
                            const key = hasFunc ? columnData[column].key : column;
                            newRow[column] = hasFunc ? (type === "A" ? fnResults[key] : fnResults[key][idx]) : objQuery(key, row, this.q.join !== undefined);
                        }
                    });
                    return newRow;
                };

                if (this._sortGroups && hasAggregateFun) { // group by with aggregate
                    let newRows: any[] = [];
                    Object.keys(this._sortGroups).forEach((k) => {
                        let thisRow = rows.filter((r, i) => this._sortGroups[k].indexOf(i) > -1).filter((v, i) => i < 1);
                        if (thisRow && thisRow.length) {
                            newRows.push(doMuateRows(thisRow[0], 0, fnGroupByResults[k]));
                        }
                    });
                    complete(newRows);
                } else if (hasAggregateFun) { // just aggregate (returns 1 row)
                    complete(rows.filter((v, i) => i < 1).map((v, i) => doMuateRows(v, i, functionResults)));
                } else { // no aggregate and no group by, easy peasy
                    complete(rows.map((v, i) => doMuateRows(v, i, functionResults)));
                }
            });
        } else {
            // just pass through
            complete(rows);
        }
    }

    /**
     * Triggers the mutations in the order of operations.
     *
     * @param {DBRow[]} inputRows
     * @param {(rows: DBRow[]) => void} callback
     * @memberof _MutateSelection
     */
    public _executeQueryArguments(inputRows: DBRow[], callback: (rows: DBRow[]) => void) {

        const afterMutate = () => {
            if (this.q.having) {
                inputRows = this._having(inputRows);
            }
            if (this.q.orderBy) {
                inputRows = this._orderBy(inputRows);
            }
            if (this.q.offset) {
                inputRows = this._offset(inputRows);
            }
            if (this.q.limit) {
                inputRows = this._limit(inputRows);
            }
            callback(inputRows);
        };

        const afterORM = () => {
            if (this.q.actionArgs && this.q.actionArgs.length) {
                this._mutateRows(inputRows, (newRows) => {
                    inputRows = newRows;
                    afterMutate();
                });
            } else {
                afterMutate();
            }

        };

        const afterJoin = () => {
            if (this.q.groupBy) {
                inputRows = this._groupBy(inputRows);
            }
            if (this.q.orm) {
                this._orm(inputRows, (newRows) => {
                    inputRows = newRows;
                    afterORM();
                });
            } else {
                afterORM();
            }
        };

        if (this.q.join) {
            this._join(inputRows, (rows) => {
                inputRows = rows;
                afterJoin();
            });
        } else {
            afterJoin();
        }
    }
}


/**
 * Selects the needed rows from the storage system.
 * Uses the fastes possible method to get the rows.
 *
 * @export
 * @class _RowSelection
 */
// tslint:disable-next-line
export class _RowSelection {


    constructor(
        public q: IdbQuery,
        public s: _NanoSQLStorage
    ) {
    }

    /**
     * Discovers the fastest possible SELECT method, then uses it.
     *
     * @param {(rows: DBRow[]) => void} callback
     * @returns
     * @memberof _RowSelection
     */
    public getRows(callback: (rows: DBRow[]) => void) {

        // join command requires n^2 scan that gets taken care of in join logic.
        if (this.q.join) {
            callback([]);
            return;
        }

        if (this.q.join && this.q.orm) {
            throw new Error("Cannot do a JOIN and ORM command at the same time!");
        }

        if ([this.q.where, this.q.range, this.q.trie].filter(i => i).length > 1) {
            throw new Error("Can only have ONE of Trie, Range or Where!");
        }

        if (this.q.trie && this.q.trie.column && this.q.trie.search) { // trie search, nice and fast.
            this._selectByTrie(callback);
            return;
        }

        if (this.q.range && this.q.range.length) { // range select, very fast
            this._selectByRange(callback);
            return;
        }

        if (!this.q.where || !this.q.where.length) { // no where statement, read whole db :(
            this._fullTableScan(callback);
            return;
        }

        if (!Array.isArray(this.q.where)) { // where statement is function, read every row and filter results :(
            this._fullTableScan((rows) => {
                callback(rows.filter(this.q.where as any));
            });
            return;
        }

        // where statement possibly contains primary key and secondary key queries, do faster search if possible.
        let doFastRead = false;
        if (typeof this.q.where[0] === "string") { // Single WHERE
            doFastRead = this._isOptimizedWhere(this.q.where) === 0;
        } else { // combined where statements
            doFastRead = (this.q.where || []).reduce((prev, cur, i) => {
                if (i % 2 === 1) return prev;
                return prev + this._isOptimizedWhere(cur);
            }, 0) === 0;
        }

        if (doFastRead) { // can go straight to primary or secondary keys, wee!
            this._selectByKeys(callback);
            return;
        }

        // Full table scan :(
        this._fullTableScan(callback);
    }

    /**
     * Does super fast primary key or secondary index select.
     * Handles compound WHERE statements, combining their results.
     * Works as long as every WHERE statement is selecting against a primary key or secondary index.
     *
     * @internal
     * @param {(rows: DBRow[]) => void} callback
     * @memberof _RowSelection
     */
    private _selectByKeys(callback: (rows: DBRow[]) => void) {

        if (this.q.where && typeof this.q.where[0] === "string") { // single where
            this._selectRowsByIndex(this.q.where as any, callback);
        } else if (this.q.where) { // compound where
            let resultRows: DBRow[] = [];
            let lastCommand = "";
            fastCHAIN((this.q.where as any), (wArg, i, nextWArg) => {
                if (wArg === "OR" || wArg === "AND") {
                    lastCommand = wArg;
                    nextWArg();
                    return;
                }
                this._selectRowsByIndex(wArg, (rows) => {
                    if (lastCommand === "AND") {
                        let idx = rows.map((r) => r[this.s.tableInfo[this.q.table as any]._pk]);
                        resultRows = resultRows.filter((row) => {
                            return idx.indexOf(row[this.s.tableInfo[this.q.table as any]._pk]) !== -1;
                        });
                    } else {
                        resultRows.concat(rows);
                    }
                    nextWArg();
                });
            }).then(() => {
                callback(resultRows);
            });
        }
    }

    /**
     * Much faster SELECT by primary key or secondary index.
     * Accepts a single WHERE statement, no compound statements allowed.
     *
     * @internal
     * @param {any[]} where
     * @param {(rows: DBRow[]) => void} callback
     * @returns
     * @memberof _RowSelection
     */
    private _selectRowsByIndex(where: any[], callback: (rows: DBRow[]) => void) {

        if (where[1] === "BETWEEN") {
            let secondaryIndexKey = where[0] === this.s.tableInfo[this.q.table as any]._pk ? "" : where[0];
            if (secondaryIndexKey) {
                const idxTable = "_" + this.q.table + "_idx_" + secondaryIndexKey;
                this.s._rangeReadPKs(idxTable, where[2][0], where[2][1], (rows) => {
                    const keys = [].concat.apply([], rows);
                    this.s._read(this.q.table as any, keys, callback);
                });

            } else {
                this.s._rangeReadPKs(this.q.table as any, where[2][0], where[2][1], (rows) => {
                    callback(rows);
                });
            }
            return;
        }

        let keys: any[] = [];

        switch (where[1]) {
            case "IN":
                keys = where[2];
                break;
            case "=":
                keys = [where[2]];
                break;
        }

        if (where[0] === this.s.tableInfo[this.q.table as any]._pk) { // primary key select
            this.s._read(this.q.table as any, keys as any, callback);
        } else { // secondary index select
            fastALL(keys, (idx, i, complete) => {
                this.s._secondaryIndexRead(this.q.table as any, where[0], idx, complete);
            }).then((rows) => {
                callback([].concat.apply([], rows));
            });
        }
    }

    /**
     * Select rows within a numerical range using limit and offset values.
     * Negative limit values will start the range from the bottom of the table.
     *
     * @internal
     * @param {(rows: DBRow[]) => void} callback
     * @memberof _RowSelection
     */
    // [limit, offset]
    private _selectByRange(callback: (rows: DBRow[]) => void) {
        if (this.q.range) {
            const r: any[] = this.q.range;
            this.s._adapter.getIndex(this.q.table as any, true, (count: number) => {
                const fromIdx = r[0] > 0 ? r[1] : count + r[0] - r[1];

                let toIdx = fromIdx;
                let counter = Math.abs(r[0]) - 1;

                while (counter--) {
                    toIdx++;
                }
                this.s._rangeReadIDX(this.q.table as any, fromIdx, toIdx, callback);
            });
        } else {
            callback([]);
        }
    }

    /**
     * Select rows based on a Trie Query.
     *
     * @internal
     * @param {(rows: DBRow[]) => void} callback
     * @memberof _RowSelection
     */
    private _selectByTrie(callback: (rows: DBRow[]) => void) {

        if (this.q.trie) {
            this.s._trieRead(this.q.table as any, this.q.trie.column, this.q.trie.search, callback);
        } else {
            callback([]);
        }
    }

    /**
     * Do a full table scan, checking every row against the WHERE statement.
     *
     * @internal
     * @param {(rows: DBRow[]) => void} callback
     * @memberof _RowSelection
     */
    private _fullTableScan(callback: (rows: DBRow[]) => void) {
        this.s._read(this.q.table as any, (row, i, keep) => {
            keep(this.q.where ? Array.isArray(this.q.where) ? _where(row, this.q.where as any || [], i || 0) : (this.q.where as any)(row, i) : true);
        }, callback);
    }

    /**
     * Checks if a single WHERE statement ["row", "=", value] uses a primary key or secondary index as it's row.
     * If so, we can use a much faster SELECT method.
     *
     * @internal
     * @param {any[]} wArgs
     * @returns {number}
     * @memberof _RowSelection
     */
    private _isOptimizedWhere(wArgs: any[]): number {
        const tableData = this.s.tableInfo[this.q.table as any];
        if (["=", "IN", "BETWEEN"].indexOf(wArgs[1]) > -1) {
            // if (wArgs[0] === tableData._pk) {
            if (wArgs[0] === tableData._pk || tableData._secondaryIndexes.indexOf(wArgs[0]) > -1) {
                return 0;
            }
        }
        return 1;
    }
}

/**
 * Select rows from an instance table. Supports RANGE and WHERE statements.
 *
 * @export
 * @class InstanceSelection
 */
export class InstanceSelection {

    constructor(
        public q: IdbQuery
    ) {
    }

    public getRows(callback: (rows: DBRow[]) => void) {

        if (this.q.join || this.q.orm || this.q.trie) {
            throw new Error("Cannot do a JOIN, ORM or TRIE command with instance table!");
        }


        if (this.q.range && this.q.range.length) { // range select [limit, offset]
            let range: [number, number] = this.q.range as any, from: number, to: number;
            if (range[0] < 0) {
                from = ((this.q.table as any[]).length) + range[0] - range[1];
            } else {
                from = range[1];
            }
            let cnt = Math.abs(range[0]) - 1;
            to = from;
            while (cnt--) {
                to++;
            }
            callback((this.q.table as any[]).filter((val, idx) => {
                return idx >= from && idx <= to;
            }));
            return;
        }

        callback((this.q.table as any[]).filter((row, i) => {
            if (this.q.where) {
                return Array.isArray(this.q.where) ? _where(row, this.q.where as any || [], i) : this.q.where(row, i);
            }
            return true;
        }));
    }
}

/**
 * Handles WHERE statements, combining multiple compared statements aginst AND/OR as needed to return a final boolean value.
 * The final boolean value is wether the row matches all WHERE conditions or not.
 *
 * @param {*} singleRow
 * @param {any[]} where
 * @param {number} rowIDX
 * @param {boolean} [ignoreFirstPath]
 * @returns {boolean}
 */
const _where = (singleRow: any, where: any[], rowIDX: number, ignoreFirstPath?: boolean): boolean => {

    const commands = ["AND", "OR"];

    if (typeof where[0] !== "string") { // compound where statements

        let hasAnd = false;
        let checkWhere = where.map(function (cur, idx) {
            if (commands.indexOf(cur) !== -1) {
                if (cur === "AND") hasAnd = true;
                return cur;
            } else {
                return _compare(cur[2], cur[1], cur[0] === "_IDX_" ? rowIDX : objQuery(cur[0], singleRow, ignoreFirstPath)) === 0 ? true : false;
            }
        });

        checkWhere.forEach(function (cur, idx) {
            if (cur === "OR") {
                checkWhere[idx] = checkWhere[idx - 1] || checkWhere[idx + 1];
                checkWhere[idx - 1] = undefined;
                checkWhere[idx + 1] = undefined;
            }
        });

        checkWhere = checkWhere.filter(val => val !== undefined);

        if (!hasAnd) { // All OR statements
            return checkWhere.indexOf(true) !== -1;
        } else {
            let reducing: number;
            let prevAnd = false;
            return checkWhere.reduce((prev, cur, idx) => {
                if (idx === 0) {
                    prev.push(cur);
                    reducing = prev.length - 1;
                    return prev;
                }
                if (cur === "AND") {
                    prevAnd = true;
                    prev.push(cur);
                    return prev;
                }
                if (prevAnd) {
                    prev.push(cur);
                    reducing = prev.length - 1;
                    prevAnd = false;
                    return prev;
                }
                if (reducing !== undefined) {
                    prev[reducing] = cur || prev[reducing];
                }
                return prev;
            }, []).filter(val => val !== undefined).indexOf(false) === -1;
        }

    } else { // single where statement
        return _compare(where[2], where[1], where[0] === "_IDX_" ? rowIDX : objQuery(where[0], singleRow, ignoreFirstPath)) === 0 ? true : false;
    }
};


/**
 * Compare function used by WHERE to determine if a given value matches a given condition.
 *
 * @param {*} val1
 * @param {string} compare
 * @param {*} val2
 * @returns {number}
 */
const _compare = (val1: any, compare: string, val2: any): number => {

    const setValue = (val: any) => {
        return ["LIKE", "NOT LIKE"].indexOf(compare) > -1 ? String(val || "").toLowerCase() : val;
    };

    const columnValue = setValue(val2);
    const givenValue = setValue(val1);

    if (val1 === "NULL" || val1 === "NOT NULL") {
        const pos = compare === "=" || compare === "LIKE";
        return (val1 === "NULL" ?
            (val2 === null || val2 === undefined) :
            (val2 !== null && val2 !== undefined)) ?
            (pos ? 0 : 1) : (pos ? 1 : 0);
    }

    switch (compare) {
        // if column equal to given value
        case "=": return columnValue === givenValue ? 0 : 1;
        // if column not equal to given value
        case "!=": return columnValue !== givenValue ? 0 : 1;
        // if column greather than given value
        case ">": return columnValue > givenValue ? 0 : 1;
        // if column less than given value
        case "<": return columnValue < givenValue ? 0 : 1;
        // if column less than or equal to given value
        case "<=": return columnValue <= givenValue ? 0 : 1;
        // if column greater than or equal to given value
        case ">=": return columnValue >= givenValue ? 0 : 1;
        // if column value exists in given array
        case "IN": return (givenValue || []).indexOf(columnValue) < 0 ? 1 : 0;
        // if column does not exist in given array
        case "NOT IN": return (givenValue || []).indexOf(columnValue) < 0 ? 0 : 1;
        // regexp search the column
        case "REGEX": return columnValue.match(givenValue) ? 0 : 1;
        // if given value exists in column value
        case "LIKE": return columnValue.indexOf(givenValue) < 0 ? 1 : 0;
        // if given value does not exist in column value
        case "NOT LIKE": return columnValue.indexOf(givenValue) > 0 ? 1 : 0;
        // if the column value is between two given numbers
        case "BETWEEN": return givenValue[0] <= columnValue && givenValue[1] >= columnValue ? 0 : 1;
        // if single value exists in array column
        case "HAVE": return (columnValue || []).indexOf(givenValue) < 0 ? 1 : 0;
        // if single value does not exist in array column
        case "NOT HAVE": return (columnValue || []).indexOf(givenValue) < 0 ? 0 : 1;
        // if array of values intersects with array column
        case "INTERSECT": return (columnValue || []).filter(l => (givenValue || []).indexOf(l) > -1).length > 0 ? 0 : 1;
        // if array of values does not intersect with array column
        case "NOT INTERSECT": return (columnValue || []).filter(l => (givenValue || []).indexOf(l) > -1).length === 0 ? 0 : 1;
        default: return 1;
    }
};