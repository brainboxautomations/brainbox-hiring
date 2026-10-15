-- Video answers: hosted links + direct-to-Storage uploads.
--
-- Two changes, no table DDL:
--   1. Bucket-level size/mime limits. Video uploads now go browser → Storage
--      directly (the `videos anon apply upload` policy from 0005), so the API
--      route never sees the bytes and cannot enforce a limit. The bucket is the
--      authoritative gate; the client-side check is only for fast feedback.
--   2. Normalise `answers.value` for file/video questions.
--
-- `answers.value` shapes for file/video questions (jsonb):
--   { "source": "upload", "storagePath": "applications/<positionId>/<uuid>-<name>",
--     "filename": "clip.mp4", "mimeType": "video/mp4" }
--   { "source": "link", "provider": "loom"|"youtube"|"vimeo"|"drive",
--     "url": "<canonical watch url>", "embedUrl": "<iframe src>" | null }
--
-- Hosted links live ONLY here — they get no `documents` row, since a link is not
-- a stored file and `documents.storage_path` is what the signed-URL reader keys
-- off. `submit_application` needs no change: its answer loop already passes
-- arbitrary jsonb straight through.

-- ── 1. Bucket limits ─────────────────────────────────────────────────────────
update storage.buckets
set file_size_limit = 52428800, -- 50 MB
    allowed_mime_types = array[
      'video/mp4',
      'video/webm',
      'video/quicktime',      -- Safari / iOS .mov
      'video/x-matroska'
    ]
where id = 'videos';

update storage.buckets
set file_size_limit = 15728640 -- 15 MB, matches MAX_RESUME_BYTES in /api/apply
where id = 'resumes';

-- ── 2. Normalise legacy answer values ────────────────────────────────────────
-- Pre-existing file/video answers stored a bare JSON string holding the storage
-- path. Lift those into the object shape. The read path still tolerates bare
-- strings defensively, so this is safe to re-run and safe to skip.
update answers a
set value = jsonb_build_object(
      'source', 'upload',
      'storagePath', a.value #>> '{}'
    )
from questions q
where q.id = a.question_id
  and q.type in ('file', 'video')
  and jsonb_typeof(a.value) = 'string';
