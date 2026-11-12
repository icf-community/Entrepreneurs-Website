-- Timeouts for the two service logins (programme S0, gap 37).
--
-- authenticated (8 s) and anon (3 s) carry Supabase's statement timeouts,
-- and authenticator adds lock_timeout. The executor (ai_service) and the
-- CV worker (cv_worker) log in directly and had none: one slow query, a
-- lock held by a stuck transaction, or a connection left idle inside a
-- transaction would hold its locks and its pooler slot indefinitely.
--
-- Both loops already treat a database error as retryable with backoff
-- (app/ai/runner.py, app/worker.py), and a timed-out provider stage keeps
-- its reservation at the upper bound, so a timeout costs a retry, never a
-- duplicate paid call. Role settings apply at login, so a running process
-- picks them up on its next connection.
--
-- ai_service: every executor statement is a short SECURITY DEFINER call
-- (retrieval at 10k members is well under 100 ms); 15 s is a ceiling for
-- something wrong, not a budget. lock_timeout also bounds advisory-lock
-- waits (claim, admission, spend), each held for milliseconds.
-- cv_worker: batch writes (chunks, embeddings) get more room.

alter role ai_service set statement_timeout = '15s';
alter role ai_service set lock_timeout = '3s';
alter role ai_service set idle_in_transaction_session_timeout = '30s';

alter role cv_worker set statement_timeout = '60s';
alter role cv_worker set lock_timeout = '5s';
alter role cv_worker set idle_in_transaction_session_timeout = '60s';
