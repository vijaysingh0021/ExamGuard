const {Client}=require('pg');
const c=new Client('postgresql://postgres:123456@localhost:5432/postgres');
c.connect().then(async()=>{
  const res = await c.query("SELECT datname FROM pg_database WHERE datname = 'examguard_test'");
  if (res.rows.length === 0) {
    await c.query('CREATE DATABASE examguard_test');
    console.log('CREATED DATABASE examguard_test');
  } else {
    console.log('DATABASE examguard_test already exists');
  }
  await c.end();
}).catch(e=>{console.error('ERR',e.message); process.exit(1);});