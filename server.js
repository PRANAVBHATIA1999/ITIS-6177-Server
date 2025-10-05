const express = require("express");
const mariadb = require("mariadb");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");

const app = express();
const port = 3000;

// DB pool
const pool = mariadb.createPool({
  host: "localhost",
  user: "root",
  password: "root",
  database: "sample",
  port: 3306,
  connectionLimit: 5,
});

app.use(express.json());

async function q(sql, params = []) {
  const conn = await pool.getConnection();
  try {
    return await conn.query(sql, params);
  } finally {
    conn.release();
  }
}


function sanitizeObject(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) { out[k] = v; continue; }
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function transformCustomer(input) {
  const x = sanitizeObject(input);
  if (x.CUST_CODE) x.CUST_CODE = String(x.CUST_CODE).trim().toUpperCase();
  if (x.CUST_COUNTRY) x.CUST_COUNTRY = String(x.CUST_COUNTRY).trim();
  for (const k of ["GRADE","OPENING_AMT","RECEIVE_AMT","PAYMENT_AMT","OUTSTANDING_AMT"]) {
    if (k in x && x[k] !== "") x[k] = Number(x[k]);
  }
  return x;
}

function validateCustomer(body, { partial = false } = {}) {
  const errs = [];
  const required = [
    "CUST_CODE","CUST_NAME","WORKING_AREA","CUST_COUNTRY",
    "OPENING_AMT","RECEIVE_AMT","PAYMENT_AMT","OUTSTANDING_AMT","PHONE_NO"
  ];
  if (!partial) {
    for (const f of required) {
      if (body[f] == null || body[f] === "") errs.push(`${f} is required`);
    }
  }
  if (body.CUST_CODE && !/^[A-Z0-9]{5,6}$/.test(body.CUST_CODE)) {
    errs.push("CUST_CODE must be 5–6 alphanumerics (e.g., C00001)");
  }
  for (const k of ["OPENING_AMT","RECEIVE_AMT","PAYMENT_AMT","OUTSTANDING_AMT"]) {
    if (k in body && (typeof body[k] !== "number" || Number.isNaN(body[k]) || body[k] < 0)) {
      errs.push(`${k} must be a non-negative number`);
    }
  }
  if ("GRADE" in body && body.GRADE != null) {
    if (typeof body.GRADE !== "number" || Number.isNaN(body.GRADE) || body.GRADE < 0) {
      errs.push("GRADE must be a number ≥ 0");
    }
  }
  if ("PHONE_NO" in body && body.PHONE_NO && body.PHONE_NO.length > 17) {
    errs.push("PHONE_NO max length is 17");
  }
  return errs;
}

async function getCustomerByCode(code) {
  const rows = await q(`SELECT CUST_CODE FROM customer WHERE CUST_CODE=? LIMIT 1`, [code]);
  return rows[0];
}

