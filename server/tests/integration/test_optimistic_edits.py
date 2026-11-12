"""Two-tab edits are compared under lock; unrelated uploads never stale a form."""
import psycopg
import pytest
from .test_concurrency import (DSN, db, admins, _as, _one, hold_then_race,
                               _pending_event, _pending_opportunity, _pending_vc)

pytestmark = pytest.mark.skipif(not DSN, reason='local AI_INTEGRATION_DSN required')


def revision(db, table, uid):
    # Lets the same regression assertion run against the old schema.
    return db.execute(f"select coalesce(to_jsonb(t)->>'edit_version','0')::bigint from public.{table} t where id=%s", (uid,)).fetchone()[0]


def save(db, kind, uid, expected):
    if kind == 'profile':
        sql = "select public.update_profile('Changed', 'Member', 'Computing', 2028, null, null, null"
    elif kind == 'event':
        sql = "select public.update_event(%s, 'Edited title', 'Edited description of the event for members.', 'https://lu.ma/x', now()+interval '9 days', 'Huxley','ICF','e@imperial.ac.uk',false"
    elif kind == 'opportunity':
        sql = "select public.update_opportunity(%s,'Edited title','Acme','Paid','remote',null,'Edited description of the role.',6::smallint,2027,current_date+30,'jobs@acme.test',false,'email',null,'{}'::smallint[],'{}'::smallint[],'both'"
    else:
        sql = "select public.update_vc_grant(%s,'vc','Edited title','Edited description of the fund for founders.','https://vc.test',null,null,null"
    has_version = db.execute("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='edit_version')").fetchone()[0]
    if has_version:
        sql += f', p_expected_version => {expected}'
    return sql+')', (() if kind=='profile' else (uid,))


@pytest.mark.parametrize('kind', ['profile','event','opportunity','vc_grant'])
def test_two_tabs_cannot_both_save_one_revision(db, kind):
    owner=db.member('twotabs'+kind)
    table={'profile':'profiles','event':'events','opportunity':'opportunities','vc_grant':'vcs_grants'}[kind]
    uid=owner if kind=='profile' else {'event':_pending_event,'opportunity':_pending_opportunity,'vc_grant':_pending_vc}[kind](db,owner)
    sql,args=save(db,kind,uid,revision(db,table,uid))
    first,second=hold_then_race(lambda c:_one(c,sql,args),lambda c:_one(c,sql,args),first_as=owner,second_as=owner)
    assert isinstance(second, psycopg.Error) and second.sqlstate == 'PT409', 'stale tab silently overwrote the first save'
    assert 'another tab' in str(second)


def test_media_update_does_not_stale_profile(db):
    owner=db.member('uploadedit')
    before=revision(db,'profiles',owner)
    db.execute("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false)")
    db.execute("update profiles set avatar_path='avatars/test.jpg', cv_uploaded_at=now() where id=%s",(owner,))
    assert revision(db,'profiles',owner)==before
    sql,args=save(db,'profile',owner,before)
    with db.transaction():
        _as(db,owner)
        db.execute(sql,args)


def test_member_cannot_reset_revision(db):
    owner=db.member('forgedrevision')
    with pytest.raises(psycopg.errors.InsufficientPrivilege), db.transaction():
        _as(db,owner)
        db.execute('update profiles set edit_version=99 where id=%s',(owner,))


def test_profile_returns_exact_saved_revision(db):
    owner=db.member('returnrevision')
    sql,args=save(db,'profile',owner,revision(db,'profiles',owner))
    with db.transaction():
        _as(db,owner)
        saved=db.execute(sql,args).fetchone()[0]
    assert saved==revision(db,'profiles',owner)
