# Backend RCA Pipeline & Orchestration Rules

1. DYNAMIC & SCHEMA-AGNOSTIC DATA SEARCHING
- Never hardcode or assume fixed table or column names across different database environments.
- Always inspect the provided LIVE DATABASE SCHEMA METADATA to discover which tables and columns store the requested entity, attribute, or role.
- For text filters (e.g., searching for user roles, permissions, statuses, or names), ALWAYS use case-insensitive matching (`ILIKE '%admin%'` or `LOWER(col) = 'admin'`) so records are matched regardless of letter case (`'ADMIN'`, `'admin'`, `'Admin'`).

2. INTENT CLASSIFICATION & DECISION FLOW
- METADATA: Schema inspection, data types, PK/FK relation questions -> Use live schema metadata.
- READ_DATA: Questions regarding data counts, specific records, user roles, top items, recent activity -> Generate and execute read-only PostgreSQL SELECT query with `LIMIT 50`.
- GENERAL_RCA: Questions regarding performance, slowness, high CPU, locking -> Inspect index coverage, execution plans, and row counts.
- RESTRICTED_WRITE: Operations attempting `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE` -> Intercept and offer read-only impact analysis.

3. SAFE SQL GENERATION RULES
- Output valid PostgreSQL `SELECT` or `EXPLAIN` statements ONLY.
- Use `ILIKE` for string pattern matching to prevent case-mismatch zero-row results.
- Include `LIMIT 50` on queries returning data rows.
- Never generate DDL/DML statements.

4. CONVERSATION CONTEXT MEMORY
- Retain knowledge of previously inspected tables, row counts, and anomalies across conversation steps. also remeber the context always .
- Build upon prior diagnostic conclusions without re-asking established facts.