// ---- READS
app.get("/api/customers", async (_req, res, next) => {
  try {
    const rows = await q(
      `SELECT CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY, GRADE
       FROM customer ORDER BY CUST_NAME LIMIT 50`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/customers/:code", async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY, GRADE,
              OPENING_AMT, RECEIVE_AMT, PAYMENT_AMT, OUTSTANDING_AMT, PHONE_NO, AGENT_CODE
       FROM customer WHERE CUST_CODE=? LIMIT 1`,
      [String(req.params.code || "").toUpperCase()]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/orders", async (req, res, next) => {
  try {
    const { cust_code, agent_code } = req.query;
    let sql = `SELECT ORD_NUM, ORD_AMOUNT, ADVANCE_AMOUNT, ORD_DATE, CUST_CODE, AGENT_CODE, ORD_DESCRIPTION FROM orders`;
    const where = [], params = [];
    if (cust_code) { where.push("CUST_CODE=?"); params.push(String(cust_code).trim().toUpperCase()); }
    if (agent_code) { where.push("AGENT_CODE=?"); params.push(String(agent_code).trim().toUpperCase()); }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY ORD_DATE DESC, ORD_NUM DESC LIMIT 50";
    const rows = await q(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/agents", async (_req, res, next) => {
  try {
    const rows = await q(
      `SELECT AGENT_CODE, AGENT_NAME, WORKING_AREA, COMMISSION, PHONE_NO, COUNTRY
       FROM agents ORDER BY AGENT_NAME`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ---- CREATE
app.post("/api/customers", async (req, res, next) => {
  try {
    const data = transformCustomer(req.body);
    const errors = validateCustomer(data, { partial: false });
    if (errors.length) return res.status(400).json({ errors });

    const exists = await getCustomerByCode(data.CUST_CODE);
    if (exists) return res.status(409).json({ error: "CUST_CODE already exists" });

    await q(
      `INSERT INTO customer (
        CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY,
        GRADE, OPENING_AMT, RECEIVE_AMT, PAYMENT_AMT, OUTSTANDING_AMT,
        PHONE_NO, AGENT_CODE
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.CUST_CODE, data.CUST_NAME ?? null, data.CUST_CITY ?? null, data.WORKING_AREA,
        data.CUST_COUNTRY, data.GRADE ?? null, data.OPENING_AMT, data.RECEIVE_AMT,
        data.PAYMENT_AMT, data.OUTSTANDING_AMT, data.PHONE_NO, data.AGENT_CODE ?? null
      ]
    );

    const created = await q(
      `SELECT CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY, GRADE,
              OPENING_AMT, RECEIVE_AMT, PAYMENT_AMT, OUTSTANDING_AMT, PHONE_NO, AGENT_CODE
       FROM customer WHERE CUST_CODE=? LIMIT 1`,
      [data.CUST_CODE]
    );
    res.status(201).json(created[0]);
  } catch (e) { next(e); }
});

