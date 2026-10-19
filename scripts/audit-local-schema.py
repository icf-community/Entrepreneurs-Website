#!/usr/bin/env python3
"""Compare local function bodies and migration history with the checked-out SQL.
Read-only; Docker's named local container is the only accepted target.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--container', default='supabase_db_EntrepreneursWebsite')
p.add_argument('--out', type=Path, default=ROOT / 'docs/verification/local-schema.json')
a = p.parse_args()
if not re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+', a.container):
    p.error('requires a named local Supabase container')
query = """select json_build_object(
 'versions', (select json_agg(version order by version) from supabase_migrations.schema_migrations),
 'functions', (select json_agg(json_build_object('schema',n.nspname,'name',p.proname,
 'args',pg_get_function_identity_arguments(p.oid),'body',p.prosrc))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','ai_private') and not exists
 (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')));"""
live = json.loads(subprocess.check_output(['docker','exec',a.container,'psql','-X','-U','postgres','-d','postgres','-Atc',query], text=True))
def normal(s):
    # Comments and whitespace don't change the body; keep all quoted values.
    s = re.sub(r'/\*.*?\*/|--[^\n]*', '', s, flags=re.S)
    return re.sub(r'\s+', ' ', s).strip().rstrip(';')
latest = {}
files = sorted((ROOT/'supabase/migrations').glob('*.sql'))
pattern = re.compile(r'create\s+(?:or\s+replace\s+)?function\s+"?(public|ai_private)"?\."?(\w+)"?\s*\(.*?\bas\s+(\$\w*\$)(.*?)\3', re.I|re.S)
for f in files:
    for m in pattern.finditer(f.read_text()):
        latest[(m[1].lower(),m[2])] = (f.name,normal(m[4]))
matched, mismatches, unlocated = [], [], []
for f in live['functions']:
    key=(f['schema'],f['name']); source=latest.get(key)
    identity=f"{f['schema']}.{f['name']}({f['args']})"
    if not source: unlocated.append(identity)
    elif source[1] != normal(f['body']): mismatches.append({'function':identity,'latest_file':source[0]})
    else: matched.append(identity)
versions={f.name.split('_')[0] for f in files}
report={'local_only': True,'migration_files':len(files),'recorded_versions':len(live['versions']),
 'unrecorded_files':sorted(versions-set(live['versions'])),
 'unknown_recorded_versions':sorted(set(live['versions'])-versions),
 'matching_function_bodies':len(matched),'body_mismatches':mismatches,'unlocated_functions':unlocated,
 'limits':'Body comparison is diagnostic, not a substitute for fresh replay, grants, triggers and SQL suites; overloaded names need manual review.'}
a.out.parent.mkdir(parents=True,exist_ok=True)
a.out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ('body_mismatches','unlocated_functions','limits')},indent=2))
print(f'{len(mismatches)} differing bodies; {len(unlocated)} unlocated; details: {a.out}')
