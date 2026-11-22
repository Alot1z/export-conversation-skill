/**
 * SQLite is read through the runtime's own driver when available.
 * The capability is explicit: no bundled binary and no silent fallback.
 */

export const SQLITE_UNSUPPORTED = "UNSUPPORTED_RUNTIME";

export async function sqliteCapability() {
  try {
    const module = await import("node:sqlite");
    if (typeof module.DatabaseSync !== "function") {
      return {
        available: false,
        code: SQLITE_UNSUPPORTED,
        reason: "node:sqlite does not expose DatabaseSync",
        node: process.version,
      };
    }
    return { available: true, module, node: process.version };
  } catch (error) {
    return {
      available: false,
      code: SQLITE_UNSUPPORTED,
      reason: `node:sqlite is unavailable: ${error.message}`,
      node: process.version,
    };
  }
}

async function open(file, mode) {
  const capability = await sqliteCapability();
  if (!capability.available) {
    const error = new Error(capability.reason);
    error.code = SQLITE_UNSUPPORTED;
    throw error;
  }
  const db = new capability.module.DatabaseSync(file, { readOnly: mode === "read" });
  db.exec("PRAGMA query_only = ON");
  return { db, capability };
}

export async function withDatabase(file, fn) {
  const { db } = await open(file, "read");
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export async function inspectDatabase(file) {
  return withDatabase(file, async (db) => {
    const tables = db
      .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
      .all();
    return tables.map((table) => {
      const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table.name)})`).all();
      return {
        name: table.name,
        type: table.type,
        columns: columns.map((column) => ({ name: column.name, type: column.type })),
      };
    });
  });
}

export async function readRows(file, sql, params = []) {
  return withDatabase(file, async (db) => db.prepare(sql).all(...params));
}

export async function tableCounts(file) {
  const tables = await inspectDatabase(file);
  return withDatabase(file, async (db) =>
    tables.map((table) => {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${JSON.stringify(table.name)}`).get();
        return { table: table.name, rows: Number(row?.count ?? 0) };
      } catch (error) {
        return { table: table.name, rows: null, error: error.message };
      }
    }),
  );
}
