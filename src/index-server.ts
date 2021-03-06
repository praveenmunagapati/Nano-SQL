declare var global: any;
global._fs = require("fs");
global._path = require("path");
global._levelup = require("levelup");
global._leveldown = require("leveldown");
global._crypto = require("crypto");

import {
    ActionOrView,
    DataModel,
    DatabaseEvent,
    JoinArgs,
    DBRow,
    NanoSQLInstance,
    DBConnect,
    nSQL
 } from "./index";


 export {
    ActionOrView,
    DataModel,
    DatabaseEvent,
    JoinArgs,
    DBRow,
    NanoSQLInstance,
    DBConnect,
    nSQL
 };