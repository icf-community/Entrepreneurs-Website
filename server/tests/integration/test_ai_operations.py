"""Operations data stays aggregate, concurrency-safe, and SQL-editor-only where required."""
from concurrent.futures import ThreadPoolExecutor
import psycopg
import pytest
from .test_concurrency import DSN, db, _as
from .test_ai_races import ai, _submit

pytestmark = pytest.mark.skipif(not DSN, reason='local AI_INTEGRATION_DSN required')


def call(uid, sql, args=()):
    with psycopg.connect(DSN) as conn:
        _as(conn, uid)
        return conn.execute(sql,args).fetchall()


def test_refusal_counter_counts_concurrent_denials_without_identity(db):
    uid=db.member('operationsrefusal')
    before=db.execute("select coalesce(sum(count),0) from ai_private.admission_refusals where reason='invalid_message'").fetchone()[0]
    def refuse(i):
        return call(uid,"select outcome from ai_submit_turn('network',null,null,'message',%s,%s,null)",('x'*601,f'opsrefusal{i:08}'))[0][0]
    with ThreadPoolExecutor(max_workers=20) as pool:
        assert set(pool.map(refuse,range(20)))=={'invalid_message'}
    after=db.execute("select sum(count) from ai_private.admission_refusals where reason='invalid_message'").fetchone()[0]
    assert after-before==20
    columns=db.execute("select column_name from information_schema.columns where table_schema='ai_private' and table_name='admission_refusals'").fetchall()
    assert {r[0] for r in columns}=={'hour','reason','count'}


def test_overview_is_admin_only_and_audits_once_under_concurrency(db):
    member=db.member('operationsmember')
    admin=db.member('operationsadmin',admin=True)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):call(member,'select admin_ai_overview()')
    with ThreadPoolExecutor(max_workers=10) as pool:
        results=list(pool.map(lambda _:call(admin,'select admin_ai_overview()')[0][0],range(10)))
    assert db.execute("select count(*) from admin_actions where admin_id=%s and action='ai_overview_viewed'",(admin,)).fetchone()[0]==1
    for o in results:
        assert o['refusals_24h']['invalid_message']>=20
        assert set(o['provider_errors_24h'])=={'timeout','rate_limit','server_error','other'}
        assert set(o['cost_today'])=={'reserved','settled','projected'}
        assert set(o['queue_wait_ms_24h'])=={'p50','p95'}
    for role in ['anon','authenticated','ai_service','cv_worker','service_role']:
        assert not db.execute("select has_function_privilege(%s,'ai_private.ai_turn_timeline(uuid)','execute')",(role,)).fetchone()[0]
        for view in ['ai_slowest_stages','ai_latest_errors']:
            assert not db.execute('select has_table_privilege(%s,%s,\'select\')',(role,'ai_private.'+view)).fetchone()[0]


def test_polls_count_without_changing_revision_or_counting_another_owner(ai):
    uid=ai.member('pollowner'); stranger=ai.member('pollstranger')
    turn=_submit(ai,uid)[0]
    before=ai.execute('select coalesce(sum(count),0) from ai_private.poll_counts').fetchone()[0]
    first=call(uid,'select * from ai_turn_status(%s)',(turn,))
    assert first==call(uid,'select * from ai_turn_status(%s)',(turn,))
    assert call(stranger,'select * from ai_turn_status(%s)',(turn,))==[]
    assert ai.execute('select sum(count) from ai_private.poll_counts').fetchone()[0]-before==2
