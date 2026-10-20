/* Vercel function for /api/history/:key (earlier saved versions, admin only) — logic lives in lib/api.js. */
"use strict";
const { handleApi } = require("../../lib/api");
module.exports = (req, res) => {
  const key = (req.query && req.query.key) || new URL(req.url, "http://localhost").pathname.split("/").pop();
  return handleApi(req, res, "/api/history/" + key);
};
