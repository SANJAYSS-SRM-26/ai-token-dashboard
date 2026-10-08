import { seed, type DB } from "./engine";

// In-memory demo database, seeded on server start (stands in for SQLite in this MVP).
let db: DB | null = null;
export function getDB(): DB {
  if (!db) db = seed();
  return db;
}
export function resetDB() {
  db = seed();
}
