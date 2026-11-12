"""B13: the worker's database connection requires TLS unless the DSN opts out."""

from psycopg.conninfo import conninfo_to_dict

from app.db import conninfo


def test_requires_tls_by_default():
    dsn = "postgresql://cv_worker.ref:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"
    assert conninfo_to_dict(conninfo(dsn))["sslmode"] == "require"


def test_an_explicit_sslmode_wins():
    assert conninfo_to_dict(conninfo("postgresql://u:p@127.0.0.1:54322/postgres?sslmode=disable"))["sslmode"] == "disable"
    assert conninfo_to_dict(conninfo("postgresql://u:p@h/db?sslmode=verify-full"))["sslmode"] == "verify-full"


def test_keeps_everything_else():
    out = conninfo_to_dict(conninfo("postgresql://u:secret@h:6543/db?application_name=worker"))
    assert out["user"] == "u" and out["password"] == "secret" and out["port"] == "6543"
    assert out["dbname"] == "db" and out["application_name"] == "worker"
