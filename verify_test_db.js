const {Client}=require('pg');
const c=new Client('postgresql://postgres:123456@localhost:5432/examguard_test');
c.connect().then(async()=>{
  const all=await c.query("select table_schema, table_name from information_schema.tables order by 1,2");
  console.log('ALL TABLES:');
  all.rows.forEach(r=>console.log(r.table_schema+'.'+r.table_name));
  const rels=await c.query("select relname, relpages, reltuples::bigint from pg_class where relkind='r' and relname not like 'pg_%' and relname not like 'sql_%' order by 1");
  console.log('USER RELATIONS:');
  rels.rows.forEach(r=>console.log(r.relname, 'pages='+r.relpages, 'tuples='+r.reltuples));
  const check = await c.query("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='attempt_answers')");
  console.log('\nattempt_answers EXISTS:', check.rows[0].exists);
  await c.end();
}).catch(e=>{console.error('ERR',e.message); process.exit(1);});