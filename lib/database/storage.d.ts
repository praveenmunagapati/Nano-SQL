import { DataModel, NanoSQLInstance } from "../index";
import { StdObject } from "../utilities";
export interface DBRow {
    [key: string]: any;
}
export interface DBKey {
    string: any;
    number: any;
}
/**
 * Storage class uses one of these to attach to the actual database backend.
 *
 * @export
 * @interface NanoSQLStorageAdapter
 */
export interface NanoSQLStorageAdapter {
    /**
     * Sent before connect(), sends data models and other info.
     * makeTable() will be called everytime the database backend is connected, so make sure
     * it's setup where you don't accidentally overwrite or destroy existing tables with the same name.
     *
     * @param {string} tableName
     * @param {DataModel[]} dataModels
     * @memberof NanoSQLStorageAdapter
     */
    makeTable(tableName: string, dataModels: DataModel[]): void;
    /**
     * Set the database ID, called before connect() and makeTable() commands get called
     *
     * @param {string} id
     * @memberof NanoSQLStorageAdapter
     */
    setID(id: string): void;
    /**
     * Called when it's time for the backend to be initilized.
     * Do all the backend setup work here, then call complete() when you're done.
     *
     * @param {() => void} complete
     * @memberof NanoSQLStorageAdapter
     */
    connect(complete: () => void): void;
    /**
     * Write a single row to the database backend.
     * Primary key will be provided if it's known before the insert, otherwise it will be null and up to the database backend to make one.
     * It's also intirely possible for a primary key to be provided for a non existent row, the backend should handle this gracefully.
     *
     * @param {string} table
     * @param {(DBKey|null)} pk
     * @param {DBRow} data
     * @param {(finalRow: DBRow) => void} complete
     * @param {boolean} skipReadBeforeWrite
     * @memberof NanoSQLStorageAdapter
     */
    write(table: string, pk: DBKey | null, data: DBRow, complete: (finalRow: DBRow) => void, skipReadBeforeWrite: boolean): void;
    /**
     * Read a single row from the database
     *
     * @param {string} table
     * @param {DBKey} pk
     * @param {(row: DBRow ) => void} callback
     * @memberof NanoSQLStorageAdapter
     */
    read(table: string, pk: DBKey, callback: (row: DBRow) => void): void;
    /**
     * Read a range of primary keys from a given table.
     * Each row is read asyncrounosuly, so make sure the front end can incriment through the rows quickly.
     *
     * If pkRange is true, the from and to values will be primary keys.  Even if the provided keys don't exist, the backend should gracefully provide all keys between the two keys given.
     * If pkRange is false, the from and to values will be numbers indicating a range of rows to get, regardless of the primary key values.
     *
     * @param {string} table
     * @param {(row: DBRow, idx: number, nextRow: () => void) => void} rowCallback
     * @param {() => void} complete
     * @param {DBKey} [from]
     * @param {DBKey} [to]
     * @memberof NanoSQLStorageAdapter
     */
    rangeRead(table: string, rowCallback: (row: DBRow, idx: number, nextRow: () => void) => void, complete: () => void, from?: any, to?: any, pkRange?: boolean): void;
    /**
     * Delete a row from the backend given a table and primary key.
     *
     * @param {string} table
     * @param {DBKey} pk
     * @param {() => void} complete
     * @memberof NanoSQLStorageAdapter
     */
    delete(table: string, pk: DBKey, complete: () => void): void;
    /**
     * Drop an entire table from the backend. (Delete all rows)
     *
     * @param {string} table
     * @param {() => void} complete
     * @memberof NanoSQLStorageAdapter
     */
    drop(table: string, complete: () => void): void;
    /**
     * Get the number of rows in a table or the table index;
     *
     * @param {string} table
     * @param {(count: number) => void} complete
     * @memberof NanoSQLStorageAdapter
     */
    getIndex(table: string, getLength: boolean, complete: (index: any[] | number) => void): void;
    /**
     * Completely delete/destroy the entire database.
     *
     * @param {() => void} complete
     * @memberof NanoSQLStorageAdapter
     */
    destroy(complete: () => void): any;
}
/**
 * Holds the general abstractions to connect the query module to the storage adapters.
 * Takes care of indexing, tries, secondary indexes and adapter management.
 *
 * @export
 * @class _NanoSQLStorage
 */
