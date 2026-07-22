import { describe, it, expect } from 'vitest';
import { RCAPipelineService } from '../src/services/RCAPipelineService';

describe('RCAPipelineService fallback SQL generation', () => {
  it('builds a safe SELECT fallback for table-specific questions', () => {
    const service = new RCAPipelineService({} as any, 'test-key');
    const metadata = {
      tables: [{ tableName: 'employee' }],
      totalTables: 1,
      totalRelationships: 0
    };

    const sql = (service as any).buildSafeFallbackSql('give me some info about employee table', metadata);

    expect(sql).toBe('SELECT * FROM "employee" LIMIT 50');
  });

  it('builds a COUNT fallback for count questions', () => {
    const service = new RCAPipelineService({} as any, 'test-key');
    const metadata = {
      tables: [{ tableName: 'employee' }],
      totalTables: 1,
      totalRelationships: 0
    };

    const sql = (service as any).buildSafeFallbackSql('how many employees are there', metadata);

    expect(sql).toBe('SELECT COUNT(*) AS total_rows FROM "employee"');
  });
});
