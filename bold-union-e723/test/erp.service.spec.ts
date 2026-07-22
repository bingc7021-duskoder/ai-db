import { describe, it, expect } from 'vitest';
import { computeSchemaHash } from '../src/utils/hash';

describe('computeSchemaHash', () => {
  it('changes when indexes, views, routines, or triggers are added to the schema snapshot', async () => {
    const baseSchema = {
      tables: [
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'INTEGER', isPrimaryKey: true, isForeignKey: false },
            { name: 'customer_id', type: 'INTEGER', isPrimaryKey: false, isForeignKey: true, foreignKeyRef: { table: 'customers', column: 'id' } }
          ]
        }
      ],
      indexes: [],
      views: [],
      routines: [],
      triggers: []
    };

    const changedSchema = {
      ...baseSchema,
      indexes: [{ name: 'idx_orders_customer_id', table: 'orders', definition: 'CREATE INDEX idx_orders_customer_id ON orders (customer_id)' }],
      views: [{ name: 'v_orders', definition: 'SELECT * FROM orders' }],
      routines: [{ name: 'refresh_orders', type: 'FUNCTION' }],
      triggers: [{ name: 'trg_orders', table: 'orders' }]
    };

    const baseHash = await computeSchemaHash(baseSchema);
    const changedHash = await computeSchemaHash(changedSchema);

    expect(baseHash).not.toBe(changedHash);
  });
});
