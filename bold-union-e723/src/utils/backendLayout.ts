export const BACKEND_LAYOUT_CONFIG = {
  NODE_WIDTH: 320,
  BASE_HEADER_HEIGHT: 54,
  ROW_HEIGHT: 32,
  PADDING: 24,
  NODESEP: 140, // Horizontal separation between table cards
  RANKSEP: 180  // Vertical separation between ranks
};

export interface TableNodeData {
  tableName: string;
  label: string;
  columns: any[];
  group?: string;
  importance?: number;
  hierarchyLevel?: number;
}

export interface BackendGraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  data: TableNodeData;
}

export interface BackendGraphEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  label: string;
  animated?: boolean;
}

export interface BackendGraphGroup {
  id: string;
  name: string;
  color?: string;
  tables: string[];
  position: { x: number; y: number };
  style: { width: number; height: number };
}

export interface BackendRenderGraph {
  nodes: BackendGraphNode[];
  edges: BackendGraphEdge[];
  groups: BackendGraphGroup[];
  labels: any[];
}

/**
 * Calculates exact dynamic height for a table node.
 */
export function calculateTableHeight(columnsCount: number, hasBadges: boolean = false): number {
  const count = Math.max(1, columnsCount);
  return (
    BACKEND_LAYOUT_CONFIG.BASE_HEADER_HEIGHT +
    count * BACKEND_LAYOUT_CONFIG.ROW_HEIGHT +
    (hasBadges ? 28 : 0) +
    BACKEND_LAYOUT_CONFIG.PADDING
  );
}

/**
 * Computes deterministic grid & rank layout on the backend.
 * Organizes tables into domains and hierarchical ranks, placing root/parent entities on top/left,
 * transactional entities in the middle, and detail tables at the bottom/right.
 */
export function computeBackendGraphLayout(
  tables: any[],
  domainStructure: {
    domains?: Array<{ id: string; name: string; color?: string; tables: string[] }>;
    tableMetadata?: Record<string, { friendlyLabel?: string; importance?: number; hierarchyLevel?: number }>;
    annotations?: Array<{ text: string; targetDomain?: string }>;
  }
): BackendRenderGraph {
  const startTime = performance.now();

  const domains = domainStructure.domains || [];
  const tableMetadataMap = domainStructure.tableMetadata || {};

  // Build relationship edges array
  const rawEdges: BackendGraphEdge[] = [];
  tables.forEach((table) => {
    (table.columns || []).forEach((col: any) => {
      if (col.isForeignKey && col.foreignKeyRef) {
        const sourceTable = table.name;
        const sourceColumn = col.name;
        const targetTable = col.foreignKeyRef.table;
        const targetColumn = col.foreignKeyRef.column;

        rawEdges.push({
          id: `edge-${sourceTable}-${targetTable}-${sourceColumn}`,
          type: 'smoothstep',
          source: sourceTable,
          target: targetTable,
          sourceHandle: `${sourceTable}-${sourceColumn}-source`,
          targetHandle: `${targetTable}-${targetColumn}-target`,
          label: 'references'
        });
      }
    });
  });

  // Organize tables into domain clusters or default cluster
  const tableDomainMap = new Map<string, string>();
  domains.forEach((d) => {
    (d.tables || []).forEach((tName) => {
      tableDomainMap.set(tName, d.id);
    });
  });

  // Calculate coordinates per domain section
  let currentYOffset = 60;
  const nodes: BackendGraphNode[] = [];
  const groups: BackendGraphGroup[] = [];

  // Sort domains or process all tables
  const unassignedTables = new Set(tables.map((t) => t.name));

  const processTableGroup = (
    groupKey: string,
    groupName: string,
    groupColor: string | undefined,
    groupTableNames: string[]
  ) => {
    const groupTables = tables.filter((t) => groupTableNames.includes(t.name));
    if (groupTables.length === 0) return;

    // Remove from unassigned
    groupTables.forEach((t) => unassignedTables.delete(t.name));

    // Sort group tables by hierarchy level then name
    groupTables.sort((a, b) => {
      const levelA = tableMetadataMap[a.name]?.hierarchyLevel ?? 1;
      const levelB = tableMetadataMap[b.name]?.hierarchyLevel ?? 1;
      if (levelA !== levelB) return levelA - levelB;
      return a.name.localeCompare(b.name);
    });

    let currentX = 60;
    let maxYInRow = 0;
    const cardsPerRow = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(groupTables.length * 1.5))));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    groupTables.forEach((t, idx) => {
      if (idx > 0 && idx % cardsPerRow === 0) {
        currentX = 60;
        currentYOffset += maxYInRow + BACKEND_LAYOUT_CONFIG.RANKSEP;
        maxYInRow = 0;
      }

      const columnsCount = t.columns ? t.columns.length : 1;
      const height = calculateTableHeight(columnsCount);
      const width = BACKEND_LAYOUT_CONFIG.NODE_WIDTH;

      const meta = tableMetadataMap[t.name];
      const friendlyLabel = meta?.friendlyLabel || t.name.charAt(0).toUpperCase() + t.name.slice(1);

      const nodeX = currentX;
      const nodeY = currentYOffset;

      nodes.push({
        id: t.name,
        type: 'tableNode',
        position: { x: nodeX, y: nodeY },
        width,
        height,
        data: {
          tableName: t.name,
          label: friendlyLabel,
          columns: t.columns || [],
          group: groupKey,
          importance: meta?.importance ?? 2,
          hierarchyLevel: meta?.hierarchyLevel ?? 1
        }
      });

      minX = Math.min(minX, nodeX);
      minY = Math.min(minY, nodeY);
      maxX = Math.max(maxX, nodeX + width);
      maxY = Math.max(maxY, nodeY + height);

      maxYInRow = Math.max(maxYInRow, height);
      currentX += width + BACKEND_LAYOUT_CONFIG.NODESEP;
    });

    // Create Group Bounding Box
    if (minX !== Infinity) {
      const padding = 35;
      groups.push({
        id: `group-${groupKey}`,
        name: groupName,
        color: groupColor,
        tables: groupTables.map((t) => t.name),
        position: { x: minX - padding, y: minY - padding - 30 },
        style: {
          width: maxX - minX + padding * 2,
          height: maxY - minY + padding * 2 + 30
        }
      });
    }

    currentYOffset += maxYInRow + BACKEND_LAYOUT_CONFIG.RANKSEP + 80;
  };

  // Process defined domains
  domains.forEach((d) => {
    processTableGroup(d.id, d.name, d.color, d.tables || []);
  });

  // Process any unassigned tables
  if (unassignedTables.size > 0) {
    processTableGroup(
      'unassigned',
      'General Schema',
      '#64748b',
      Array.from(unassignedTables)
    );
  }

  const endTime = performance.now();
  console.log(
    `[Backend Layout] Computed render-ready graph for ${nodes.length} tables and ${rawEdges.length} edges in ${(endTime - startTime).toFixed(2)} ms`
  );

  return {
    nodes,
    edges: rawEdges,
    groups,
    labels: domainStructure.annotations || []
  };
}
