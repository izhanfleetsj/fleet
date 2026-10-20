/* Vercel function for /api/migrate-index (list of keys + files to copy to a new database) — logic lives in lib/api.js. */
"use strict";
const { handleApi } = require("../lib/api");
module.exports = (req, res) => handleApi(req, res, "/api/migrate-index");
