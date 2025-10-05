// server.js
const express = require("express");
const mariadb = require("mariadb");
const app = express();
const port = 3000;

// DB pool (hardcoded)
const pool = mariadb.createPool({
  host: "localhost",
  user: "root",
  password: "root",
  database: "sample",
  port: 3306,
  connectionLimit: 5,
});

// small helper to run queries
async function q(sql, params = []) {
  const conn = await pool.getConnection();
  try { return await conn.query(sql, params); }
  finally { conn.release(); }
}

// --- routes ---
app.get("/api/customers", async (req, res) => {
  const rows = await q(
    `SELECT CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY, GRADE
     FROM customer ORDER BY CUST_NAME LIMIT 50`
  );
  res.json(rows);
});

app.get("/api/customers/:code", async (req, res) => {
  const rows = await q(
    `SELECT CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY, GRADE
     FROM customer WHERE CUST_CODE=? LIMIT 1`,
    [req.params.code]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

app.get("/api/orders", async (req, res) => {
  const { cust_code, agent_code } = req.query;
  let sql = `SELECT ORD_NUM, ORD_AMOUNT, ADVANCE_AMOUNT, ORD_DATE, CUST_CODE, AGENT_CODE, ORD_DESCRIPTION FROM orders`;
  const where = [], params = [];
  if (cust_code) { where.push("CUST_CODE=?"); params.push(cust_code); }
  if (agent_code) { where.push("AGENT_CODE=?"); params.push(agent_code); }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY ORD_DATE DESC, ORD_NUM DESC LIMIT 50";
  const rows = await q(sql, params);
  res.json(rows);
});

app.get("/api/agents", async (_req, res) => {
  const rows = await q(
    `SELECT AGENT_CODE, AGENT_NAME, WORKING_AREA, COMMISSION, PHONE_NO, COUNTRY
     FROM agents ORDER BY AGENT_NAME`
  );
  res.json(rows);
});

// start server
app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}`);
});