// ---- REPLACE
app.put("/api/customers/:code", async (req, res, next) => {
  try {
    const code = String(req.params.code || "").toUpperCase();
    const data = transformCustomer({ ...req.body, CUST_CODE: code });
    const errors = validateCustomer(data, { partial: false });
    if (errors.length) return res.status(400).json({ errors });

    const exists = await getCustomerByCode(code);
    if (exists) {
      await q(
        `UPDATE customer
         SET CUST_NAME=?, CUST_CITY=?, WORKING_AREA=?, CUST_COUNTRY=?, GRADE=?,
             OPENING_AMT=?, RECEIVE_AMT=?, PAYMENT_AMT=?, OUTSTANDING_AMT=?, PHONE_NO=?, AGENT_CODE=?
         WHERE CUST_CODE=? LIMIT 1`,
        [
          data.CUST_NAME, data.CUST_CITY ?? null, data.WORKING_AREA, data.CUST_COUNTRY,
          data.GRADE ?? null, data.OPENING_AMT, data.RECEIVE_AMT, data.PAYMENT_AMT,
          data.OUTSTANDING_AMT, data.PHONE_NO, data.AGENT_CODE ?? null, code
        ]
      );
      const updated = await q(
        `SELECT CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY, GRADE,
                OPENING_AMT, RECEIVE_AMT, PAYMENT_AMT, OUTSTANDING_AMT, PHONE_NO, AGENT_CODE
         FROM customer WHERE CUST_CODE=? LIMIT 1`, [code]);
      return res.json(updated[0]);
    } else {
      await q(
        `INSERT INTO customer (
          CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY,
          GRADE, OPENING_AMT, RECEIVE_AMT, PAYMENT_AMT, OUTSTANDING_AMT,
          PHONE_NO, AGENT_CODE
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          code, data.CUST_NAME, data.CUST_CITY ?? null, data.WORKING_AREA,
          data.CUST_COUNTRY, data.GRADE ?? null, data.OPENING_AMT, data.RECEIVE_AMT,
          data.PAYMENT_AMT, data.OUTSTANDING_AMT, data.PHONE_NO, data.AGENT_CODE ?? null
        ]
      );
      const created = await q(
        `SELECT CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY, GRADE,
                OPENING_AMT, RECEIVE_AMT, PAYMENT_AMT, OUTSTANDING_AMT, PHONE_NO, AGENT_CODE
         FROM customer WHERE CUST_CODE=? LIMIT 1`, [code]);
      return res.status(201).json(created[0]);
    }
  } catch (e) { next(e); }
});

// ---- PATCH
app.patch("/api/customers/:code", async (req, res, next) => {
  try {
    const code = String(req.params.code || "").toUpperCase();
    const exists = await getCustomerByCode(code);
    if (!exists) return res.status(404).json({ error: "Not found" });

    const allowed = [
      "CUST_NAME","CUST_CITY","WORKING_AREA","CUST_COUNTRY","GRADE",
      "OPENING_AMT","RECEIVE_AMT","PAYMENT_AMT","OUTSTANDING_AMT","PHONE_NO","AGENT_CODE"
    ];
    const incoming = transformCustomer(req.body);
    const patch = Object.fromEntries(Object.entries(incoming).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid fields to update" });

    const errors = validateCustomer(patch, { partial: true });
    if (errors.length) return res.status(400).json({ errors });

    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(patch)) { sets.push(`${k}=?`); vals.push(v ?? null); }
    vals.push(code);

    await q(`UPDATE customer SET ${sets.join(", ")} WHERE CUST_CODE=? LIMIT 1`, vals);

    const updated = await q(
      `SELECT CUST_CODE, CUST_NAME, CUST_CITY, WORKING_AREA, CUST_COUNTRY, GRADE,
              OPENING_AMT, RECEIVE_AMT, PAYMENT_AMT, OUTSTANDING_AMT, PHONE_NO, AGENT_CODE
       FROM customer WHERE CUST_CODE=? LIMIT 1`, [code]);
    res.json(updated[0]);
  } catch (e) { next(e); }
});

// ---- DELETE
app.delete("/api/customers/:code", async (req, res, next) => {
  try {
    const code = String(req.params.code || "").toUpperCase();
    const exists = await getCustomerByCode(code);
    if (!exists) return res.status(404).json({ error: "Not found" });

    await q(`DELETE FROM customer WHERE CUST_CODE=? LIMIT 1`, [code]);
    res.status(204).send();
  } catch (e) { next(e); }
});

// error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ----  SWAGGER
const openApiDefinition = {
  openapi: "3.0.3",
  info: {
    title: "Pranav's API",
    version: "1.0.0",
    description:
      "Express + MariaDB API for customers, orders, and agents.\n\n" +
      "**Base URL:** http://localhost:3000"
      
  },
  tags: [{ name: "Customers" }, { name: "Orders" }, { name: "Agents" }],
  components: {
    schemas: {
      Customer: {
        type: "object",
        properties: {
          CUST_CODE: { type: "string", example: "C00001" },
          CUST_NAME: { type: "string", example: "Acme Corp" },
          CUST_CITY: { type: "string", nullable: true, example: "Charlotte" },
          WORKING_AREA: { type: "string", example: "South" },
          CUST_COUNTRY: { type: "string", example: "USA" },
          GRADE: { type: "integer", nullable: true, example: 2 },
          OPENING_AMT: { type: "number", example: 1000.5 },
          RECEIVE_AMT: { type: "number", example: 200.0 },
          PAYMENT_AMT: { type: "number", example: 50.0 },
          OUTSTANDING_AMT: { type: "number", example: 1150.5 },
          PHONE_NO: { type: "string", example: "555-123-4567" },
          AGENT_CODE: { type: "string", nullable: true, example: "A001" }
        },
        required: ["CUST_CODE","CUST_NAME","WORKING_AREA","CUST_COUNTRY","OPENING_AMT","RECEIVE_AMT","PAYMENT_AMT","OUTSTANDING_AMT","PHONE_NO"]
      },
      CustomerCreate: { allOf: [{ $ref: "#/components/schemas/Customer" }] },
      CustomerPatch: {
        type: "object",
        properties: {
          CUST_NAME: { type: "string" },
          CUST_CITY: { type: "string", nullable: true },
          WORKING_AREA: { type: "string" },
          CUST_COUNTRY: { type: "string" },
          GRADE: { type: "integer", nullable: true },
          OPENING_AMT: { type: "number" },
          RECEIVE_AMT: { type: "number" },
          PAYMENT_AMT: { type: "number" },
          OUTSTANDING_AMT: { type: "number" },
          PHONE_NO: { type: "string" },
          AGENT_CODE: { type: "string", nullable: true }
        }
      },
      Order: {
        type: "object",
        properties: {
          ORD_NUM: { type: "integer", example: 200110 },
          ORD_AMOUNT: { type: "number", example: 350.0 },
          ADVANCE_AMOUNT: { type: "number", example: 50.0 },
          ORD_DATE: { type: "string", format: "date", example: "2008-07-15" },
          CUST_CODE: { type: "string", example: "C00001" },
          AGENT_CODE: { type: "string", example: "A001" },
          ORD_DESCRIPTION: { type: "string", example: "Widget shipment" }
        }
      },
      Agent: {
        type: "object",
        properties: {
          AGENT_CODE: { type: "string", example: "A001" },
          AGENT_NAME: { type: "string", example: "John Smith" },
          WORKING_AREA: { type: "string", example: "New York" },
          COMMISSION: { type: "number", example: 0.12 },
          PHONE_NO: { type: "string", example: "123-456-7890" },
          COUNTRY: { type: "string", example: "USA" }
        }
      },
      ErrorResponse: { type: "object", properties: { error: { type: "string", example: "Not found" } } },
      ValidationErrorResponse: {
        type: "object",
        properties: {
          errors: { type: "array", items: { type: "string" },
            example: ["CUST_CODE is required","OPENING_AMT must be a non-negative number"] }
        }
      }
    },
    parameters: {
      CustCodeParam: {
        name: "code", in: "path", required: true,
        schema: { type: "string", example: "C00001" }, description: "Customer code (5–6 alphanumerics)"
      },
      OrdersCustQuery: { name: "cust_code", in: "query", required: false, schema: { type: "string", example: "C00001" } },
      OrdersAgentQuery: { name: "agent_code", in: "query", required: false, schema: { type: "string", example: "A001" } }
    }
  },
  paths: {
    "/api/customers": {
      get: {
        tags: ["Customers"], summary: "List customers",
        responses: { 200: { description: "Array of customers (limited to 50)",
          content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Customer" } } } } } }
      },
      post: {
        tags: ["Customers"], summary: "Create a customer",
        requestBody: { required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CustomerCreate" } } } },
        responses: {
          201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationErrorResponse" } } } },
          409: { description: "Duplicate CUST_CODE", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/api/customers/{code}": {
      get: {
        tags: ["Customers"], summary: "Get a customer by code",
        parameters: [{ $ref: "#/components/parameters/CustCodeParam" }],
        responses: {
          200: { description: "Customer", content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } } },
          404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      },
      put: {
        tags: ["Customers"], summary: "Create or replace a customer",
        parameters: [{ $ref: "#/components/parameters/CustCodeParam" }],
        requestBody: { required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CustomerCreate" } } } },
        responses: {
          200: { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } } },
          201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationErrorResponse" } } } }
        }
      },
      patch: {
        tags: ["Customers"], summary: "Partially update a customer",
        parameters: [{ $ref: "#/components/parameters/CustCodeParam" }],
        requestBody: { required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CustomerPatch" } } } },
        responses: {
          200: { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationErrorResponse" } } } },
          404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      },
      delete: {
        tags: ["Customers"], summary: "Delete a customer",
        parameters: [{ $ref: "#/components/parameters/CustCodeParam" }],
        responses: { 204: { description: "Deleted" },
          404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } } }
      }
    },
    "/api/orders": {
      get: {
        tags: ["Orders"], summary: "List orders (filterable)",
        parameters: [
          { $ref: "#/components/parameters/OrdersCustQuery" },
          { $ref: "#/components/parameters/OrdersAgentQuery" }
        ],
        responses: {
          200: { description: "Array of orders (limited to 50)",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Order" } } } } }
        }
      }
    },
    "/api/agents": {
      get: {
        tags: ["Agents"], summary: "List agents",
        responses: {
          200: { description: "Array of agents",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Agent" } } } } }
        }
      }
    }
  }
};

const swaggerSpec = swaggerJSDoc({ definition: openApiDefinition, apis: [] });


app.get("/openapi.json", (_req, res) => res.json(swaggerSpec));


app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  swaggerOptions: {
    docExpansion: "list",
    defaultModelsExpandDepth: -1,   
    defaultModelExpandDepth: 0,
    defaultModelRendering: "example",
  }
}));

app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/api-docs`);
  console.log(`OpenAPI JSON: http://localhost:${port}/openapi.json`);
});

