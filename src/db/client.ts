import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import type { Config } from '../config.ts'
import * as schema from './schema.ts'

export type Database = ReturnType<typeof createDb>['db']

export function createDb(config: Config) {
  const pool = mysql.createPool(config.databaseUrl)
  const db = drizzle(pool, { schema, mode: 'default' })
  return { db, pool }
}
