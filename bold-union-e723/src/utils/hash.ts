/**
 * Computes a deterministic SHA-256 hash string over a canonicalized schema snapshot.
 * Any structural change to tables, columns, relationships, indexes, views, routines,
 * or triggers produces a different 64-character hex hash string.
 */
export async function computeSchemaHash(schemaLike: any): Promise<string> {
  const tables = Array.isArray(schemaLike?.tables)
    ? schemaLike.tables
    : Array.isArray(schemaLike)
      ? schemaLike
      : [];

  if (!tables || tables.length === 0) {
    return 'empty_schema';
  }

  const canonicalTables = [...tables]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((table) => {
      const sortedColumns = [...(table.columns || [])]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((col) => ({
          name: col.name,
          type: String(col.type).toUpperCase(),
          pk: !!col.isPrimaryKey,
          fk: !!col.isForeignKey,
          fkTarget: col.foreignKeyRef ? `${col.foreignKeyRef.table}.${col.foreignKeyRef.column}` : null
        }));

      return {
        name: table.name,
        columns: sortedColumns
      };
    });

  const canonicalIndexes = [...(schemaLike?.indexes || [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((index: any) => ({
      name: index.name,
      table: index.table,
      definition: index.definition
    }));

  const canonicalViews = [...(schemaLike?.views || [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((view: any) => ({
      name: view.name,
      definition: view.definition
    }));

  const canonicalRoutines = [...(schemaLike?.routines || [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((routine: any) => ({
      name: routine.name,
      type: routine.type,
      definition: routine.definition
    }));

  const canonicalTriggers = [...(schemaLike?.triggers || [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((trigger: any) => ({
      name: trigger.name,
      table: trigger.table,
      definition: trigger.definition
    }));

  const canonicalPayload = {
    tables: canonicalTables,
    indexes: canonicalIndexes,
    views: canonicalViews,
    routines: canonicalRoutines,
    triggers: canonicalTriggers
  };

  const jsonString = JSON.stringify(canonicalPayload);

  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
