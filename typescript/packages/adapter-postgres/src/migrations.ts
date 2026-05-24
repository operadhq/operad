import type postgres from 'postgres'

/**
 * Run all Operad schema migrations.
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
export async function migrate(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    -- Immutable event log (created first — other tables reference it)
    CREATE TABLE IF NOT EXISTS operad_events (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      caused_by TEXT REFERENCES operad_events(id),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_operad_events_graph_id ON operad_events(graph_id);
    CREATE INDEX IF NOT EXISTS idx_operad_events_type ON operad_events(type);
    CREATE INDEX IF NOT EXISTS idx_operad_events_caused_by ON operad_events(caused_by);
    CREATE INDEX IF NOT EXISTS idx_operad_events_timestamp ON operad_events(timestamp);

    -- Graph objects (nodes)
    CREATE TABLE IF NOT EXISTS operad_objects (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by_event_id TEXT NOT NULL REFERENCES operad_events(id)
    );

    CREATE INDEX IF NOT EXISTS idx_operad_objects_graph_id ON operad_objects(graph_id);
    CREATE INDEX IF NOT EXISTS idx_operad_objects_type ON operad_objects(type);
    CREATE INDEX IF NOT EXISTS idx_operad_objects_graph_type ON operad_objects(graph_id, type);

    -- Graph relations (directed edges)
    CREATE TABLE IF NOT EXISTS operad_relations (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES operad_objects(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES operad_objects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by_event_id TEXT NOT NULL REFERENCES operad_events(id)
    );

    CREATE INDEX IF NOT EXISTS idx_operad_relations_graph_id ON operad_relations(graph_id);
    CREATE INDEX IF NOT EXISTS idx_operad_relations_source_id ON operad_relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_operad_relations_target_id ON operad_relations(target_id);
    CREATE INDEX IF NOT EXISTS idx_operad_relations_type ON operad_relations(type);

    -- Decision records
    CREATE TABLE IF NOT EXISTS operad_decisions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES operad_events(id),
      graph_id TEXT NOT NULL,
      selected_action TEXT NOT NULL,
      alternatives JSONB NOT NULL DEFAULT '[]',
      confidence NUMERIC(5, 4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      reasoning TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_operad_decisions_graph_id ON operad_decisions(graph_id);
    CREATE INDEX IF NOT EXISTS idx_operad_decisions_confidence ON operad_decisions(confidence);

    -- Object health tracking
    CREATE TABLE IF NOT EXISTS operad_health (
      object_id TEXT PRIMARY KEY REFERENCES operad_objects(id) ON DELETE CASCADE,
      last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      verification_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      success_rate NUMERIC(5, 4) NOT NULL DEFAULT 1.0,
      stale_since TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_operad_health_last_verified ON operad_health(last_verified_at);
  `)
}
