export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
}

export interface TableInfo {
  schema: string;
  tableName: string;
  columns: Map<string, ColumnInfo>;
}

/**
 * DbSchema maps "schema.table" → TableInfo.
 * Also supports plain "table" lookups for the default public schema.
 */
export type DbSchema = Map<string, TableInfo>;

export interface SchemaSnapshot {
  schema: DbSchema;
  version: string;
  loadedAt: Date;
}
