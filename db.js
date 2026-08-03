// db.js — Simple JSON-file database using lowdb (no native compilation needed, Termux-friendly)
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');

const dbFile = path.join(__dirname, 'data', 'db.json');
const adapter = new JSONFile(dbFile);
const defaultData = {
  users: [],
  sessions: [],
  logs: [],
  statistics: []
};

const db = new Low(adapter, defaultData);

async function initDb() {
  await db.read();
  db.data ||= defaultData;
  await db.write();
  return db;
}

module.exports = { db, initDb };
