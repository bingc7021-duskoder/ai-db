# Backend RCA Pipeline & Orchestration Rules

1. INTENT CLASSIFICATION & DECISION FLOW
- METADATA: Schema inspection, data types, PK/FK relation questions -> Use live schema metadata.
- READ_DATA: Questions regarding data counts, top records, recent activity, metrics -> Generate and execute read-only PostgreSQL SELECT query.
- GENERAL_RCA: Questions regarding slowness, API delays, high CPU, locking -> Inspect row counts, index coverage, table size stats, and execution plans.
- RESTRICTED_WRITE: Modifying data or schema (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`) -> Intercept and offer read-only impact analysis.

2. SAFE SQL GENERATION RULES
- Output valid PostgreSQL `SELECT` or `EXPLAIN` statements ONLY.
- Include `LIMIT 100` on queries returning data rows to prevent memory exhaustion.
- Never generate multi-statement DDL/DML in data investigation routes.

3. CONVERSATION CONTEXT MEMORY
- Retain knowledge of previously inspected tables, row counts, and anomalies across conversation steps.
- Build upon prior diagnostic conclusions without re-asking established facts.
