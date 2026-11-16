/**
 * What a query is written with, anywhere in sift: the tables, Drizzle's operators, and `sql` that
 * refuses a person's table written into it (src/store/own.ts). Queries run on the handle they are given
 * (`Sql`), whose builder holds them to its person. Nothing else imports Drizzle.
 */
export {
  type AnyColumn,
  type SQL,
  and,
  asc,
  avg,
  between,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  notExists,
  notInArray,
  or,
  sum,
} from 'drizzle-orm';
export { alias, union, unionAll } from 'drizzle-orm/pg-core';
export { sql } from './own.ts';
export * from './schema.ts';