export declare class _NanoSQLStorage {
    _mode: string | NanoSQLStorageAdapter;
    _id: string;
    _adapter: NanoSQLStorageAdapter;
    tableInfo: {
        [tableName: string]: {
            _pk: string;
            _pkType: string;
            _name: string;
            _secondaryIndexes: string[];
            _trieColumns: string[];
            _keys: string[];
            _defaults: any[];
        };
    };
    /**
     * Wether ORM values exist in the data models or not.
     *
     * @type {boolean}
     * @memberof _NanoSQLStorage
     */
    _hasORM: boolean;
    /**
     * Stores a copy of all the data models
     *
     * @type {{
     *         [tableName: string]: DataModel[];
     *     }}
     * @memberof _NanoSQLStorage
     */
    models: {
        [tableName: string]: DataModel[];
    };
    /**
     * Do we cache select queries or no?
     *
     * @type {boolean}
     * @memberof _NanoSQLStorage
     */
    _doCache: boolean;
    /**
     * The actual select query cache.
     *
     * @type {{
     *         [table: string]: {
     *             [queryHash: number]: any[];
     *         }
     *     }}
     * @memberof _NanoSQLStorage
     */
    _cache: {
        [table: string]: {
            [queryHash: number]: any[];
        };
    };
    /**
     * The primary keys in each cache.
     *
     * @type {{
     *         [table: string]: {
     *             [queryHash: number]: {[primaryKey: any]: boolean};
     *         }
     *     }}
     * @memberof _NanoSQLStorage
     */
    _cacheKeys: {
        [table: string]: {
            [queryHash: number]: any;
        };
    };
    /**
     * Parent instance of NanoSQL
     *
     * @type {NanoSQLInstance}
     * @memberof _NanoSQLStorage
     */
    _nsql: NanoSQLInstance;
    private _size;
    /**
     * Given a table, keep track of all ORM references pointing FROM that table.
     *
     * @type {({
     *         [tableName: string]: { // Relations with this table
     *             _table: string // other table
     *             _key: string // this column
     *             _mapTo: string // other column
     *             _type: "array" | "single" // type of relation
     *         }[];
     *     })}
     * @memberof NanoSQLInstance
     */
    _relFromTable: {
        [tableName: string]: {
            [thisColmn: string]: {
                _toTable: string;
                _toColumn: string;
                _toType: "array" | "single";
                _thisType: "array" | "single";
            };
        };
    };
    /**
     * Used by the .orm() queries to find what records to get.
     *
     * @type {({
     *         [tableName: string]: {
     *             [thisColmn: string]: { // Relations with this table
     *                 _toTable: string // other table
     *                 _thisType: "array" | "single" // type of relation,
     *             };
     *         }
     *     })}
     * @memberof _NanoSQLStorage
     */
    _columnsAreTables: {
        [tableName: string]: {
            [thisColmn: string]: {
                _toTable: string;
                _thisType: "array" | "single";
            };
        };
    };
    /**
     * Given a table, keep track of all ORM references pointing TO that table.
     *
     * @type {({
     *         [tableName: string]: {
     *             thisColumn: string;
     *             fromTable: string;
     *             fromColumn: string;
     *             fromType: "array" | "single"
     *         }[]
     *     })}
     * @memberof NanoSQLInstance
     */
    _relToTable: {
        [tableName: string]: {
            _thisColumn: string;
            _thisType: "array" | "single";
            _fromTable: string;
            _fromColumn: string;
            _fromType: "array" | "single";
        }[];
    };
    /**
     * Stores which columns are used for ORM stuff.
     *
     * @type {{
     *         [tableName: string]: string[];
     *     }}
     * @memberof NanoSQLInstance
     */
    _relationColumns: {
        [tableName: string]: string[];
    };
    constructor(parent: NanoSQLInstance, args: {
        mode: string | NanoSQLStorageAdapter;
        id: string;
        dbPath: string;
        writeCache: number;
        persistent: boolean;
        readCache: number;
        cache: boolean;
        size: number;
    });
    /**
     * Initilize the storage adapter and get ready to rumble!
     *
     * @param {StdObject<DataModel[]>} dataModels
     * @param {(newModels: StdObject<DataModel[]>) => void} complete
     * @memberof _NanoSQLStorage
     */
    init(dataModels: StdObject<DataModel[]>, complete: (newModels: StdObject<DataModel[]>) => void): void;
    /**
     * Rebuild secondary indexes of a given table.
     * Pass "_ALL_" as table to rebuild all indexes.
     *
     * @param {(time: number) => void} complete
     * @memberof _NanoSQLStorage
     */
    rebuildIndexes(table: string, complete: (time: number) => void): void;
    /**
     * Use variouse methods to detect the best persistent storage method for the environment NanoSQL is in.
     *
     * @returns {string}
     * @memberof _NanoSQLStorage
     */
    _detectStorageMethod(): string;
    /**
     * Get rows from a table given the column and secondary index primary key to read from.
     *
     * @param {string} table
     * @param {string} column
     * @param {string} search
     * @param {(rows: DBRow[]) => void} callback
     * @memberof _NanoSQLStorage
     */
    _secondaryIndexRead(table: string, column: string, search: string, callback: (rows: DBRow[]) => void): void;
    /**
     * Get a range of rows from a given table.
     * The range is in limit/offset form where the from and to values are numbers indicating a range of rows to get.
     *
     * @param {string} table
     * @param {DBKey} from
     * @param {DBKey} to
     * @param {(rows: DBRow[]) => void} complete
     * @memberof _NanoSQLStorage
     */
    _rangeReadIDX(table: string, fromIdx: number, toIdx: number, complete: (rows: DBRow[]) => void): void;
    /**
     * Get a range fo rows from a given table.
     * The range is provided as the rows between two primary key values.
     *
     * @param {string} table
     * @param {*} fromPK
     * @param {*} toPK
     * @param {(rows: DBRow[]) => void} complete
     * @memberof _NanoSQLStorage
     */
    _rangeReadPKs(table: string, fromPK: any, toPK: any, complete: (rows: DBRow[]) => void): void;
    /**
     * Full table scan if a function is passed in OR read an array of primary keys.
     *
     * @param {string} table
     * @param {(row: DBRow, idx: number, toKeep: (result: boolean) => void) => void} query
     * @param {(rows: DBRow[]) => void} callback
     * @returns
     * @memberof _NanoSQLStorage
     */
    _read(table: string, query: (row: DBRow, idx: number, toKeep: (result: boolean) => void) => void | any[], callback: (rows: DBRow[]) => void): void;
    /**
     * Get all values in a table where the column value matches against the given trie search value.
     *
     * @param {string} table
     * @param {string} column
     * @param {string} search
     * @param {(rows: DBRow[] ) => void} callback
     * @memberof _NanoSQLStorage
     */
    _trieRead(table: string, column: string, search: string, callback: (rows: DBRow[]) => void): void;
    /**
     * Write a row to the database
     *
     * @param {string} table
     * @param {DBKey} pk
     * @param {*} oldRow
     * @param {DBRow} newRow
     * @param {(row: DBRow) => void} complete
     * @memberof _NanoSQLStorage
     */
    _write(table: string, pk: DBKey, oldRow: any, newRow: DBRow, complete: (row: DBRow) => void): void;
    /**
     * Delete a specific row from the database.
     *
     * @param {string} table
     * @param {DBKey} pk
     * @param {(row: DBRow) => void} complete
     * @memberof _NanoSQLStorage
     */
    _delete(table: string, pk: DBKey, complete: (row: DBRow) => void): void;
    /**
     * Drop entire table from the database.
     *
     * @param {string} table
     * @param {() => void} complete
     * @memberof _NanoSQLStorage
     */
    _drop(table: string, complete: () => void): void;
}
