# Database Schema & Grounding Context Rules

1. GROUNDED IN LIVE POSTGRESQL METADATA
- All table names, column names, data types, primary keys, and foreign key relationships must strictly match the provided live schema metadata.
- Never invent table names, column names, or relationships that do not exist in the active PostgreSQL database.

2. COMBining SCHEMA METADATA WITH SQL RESULTS
- When SQL execution results are provided, blend table metadata with actual row values and counts to explain underlying data patterns.
- Explicitly trace foreign key references between entities when explaining fan-out or join performance bottlenecks.

3. ARCHITECTURAL GROUPINGS
- Group tables logically into business domains (e.g. User Management, Transactions & Billing, System Diagnostics) when describing database topology.
