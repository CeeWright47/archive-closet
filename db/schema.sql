-- Run this once in your Neon SQL editor to set up the schema.
-- Dashboard → your project → SQL Editor

CREATE TABLE IF NOT EXISTS pieces (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT,
  color    TEXT,
  material TEXT,
  vibe     TEXT,
  seasons  JSONB    NOT NULL DEFAULT '[]',
  image    TEXT,
  added    BIGINT   NOT NULL
);

CREATE TABLE IF NOT EXISTS inspo (
  id    TEXT PRIMARY KEY,
  vibe  TEXT,
  image TEXT,
  added BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fits (
  id        TEXT PRIMARY KEY,
  title     TEXT,
  occasion  TEXT,
  piece_ids JSONB  NOT NULL DEFAULT '[]',
  why       TEXT,
  missing   TEXT,
  saved     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
