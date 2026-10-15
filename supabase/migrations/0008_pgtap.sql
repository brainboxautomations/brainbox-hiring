-- pgTAP — the L4 (database) test layer.
--
-- RLS *is* the authorisation model in Phase 1: there are no roles, so the
-- anon/authenticated policy split is the entire security boundary. A policy
-- regression is silent — the app keeps working, it just leaks. pgTAP is the
-- only layer that catches that, so the extension ships as schema, not as a
-- developer's local convenience.
--
-- Installed into `extensions`, NOT `public`. The security advisor already flags
-- `citext` for living in `public` (inherited from 0001, and moving it would
-- rewrite an applied migration); pgTAP adds ~1,000 functions and putting those
-- in `public` would both drown that surface and expose them through PostgREST.
-- `search_path` on this project is `"$user", public, extensions`, so test files
-- can call plan()/finish()/ok() unqualified without any further setup.
--
-- Safe to leave installed on a dev database: every pgTAP function is a test
-- assertion or a catalogue query. None of them mutate application data, and no
-- grants are issued here, so `anon` and `authenticated` cannot reach them.
create schema if not exists extensions;

create extension if not exists pgtap with schema extensions;
