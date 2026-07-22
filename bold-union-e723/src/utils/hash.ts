/**
 * Computes a deterministic SHA-256 hash string over a canonicalized schema metadata object.
 * Any structural change to table names, column names, column data types, key constraints,
 * or relationships produces a different 64-character hex hash string.
 */
export async function computeSchemaHash(tables: any[]): Promise<string> {
  if (!tables || tables.length === 0) {
    return 'empty_schema';
  }

  // 1. Sort tables deterministically by table name
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

  // 2. Stringify canonicalized structure
  const jsonString = JSON.stringify(canonicalTables);

  // 3. Digest using Web Crypto SHA-256 (Cloudflare Workers & Node.js standard)
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // 4. Convert ArrayBuffer to 64-char Hex String
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hexHash;
}
