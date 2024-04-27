CREATE TABLE docs (
  id UUID PRIMARY KEY,
  docName TEXT NOT NULL
);

ALTER TABLE docs ENABLE ELECTRIC;

-- Rich-text tables for the docs.

CREATE TABLE bunches (
  id TEXT PRIMARY KEY,
  -- Another bunchId or "ROOT".
  parent_id TEXT NOT NULL,
  the_offset INTEGER NOT NULL,
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE
);

ALTER TABLE bunches ENABLE ELECTRIC;

-- To allow merging concurrent deletions within the same bunch,
-- we unfortunately need to store each (Position, char) pair as
-- its own row, instead of as fields within the bunch.
CREATE TABLE char_entries (
  -- String encoding of the Position, used since we need a primary key
  -- but don't want to waste space on a UUID.
  pos TEXT PRIMARY KEY,
  -- Electric does not support CHAR(1), so use TEXT instead.
  char TEXT NOT NULL,
  -- Store doc IDs so we can delete cascade.
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE
);

ALTER TABLE char_entries ENABLE ELECTRIC;

-- Add-only log of TimestampMarks from @list-positions/formatting.
CREATE TABLE formatting_marks (
  -- String encoding of (creatorID, timestamp), used since we need a primary key
  -- but don't want to waste space on a UUID.
  id TEXT PRIMARY KEY,
  start_pos TEXT NOT NULL,
  start_before BOOLEAN NOT NULL,
  end_pos TEXT NOT NULL,
  end_before BOOLEAN NOT NULL,
  the_key TEXT NOT NULL,
  -- JSON encoded.
  the_value TEXT NOT NULL,
  -- Store doc IDs so we can delete cascade.
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE
);

ALTER TABLE formatting_marks ENABLE ELECTRIC;